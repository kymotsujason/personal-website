// the build that ships (pnpm build with no CAPTURE, served by the ship project), which has no dev tools and no capture
// readout. everything is read from the page and from dist, since window.__capture isn't there
import { readdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { quiet, watchErrors } from "./scene";

const DIST = new URL("../../dist/", import.meta.url);
const PRELOADED = [
  "/models/phone.packed.glb",
  "/models/hands.packed.glb",
  "/models/hands-rig.json",
  "/keys/landscape-baked.json",
  "/keys/support.json",
  "/keys/pinch.json",
  "/keys/portrait-grips.json",
  "/desk-small.jpg",
  "/desk-wall-mask-small.png",
];
const DEV_STRINGS = [
  "poseEditor",
  "__save",
  "__perf",
  "spikeApi",
  "__capture",
  "noweather",
];

const distFiles = (): URL[] =>
  readdirSync(DIST, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => new URL(`${entry.parentPath}/${entry.name}`, "file://"));

// the first frame is up. the page itself stays hidden on the home screen, where the phone shows its content
const shown = (page: Page) =>
  page.waitForFunction(
    () =>
      (window as unknown as { __sceneShown?: boolean }).__sceneShown === true &&
      document.body.classList.contains("ready"),
    null,
    { timeout: 60000 },
  );

const openedPage = (page: Page, path: string, heading: string) =>
  page.waitForFunction(
    ([path, heading]) => {
      const pageEl = document.getElementById("page");
      const h1 = pageEl?.querySelector("h1");
      return (
        location.pathname === path &&
        h1?.textContent === heading &&
        pageEl!.style.pointerEvents !== "none" &&
        document.body.classList.contains("ready")
      );
    },
    [path, heading],
    { timeout: 60000 },
  );

test("the dev tools are absent, the intro plays, and an app opens and closes", async ({
  page,
}) => {
  test.setTimeout(180000);
  await quiet(page);
  const { errors } = watchErrors(page);
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  // the dev, frame log, and slow switches do nothing in this build. a slow of 50 would keep About from opening for
  // minutes if it counted
  await page.goto("/?dev&perf&slow=50");
  await expect(page.locator("html")).toHaveClass(/has-3d/);
  await shown(page);

  const globals = await page.evaluate(() => ({
    panel: document.getElementById("panel") !== null,
    spike: "spike" in window,
    capture: "__capture" in window,
    perf: "__perf" in window,
  }));
  expect(globals).toEqual({
    panel: false,
    spike: false,
    capture: false,
    perf: false,
  });
  expect(
    requested.filter((url) =>
      /\/src\/dev\/|__perf|__save|spikeApi|perf\.js|panel\.js/.test(url),
    ),
  ).toEqual([]);

  // the intro takes the icons' clicks once it ends, so About is tapped until it opens
  const about = page
    .locator("#css-layer .panel.main .app-icon")
    .filter({ hasText: "About" });
  await expect(about).toHaveCount(1);
  await expect(async () => {
    await about.evaluate((icon: HTMLElement) => icon.click());
    await expect(page).toHaveURL((url) => url.pathname === "/about", {
      timeout: 1000,
    });
  }).toPass({ timeout: 60000 });
  await openedPage(page, "/about", "About");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.locator("#page")).toHaveAttribute("data-app", "home");
  await expect(page.locator("#page")).toBeHidden();
  await expect(page.locator("html")).not.toHaveClass(/scene-failed/);
  expect(errors).toEqual([]);
});

test("dist has none of the dev tools' code", () => {
  const files = distFiles();
  expect(files.length).toBeGreaterThan(10);
  const text = files.filter((file) =>
    /\.(js|html|css|json|txt|xml)$/.test(file.pathname),
  );
  expect(text.length).toBeGreaterThan(5);
  for (const file of text) {
    const body = readFileSync(file, "utf8");
    for (const word of DEV_STRINGS) {
      expect(body.includes(word), `${file.pathname} has ${word}`).toBe(false);
    }
  }
  // a chunk named for a dev module would hold its code
  const names = files.map((file) => file.pathname.split("/").pop()!);
  expect(
    names.filter((name) =>
      /perf|panel|poseEditor|spikeApi|capture/i.test(name),
    ),
  ).toEqual([]);
});

test("/dev gives the not found page", async ({ page }) => {
  const response = await page.goto("/dev");
  expect(response?.status()).toBe(404);
  await expect(page.locator("#page h1")).toHaveText(
    "No connection to this page",
  );
});

// the chunks a page asks for, by the name before the hash
const watchChunks = (page: Page) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    const match = /\/_astro\/([A-Za-z0-9_-]+?)\.[A-Za-z0-9_-]{8}\.js$/.exec(
      new URL(request.url()).pathname,
    );
    if (match) {
      asked.push(match[1]);
    }
  });
  return asked;
};

