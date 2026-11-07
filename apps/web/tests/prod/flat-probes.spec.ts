import { readFileSync } from "node:fs";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "@playwright/test";
import { quiet } from "./scene";

// speed probes for the 2d scene. each one logs what it measured and asserts only that it ran, since the numbers are
// read by a person (docs/flat-scene-probes.md) and a machine's speed shouldn't fail a build. frame times are the gaps
// between animation frames while a loop updates the scene every frame, plus the page's long animation frames. headless
// animation frames aren't tied to vsync, so the gaps are compared between variants on one machine and not read as fps

type Stats = {
  n: number;
  median: number;
  p95: number;
  max: number;
  over33: number;
  jsMedian: number;
  jsP95: number;
  loafCount: number;
  loafMax: number;
};

type Hook = {
  manifest: {
    frames: { fold: number }[];
    window: { width: number; height: number };
    set: string;
    size: string;
  };
  stage: {
    placed: { rest: Record<string, number> };
    placePage: (mode: string, options?: object) => void;
    frameLayer: object;
    layers: { screens: HTMLElement; frames: HTMLElement };
  };
  frames: { show: (i: number) => void; elements: HTMLElement[] };
  screens: {
    picture: () => object;
    showPicture: (on: boolean) => void;
    faces?: object;
    flap: HTMLElement;
    body: HTMLElement;
    cover: HTMLElement;
  };
  setPose: (pose: object) => void;
  setFold: (fold: number, lead?: number) => void;
  mount: (options?: {
    set?: string;
    lighting?: string;
    size?: string;
  }) => Promise<unknown>;
};

const withHook = async (page: Page, route = "/?2d") => {
  await quiet(page);
  await page.goto(route);
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __flat?: Hook }).__flat),
  );
  await page.evaluate(() =>
    (window as unknown as { __flat: Hook }).__flat.mount(),
  );
};

const throttle = async (client: CDPSession, rate: number) => {
  await client.send("Emulation.setCPUThrottlingRate", { rate });
};

// runs update(i) once per animation frame for steps frames (or until limitMs passes) and returns the gaps between
// frames, the time update itself took, and the long animation frames
const LOOP = `
async ({ steps, limitMs }, body) => {
  const update = new Function("i", "hook", body);
  const hook = window.__flat;
  const loafs = [];
  const observer = new PerformanceObserver((list) => {
    list.getEntries().forEach((e) => loafs.push(e.duration));
  });
  try {
    observer.observe({ type: "long-animation-frame", buffered: false });
  } catch (error) {}
  const gaps = [];
  const js = [];
  const next = () => new Promise((resolve) => requestAnimationFrame(resolve));
  let last = await next();
  const start = last;
  for (let i = 0; i < steps; i++) {
    const t = await next();
    gaps.push(t - last);
    last = t;
    const t0 = performance.now();
    update(i, hook);
    js.push(performance.now() - t0);
    if (t - start > limitMs) {
      break;
    }
  }
  await next();
  observer.disconnect();
  return { gaps, js, loafs };
}
`;

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  );
};

const summarize = (run: {
  gaps: number[];
  js: number[];
  loafs: number[];
}): Stats => ({
  n: run.gaps.length,
  median: +percentile(run.gaps, 0.5).toFixed(1),
  p95: +percentile(run.gaps, 0.95).toFixed(1),
  max: +Math.max(...run.gaps).toFixed(1),
  over33: run.gaps.filter((g) => g > 33.4).length,
  jsMedian: +percentile(run.js, 0.5).toFixed(2),
  jsP95: +percentile(run.js, 0.95).toFixed(2),
  loafCount: run.loafs.length,
  loafMax: +Math.max(0, ...run.loafs).toFixed(1),
});

const loop = async (
  page: Page,
  steps: number,
  body: string,
  limitMs = 60000,
) => {
  const run = (await page.evaluate(
    ({ source, args, code }) => {
      const fn = (0, eval)(source);
      return fn(args, code);
    },
    { source: LOOP, args: { steps, limitMs }, code: body },
  )) as { gaps: number[]; js: number[]; loafs: number[] };
  return summarize(run);
};

