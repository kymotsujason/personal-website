// renders apps/web/public/og.jpg, the preview image every page shares: the phone open at the desk, 1200 by 630. run it
// by hand from site/ with the dev server serving (pnpm -C apps/web dev):
//   taskset -c 0,2,4,6,8,10,12,14,16-23 node tools/render-og.mjs [--base http://127.0.0.1:4321] [--hour 14] [--out <FILE>]
// it screenshots the dev page at its settled home screen (offline, with the github fixture in place of the cron's
// data), strips the metadata, checks the result, and writes the file.
// the privacy allowlist then needs the new file's sha-256, which the last line prints
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./privacy/allowlist.mjs";
import { scanMetadata, stripMetadata } from "./privacy/metadata.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../apps/web/package.json"));
const { chromium } = require("@playwright/test");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const base = flag("--base", "http://127.0.0.1:4321");
const hour = Number(flag("--hour", "14"));
const github = JSON.parse(
  readFileSync(
    path.join(here, "../apps/web/src/data/github-fixture.json"),
    "utf8",
  ),
);
// the status bar's clock reads the page's own date, so it is pinned to the hour the sky shows (-07:00 is Vancouver in
// October)
const hh = String(Math.floor(hour)).padStart(2, "0");
const mm = String(Math.round((hour % 1) * 60)).padStart(2, "0");
const pageTime = new Date(`2026-10-18T${hh}:${mm}:00-07:00`);
const out = path.resolve(
  flag("--out", path.join(here, "../apps/web/public/og.jpg")),
);

const browser = await chromium.launch({
  args: ["--use-angle=gl", "--enable-gpu", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
    timezoneId: "America/Vancouver",
    locale: "en-US",
  });
  await page.clock.setFixedTime(pageTime);
  await page.route(
    (url) => url.pathname === "/api/home",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ weather: null, github }),
      }),
  );
  await page.goto(`${base}/?dev&noweather`);
  await page.waitForFunction(() => window.spike && window.__sceneShown, null, {
    timeout: 60000,
  });
  // the intro ends with the phone open and the hands still
  await page.waitForFunction(
    () => window.spike.state.phone === "open" && !window.spike.state.busy,
    null,
    { timeout: 60000 },
  );
  await page.evaluate((h) => {
    window.spike.daylight(h);
    document.getElementById("panel")?.remove();
  }, hour);
  await page.waitForTimeout(3000);
  const shot = await page.screenshot({ type: "jpeg", quality: 90 });
  const clean = stripMetadata(new Uint8Array(shot), out);
  const found = scanMetadata(clean, out);
  if (found.length > 0) {
    throw new Error(`metadata is left in the image: ${JSON.stringify(found)}`);
  }
  writeFileSync(out, clean);
  console.log(`${out} ${clean.length} bytes`);
  console.log(`sha-256 ${sha256(clean)}`);
} finally {
  await browser.close();
}
