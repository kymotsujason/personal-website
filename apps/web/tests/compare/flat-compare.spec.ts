// compares the 2D scene with the 3D scene it was captured from, on the dev page (a capture build, so window.__flat and
// window.spike are both there). the outline check draws the hands and the phone in 3D at a fold and shows the same
// fold's frame in 2D, then compares the two silhouettes. the crop check looks for lines in the frames at several window
// sizes, and the screencast check watches the hands and the phone across a whole unfold and a charger run
import { expect, test, type Browser, type Page } from "@playwright/test";

const LANDSCAPE = { width: 1280, height: 800 };
const PORTRAIT = { width: 600, height: 800 };
// the most the two outlines may be apart, in px
const OUTLINE_LIMIT = 2;
// the 3d render's alpha, from the two key colors the capture tool uses, counts as the silhouette from here
const COVERED = 0.5;

type Manifest = {
  set: string;
  orientation: string;
  window: { width: number; height: number };
  margin: { x: number; top: number; bottom: number };
  frames: { fold: number; lead: number; hand: number; t: number | null }[];
};

type Hook = {
  manifest: Manifest;
  stage: {
    placed: { rest: object };
    setPose: (pose: object) => void;
    setFold: (fold: number, lead?: number, index?: number | null) => void;
    frameLayer: { show: (index: number) => void };
  };
  mount: (options?: {
    set?: string;
    lighting?: string;
    size?: string;
  }) => Promise<Manifest>;
};

const emptyHome = (page: Page) =>
  page.route("**/api/home*", async (route) => {
    // no weather, so the sky stays clear and the same on every run
    const response = await route.fetch();
    const body = await response.json().catch(() => ({}));
    await route.fulfill({ json: { ...body, weather: null } });
  });

const newPage = async (
  browser: Browser,
  size: { width: number; height: number },
  storage: Record<string, string>,
) => {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    timezoneId: "America/Vancouver",
    locale: "en-US",
  });
  await context.addInitScript((entries) => {
    Object.entries(entries).forEach(([key, value]) =>
      localStorage.setItem(key, value),
    );
  }, storage);
  const page = await context.newPage();
  await emptyHome(page);
  return { context, page };
};

// the 3d scene on the dev page with the phone open at rest, and the helpers that draw it into a mask
const open3d = async (browser: Browser, size: typeof LANDSCAPE) => {
  const { context, page } = await newPage(browser, size, {
    introSeen: "1",
    "2d": "0",
  });
  await page.goto("/?dev&noweather");
  await page.waitForFunction(
    () => {
      const spike = (window as any).spike;
      return (
        spike &&
        document.body.classList.contains("ready") &&
        spike.state.phone === "open" &&
        !spike.state.busy &&
        spike.state.volume
      );
    },
    null,
    { timeout: 60000 },
  );
  await page.evaluate(async () => {
    const spike = (window as any).spike;
    const r = spike.renderer();
    const cam = spike.camera();
    // the main scene is only reachable through the renderer, so one frame's render is watched for it
    const draw = r.render;
    let main: any = null;
    r.render = function (s: any, c: any) {
      if (c === cam) {
        main = s;
      }
      return draw.call(this, s, c);
    };
    await new Promise((done) =>
      requestAnimationFrame(() => requestAnimationFrame(done)),
    );
    r.render = draw;
    const cap: any = { main, found: [], keys: null };
    (window as any).__cmp = cap;
    const screenOf = (mesh: any) => {
      const s = spike.state;
      if (mesh.material === s.cover.material) {
        return "cover";
      }
      for (let p = mesh; p; p = p.parent) {
        if (p === s.flap) {
          return "flap";
        }
        if (p === s.body) {
          return "body";
        }
      }
      return null;
    };
    // the phone is built again on a resize, so its screens are found again before each read
    cap.discover = () => {
      const named: Record<string, any> = {};
      main.traverse((o: any) => {
        const m = o.material;
        if (
          m &&
          m.isMeshBasicMaterial &&
          m.onBeforeCompile &&
          String(m.onBeforeCompile).includes("planeOrigin")
        ) {
          named[String(screenOf(o))] = { mesh: o, material: m };
        }
      });
      cap.found = ["cover", "flap", "body"].map((name) => named[name]);
      return Object.keys(named);
    };
    cap.bones = () => {
      const bones = spike.state.handModel.bones;
      const V = cam.position.constructor;
      return Object.keys(bones)
        .sort()
        .map((name) => {
          const p = bones[name].getWorldPosition(new V()).project(cam);
          return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight];
        });
    };
  });
  return { context, page };
};