// the unfold with the phone swaying a little, so every frame has a new fold frame, new screen corners, and a new
// chain transform (matrix3d) under the screens
const SWAY = `
  const frames = hook.manifest.frames;
  const f = frames[(frames.length - 1) - (i % frames.length)];
  hook.setPose({ ...hook.stage.placed.rest, ry: 0.25 * Math.sin(i / 9), rx: 0.08 * Math.sin(i / 13) });
  hook.setFold(f.fold);
`;

const log = (label: string, value: unknown) => {
  console.log(`PROBE ${label} ${JSON.stringify(value)}`);
};

test.describe("2d scene probes", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240000);

  test("live html under a matrix3d that changes every frame", async ({
    page,
  }) => {
    await withHook(page);
    const client = await page.context().newCDPSession(page);
    const results: Record<string, Stats> = {};
    for (const rate of [1, 4]) {
      await throttle(client, rate);
      results[`live_html_cpu${rate}x`] = await loop(page, 180, SWAY);
      await page.evaluate(() => {
        const hook = (window as unknown as { __flat: Hook }).__flat;
        hook.screens.picture();
        hook.screens.showPicture(true);
      });
      results[`canvas_picture_cpu${rate}x`] = await loop(page, 180, SWAY);
      await page.evaluate(() => {
        const hook = (window as unknown as { __flat: Hook }).__flat;
        hook.screens.showPicture(false);
      });
      const drawMs = await page.evaluate(() => {
        const hook = (window as unknown as { __flat: Hook }).__flat;
        hook.setFold(0.4);
        const times: number[] = [];
        for (let i = 0; i < 5; i++) {
          const t0 = performance.now();
          hook.screens.picture();
          times.push(performance.now() - t0);
        }
        return times.map((t) => +t.toFixed(1));
      });
      log(`picture_draw_ms_cpu${rate}x`, drawMs);
    }
    await throttle(client, 1);
    log("matrix3d_frame_times", results);
    expect(Object.keys(results)).toHaveLength(4);
  });

  test("a tilted html layer keeps its text strips", async ({ page }) => {
    await withHook(page);
    const analyze = await page.context().newPage();
    const folds = [0.15, 0.35, 0.55, 0.75];
    const found: unknown[] = [];
    for (const fold of folds) {
      await page.evaluate((f) => {
        const hook = (window as unknown as { __flat: Hook }).__flat;
        hook.stage.placePage("hidden");
        hook.stage.layers.frames.style.visibility = "hidden";
        hook.setPose({
          ...hook.stage.placed.rest,
          ry: 0.3,
          rx: 0.1,
        });
        hook.setFold(f);
        hook.screens.showPicture(false);
        hook.screens.picture();
      }, fold);
      const box = await page.evaluate(() => {
        const hook = (window as unknown as { __flat: Hook }).__flat;
        const rects = [hook.screens.flap, hook.screens.body].map((el) =>
          el.getBoundingClientRect(),
        );
        const x0 = Math.max(0, Math.min(...rects.map((r) => r.left)));
        const y0 = Math.max(0, Math.min(...rects.map((r) => r.top)));
        const x1 = Math.min(innerWidth, Math.max(...rects.map((r) => r.right)));
        const y1 = Math.min(
          innerHeight,
          Math.max(...rects.map((r) => r.bottom)),
        );
        return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      });
      const settle = () =>
        page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
      await settle();
      const live = (await page.screenshot({ clip: box })).toString("base64");
      await page.evaluate(() => {
        (window as unknown as { __flat: Hook }).__flat.screens.showPicture(
          true,
        );
      });
      await settle();
      const pictured = (await page.screenshot({ clip: box })).toString(
        "base64",
      );
      const rows = await analyze.evaluate(
        async ({ a, b }) => {
          const read = async (data: string) => {
            const blob = new Blob(
              [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
              { type: "image/" + "png" },
            );
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(bitmap, 0, 0);
            const {
              data: px,
              width,
              height,
            } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
            const energy: number[] = [];
            for (let y = 0; y < height; y++) {
              let sum = 0;
              for (let x = 1; x < width; x++) {
                const i = (y * width + x) * 4;
                const j = i - 4;
                sum +=
                  Math.abs(px[i] - px[j]) +
                  Math.abs(px[i + 1] - px[j + 1]) +
                  Math.abs(px[i + 2] - px[j + 2]);
              }
              energy.push(sum);
            }
            return energy;
          };
          const live = await read(a);
          const picture = await read(b);
          let flagged = 0;
          let run = 0;
          let longest = 0;
          let liveTotal = 0;
          let pictureTotal = 0;
          for (let y = 0; y < live.length; y++) {
            liveTotal += live[y];
            pictureTotal += picture[y];
            if (picture[y] > 600 && live[y] < 0.2 * picture[y]) {
              flagged++;
              run++;
              longest = Math.max(longest, run);
            } else {
              run = 0;
            }
          }
          return {
            rows: live.length,
            flagged,
            longest,
            ratio: +(liveTotal / pictureTotal).toFixed(2),
          };
        },
        { a: live, b: pictured },
      );
      found.push({ fold, ...rows });
    }
    log("text_strips", found);
    await analyze.close();
    expect(found).toHaveLength(folds.length);
  });

  test("visibility against opacity frame flips", async ({ page }) => {
    await withHook(page);
    const client = await page.context().newCDPSession(page);
    const FLIP = `hook.frames.show((i * 7) % hook.frames.elements.length);`;
    const layerStats = async () => {
      let layers: { width: number; height: number }[] = [];
      client.on("LayerTree.layerTreeDidChange", (event) => {
        layers = (event.layers ?? layers) as typeof layers;
      });
      await client.send("LayerTree.enable");
      await page.evaluate(() => {
        const hook = (window as unknown as { __flat: Hook }).__flat;
        hook.frames.show(3);
        hook.frames.show(9);
      });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await client.send("LayerTree.disable");
      return {
        layers: layers.length,
        layerMegabytes: +(
          layers.reduce((sum, l) => sum + l.width * l.height * 4, 0) / 1e6
        ).toFixed(1),
      };
    };
    await throttle(client, 4);
    const out: Record<string, unknown> = {};
    out.visibility = {
      ...(await loop(page, 240, FLIP)),
      ...(await layerStats()),
    };
    await page.addStyleTag({
      content:
        ".flat-frame { visibility: visible !important; opacity: 0; } .flat-frame.on { opacity: 1; }",
    });
    out.opacity = {
      ...(await loop(page, 240, FLIP)),
      ...(await layerStats()),
    };
    await throttle(client, 1);
    log("frame_flips_cpu4x", out);
    expect(Object.keys(out)).toHaveLength(2);
  });

  test("set sizes against the budgets", async ({ page }) => {
    await withHook(page);
    const result = await page.evaluate(async () => {
      const hook = (window as unknown as { __flat: Hook }).__flat;
      const sizes = (await (await fetch("/flat/sizes.json")).json()) as Record<
        string,
        { decodedBytes: number; downloadBytes: number }
      >;
      const measured: Record<string, unknown> = {};
      for (const size of ["full", "half"]) {
        await hook.mount({ set: "cable-landscape", lighting: "day", size });
        const manifest = hook.manifest as unknown as {
          base: string;
          frames: { atlas?: string; pieces: unknown[] }[];
          shared: { atlas: string }[];
        };
        const atlases = new Set<string>();
        manifest.frames.forEach(
          (f) => f.pieces.length > 0 && atlases.add(f.atlas!),
        );
        manifest.shared.forEach((s) => atlases.add(s.atlas));
        let decoded = 0;
        for (const atlas of atlases) {
          const image = new Image();
          image.src = `${manifest.base}${atlas}`;
          await image.decode();
          decoded += image.naturalWidth * image.naturalHeight * 4;
        }
        const entries = performance
          .getEntriesByType("resource")
          .filter((e) =>
            e.name.includes(`/flat/cable-landscape-day-${size}/`),
          ) as PerformanceResourceTiming[];
        measured[size] = {
          atlasCount: atlases.size,
          decodedBytes: decoded,
          encodedBytes: entries.reduce((s, e) => s + e.encodedBodySize, 0),
        };
      }
      return { sizes, measured };
    });
    const mb = (bytes: number) => +(bytes / 1e6).toFixed(1);
    const rows: Record<string, unknown> = {};
    const { sizes } = result;
    const pick = (name: string, size: string, lighting = "day") =>
      sizes[`${name}-${lighting}-${size}`];
    for (const size of ["full", "half"]) {
      const budget =
        size === "full"
          ? { decoded: 160, download: 1.2 }
          : { decoded: 60, download: 0.6 };
      const visits: Record<string, string[]> = {
        landscape: ["cable-landscape", "desk"],
        landscapeCharger: [
          "cable-landscape",
          "desk",
          "charger-landscape-closed",
          "charger-landscape-open",
        ],
        portrait: ["cable-portrait-open", "cable-portrait-close", "desk"],
        portraitCharger: [
          "cable-portrait-open",
          "cable-portrait-close",
          "desk",
          "charger-portrait-closed",
          "charger-portrait-open",
        ],
      };
      for (const [visit, names] of Object.entries(visits)) {
        const parts = names.map((n) => pick(n, size));
        rows[`${visit}_${size}`] = {
          decodedMB: mb(parts.reduce((s, p) => s + p.decodedBytes, 0)),
          downloadMB: +(
            parts.reduce((s, p) => s + p.downloadBytes, 0) / 1e6
          ).toFixed(2),
          budget,
        };
      }
    }
    log("set_sizes", { visits: rows, measured: result.measured });
    for (const name of Object.keys(sizes)) {
      if (/^(cable|charger|desk)-/.test(name) && /-day-/.test(name)) {
        log(`set ${name}`, {
          decodedMB: mb(sizes[name].decodedBytes),
          downloadMB: +(sizes[name].downloadBytes / 1e6).toFixed(2),
        });
      }
    }
    expect(Object.keys(rows).length).toBeGreaterThan(0);
  });
});

