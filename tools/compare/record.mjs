// records the reference spike's poses frame by frame, for the site's compare spec. run by hand from site/:
//   node tools/compare/record.mjs --out <DIR> [--base http://localhost:5173] [--only <SEQUENCE>] [--orientation <NAME>]
//   node tools/compare/record.mjs --diff <DIR_A> <DIR_B>
// the spike (83541ed, or later if --diff shows only the change being recorded) must already be serving at --base (or
// SPIKE_URL). nothing in site/ reads the spike's files, this only reads the page over HTTP
import { createRequire } from "node:module";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../apps/web/package.json"));
const { chromium } = require("@playwright/test");

const STEP = 16;
const INSTALL_TIME = "2026-10-17T12:00:00Z";
const INSTALL_MS = Date.parse(INSTALL_TIME);
// a multiple of 16 after the install time, so every step lands on the animation frame grid
const PAUSE_AT_MS = 992;
// every sequence starts at the same fake time, on the frame grid and after the intro that plays on load has finished
const SEQUENCE_START_MS = INSTALL_MS + 14000;
const DRAIN_MS = 10 * 60 * 1000;
// the same options in the spec, so the machine can't change layout or lighting
const CONTEXT_OPTIONS = {
  viewport: { width: 1400, height: 850 },
  deviceScaleFactor: 1,
  timezoneId: "America/Vancouver",
  locale: "en-US",
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};
const ORIENTATIONS = ["landscape", "portrait"];

// frames: how many 16 ms steps to record. shots: frame numbers that also get a checkerboard screenshot
const SEQUENCES = {
  "full-intro": { frames: 320, shots: [20, 120, 200, 319] },
  "fast-intro": { frames: 130, shots: [10, 60, 129] },
  about: { frames: 150, shots: [20, 60, 149] },
  phone: { frames: 190, shots: [30, 100, 189] },
  charger: { frames: 400, shots: [100, 250, 399] },
};

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