// the 3d scene held at one frame's fold, lead, and hand fold (the capture's settle), drawn twice with the screens in
// two key colors, and the silhouette of the hands and the phone with the screens cut out, as one byte a px (1 inside),
// top row first, at the window's size
const mask3d = (
  page: Page,
  step: { fold: number; lead: number; hand: number; path: string | null },
) =>
  page.evaluate(
    async ({ step, covered }) => {
      const spike = (window as any).spike;
      const s = spike.state;
      const cap = (window as any).__cmp;
      const rest = spike.timeline(false).rest;
      const values = { ...rest, fold: step.fold, idle: 0, blur: 0 };
      const frames = (n: number) =>
        new Promise<void>((done) => {
          const next = (k: number) =>
            k === 0 ? done() : requestAnimationFrame(() => next(k - 1));
          next(n);
        });
      const toBase64 = (bytes: Uint8Array) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const text = String(reader.result);
            resolve(text.slice(text.indexOf(",") + 1));
          };
          reader.readAsDataURL(new Blob([bytes.slice()]));
        });
      let off = Infinity;
      let kept: any = null;
      for (let tries = 0; tries < 10 && off > 2; tries++) {
        spike.freeze(values);
        s.lead = step.lead;
        if (step.path && s.foldPath !== step.path) {
          s.foldPath = step.path;
          spike.rekey();
        }
        // loop.js picks portrait's path as the fold leaves either end, so it's told the fold didn't move
        s.lastFold = values.fold;
        for (let k = 0; k < 4; k++) {
          const look = spike.backdrop.look;
          look.yaw = look.targetYaw;
          look.pitch = look.targetPitch;
          s.lastFold = values.fold;
          await frames(1);
        }
        cap.discover();
        const r = spike.renderer();
        const cam = spike.camera();
        // the quality ladder resizes the renderer when frames run slow, so the window's size is set again here
        r.setPixelRatio(1);
        r.setSize(innerWidth, innerHeight, false);
        cam.aspect = innerWidth / innerHeight;
        cam.clearViewOffset();
        cam.updateProjectionMatrix();
        // the hands are checked against the pose the scene reports for the hand fold, as the capture does
        const drawn = cap.bones();
        s.hands.update(step.hand);
        const bones = cap.bones();
        off = Math.max(
          ...drawn.map(([x, y]: number[], k: number) =>
            Math.hypot(x - bones[k][0], y - bones[k][1]),
          ),
        );
        const gl = r.getContext();
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const Basic = cap.found[0].material.constructor;
        cap.keys = cap.keys || [
          new Basic({ color: 0xff00ff, toneMapped: false }),
          new Basic({ color: 0x00ff00, toneMapped: false }),
        ];
        const reads = cap.keys.map((key: any) => {
          cap.found.forEach((f: any) => {
            f.mesh.material = key;
          });
          r.setRenderTarget(null);
          r.setClearColor(0x000000, 0);
          r.clear(true, true, true);
          r.render(cap.main, cam);
          const raw = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
          return raw;
        });
        cap.found.forEach((f: any) => {
          f.mesh.material = f.material;
        });
        const [m, g] = reads;
        const out = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
          const from = (h - 1 - y) * w * 4;
          for (let x = 0; x < w; x++) {
            const i = from + x * 4;
            // magenta minus green is (255, -255, 255) times the screen's coverage
            const k = Math.min(
              1,
              Math.max(
                0,
                (m[i] - g[i] + g[i + 1] - m[i + 1] + m[i + 2] - g[i + 2]) / 765,
              ),
            );
            out[y * w + x] = Math.max(0, m[i + 3] / 255 - k) >= covered ? 1 : 0;
          }
        }
        kept = { w, h, mask: await toBase64(out) };
      }
      return { ...kept, off };
    },
    { step, covered: COVERED },
  );

