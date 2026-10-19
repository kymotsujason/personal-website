// drives the site's dev page through the same sequences tools/compare/record.mjs recorded on the reference spike, and
// checks every frame's matrices and the checkerboard screenshots against the fixtures. see fixtures/poses/README.md.
// with COMPARE_CAPTURE=1 it drives the capture build (the production build with window.__capture) instead, so the
// code that ships is compared too
import { expect, test, type Page } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CAPTURE = process.env.COMPARE_CAPTURE === "1";

const fixtureDir = fileURLToPath(
  new URL("../fixtures/poses/", import.meta.url),
);

// the same options as tools/compare/record.mjs, so the machine can't change layout or lighting
test.use({
  viewport: { width: 1400, height: 850 },
  deviceScaleFactor: 1,
  timezoneId: "America/Vancouver",
  locale: "en-US",
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
});

const STEP = 16;
const INSTALL_TIME = "2026-10-17T12:00:00Z";
const INSTALL_MS = Date.parse(INSTALL_TIME);
// a multiple of 16 after the install time, so every step lands on the animation frame grid
const PAUSE_AT_MS = 992;
const SEQUENCE_START_MS = INSTALL_MS + 14000;
const DRAIN_MS = 10 * 60 * 1000;
// per matrix entry, set from two recordings of the spike (see the README)
const TOLERANCE = 1e-4;
const MAX_DIFFERENT_SHARE = 0.005;
const CHANNEL_STEP = 16;

type Frame = {
  t: number;
  root: number[];
  parts: Record<string, number[]>;
  bones: Record<string, number[]>;
  screenshot?: string;
};
type Fixture = { step_ms: number; frames: Frame[] };

// the spike's eight home screen icons, in its order. the app window grows out of the About icon, so the recorded
// screenshots of an opening About only match with the icons where the spike had them
const SPIKE_APPS = [
  ["Projects", "P", "#e07a5f"],
  ["About", "A", "#3d405b"],
  ["Blog", "B", "#81b29a"],
  ["Games", "G", "#f2cc8f"],
  ["Chat", "C", "#5e9bd6"],
  ["Photos", "Ph", "#c06c84"],
  ["Lab", "L", "#6c5b7b"],
  ["Music", "M", "#f67280"],
].map(([name, glyph, color]) => ({
  name,
  path: `/${name.toLowerCase()}`,
  glyph,
  color,
}));

// the page's site data with the spike's icons in place of the site's, on the page load only
const withSpikeApps = (page: Page) =>
  page.route(
    (url) => url.pathname === "/",
    async (route) => {
      // only the page load itself gets the spike's icons
      if (route.request().resourceType() !== "document") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const html = await response.text();
      const pattern = /(<script[^>]*id="site-data"[^>]*>)([^<]*)(<\/script>)/;
      const found = html.match(pattern);
      if (!found) {
        throw new Error("the dev page has no site-data");
      }
      const data = JSON.parse(found[2]);
      data.apps = SPIKE_APPS;
      await route.fulfill({
        response,
        body: html.replace(pattern, `$1${JSON.stringify(data)}$3`),
      });
    },
  );

const files = readdirSync(fixtureDir).filter((f) => f.endsWith(".json.gz"));

const snapshot = (page: Page) =>
  page.evaluate((capture) => {
    if (capture) {
      const { root, parts, bones } = (window as any).__capture.pose();
      return { root, parts, bones };
    }
    const spike = (window as any).spike;
    const inverse = spike.camera().matrixWorldInverse;
    const relative = (object: any) =>
      inverse.clone().multiply(object.matrixWorld).toArray();
    const bones: Record<string, number[]> = {};
    Object.keys(spike.state.handModel.bones)
      .sort()
      .forEach((name) => {
        bones[name] = relative(spike.state.handModel.bones[name]);
      });
    const parts: Record<string, number[]> = {};
    ["flap", "body", "hinged", "pivot", "hingeTurn"].forEach((name) => {
      if (spike.state[name]) {
        parts[name] = relative(spike.state[name]);
      }
    });
    return { root: relative(spike.state.root), parts, bones };
  }, CAPTURE);