// 6 significant digits keep the fixtures small, and values under 1e-7 are written as 0
const rounded = (key, value) => {
  if (typeof value !== "number") {
    return value;
  }
  return Math.abs(value) < 1e-7 ? 0 : Number(value.toPrecision(6));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// the matrices of one frame, relative to the camera
const snapshot = (page) =>
  page.evaluate(() => {
    const spike = window.spike;
    const inverse = spike.camera().matrixWorldInverse;
    const relative = (object) =>
      inverse.clone().multiply(object.matrixWorld).toArray();
    const bones = {};
    Object.keys(spike.state.handModel.bones)
      .sort()
      .forEach((name) => {
        bones[name] = relative(spike.state.handModel.bones[name]);
      });
    const parts = {};
    ["flap", "body", "hinged", "pivot", "hingeTurn"].forEach((name) => {
      if (spike.state[name]) {
        parts[name] = relative(spike.state[name]);
      }
    });
    return { root: relative(spike.state.root), parts, bones };
  });

const finite = (frame, label) => {
  const all = [
    ...frame.root,
    ...Object.values(frame.parts).flat(),
    ...Object.values(frame.bones).flat(),
  ];
  if (!all.every((v) => Number.isFinite(v))) {
    throw new Error(`a matrix entry is not finite at ${label}`);
  }
};

const swapScreens = (page) =>
  page.evaluate(() => {
    const spike = window.spike;
    const materials = [spike.state.screen.material, spike.state.cover.material];
    const original = materials[0].map;
    const Texture = original.constructor;
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
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
    window.__restore = materials.map((m) => [m, m.map]);
    materials.forEach((m) => {
      m.map = checker;
      m.needsUpdate = true;
    });
  });

const restoreScreens = (page) =>
  page.evaluate(() => {
    document.getElementById("__blank")?.remove();
    window.__restore.forEach(([m, map]) => {
      m.map = map;
      m.needsUpdate = true;
    });
  });

const openPage = async (browser, base, batteryStart) => {
  const context = await browser.newContext(CONTEXT_OPTIONS);
  const page = await context.newPage();
  await page.clock.install({ time: INSTALL_TIME });
  await page.addInitScript(
    (start) => localStorage.setItem("duo-battery-start", String(start)),
    batteryStart,
  );
  // frozen from the start, so no fake time passes until a step asks for it and the load time can't change the phase
  await page.clock.pauseAt(INSTALL_MS + PAUSE_AT_MS);
  await page.goto(`${base}/?noweather`);
  for (let i = 0; i < 2000; i++) {
    const ready = await page.evaluate(
      () => Boolean(window.spike) && document.body.classList.contains("ready"),
    );
    if (ready) {
      break;
    }
    await page.clock.runFor(STEP);
    await sleep(10);
  }
  return { context, page };
};

const runTo = async (page, target) => {
  for (;;) {
    const now = await page.evaluate(() => Date.now());
    if (now >= target) {
      return now;
    }
    const left = target - now;
    await page.clock.runFor(Math.min(left, 800));
  }
};

const recordSequence = async (browser, base, orientation, name, outDir) => {
  const spec = SEQUENCES[name];
  const batteryStart =
    name === "charger"
      ? SEQUENCE_START_MS - (DRAIN_MS - 2000)
      : INSTALL_MS - 120000;
  const { context, page } = await openPage(browser, base, batteryStart);
  try {
    if (orientation !== "landscape") {
      await page.evaluate((value) => {
        const select = document.getElementById("device-select");
        select.value = value;
        select.dispatchEvent(new Event("change"));
      }, orientation);
    }
    // the load intro runs on fake time, so it takes a few seconds of steps, not real waiting
    await runTo(page, SEQUENCE_START_MS);
    const startedAt = await page.evaluate(() => Date.now());
    if (
      startedAt < SEQUENCE_START_MS ||
      startedAt >= SEQUENCE_START_MS + STEP
    ) {
      throw new Error(`the clock is at ${startedAt}, not ${SEQUENCE_START_MS}`);
    }
    const ok = await page.evaluate(
      () => !window.spike.state.busy && window.spike.state.phone === "open",
    );
    if (!ok) {
      throw new Error("the phone is not settled and open at the start time");
    }
    await page.evaluate(() => {
      document.getElementById("panel").style.display = "none";
    });

    const frames = [];
    const shots = [];
    // an action is queued for the next animation frame and runs right after it, since the clock is exactly on the
    // frame time there. started between frames, a tween's start time came out a millisecond off from run to run
    const queue = (action) =>
      page.evaluate((which) => {
        const actions = {
          "replay-full": () => document.getElementById("replay-full").click(),
          "replay-fast": () => document.getElementById("replay-fast").click(),
          open: () => window.spike.openPhone(),
          close: () => window.spike.closePhone(),
          about: () => {
            history.pushState(null, "", "#about");
            window.dispatchEvent(new PopStateEvent("popstate"));
          },
          escape: () =>
            window.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape" }),
            ),
        };
        requestAnimationFrame(() => actions[which]());
      }, action);
    const first = {
      "full-intro": "replay-full",
      "fast-intro": "replay-fast",
      about: "about",
      phone: "close",
    }[name];
    // the app is open by about 40 frames, then escape closes it. the phone is shut by about 60 frames, then it opens
    const later = {
      about: { at: 50, action: "escape" },
      phone: { at: 75, action: "open" },
    }[name];

    for (let i = 0; i <= spec.frames; i++) {
      if (i === 0 && first) {
        await queue(first);
      }
      if (later && i === later.at) {
        await queue(later.action);
      }
      const shot = spec.shots.includes(i);
      if (shot) {
        await swapScreens(page);
      }
      await page.clock.runFor(STEP);
      const frame = await snapshot(page);
      frame.t = i * STEP;
      finite(frame, `${orientation}-${name} frame ${i}`);
      frames.push(frame);
      if (shot) {
        const file = `${orientation}-${name}-${i}.png`;
        await page.screenshot({ path: path.join(outDir, file) });
        frame.screenshot = file;
        shots.push(file);
        await restoreScreens(page);
      }
    }
    const file = path.join(outDir, `${orientation}-${name}.json.gz`);
    writeFileSync(
      file,
      gzipSync(JSON.stringify({ step_ms: STEP, frames }, rounded) + "\n", {
        level: 9,
      }),
    );
    console.log(
      `${orientation}-${name}: ${frames.length} frames, ${Math.round(statSync(file).size / 1024)} KB, ${shots.length} screenshots`,
    );
  } finally {
    await context.close();
  }
};