// the 2d scene on the dev page at one frame, with only the hands' frame showing on a transparent page. the page's
// pixels have alpha, so the screenshot is the 2d render's own transparency
const open2d = async (
  browser: Browser,
  size: typeof LANDSCAPE,
  options: { set?: string; lighting?: string; size?: string } = {},
  storage: Record<string, string> = {},
) => {
  const { context, page } = await newPage(browser, size, {
    introSeen: "1",
    "2d": "1",
    // a device through 2dAuto stays calm, so nothing drifts or rains while a frame is looked at
    "2dAuto": String(Date.now()),
    ...storage,
  });
  await page.goto("/?2d&noweather");
  await page.waitForFunction(() => Boolean((window as any).__flat), null, {
    timeout: 60000,
  });
  const manifest = await page.evaluate(
    (options) => (window as any).__flat.mount(options),
    { lighting: "day", size: "full", ...options },
  );
  await page.addStyleTag({
    content: `
      html, body { background: transparent !important; }
      body * { visibility: hidden !important; }
      .flat-frame.on, .flat-frame.on * { visibility: visible !important; }
    `,
  });
  return { context, page, manifest: manifest as Manifest };
};

// shows frame `index` at the rest pose and waits for it to paint
const show2d = async (page: Page, index: number) => {
  await page.evaluate((index) => {
    const hook = (window as any).__flat as Hook;
    const frame = hook.manifest.frames[index];
    hook.stage.setPose(hook.stage.placed.rest);
    hook.stage.setFold(frame.fold, frame.lead, index);
  }, index);
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
};

// a screenshot of the transparent page, as the silhouette mask (alpha at least half), one byte a px, top row first
const shotMask = async (page: Page, viewer: Page) => {
  const png = await page.screenshot({ omitBackground: true });
  return viewer.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const out = new Uint8Array(bitmap.width * bitmap.height);
    for (let i = 0; i < out.length; i++) {
      out[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
    }
    let text = "";
    for (let i = 0; i < out.length; i += 0x8000) {
      text += String.fromCharCode(...out.subarray(i, i + 0x8000));
    }
    return { w: bitmap.width, h: bitmap.height, mask: btoa(text) };
  }, png.toString("base64"));
};

const fromBase64 = (text: string) =>
  new Uint8Array(Buffer.from(text, "base64"));

// the mask's boundary: the pixels inside it with a 4 neighbor outside it. the window's own edge isn't a boundary,
// since both silhouettes are cut there the same way
const boundaryOf = (mask: Uint8Array, w: number, h: number) => {
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) {
        continue;
      }
      if (
        (x > 0 && !mask[i - 1]) ||
        (x < w - 1 && !mask[i + 1]) ||
        (y > 0 && !mask[i - w]) ||
        (y < h - 1 && !mask[i + w])
      ) {
        edge[i] = 1;
      }
    }
  }
  return edge;
};

// for each boundary pixel of `from`, the distance to the nearest boundary pixel of `to`, searched out to `reach` px
const gaps = (
  from: Uint8Array,
  to: Uint8Array,
  w: number,
  h: number,
  reach: number,
) => {
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!from[y * w + x]) {
        continue;
      }
      let best = reach * reach;
      for (let r = 0; r <= reach && r * r <= best; r++) {
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) {
            continue;
          }
          const step = Math.abs(dy) === r ? 1 : 2 * r || 1;
          for (let dx = -r; dx <= r; dx += step) {
            const xx = x + dx;
            if (xx >= 0 && xx < w && to[yy * w + xx]) {
              best = Math.min(best, dx * dx + dy * dy);
            }
          }
        }
      }
      out.push(Math.sqrt(best));
    }
  }
  return out;
};

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  );
};

