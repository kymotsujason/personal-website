// screenshots of the app pages on the dev server, on the gpu, for the design pass. Run by hand, not by pnpm verify.
// OUT names the folder (required), BASE the server, PAGES and PROFILES limit the run. PAGES is About, the projects list and the eight stories, Blog, and Music.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (!process.env.OUT) {
  console.error("OUT is required, a folder for the screenshots");
  process.exit(1);
}
const OUT = resolve(process.env.OUT) + "/";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || "http://127.0.0.1:4321";
const ONLY = process.env.PROFILES ? process.env.PROFILES.split(",") : null;
const MODES = process.env.MODES ? process.env.MODES.split(",") : ["3d", "flat"];
const require = createRequire(WEB + "/package.json");
const { chromium, devices } = require("@playwright/test");

const sceneSource = readFileSync(WEB + "/tests/prod/scene.ts", "utf8");
const FAKE_YOUTUBE = sceneSource.split("FAKE_YOUTUBE = `")[1].split("`;")[0];
const PIXEL = Buffer.from(
  [
    "iVBORw0KGgo",
    "AAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwcHAAAAGEAMGDX2mUAAAAAElFTkSuQmCC",
  ].join(""),
  "base64",
);

const STORIES = [
  "super-hexagon-rl",
  "pickban-gg",
  "battlebgm",
  "jasonyue-ca",
  "virtual-ascii",
  "tobii-gaze-linux",
  "mouse-battery",
  "mangadex-paperback",
];
const PAGES = [
  ["about", "/about"],
  ["projects", "/projects"],
  ...STORIES.map((slug) => [`project-${slug}`, `/projects/${slug}`]),
  ["blog", "/blog"],
  ["music", "/music"],
].filter(
  ([name]) =>
    !process.env.PAGES ||
    process.env.PAGES.split(",").some((p) => name.startsWith(p)),
);

const profiles = {
  desktop: { viewport: { width: 1400, height: 850 }, deviceScaleFactor: 1 },
  iphone: { ...devices["iPhone 15"] },
};

const stub = async (page, errors) => {
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  await page.route(
    (url) => !["127.0.0.1", "localhost"].includes(url.hostname),
    (route) => {
      const url = new URL(route.request().url());
      if (url.href === "https://www.youtube.com/iframe_api") {
        return route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: FAKE_YOUTUBE,
        });
      }
      if (url.hostname === "i.ytimg.com") {
        return route.fulfill({
          status: 200,
          contentType: "image/png",
          headers: { "access-control-allow-origin": "*" },
          body: PIXEL,
        });
      }
      return route.abort();
    },
  );
  await page.route(
    (url) => url.pathname === "/api/home",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ weather: null, github: null }),
      }),
  );
};

// a link the router takes, the way a tap on the home screen or a page's own link would
const follow = (page, path) =>
  page.evaluate((href) => {
    const a = document.createElement("a");
    a.href = href;
    a.style.cssText = "position:fixed;left:-99px;top:0";
    document.body.append(a);
    a.click();
    a.remove();
  }, path);

const run = async () => {
  const browser = await chromium.launch({
    args: ["--use-angle=gl", "--enable-gpu", "--ignore-gpu-blocklist"],
  });
  try {
    for (const [name, options] of Object.entries(profiles)) {
      if (ONLY && !ONLY.includes(name)) {
        continue;
      }
      const errors = [];

      if (MODES.includes("3d")) {
        const context = await browser.newContext({
          ...options,
          timezoneId: "America/Vancouver",
          locale: "en-US",
        });
        const page = await context.newPage();
        await stub(page, errors);
        await page.goto(BASE + "/");
        await page.waitForFunction(() => window.__sceneShown === true, null, {
          timeout: 60000,
        });
        await page.waitForFunction(
          () => localStorage.getItem("introSeen") === "1",
          null,
          { timeout: 90000 },
        );
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${OUT}${name}-home.png` });
        for (const [label, path] of PAGES) {
          await follow(page, path);
          await page.waitForTimeout(Number(process.env.OPEN_MS || 330));
          await page.screenshot({ path: `${OUT}${name}-${label}-open.png` });
          await page.waitForTimeout(3000);
          await page.screenshot({ path: `${OUT}${name}-${label}-zoom.png` });
          await follow(page, "/");
          await page.waitForTimeout(2200);
        }
        await context.close();
      }

      if (MODES.includes("flat")) {
        const context = await browser.newContext({
          ...options,
          timezoneId: "America/Vancouver",
          locale: "en-US",
        });
        await context.addInitScript(() => localStorage.setItem("2d", "1"));
        const page = await context.newPage();
        await stub(page, errors);
        for (const [label, path] of [
          ["home", "/"],
          ...PAGES,
          ["404", "/no-such-page"],
        ]) {
          await page.goto(BASE + path);
          await page.waitForTimeout(1200);
          await page.screenshot({ path: `${OUT}${name}-${label}-flat.png` });
        }
        await context.close();
      }
      console.log(name, "console errors", JSON.stringify(errors));
    }
  } finally {
    await browser.close();
  }
};

await run();
