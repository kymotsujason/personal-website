import { expect, test, type Page } from "@playwright/test";
import { quiet, settledOn } from "./scene";

const savedChoice = (page: import("@playwright/test").Page) =>
  page.evaluate(() => ({
    choice: localStorage.getItem("2d"),
    auto: localStorage.getItem("2dAuto"),
  }));

test("webgl drawn in software gets the 2d scene, and ?3d still shows the 3d one", async ({
  playwright,
}, testInfo) => {
  // the runner adds the project's gpu flags to this launch too, so swiftshader is asked for by name
  const browser = await playwright.chromium.launch({
    args: ["--use-angle=swiftshader"],
  });
  try {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
    });
    const page = await context.newPage();
    await quiet(page);
    await page.goto("/");
    const renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl && info
        ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
        : "";
    });
    expect(renderer, "the browser draws webgl in software").toMatch(
      /swiftshader/i,
    );
    await expect(page.locator("html")).not.toHaveClass(/has-3d/);
    await expect(page.locator("html")).toHaveClass(/has-flat-scene/);
    await expect(page.locator(".flat-home h1")).toHaveText("Jason Yue");
    await expect(page.locator(".flat-home .flat-body")).toBeVisible();

    await page.goto("/?3d");
    await expect(page.locator("html")).toHaveClass(/has-3d/);
    expect(await savedChoice(page)).toEqual({ choice: "0", auto: null });
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/has-3d/);
  } finally {
    await browser.close();
  }
});

// each frame takes at least 60 ms, under 17 fps, which no step of the 3d ladder can fix. window.__fastAgain ends it, so a
// test can stop spending the cpu once the slow step has been taken
const slowFrames = (page: Page) =>
  page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf((time) => {
        const end = performance.now() + 60;
        while (!(window as any).__fastAgain && performance.now() < end) {
          // the slow device
        }
        callback(time);
      });
  });

// what the page shows at the end of each task that changes it: the root's classes, and whether the handoff's cover
// is up (not lifting). only changes are kept
const watchHandoff = (page: Page) =>
  page.addInitScript(() => {
    const log: { classes: string; cover: boolean; any: boolean }[] = [];
    (window as any).__handoffLog = log;
    let last = "";
    const record = () => {
      const cover = document.querySelector("#stage > .flat-blackout");
      const entry = {
        classes: document.documentElement.className,
        cover: Boolean(cover && !cover.classList.contains("lifting")),
        any: Boolean(cover),
      };
      const key = JSON.stringify(entry);
      if (key !== last) {
        last = key;
        log.push(entry);
      }
    };
    new MutationObserver(record).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  });

type Shown = { classes: string; cover: boolean; any: boolean };
const handoffLog = (page: Page): Promise<Shown[]> =>
  page.evaluate(() => (window as any).__handoffLog);
const has = (entry: Shown, name: string) =>
  entry.classes.split(/\s+/).includes(name);

// from the moment has-3d went, the plain flat page never showed: the cover was up until the 2d scene's first frame
const neverFlat = (log: Shown[]) => {
  const started = log.findIndex((entry) => has(entry, "has-3d"));
  expect(started, "the 3d scene ran").toBeGreaterThanOrEqual(0);
  const from = log.findIndex(
    (entry, i) => i > started && !has(entry, "has-3d"),
  );
  expect(from, "the 3d scene handed off").toBeGreaterThan(started);
  for (const entry of log.slice(from)) {
    expect(has(entry, "scene-failed"), entry.classes).toBe(false);
    expect(has(entry, "has-flat-scene"), entry.classes).toBe(true);
    if (!has(entry, "flat-ready")) {
      expect(entry.cover, entry.classes).toBe(true);
    }
  }
};

const flatStatus = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__flat?.status();
    return s
      ? {
          phone: s.phone,
          busy: s.busy,
          zoomed: s.zoomed,
          app: s.app,
          path: location.pathname,
          pageApp: document.getElementById("page")?.dataset.app,
        }
      : null;
  });

const flatSettledOn = (page: Page, path: string, app: string | null) =>
  expect
    .poll(() => flatStatus(page), { timeout: 30000 })
    .toMatchObject({
      phone: "open",
      busy: false,
      zoomed: app !== null,
      app,
      path,
      pageApp: app ?? "home",
    });