// the frames to compare: the manifest's frames nearest these folds, and in a set with a lead (portrait's opening path)
// two of the lead's own frames, where the hands move ahead of the phone
const FOLDS = [1, 0.85, 0.65, 0.45, 0.25, 0.1, 0];
const pickFrames = (manifest: Manifest) => {
  const { frames } = manifest;
  const leading = (f: Manifest["frames"][number]) => f.hand !== f.fold;
  const folding = frames
    .map((frame, index) => ({ frame, index }))
    .filter(({ frame }) => !leading(frame));
  const picked = new Set<number>();
  FOLDS.forEach((target) => {
    const best = folding.reduce((a, b) =>
      Math.abs(b.frame.fold - target) < Math.abs(a.frame.fold - target) ? b : a,
    );
    picked.add(best.index);
  });
  const lead = frames
    .map((frame, index) => ({ frame, index }))
    .filter(({ frame }) => leading(frame));
  [0.5, 1].forEach((target) => {
    if (lead.length > 0) {
      const best = lead.reduce((a, b) =>
        Math.abs(b.frame.lead - target) < Math.abs(a.frame.lead - target)
          ? b
          : a,
      );
      picked.add(best.index);
    }
  });
  return [...picked].sort((a, b) => a - b);
};

type Shape = {
  name: string;
  size: typeof LANDSCAPE;
  set: string;
  path: string | null;
};

const SHAPES: Shape[] = [
  { name: "landscape", size: LANDSCAPE, set: "landscape", path: null },
  {
    name: "portrait opening",
    size: PORTRAIT,
    set: "portrait-open",
    path: "open",
  },
  {
    name: "portrait closing",
    size: PORTRAIT,
    set: "portrait-close",
    path: "close",
  },
];

test.describe("the outline of the hands and the phone", () => {
  test.setTimeout(10 * 60 * 1000);

  for (const shape of SHAPES) {
    test(`${shape.name} is within ${OUTLINE_LIMIT} px of 3D`, async ({
      browser,
    }) => {
      const flat = await open2d(browser, shape.size, { set: shape.set });
      const three = await open3d(browser, shape.size);
      const viewer = await three.context.newPage();
      try {
        const portrait = await three.page.evaluate(
          () => (window as any).spike.state.portrait,
        );
        expect(
          portrait,
          "the 3d phone is held the way the set was captured",
        ).toBe(shape.size.width < shape.size.height);
        const frames = pickFrames(flat.manifest);
        expect(frames.length).toBeGreaterThan(5);
        const worst = { gap: 0, at: "" };
        for (const index of frames) {
          const frame = flat.manifest.frames[index];
          const step = {
            fold: frame.fold,
            lead: frame.lead,
            hand: frame.hand,
            path: shape.path,
          };
          const a = await mask3d(three.page, step);
          expect(
            a.off,
            `the 3d hands at frame ${index} reached their pose`,
          ).toBeLessThanOrEqual(2);
          await show2d(flat.page, index);
          const b = await shotMask(flat.page, viewer);
          expect([a.w, a.h], "both renders are the window's size").toEqual([
            b.w,
            b.h,
          ]);
          const m3 = fromBase64(a.mask);
          const m2 = fromBase64(b.mask);
          const edge3 = boundaryOf(m3, a.w, a.h);
          const edge2 = boundaryOf(m2, a.w, a.h);
          const covered3 = m3.reduce((n, v) => n + v, 0);
          expect(
            covered3,
            `frame ${index} has something drawn in 3d`,
          ).toBeGreaterThan(1000);
          const all = [
            ...gaps(edge3, edge2, a.w, a.h, 24),
            ...gaps(edge2, edge3, a.w, a.h, 24),
          ];
          const max = Math.max(...all);
          const label = `${shape.name} frame ${index} (fold ${frame.fold.toFixed(3)}, lead ${frame.lead.toFixed(2)})`;
          console.log(
            `OUTLINE ${label} max ${max.toFixed(2)} p99.9 ${percentile(all, 0.999).toFixed(2)} over ${all.filter((g) => g > OUTLINE_LIMIT).length} of ${all.length}`,
          );
          if (max > worst.gap) {
            worst.gap = max;
            worst.at = label;
          }
        }
        expect(
          worst.gap,
          `the largest gap between the outlines, at ${worst.at}`,
        ).toBeLessThanOrEqual(OUTLINE_LIMIT);

        // the check can fail: the 3d silhouette of one frame against the 2d frame a few folds away is well past the limit
        const near = flat.manifest.frames[frames[2]];
        const other = frames[3];
        const wrong = await mask3d(three.page, {
          fold: near.fold,
          lead: near.lead,
          hand: near.hand,
          path: shape.path,
        });
        await show2d(flat.page, other);
        const there = await shotMask(flat.page, viewer);
        const control = Math.max(
          ...gaps(
            boundaryOf(fromBase64(wrong.mask), wrong.w, wrong.h),
            boundaryOf(fromBase64(there.mask), wrong.w, wrong.h),
            wrong.w,
            wrong.h,
            24,
          ),
        );
        console.log(
          `OUTLINE ${shape.name} control, the wrong frame is ${control.toFixed(2)} px off`,
        );
        expect(
          control,
          "a frame that isn't the same one is told apart",
        ).toBeGreaterThan(OUTLINE_LIMIT);
      } finally {
        await flat.context.close();
        await three.context.close();
      }
    });
  }
});