test("clip-path on #page while an app opens, under swiftshader", async ({
  playwright,
}, testInfo) => {
  test.setTimeout(240000);
  const browser: Browser = await playwright.chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await withHook(page, "/about?2d");
    const gpu = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return info ? gl!.getParameter(info.UNMASKED_RENDERER_WEBGL) : "none";
    });
    log("swiftshader_renderer", gpu);
    const GROW = (clip: boolean) => `
      const t = Math.min(1, i / 20);
      const eased = 1 - Math.pow(1 - t, 3);
      const lerp = (a, b) => a + (b - a) * eased;
      hook.stage.setPose(hook.stage.placed.rest);
      hook.setFold(0);
      hook.stage.placePage("pinned", { box: { x0: lerp(0.62, 0), y0: lerp(0.3, 0), x1: lerp(0.72, 1), y1: lerp(0.4, 1) } });
      const page = document.getElementById("page");
      page.style.clipPath = ${clip} ? "inset(" + lerp(40, 0) + "px " + lerp(60, 0) + "px " + lerp(40, 0) + "px " + lerp(60, 0) + "px round " + lerp(60, 0) + "px)" : "";
    `;
    const out: Record<string, unknown> = {};
    for (const clip of [false, true]) {
      await page.evaluate(() => {
        const hook = (window as unknown as { __flat: Hook }).__flat;
        hook.stage.placePage("hidden");
        document.getElementById("page")!.style.clipPath = "";
      });
      const started = Date.now();
      const stats = await loop(page, 24, GROW(clip), 30000);
      out[clip ? "with_clip_path" : "without_clip_path"] = {
        ...stats,
        wallMs: Date.now() - started,
      };
    }
    // the same moving screens on a software renderer, live html against the canvas picture
    await page.evaluate(() => {
      const hook = (window as unknown as { __flat: Hook }).__flat;
      hook.stage.placePage("hidden");
      document.getElementById("page")!.style.clipPath = "";
      hook.screens.picture();
    });
    out.swiftshader_live_html = await loop(page, 120, SWAY, 30000);
    await page.evaluate(() => {
      (window as unknown as { __flat: Hook }).__flat.screens.showPicture(true);
    });
    out.swiftshader_canvas_picture = await loop(page, 120, SWAY, 30000);
    log("clip_path_swiftshader", out);
    expect(Object.keys(out)).toHaveLength(4);
  } finally {
    await context?.close();
    await browser.close();
  }
});