// the largest per-entry difference between two recordings of the same sequence. a missing file, a different frame
// count, or an entry that isn't finite counts as a failure
const diffDirs = (dirA, dirB) => {
  let largest = 0;
  let failures = 0;
  const read = (dir, f) =>
    JSON.parse(gunzipSync(readFileSync(path.join(dir, f))).toString("utf8"));
  const files = readdirSync(dirA).filter((f) => f.endsWith(".json.gz"));
  const others = readdirSync(dirB).filter((f) => f.endsWith(".json.gz"));
  if (files.length === 0 || files.join() !== others.join()) {
    console.log(
      `the folders hold different files: ${files.length} against ${others.length}`,
    );
    failures += 1;
  }
  for (const f of files) {
    if (!others.includes(f)) {
      continue;
    }
    const a = read(dirA, f);
    const b = read(dirB, f);
    let max = 0;
    let where = "";
    if (a.frames.length === 0 || a.frames.length !== b.frames.length) {
      console.log(`${f}: ${a.frames.length} frames against ${b.frames.length}`);
      failures += 1;
      continue;
    }
    a.frames.forEach((fa, i) => {
      const fb = b.frames[i];
      const names = (x) =>
        [Object.keys(x.parts), Object.keys(x.bones)].join("|");
      if (names(fa) !== names(fb)) {
        failures += 1;
        console.log(`${f}: frame ${i} has different parts or bones`);
        return;
      }
      const pairs = [
        ["root", fa.root, fb.root],
        ...Object.keys(fa.parts).map((k) => [k, fa.parts[k], fb.parts[k]]),
        ...Object.keys(fa.bones).map((k) => [k, fa.bones[k], fb.bones[k]]),
      ];
      for (const [key, ma, mb] of pairs) {
        ma.forEach((v, j) => {
          const d = Math.abs(v - mb[j]);
          if (!Number.isFinite(d)) {
            failures += 1;
            max = Infinity;
            where = `frame ${i} ${key}[${j}] is not finite`;
          } else if (d > max) {
            max = d;
            where = `frame ${i} ${key}[${j}]`;
          }
        });
      }
    });
    console.log(`${f}: largest difference ${max} at ${where}`);
    largest = Math.max(largest, max);
  }
  console.log(`largest difference over all files: ${largest}`);
  if (failures > 0) {
    console.log(`${failures} failures`);
    process.exitCode = 1;
  }
};

const main = async () => {
  if (args[0] === "--diff") {
    diffDirs(args[1], args[2]);
    return;
  }
  const base = flag("--base", process.env.SPIKE_URL || "http://localhost:5173");
  const outDir = path.resolve(
    flag("--out", path.join(here, "../../apps/web/tests/fixtures/poses")),
  );
  const only = flag("--only", null);
  const onlyOrientation = flag("--orientation", null);
  mkdirSync(outDir, { recursive: true });
  // the same renderer the compare project uses, so the screenshots match (see playwright.config.ts)
  const browser = await chromium.launch(
    process.env.PW_GPU === "0"
      ? {}
      : { args: ["--use-angle=gl", "--enable-gpu", "--ignore-gpu-blocklist"] },
  );
  try {
    for (const orientation of ORIENTATIONS) {
      if (onlyOrientation && onlyOrientation !== orientation) {
        continue;
      }
      for (const name of Object.keys(SEQUENCES)) {
        if (only && only !== name) {
          continue;
        }
        await recordSequence(browser, base, orientation, name, outDir);
      }
    }
  } finally {
    await browser.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