// the hand crops: the frame as the browser draws its pieces, against the same frame drawn as one image with no piece
// edges in it (the pieces composed on a canvas at the frame's own size). a seam between pieces, or a piece edge cut
// through a hand, shows as a long run of pixels that differ along a row or a column. the capture's own PNGs aren't kept
// (.media/flat holds only each set's json), so the whole image comes from the packed atlases and not the capture
const CROP_SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1600, height: 1000 },
  { width: 2560, height: 1440 },
  { width: 768, height: 1024 },
  { width: 600, height: 900 },
];
const CROP_FOLDS = [1, 0.75, 0.5, 0.25, 0];
// a color change counts from this many levels (the strong limit where the reference has a rim highlight or edge
// nearby, the flat one elsewhere), and a line is this many pixels in a row
const STRONG_LEVELS = 80;
const FLAT_LEVELS = 24;
const LINE_RUN = 24;

type Seam = { row: number; kind: "alpha" | "color" };
const composeFrame = (page: Page, index: number, seam: Seam | null = null) =>
  page.evaluate(
    async ([index, seam]) => {
      const hook = (window as any).__flat as Hook;
      const frames = (hook as any).frames as { elements: HTMLElement[] };
      const el = frames.elements[index];
      const width = parseFloat(el.style.width);
      const height = parseFloat(el.style.height);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      const images = new Map<string, HTMLImageElement>();
      for (const piece of el.querySelectorAll<HTMLElement>("i")) {
        const style = getComputedStyle(piece);
        const found = style.backgroundImage.match(/url\("?([^")]+)"?\)/);
        if (!found) {
          throw new Error("a piece has no atlas");
        }
        let image = images.get(found[1]);
        if (!image) {
          image = new Image();
          image.src = found[1];
          await image.decode();
          images.set(found[1], image);
        }
        const [bx, by] = style.backgroundPosition
          .split(" ")
          .map((v) => parseFloat(v));
        const w = piece.offsetWidth;
        const h = piece.offsetHeight;
        ctx.drawImage(
          image,
          -bx,
          -by,
          w,
          h,
          parseFloat(piece.style.left),
          parseFloat(piece.style.top),
          w,
          h,
        );
      }
      // the control for the check: a 2 px band across the image that loses some coverage or gains some color, as a seam
      // between two pieces would
      if (seam !== null) {
        const band = ctx.getImageData(0, seam.row, width, 2);
        for (let i = 0; i < band.data.length; i += 4) {
          if (seam.kind === "alpha") {
            band.data[i + 3] = Math.max(0, band.data[i + 3] - 60);
          } else {
            for (let c = 0; c < 3; c++) {
              band.data[i + c] = Math.min(255, band.data[i + c] + 50);
            }
          }
        }
        ctx.putImageData(band, 0, seam.row);
      }
      // shown as a background image, the way a piece is, so both are scaled by the same filter
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((made) => resolve(made!), "image/png"),
      );
      const url = URL.createObjectURL(blob);
      const decoded = new Image();
      decoded.src = url;
      await decoded.decode();
      const whole = document.createElement("div");
      whole.className = "whole";
      whole.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;background:url("${url}") 0 0 / ${width}px ${height}px no-repeat`;
      el.classList.add("composed");
      el.append(whole);
    },
    [index, seam] as const,
  );

const lines = (page: Page, a: Buffer, b: Buffer) =>
  page.evaluate(
    async ([x, y, strongLevels, flatLevels]) => {
      const load = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes]));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const first = await load(x as string);
      const second = await load(y as string);
      const { width, height } = first;
      // an edge is drawn a fraction of a px differently by one piece and by a whole image, so near an edge only a pixel that
      // one render has and the other doesn't counts (a cut edge), and inside the hands and the phone any change counts
      // (a line). the inside is where the whole image is solid for 2 px around
      const solid = new Uint8Array(width * height);
      for (let i = 0; i < solid.length; i++) {
        solid[i] = second.data[i * 4 + 3] >= 250 ? 1 : 0;
      }
      const across = new Uint8Array(width * height);
      for (let yy = 0; yy < height; yy++) {
        for (let xx = 0; xx < width; xx++) {
          let all = 1;
          for (let k = -2; k <= 2 && all; k++) {
            const at = Math.min(width - 1, Math.max(0, xx + k));
            all = solid[yy * width + at];
          }
          across[yy * width + xx] = all;
        }
      }
      const inside = new Uint8Array(width * height);
      for (let yy = 0; yy < height; yy++) {
        for (let xx = 0; xx < width; xx++) {
          let all = 1;
          for (let k = -2; k <= 2 && all; k++) {
            const at = Math.min(height - 1, Math.max(0, yy + k));
            all = across[at * width + xx];
          }
          inside[yy * width + xx] = all;
        }
      }
      const differs = new Uint8Array(width * height);
      let count = 0;
      let drawn = 0;
      let flatWorst = 0;
      for (let i = 0; i < differs.length; i++) {
        const j = i * 4;
        if (first.data[j + 3] > 0 || second.data[j + 3] > 0) {
          drawn++;
        }
        let off = false;
        if (inside[i]) {
          // a thin highlight along the rim is sampled a fraction of a px differently too, which moves its levels by up
          // to about 60, so there (where the reference changes by over 24 levels between neighbors) a color change
          // counts from the strong limit. everywhere else it counts from the flat one, which a seam's bleed of 30 to 60
          // levels passes
          const luma = (d: ImageData, k: number) =>
            (d.data[k] + d.data[k + 1] + d.data[k + 2]) / 3;
          const here = luma(second, j);
          const edge = Math.max(
            Math.abs(here - luma(second, j - 4)),
            Math.abs(here - luma(second, j + 4)),
            Math.abs(here - luma(second, j - width * 4)),
            Math.abs(here - luma(second, j + width * 4)),
          );
          const limit =
            edge > 24 ? (strongLevels as number) : (flatLevels as number);
          for (let c = 0; c < 3; c++) {
            const diff = Math.abs(first.data[j + c] - second.data[j + c]);
            if (edge <= 24) {
              flatWorst = Math.max(flatWorst, diff);
            }
            off ||= diff > limit;
          }
          off ||= Math.abs(first.data[j + 3] - second.data[j + 3]) > 24;
        } else {
          off = Math.abs(first.data[j + 3] - second.data[j + 3]) > 128;
        }
        if (off) {
          differs[i] = 1;
          count++;
        }
      }
      let longestRow = 0;
      let rowAt = -1;
      for (let yy = 0; yy < height; yy++) {
        let run = 0;
        for (let xx = 0; xx < width; xx++) {
          run = differs[yy * width + xx] ? run + 1 : 0;
          if (run > longestRow) {
            longestRow = run;
            rowAt = yy;
          }
        }
      }
      let longestColumn = 0;
      let columnAt = -1;
      for (let xx = 0; xx < width; xx++) {
        let run = 0;
        for (let yy = 0; yy < height; yy++) {
          run = differs[yy * width + xx] ? run + 1 : 0;
          if (run > longestColumn) {
            longestColumn = run;
            columnAt = xx;
          }
        }
      }
      return {
        count,
        drawn,
        flatWorst,
        longestRow,
        rowAt,
        longestColumn,
        columnAt,
      };
    },
    [
      a.toString("base64"),
      b.toString("base64"),
      STRONG_LEVELS,
      FLAT_LEVELS,
    ] as const,
  );

test.describe("the hand crops", () => {
  test.setTimeout(10 * 60 * 1000);

  // the control runs at a scaled size (1366 by 768), where the real frames differ from their whole image by a few levels,
  // with a seam that loses 60 levels of coverage or gains 50 of color, which is about what a bleed between pieces does.
  // the seam is in the whole image and the reference is the pieces, which the check reads its solid inside from
  for (const kind of ["alpha", "color"] as const) {
    test(`a ${kind} seam across a frame is found`, async ({ browser }) => {
      const flat = await open2d(browser, CROP_SIZES[2]);
      const viewer = await flat.context.newPage();
      try {
        await flat.page.addStyleTag({
          content:
            ".flat-frame.on.composed i { visibility: hidden !important; }",
        });
        const last = flat.manifest.frames.length - 1;
        await show2d(flat.page, last);
        const pieces = await flat.page.screenshot({ omitBackground: true });
        // the open phone's middle, which is solid across its width
        await composeFrame(flat.page, last, {
          row: flat.manifest.margin.top + 400,
          kind,
        });
        await show2d(flat.page, last);
        const whole = await flat.page.screenshot({ omitBackground: true });
        const found = await lines(viewer, whole, pieces);
        console.log(
          `CROP control, a ${kind} seam gives a row run of ${found.longestRow}`,
        );
        expect(found.longestRow).toBeGreaterThanOrEqual(LINE_RUN);
      } finally {
        await flat.context.close();
      }
    });
  }

  for (const size of CROP_SIZES) {
    test(`${size.width} by ${size.height} shows no lines`, async ({
      browser,
    }) => {
      const flat = await open2d(browser, size);
      const viewer = await flat.context.newPage();
      try {
        await flat.page.addStyleTag({
          content:
            ".flat-frame.on.composed i { visibility: hidden !important; }",
        });
        const worst = { run: 0, at: "" };
        for (const index of pickFrames(flat.manifest).filter((i) => {
          const f = flat.manifest.frames[i];
          return CROP_FOLDS.some((t) => Math.abs(f.fold - t) < 0.12);
        })) {
          const frame = flat.manifest.frames[index];
          // a big window can be shot before its frame has painted, so each shot is taken after two settled frames, and
          // a pair that differs over most of the drawing (a shot that missed a paint, which no seam does) is taken again
          const shoot = async () => {
            await show2d(flat.page, index);
            return flat.page.screenshot({ omitBackground: true });
          };
          await show2d(flat.page, index);
          const pieces = await shoot();
          await composeFrame(flat.page, index);
          let whole = await shoot();
          let found = await lines(viewer, pieces, whole);
          const label = `${flat.manifest.set} ${size.width}x${size.height} frame ${index} fold ${frame.fold.toFixed(3)}`;
          if (found.count > found.drawn / 2) {
            console.log(
              `CROP ${label} retaken, ${found.count} of ${found.drawn} differed`,
            );
            whole = await shoot();
            found = await lines(viewer, pieces, whole);
          }
          expect(found.drawn, "something is drawn").toBeGreaterThan(1000);
          console.log(
            `CROP ${label} different ${found.count} of ${found.drawn}, flat worst ${found.flatWorst}, longest row run ${found.longestRow} (y ${found.rowAt}), column run ${found.longestColumn} (x ${found.columnAt})`,
          );
          const run = Math.max(found.longestRow, found.longestColumn);
          if (run > worst.run) {
            worst.run = run;
            worst.at = label;
          }
        }
        expect(
          worst.run,
          `the longest line of pixels that differ, at ${worst.at}`,
        ).toBeLessThan(LINE_RUN);
      } finally {
        await flat.context.close();
      }
    });
  }
});

// chromium's own screencast across a whole unfold and a charger run. the page shows only the hands' frame on magenta,
// so a captured image with no hands and phone in it is a blank frame. the screencast can skip frames when it falls
// behind, so this catches a stray or blank frame and doesn't count them
const MAGENTA_NEAR = 90;
// the share of the image the hands and the phone cover, at the least, in any captured image
const LEAST_COVERED = 0.04;

const startCast = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page);
  const shots: string[] = [];
  cdp.on("Page.screencastFrame", (frame) => {
    shots.push(frame.data);
    cdp
      .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
      .catch(() => {});
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 40,
    maxWidth: 320,
    maxHeight: 200,
    everyNthFrame: 1,
  });
  return {
    stop: async () => {
      await cdp.send("Page.stopScreencast");
      await cdp.detach();
      return shots;
    },
  };
};

const covered = (viewer: Page, shots: string[]) =>
  viewer.evaluate(
    async ([list, near]) => {
      const shares: number[] = [];
      for (const base64 of list as string[]) {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(
          new Blob([bytes], { type: "image/jpeg" }),
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bitmap, 0, 0);
        const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        let hands = 0;
        for (let i = 0; i < data.length; i += 4) {
          const away =
            Math.abs(data[i] - 255) + data[i + 1] + Math.abs(data[i + 2] - 255);
          if (away > (near as number)) {
            hands++;
          }
        }
        shares.push(hands / (data.length / 4));
      }
      return shares;
    },
    [shots, MAGENTA_NEAR] as const,
  );

test.describe("the screencast", () => {
  test.setTimeout(5 * 60 * 1000);

  test("a close, an unfold, and a charger run show the hands in every image", async ({
    browser,
  }) => {
    const flat = await open2d(browser, LANDSCAPE, {}, { "2dAuto": "" });
    const viewer = await flat.context.newPage();
    const { page } = flat;
    try {
      await page.addStyleTag({
        content: "html { background: #ff00ff !important; }",
      });
      const status = () => page.evaluate(() => (window as any).__flat.status());
      const DRAIN = 10 * 60 * 1000;
      // the unfold and the close
      const motion = await startCast(page);
      await page.keyboard.press("Escape");
      await expect.poll(status).toMatchObject({ phone: "closed", busy: false });
      await page.keyboard.press("Enter");
      await expect.poll(status).toMatchObject({ phone: "open", busy: false });
      const folds = await motion.stop();
      const foldShares = await covered(viewer, folds);
      console.log(
        `CAST folds ${folds.length} images, least covered ${Math.min(...foldShares).toFixed(3)}`,
      );
      expect(folds.length, "the screencast caught the folds").toBeGreaterThan(
        10,
      );
      expect(
        Math.min(...foldShares),
        "every image shows the hands",
      ).toBeGreaterThan(LEAST_COVERED);

      // the charger's plug run
      await page.evaluate(
        (at) => (window as any).__flat.battery(at),
        DRAIN - 30000,
      );
      await expect
        .poll(
          () => page.evaluate(() => (window as any).__flat.charger().ready),
          {
            timeout: 20000,
          },
        )
        .toBe(true);
      const run = await startCast(page);
      await page.evaluate(
        (at) => (window as any).__flat.battery(at),
        DRAIN - 300,
      );
      await expect
        .poll(
          () => page.evaluate(() => (window as any).__flat.charger().busy),
          {
            timeout: 15000,
          },
        )
        .toBe(true);
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const s = (window as any).__flat.charger();
              return !s.busy && s.plugged;
            }),
          { timeout: 20000 },
        )
        .toBe(true);
      const plug = await run.stop();
      const plugShares = await covered(viewer, plug);
      console.log(
        `CAST charger ${plug.length} images, least covered ${Math.min(...plugShares).toFixed(3)}`,
      );
      expect(plug.length, "the screencast caught the run").toBeGreaterThan(10);
      expect(
        Math.min(...plugShares),
        "every image shows the hands",
      ).toBeGreaterThan(LEAST_COVERED);

      // the check can fail: with the hands' frame hidden, no image the screencast takes has any in it. the page's color
      // is nudged each frame, since the screencast only sends an image when something repaints
      await page.addStyleTag({
        content:
          ".flat-frame.on, .flat-frame.on * { visibility: hidden !important; }",
      });
      const blank = await startCast(page);
      await page.evaluate(async () => {
        for (let i = 0; i < 8; i++) {
          document.documentElement.style.setProperty(
            "background",
            i % 2 ? "#ff00ff" : "#fe00ff",
            "important",
          );
          await new Promise((done) => requestAnimationFrame(done));
        }
      });
      const none = await blank.stop();
      expect(
        none.length,
        "the screencast caught the hidden frame",
      ).toBeGreaterThan(3);
      const noneShares = await covered(viewer, none);
      // the first image can be the frame painted before the hiding, so the last ones are read
      const settled = noneShares.slice(-3);
      console.log(
        `CAST control, ${none.length} images with the frame hidden, the shares ${noneShares.map((v) => v.toFixed(3)).join(" ")}`,
      );
      expect(Math.max(...settled)).toBeLessThan(LEAST_COVERED);
    } finally {
      await flat.context.close();
    }
  });
});