// the half frames against the full ones at several phone heights, frames only (the screens and #page hidden), so what
// differs is what the size changes. the phone's height on screen in device pixels is its height at the home pose
const PHONE_HEIGHTS = [344, 450, 550, 650, 750, 900];
const FILL = 0.86;

test("half against full frames by phone height", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240000);
  const baseURL = testInfo.project.use.baseURL;
  const scratch = await (await browser.newContext()).newPage();
  const compare = async (a: Buffer, b: Buffer) =>
    scratch.evaluate(
      async ({ x, y }) => {
        const read = async (data: string) => {
          const blob = new Blob(
            [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
            { type: "image/" + "png" },
          );
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(bitmap, 0, 0);
          return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        };
        const full = await read(x);
        const half = await read(y);
        const luma = (d: ImageData, i: number) =>
          0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
        const { width, height } = full;
        // only pixels where a frame drew something count, since the empty rest of the window would hide the softness
        const bg = luma(full, 0);
        let squared = 0;
        let fullEdge = 0;
        let halfEdge = 0;
        let count = 0;
        for (let yy = 1; yy < height; yy++) {
          for (let xx = 1; xx < width; xx++) {
            const i = (yy * width + xx) * 4;
            if (
              Math.abs(luma(full, i) - bg) < 6 &&
              Math.abs(luma(half, i) - bg) < 6
            ) {
              continue;
            }
            const left = i - 4;
            const up = i - width * 4;
            const diff = luma(full, i) - luma(half, i);
            squared += diff * diff;
            fullEdge +=
              Math.abs(luma(full, i) - luma(full, left)) +
              Math.abs(luma(full, i) - luma(full, up));
            halfEdge +=
              Math.abs(luma(half, i) - luma(half, left)) +
              Math.abs(luma(half, i) - luma(half, up));
            count++;
          }
        }
        return {
          drawnPx: count,
          rmse: +Math.sqrt(squared / Math.max(count, 1)).toFixed(2),
          sharpness: +(halfEdge / Math.max(fullEdge, 1)).toFixed(3),
        };
      },
      { x: a.toString("base64"), y: b.toString("base64") },
    );

  const shot = async (page: Page, phonePx: number, size: string) => {
    const height = Math.round(phonePx / FILL);
    await page.setViewportSize({ width: Math.round(height * 1.7), height });
    // the scene fits itself to the new window once the resize has been quiet (resize.js RESIZE_WAIT_MS), and a mount
    // that starts before that is cut off by it
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 500)),
    );
    await page.evaluate(async (s) => {
      const hook = (window as unknown as { __flat: Hook }).__flat;
      await hook.mount({ set: "cable-landscape", lighting: "day", size: s });
      hook.stage.placePage("hidden");
      hook.stage.layers.screens.style.visibility = "hidden";
      hook.setFold(0);
    }, size);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    return page.screenshot();
  };

  const rows: unknown[] = [];
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({
      baseURL,
      deviceScaleFactor: dpr,
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await withHook(page);
    for (const phonePx of dpr === 1 ? PHONE_HEIGHTS : [800]) {
      // the viewport's css height gives phonePx device pixels once multiplied by dpr
      const cssPx = phonePx / dpr;
      const full = await shot(page, cssPx, "full");
      const half = await shot(page, cssPx, "half");
      rows.push({ dpr, phonePx, ...(await compare(full, half)) });
    }
    await context.close();
  }
  log("half_against_full", rows);
  await scratch.context().close();
  expect(rows).toHaveLength(PHONE_HEIGHTS.length + 1);
});

// reads sizes.json's file from disk for the doc's table without a browser, so the budgets and the sizes sit in one log
test("sizes file is readable", () => {
  const file = path.join(process.cwd(), "public/flat/sizes.json");
  const sizes = JSON.parse(readFileSync(file, "utf8"));
  expect(Object.keys(sizes).length).toBeGreaterThan(0);
});