// the head script adds them only with 3d, so the flat site and a browser without javascript never download them
test("with 3d the head preloads the models, the keys, and the rig", async ({
  page,
  request,
}) => {
  const html = await (await request.get("/")).text();
  expect(html, "none in the html itself").not.toContain('rel="preload"');
  await quiet(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/has-3d/);
  const links = await page
    .locator('head link[rel="preload"]')
    .evaluateAll((els) =>
      els.map((el) => ({
        href: el.getAttribute("href"),
        as: el.getAttribute("as"),
        crossorigin: el.getAttribute("crossorigin"),
      })),
    );
  expect(links).toEqual(
    PRELOADED.map((href) => ({ href, as: "fetch", crossorigin: "anonymous" })),
  );
});

// the blurred desk behind the flat page is the small desk image, which the flat site loads for itself
test("the flat site preloads nothing", async ({ page }) => {
  await quiet(page);
  await page.addInitScript(() => localStorage.setItem("2d", "1"));
  const requested: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await page.goto("/about");
  await expect(page.locator("#page h1")).toBeVisible();
  await expect(page.locator('head link[rel="preload"]')).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  const unused = PRELOADED.filter((path) => path !== "/desk-small.jpg");
  expect(requested.filter((path) => unused.includes(path))).toEqual([]);
});

test("the music and the volume buttons load when they're needed, and the cable stays out", async ({
  page,
}) => {
  test.setTimeout(120000);
  await quiet(page);
  const { errors } = watchErrors(page);
  const asked = watchChunks(page);
  await page.goto("/");
  await shown(page);
  expect(asked, "no music code before a gesture").not.toContain("music");
  expect(asked).not.toContain("youtube");
  await page.mouse.click(5, 5);
  await expect.poll(() => asked).toContain("music");
  await expect.poll(() => asked).toContain("youtube");
  await expect
    .poll(() => asked, { message: "the volume buttons after the intro" })
    .toContain("volume");
  expect(asked, "a full battery needs no cable").not.toContain("charger");
  expect(errors).toEqual([]);
});

// a preload whose as or crossorigin differs from the loader's own request isn't reused, so the file comes down twice
test("each preloaded file is requested once", async ({ page }) => {
  test.setTimeout(120000);
  await quiet(page);
  const counts = new Map<string, number>();
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  });
  await page.goto("/");
  await shown(page);
  expect(
    Object.fromEntries(PRELOADED.map((path) => [path, counts.get(path)])),
  ).toEqual(Object.fromEntries(PRELOADED.map((path) => [path, 1])));
});

// chromium keeps a failed module import failed for the rest of the page load without fetching it again, so the warning
// each try logs is what counts the tries
test("a charging cable chunk that fails isn't asked for again", async ({
  page,
}) => {
  test.setTimeout(120000);
  await quiet(page);
  const { errors, blocked } = watchErrors(page);
  let tries = 0;
  page.on("console", (message) => {
    if (message.text().includes("the charging cable didn't load")) {
      tries += 1;
    }
  });
  // the same low battery as below, whose drain ticks about every 6 s, each asking for the cable
  await page.addInitScript(() =>
    localStorage.setItem(
      "duo-battery-start",
      String(Date.now() - 9.7 * 60 * 1000),
    ),
  );
  let asked = 0;
  await page.route(
    (url) => /\/_astro\/charger\.[A-Za-z0-9_-]{8}\.js$/.test(url.pathname),
    (route) => {
      asked += 1;
      blocked.add(route.request().url());
      return route.abort();
    },
  );
  await page.goto("/");
  await shown(page);
  await expect.poll(() => tries).toBe(1);
  // past two of the battery's ticks
  await page.waitForTimeout(14000);
  expect(tries, "tries").toBe(1);
  expect(asked, "requests").toBe(1);
  await expect(page.locator("html")).not.toHaveClass(/scene-failed/);
  expect(errors).toEqual([]);
});

test("the charging cable loads when the battery is low", async ({ page }) => {
  test.setTimeout(120000);
  await quiet(page);
  const { errors } = watchErrors(page);
  // 9.7 of the 10 drain minutes gone leaves the battery at 4%
  await page.addInitScript(() =>
    localStorage.setItem(
      "duo-battery-start",
      String(Date.now() - 9.7 * 60 * 1000),
    ),
  );
  const asked = watchChunks(page);
  await page.goto("/");
  await shown(page);
  await expect.poll(() => asked).toContain("charger");
  await expect(page.locator("html")).not.toHaveClass(/scene-failed/);
  expect(errors).toEqual([]);
});