// the cover is up, the 2d scene hasn't shown, and nothing of the 3d scene is left
const underCover = async (page: Page) => {
  const root = page.locator("html");
  // the ladder's step lands either way, and the plain flat page isn't waited out to the timeout
  await expect
    .poll(
      () =>
        root.evaluate((el) =>
          el.classList.contains("scene-failed")
            ? "the plain flat page"
            : el.classList.contains("has-flat-scene")
              ? "the 2d scene"
              : null,
        ),
      { timeout: 150000 },
    )
    .not.toBeNull();
  await expect(root).toHaveClass(/has-flat-scene/);
  await expect(root).not.toHaveClass(/has-3d/);
  await expect(root).not.toHaveClass(/scene-failed/);
  await expect(root).not.toHaveClass(/page-pinned/);
  await expect(page.locator("#stage > .flat-blackout")).toHaveCount(1);
};

test("the slow 3d scene hands off to the 2d scene without scene-failed", async ({
  page,
}) => {
  test.setTimeout(240000);
  await slowFrames(page);
  await watchHandoff(page);
  await quiet(page);
  await page.goto("/");
  const root = page.locator("html");
  await expect(root).toHaveClass(/has-3d/);
  await settledOn(page, "/", null, 90000);
  await underCover(page);
  await page.evaluate(() => Object.assign(window, { __fastAgain: true }));
  // the 3d scene left nothing behind
  expect(
    await page.evaluate(() => ({
      shown: (window as any).__sceneShown ?? null,
      ready: document.body.classList.contains("ready"),
      overPhone: document.body.classList.contains("over-phone"),
      cssLayer: document.getElementById("css-layer")?.childElementCount,
      glassFill:
        document.documentElement.style.getPropertyValue("--glass-fill"),
    })),
  ).toEqual({
    shown: null,
    ready: false,
    overPhone: false,
    cssLayer: 0,
    glassFill: "",
  });
  // a device found slow keeps the simpler glass
  await expect(root).toHaveClass(/glass-simple/);

  await expect(root).toHaveClass(/flat-ready/, { timeout: 20000 });
  await expect(page.locator("#stage > .flat-blackout")).toHaveCount(0);
  await flatSettledOn(page, "/", null);
  const home = page.locator(".flat-home");
  await expect(home.locator("h1")).toHaveText("Jason Yue");
  await expect(home).not.toHaveAttribute("inert");
  neverFlat(await handoffLog(page));
  const saved = await savedChoice(page);
  expect(saved.choice).toBeNull();
  const age = Date.now() - Number(saved.auto);
  expect(age).toBeGreaterThanOrEqual(0);
  expect(age).toBeLessThan(240000);
  // the 2d scene takes the keys now
  await page.keyboard.press("Escape");
  await expect
    .poll(() => flatStatus(page))
    .toMatchObject({ phone: "closed", busy: false });

  // the reload lands in the 2d scene, whose home screen has the 3d link in its credits row
  await page.reload();
  await expect(root).not.toHaveClass(/has-3d/);
  await expect(root).toHaveClass(/has-flat-scene/);
  await expect(home.locator("h1")).toHaveText("Jason Yue");
  await expect(home.locator(".flat-body")).toBeVisible();
  await expect(home).not.toHaveAttribute("inert", { timeout: 15000 });

  // the 2d home screen's 3d link takes the visitor back to 3d, and that choice outlasts the switch
  await home.locator('a[data-version="3d"]').click();
  await expect(root).toHaveClass(/has-3d/);
  expect(await savedChoice(page)).toEqual({ choice: "0", auto: null });
});

test("a Back press under the cover with the 2d chunk delayed lands on the address's page", async ({
  page,
}) => {
  test.setTimeout(240000);
  await slowFrames(page);
  await watchHandoff(page);
  await quiet(page);
  // the 2d scene's chunk is held from its first request (the prefetch at the ladder's last step) until it's let go
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let asked = 0;
  await page.route(/\/_astro\/[^/]+\.js$/, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes("the 2d scene stopped")) {
      asked++;
      await held;
    }
    await route.fulfill({ response, body });
  });
  await page.goto("/about");
  const root = page.locator("html");
  await expect(root).toHaveClass(/has-3d/);
  await settledOn(page, "/about", "About", 90000);
  // home through the router, so Back has an entry of this document to go to
  await page.keyboard.press("Escape");
  await settledOn(page, "/", null, 30000);
  await underCover(page);
  await page.evaluate(() => Object.assign(window, { __fastAgain: true }));
  expect(asked).toBeGreaterThan(0);
  // the cover takes the pointer, so a key or Back is all that reaches the page
  expect(
    await page.evaluate(() => {
      const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return el ? el.className : null;
    }),
  ).toBe("flat-blackout");
  await page.evaluate(() => history.back());
  await expect
    .poll(() => page.evaluate(() => location.pathname))
    .toBe("/about");
  await expect(root).not.toHaveClass(/flat-ready/);
  release();
  await flatSettledOn(page, "/about", "About");
  await expect(page.locator("#stage > .flat-blackout")).toHaveCount(0, {
    timeout: 10000,
  });
  await expect(page.locator("#page h1")).toHaveText("About");
  await expect(page.locator("#page h1")).toBeVisible();
  neverFlat(await handoffLog(page));
});