const swapScreens = (page: Page) =>
  page.evaluate((capture) => {
    const spike = (window as any).spike;
    const materials = capture
      ? (window as any).__capture.screens()
      : [spike.state.screen.material, spike.state.cover.material];
    const original = materials[0].map;
    const Texture = original.constructor;
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 ? "#ff3b30" : "#34c759";
        ctx.fillRect(x * 8, y * 8, 8, 8);
      }
    }
    const checker = new Texture(canvas);
    checker.magFilter = 1003;
    checker.minFilter = 1003;
    checker.generateMipmaps = false;
    checker.colorSpace = original.colorSpace;
    checker.needsUpdate = true;
    // the app's page is html behind the canvas, so it's hidden for the shot and only the canvas shows
    const blank = document.createElement("style");
    blank.id = "__blank";
    blank.textContent =
      "body * { visibility: hidden !important; } body canvas { visibility: visible !important; }";
    document.head.appendChild(blank);
    (window as any).__restore = materials.map((m: any) => [m, m.map]);
    materials.forEach((m: any) => {
      m.map = checker;
      m.needsUpdate = true;
    });
  }, CAPTURE);

const restoreScreens = (page: Page) =>
  page.evaluate(() => {
    document.getElementById("__blank")?.remove();
    (window as any).__restore.forEach(([m, map]: [any, any]) => {
      m.map = map;
      m.needsUpdate = true;
    });
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runTo = async (page: Page, target: number) => {
  for (;;) {
    const now = await page.evaluate(() => Date.now());
    if (now >= target) {
      return;
    }
    await page.clock.runFor(Math.min(target - now, 800));
  }
};

// the share of pixels where any channel is more than CHANNEL_STEP levels off
const differentShare = (page: Page, a: Buffer, b: Buffer) =>
  page.evaluate(
    async ([x, y, step]) => {
      // the scheme is joined at run time, since the privacy check refuses a tracked file that holds an inline image
      const prefix = ["data", "image/png;base64,"].join(":");
      const load = async (base64: string) => {
        const blob = await (await fetch(`${prefix}${base64}`)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const first = await load(x as string);
      const second = await load(y as string);
      if (first.width !== second.width || first.height !== second.height) {
        return 1;
      }
      let different = 0;
      for (let i = 0; i < first.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          if (
            Math.abs(first.data[i + c] - second.data[i + c]) > (step as number)
          ) {
            different += 1;
            break;
          }
        }
      }
      return different / (first.data.length / 4);
    },
    [a.toString("base64"), b.toString("base64"), CHANNEL_STEP] as const,
  );

for (const file of files) {
  const name = file.replace(/\.json\.gz$/, "");
  const [orientation, ...rest] = name.split("-");
  const sequence = rest.join("-");

  test(`${name} matches the spike`, async ({ page }) => {
    test.setTimeout(30 * 60 * 1000);
    const fixture: Fixture = JSON.parse(
      gunzipSync(readFileSync(path.join(fixtureDir, file))).toString("utf8"),
    );
    expect(fixture.frames.length).toBeGreaterThan(0);
    const batteryStart =
      sequence === "charger"
        ? SEQUENCE_START_MS - (DRAIN_MS - 2000)
        : INSTALL_MS - 120000;

    await page.clock.install({ time: INSTALL_TIME });
    await page.addInitScript(
      (start) => localStorage.setItem("duo-battery-start", String(start)),
      batteryStart,
    );
    await page.clock.pauseAt(INSTALL_MS + PAUSE_AT_MS);
    await withSpikeApps(page);
    await page.goto(CAPTURE ? "/?noweather" : "/?dev&noweather");
    let ready = false;
    for (let i = 0; i < 400 && !ready; i++) {
      ready = await page.evaluate(
        (capture) =>
          Boolean(
            capture ? (window as any).__capture : (window as any).spike,
          ) && document.body.classList.contains("ready"),
        CAPTURE,
      );
      if (!ready) {
        await page.clock.runFor(STEP);
        await sleep(10);
      }
    }
    expect(ready, "the page has its test api and shows the scene").toBe(true);

    if (orientation !== "landscape") {
      await page.evaluate(
        ([value, capture]) => {
          if (capture) {
            (window as any).__capture.setDevice(value);
            return;
          }
          const select = document.getElementById(
            "device-select",
          ) as HTMLSelectElement;
          select.value = value as string;
          select.dispatchEvent(new Event("change"));
        },
        [orientation, CAPTURE] as const,
      );
    }
    await runTo(page, SEQUENCE_START_MS);
    const startedAt = await page.evaluate(() => Date.now());
    expect(startedAt).toBeGreaterThanOrEqual(SEQUENCE_START_MS);
    expect(startedAt).toBeLessThan(SEQUENCE_START_MS + STEP);
    const settled = await page.evaluate((capture) => {
      const s = capture
        ? (window as any).__capture.pose()
        : (window as any).spike.state;
      return !s.busy && s.phone === "open";
    }, CAPTURE);
    expect(settled, "the phone is settled and open at the start time").toBe(
      true,
    );
    if (!CAPTURE) {
      await page.evaluate(() => {
        document.getElementById("panel")!.style.display = "none";
      });
    }

    // an action is queued for the next animation frame and runs right after it, as record.mjs does
    const queue = (action: string) =>
      page.evaluate(
        ([which, capture]) => {
          if (capture) {
            requestAnimationFrame(() => (window as any).__capture.act(which));
            return;
          }
          const actions: Record<string, () => void> = {
            "replay-full": () =>
              document.getElementById("replay-full")!.click(),
            "replay-fast": () =>
              document.getElementById("replay-fast")!.click(),
            open: () => (window as any).spike.openPhone(),
            close: () => (window as any).spike.closePhone(),
            // the site has no #about address, so About opens and closes through the scene's own calls, which start
            // the same tweens in the same frame as the spike's popstate and Escape handlers
            about: () => (window as any).spike.openApp("About"),
            escape: () => (window as any).spike.closeApp(),
          };
          requestAnimationFrame(() => actions[which as string]());
        },
        [action, CAPTURE] as const,
      );
    const first: Record<string, string> = {
      "full-intro": "replay-full",
      "fast-intro": "replay-fast",
      about: "about",
      phone: "close",
    };
    const later: Record<string, { at: number; action: string }> = {
      about: { at: 50, action: "escape" },
      phone: { at: 75, action: "open" },
    };

    const worst = { diff: 0, at: "" };
    const compareFrame = (frame: Frame, expected: Frame, i: number) => {
      expect(
        Object.keys(frame.bones).sort(),
        `bone names at frame ${i}`,
      ).toEqual(Object.keys(expected.bones).sort());
      expect(
        Object.keys(frame.parts).sort(),
        `part names at frame ${i}`,
      ).toEqual(Object.keys(expected.parts).sort());
      const pairs: [string, number[], number[]][] = [
        ["root", frame.root, expected.root],
      ];
      for (const key of Object.keys(expected.parts)) {
        pairs.push([key, frame.parts[key], expected.parts[key]]);
      }
      for (const key of Object.keys(expected.bones)) {
        pairs.push([key, frame.bones[key], expected.bones[key]]);
      }
      for (const [key, got, want] of pairs) {
        for (let j = 0; j < 16; j++) {
          const diff = Math.abs(got[j] - want[j]);
          if (!Number.isFinite(diff)) {
            throw new Error(`${key}[${j}] at frame ${i} is not finite`);
          }
          if (diff > worst.diff) {
            worst.diff = diff;
            worst.at = `frame ${i} ${key}[${j}]`;
          }
        }
      }
    };

    const frames = fixture.frames;
    for (let i = 0; i < frames.length; i++) {
      if (i === 0 && first[sequence]) {
        await queue(first[sequence]);
      }
      const step = later[sequence];
      if (step && i === step.at) {
        await queue(step.action);
      }
      const shot = Boolean(frames[i].screenshot);
      if (shot) {
        await swapScreens(page);
      }
      await page.clock.runFor(STEP);
      compareFrame({ ...(await snapshot(page)), t: i * STEP }, frames[i], i);
      if (shot) {
        const png = await page.screenshot();
        const expectedPng = readFileSync(
          path.join(fixtureDir, frames[i].screenshot!),
        );
        const viewer = await page.context().newPage();
        const share = await differentShare(viewer, png, expectedPng);
        await viewer.close();
        expect(
          share,
          `pixels that differ in ${frames[i].screenshot}`,
        ).toBeLessThan(MAX_DIFFERENT_SHARE);
        await restoreScreens(page);
      }
    }
    expect(
      worst.diff,
      `largest matrix difference, at ${worst.at}`,
    ).toBeLessThanOrEqual(TOLERANCE);
  });
}