test("a 2d failure under the cover removes it", async ({ page }) => {
  test.setTimeout(240000);
  await slowFrames(page);
  await watchHandoff(page);
  await quiet(page);
  // the 2d scene's opening frames never load
  await page.route(/\/flat\/landscape-[^/]+\/a\d+\.webp$/, (route) =>
    route.abort(),
  );
  await page.goto("/");
  const root = page.locator("html");
  await expect(root).toHaveClass(/has-3d/);
  await settledOn(page, "/", null, 90000);
  await expect(root).toHaveClass(/scene-failed/, { timeout: 150000 });
  await page.evaluate(() => Object.assign(window, { __fastAgain: true }));
  await expect(root).not.toHaveClass(/has-flat-scene/);
  await expect(page.locator("#stage > .flat-blackout")).toHaveCount(0);
  await expect(page.locator("#page h1")).toBeVisible();
  await expect(page.locator("#stage .flat-layer")).toHaveCount(0);
  const log = await handoffLog(page);
  // the cover went up with the handoff, and went at once with the failure, with no fade
  const handed = log.findIndex((entry) => has(entry, "has-flat-scene"));
  expect(handed).toBeGreaterThan(0);
  expect(log[handed].cover).toBe(true);
  for (const entry of log.filter((e) => has(e, "scene-failed"))) {
    expect(entry.any, entry.classes).toBe(false);
  }
  const failedAt = log.findIndex((entry) => has(entry, "scene-failed"));
  for (const entry of log.slice(handed, failedAt)) {
    expect(entry.cover, entry.classes).toBe(true);
  }
});

test("a 2d scene still too slow drops to the plain flat page and stays there", async ({
  page,
}) => {
  test.setTimeout(120000);
  // each frame takes at least 60 ms, under 17 fps
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf((time) => {
        const end = performance.now() + 60;
        while (performance.now() < end) {
          // the slow device
        }
        callback(time);
      });
  });
  await quiet(page);
  await page.goto("/?2d");
  await expect(page.locator("html")).toHaveClass(/has-flat-scene/);
  // a first visit's intro may not give 3 s of motion past each start's 200 ms, so the phone folds until it has
  const root = page.locator("html");
  for (let i = 0; i < 6; i++) {
    const failed = await root.evaluate((el) =>
      el.classList.contains("scene-failed"),
    );
    if (failed) {
      break;
    }
    const s = await page.evaluate(() => (window as any).__flat?.status());
    if (s && s.phone !== null && !s.busy) {
      await page.keyboard.press(s.phone === "open" ? "Escape" : "Enter");
    }
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const root = document.documentElement;
            const s = (window as any).__flat?.status();
            return (
              root.classList.contains("scene-failed") ||
              Boolean(s && s.phone !== null && !s.busy)
            );
          }),
        { timeout: 30000 },
      )
      .toBe(true);
  }
  await expect(root).toHaveClass(/scene-failed/);
  await expect(root).toHaveClass(/flat-slow/);
  await expect(root).not.toHaveClass(/has-flat-scene/);
  const age = await page.evaluate(
    () => Date.now() - Number(localStorage.getItem("flatAuto")),
  );
  expect(age).toBeGreaterThanOrEqual(0);
  expect(age).toBeLessThan(120000);
  await expect(page.locator("#page h1")).toBeVisible();
  await expect(page.locator("#stage .flat-layer")).toHaveCount(0);
  await expect(page.locator('#page a[data-version="2d"]')).toBeVisible();

  // the next load stays on the plain flat page, with the 2d link from its first paint
  await page.reload();
  await expect(root).not.toHaveClass(/has-flat-scene/);
  await expect(root).not.toHaveClass(/has-3d/);
  await expect(root).toHaveClass(/flat-slow/);
  await expect(page.locator('#page a[data-version="2d"]')).toBeVisible();

  // the 2d link tries the 2d scene again
  await page.locator('#page a[data-version="2d"]').click();
  await expect(root).toHaveClass(/has-flat-scene/);
  expect(await page.evaluate(() => localStorage.getItem("flatAuto"))).toBe(
    null,
  );
});
