// captures the 2d scene's frames from the 3d scene: the hands and the phone with its screens cut out, at each fold
// a set needs, plus where the screens' and halves' corners land, the drag's table, and the desk's cube faces. it
// drives the dev server (pnpm --dir apps/web dev, port 4321) in headless chromium on the gpu. run it from site/:
//   node tools/capture-flat/capture.mjs --set <SET> --lighting <day|dusk|night>
// the raw output lands in .media/flat/<SET>-<LIGHTING>/ for the packer. every odd step below fixed a real bug in the
// spike (spikes/flat-intro/capture.mjs in the workshop repo), so read the spec's lessons before changing one
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { daylight } from "../../apps/web/src/scene/daylight.js";
import { NIGHT, wallpaperAt } from "../../apps/web/src/scene/monitors.js";
import {
  FOLD_SAMPLES,
  FOLD_TIME,
  MAX_FOLLOW,
  ease,
  foldPoseAt,
} from "../../apps/web/src/scene/shared/motion.js";
import { DUO } from "../../apps/web/src/scene/state.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, "..", "..");
const SERVER = "http://127.0.0.1:4321";
const GPU_ARGS = ["--use-angle=gl", "--enable-gpu", "--ignore-gpu-blocklist"];

// folds closer than this are one frame
export const MERGE = 0.004;
const REFRESH = 1000 / 60;
// the extra room around the window in each frame. the sides fit a 21:9 window, the top the flap standing up, and
// the bottom the phone moving away
export const MARGIN = { x: 320, top: 160, bottom: 200 };
// a wrong pose was 8 px or more off in the spike
const POSE_LIMIT = 2;
const POSE_TRIES = 10;
export const LIGHTING = { day: 13, dusk: 19, night: 23 };
const SUN = { sunrise: 7, sunset: 19 };
const SCREEN_NAMES = ["cover", "flap", "body"];
const FULL_PHOTO_WIDTH = 4096;
// the 3d desk is seen through a 75 degree view
const DESK_FOV = 75;
const FACES = {
  front: { dir: [0, 0, -1], up: [0, 1, 0] },
  right: { dir: [1, 0, 0], up: [0, 1, 0] },
  back: { dir: [0, 0, 1], up: [0, 1, 0] },
  left: { dir: [-1, 0, 0], up: [0, 1, 0] },
  up: { dir: [0, 1, 0], up: [0, 0, 1] },
  down: { dir: [0, -1, 0], up: [0, 0, -1] },
};

const STILL = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
const keyFold = (from, to, p, action) =>
  foldPoseAt(STILL, STILL, from, to, p, action).fold;

// every curve that plays the folds, each as its fold over u from 0 to 1 across `time` ms
export const foldCurves = () => [
  { name: "full intro", time: 1100, fold: (u) => 1 - ease.inOutSine(u) },
  { name: "fast intro", time: 700, fold: (u) => 1 - ease.outSine(u) },
  {
    name: "close key",
    time: FOLD_TIME.close,
    fold: (u) => keyFold(0, 1, ease.inOutSine(u), "close"),
  },
  {
    name: "open key",
    time: FOLD_TIME.open,
    fold: (u) => keyFold(1, 0, ease.inOutSine(u), "open"),
  },
  // a release runs outCubic over the fold's time scaled by what's left of it (fold.js endGesture), so wherever it
  // starts it moves the progress fastest as it starts, at 3 / FOLD_TIME per ms. these move it at that pace all the
  // way, which no release outruns
  {
    name: "close release",
    time: FOLD_TIME.close / 3,
    fold: (u) => keyFold(0, 1, u, "close"),
  },
  {
    name: "open release",
    time: FOLD_TIME.open / 3,
    fold: (u) => keyFold(1, 0, u, "open"),
  },
];

// the folds each curve passes at 60 hz, from 1 down to 0, merged where they're closer than MERGE
export const foldList = () => {
  const all = [];
  for (const curve of foldCurves()) {
    const steps = Math.ceil(curve.time / REFRESH);
    for (let k = 0; k <= steps; k++) {
      all.push(curve.fold(k / steps));
    }
  }
  all.sort((a, b) => b - a);
  const list = [1];
  for (const fold of all) {
    if (list[list.length - 1] - fold >= MERGE) {
      list.push(fold);
    }
  }
  if (list[list.length - 1] < MERGE) {
    list[list.length - 1] = 0;
  } else {
    list.push(0);
  }
  return list;
};

// the sets the tool can capture. a set is its orientation, the window shape it's captured at, its steps (each the
// phone's fold, the lead, the hands' fold, and t for a timeline), and whether the desk's faces come with it
export const SETS = {
  landscape: {
    orientation: "landscape",
    window: { width: 1280, height: 800 },
    desk: true,
    steps: () =>
      foldList().map((fold) => ({ fold, lead: 0, hand: fold, t: null })),
  },
};

// the frame from two reads of the gl buffer (bottom row first, premultiplied), one with the screens drawn solid
// magenta and one solid green. where the two differ a screen shows, and by how much says that pixel's coverage, so
// the result is the picture without the screens, top row first, with straight alpha
export const matte = (magenta, green, width, height) => {
  const out = new Uint8Array(width * height * 4);
  const m = magenta;
  const g = green;
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * width * 4;
    const to = y * width * 4;
    for (let x = 0; x < width * 4; x += 4) {
      const i = from + x;
      // magenta minus green is (255, -255, 255) times the screen's coverage
      const k = Math.min(
        1,
        Math.max(
          0,
          (m[i] - g[i] + g[i + 1] - m[i + 1] + m[i + 2] - g[i + 2]) / (3 * 255),
        ),
      );
      const a = Math.max(0, m[i + 3] / 255 - k);
      if (a <= 0.002) {
        continue;
      }
      // the premultiplied color left once the magenta's share is taken out
      const r = Math.max(0, m[i] / 255 - k);
      const gg = m[i + 1] / 255;
      const b = Math.max(0, m[i + 2] / 255 - k);
      const o = to + x;
      out[o] = Math.min(255, Math.round((r / a) * 255));
      out[o + 1] = Math.min(255, Math.round((gg / a) * 255));
      out[o + 2] = Math.min(255, Math.round((b / a) * 255));
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
};

// the largest distance between matching points, the first pass's moved by `shift`
export const largestOffset = (now, first, [dx, dy]) => {
  if (now.length !== first.length) {
    throw new Error(
      `the pose has ${now.length} points where the first pass had ${first.length}`,
    );
  }
  let worst = 0;
  now.forEach(([x, y], k) => {
    const [fx, fy] = first[k];
    worst = Math.max(worst, Math.hypot(x - (fx + dx), y - (fy + dy)));
  });
  return worst;
};

// fold.js foldTable's table from its measurements: for each px the pointer moves, how far through the fold to be.
// edge is where the flap's outer edge is along the swipe at each sample, and corners the phone's outer corners
export const dragTable = (edge, corners, sign, samples = FOLD_SAMPLES) => {
  const ahead = edge.map((x) => (x - edge[0]) * sign);
  const moved = (a, b) =>
    Math.max(
      ...corners[a].map((c, k) =>
        Math.hypot(c[0] - corners[b][k][0], c[1] - corners[b][k][1]),
      ),
    );
  const span = Math.max(...ahead);
  const table = [0];
  let i = 0;
  for (let k = 1; i < samples; k++) {
    const from = i;
    while (i < samples && ahead[i] < k && moved(from, i + 1) <= MAX_FOLLOW) {
      i++;
    }
    if (i === from && ahead[i] < k) {
      i++;
    }
    table.push(i / samples);
  }
  return { table, span };
};

const pngChunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

// an 8 bit rgba png, written here since a canvas would premultiply the alpha and lose the soft edges' color
export const encodePng = (rgba, width, height) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

// sha256 over the files the capture depends on (inputs.json), so a check can tell when a set is out of date
export const inputsHash = (site = SITE) => {
  const files = JSON.parse(
    readFileSync(path.join(HERE, "inputs.json"), "utf8"),
  );
  const lines = files.map((file) => {
    const hash = createHash("sha256")
      .update(readFileSync(path.join(site, file)))
      .digest("hex");
    return `${hash}  ${file}\n`;
  });
  return createHash("sha256").update(lines.join("")).digest("hex");
};

const round = (v, places) => Math.round(v * 10 ** places) / 10 ** places;
const roundPoints = (points) =>
  points.map(([x, y]) => [round(x, 2), round(y, 2)]);
const pad = (i, count) =>
  String(i).padStart(Math.max(2, String(count - 1).length), "0");
const fromBase64 = (text) => new Uint8Array(Buffer.from(text, "base64"));

// the page's helpers, found again on every call where the scene could have built the phone again since
const installHelpers = (page, duo) =>
  page.evaluate(async (duo) => {
    const spike = window.spike;
    const r = spike.renderer();
    const cam = spike.camera();
    // the main scene is only reachable through the renderer, so one frame's render is watched for it
    const draw = r.render;
    let main = null;
    r.render = function (s, c) {
      if (c === cam) {
        main = s;
      }
      return draw.call(this, s, c);
    };
    await new Promise((done) =>
      requestAnimationFrame(() => requestAnimationFrame(done)),
    );
    r.render = draw;
    const V = cam.position.constructor;
    const cap = { main, found: [], keys: null };
    window.__cap = cap;

    const screenOf = (mesh) => {
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
    // the three screens of the phone the scene has now, as cover, flap, and body. a resize builds the phone again
    // with new meshes, so this runs again after the window is widened
    cap.discover = () => {
      const named = {};
      main.traverse((o) => {
        const m = o.material;
        if (
          m &&
          m.isMeshBasicMaterial &&
          m.onBeforeCompile &&
          String(m.onBeforeCompile).includes("planeOrigin")
        ) {
          named[screenOf(o)] = { mesh: o, material: m };
        }
      });
      cap.found = ["cover", "flap", "body"].map((name) => named[name]);
      return Object.keys(named);
    };
    cap.meshes = () => cap.found.map((s) => s && s.mesh);
    const toWindow = (world) => {
      const p = world.project(cam);
      return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight];
    };
    // a part's local corners, in the order top left, top right, bottom right, bottom left of its own frame
    const box = (frame, x0, x1, y0, y1, z) =>
      [
        [x0, y1],
        [x1, y1],
        [x1, y0],
        [x0, y0],
      ].map(([x, y]) => new V(x, y, z).applyMatrix4(frame.matrixWorld));
    cap.corners = () => {
      const s = spike.state;
      s.root.updateMatrixWorld(true);
      const screens = [];
      const depths = [];
      cap.found.forEach(({ mesh }) => {
        mesh.geometry.computeBoundingBox();
        const { min, max } = mesh.geometry.boundingBox;
        const world = box(mesh, min.x, max.x, min.y, max.y, min.z);
        depths.push(
          world.reduce(
            (sum, w) =>
              sum + w.clone().applyMatrix4(cam.matrixWorldInverse).z / 4,
            0,
          ),
        );
        screens.push(world.map(toWindow));
      });
      const h = duo.bodyH / 2;
      return {
        screens,
        depths,
        body: box(s.body, 0, duo.halfW, -h, h, 0).map(toWindow),
        flap: box(s.flap, -duo.halfW, 0, -h, h, 0).map(toWindow),
      };
    };
    cap.bones = () => {
      const bones = spike.state.handModel.bones;
      return Object.keys(bones)
        .sort()
        .map((name) => toWindow(bones[name].getWorldPosition(new V())));
    };
    cap.toBase64 = (bytes) =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(reader.result.slice(reader.result.indexOf(",") + 1));
        reader.readAsDataURL(new Blob([bytes]));
      });
  }, duo);

// the phone in a step's pose, held there. the frost wallpaper and the pinned html take a few frames to follow. the
// phone also trails the desk view by the view's distance from its target, and the target depends on the window's
// shape, so the view is put on its target
const settle = (page, values, lead) =>
  page.evaluate(
    async ({ values, lead }) => {
      window.spike.freeze(values);
      window.spike.state.lead = lead;
      for (let k = 0; k < 4; k++) {
        const look = window.spike.backdrop.look;
        look.yaw = look.targetYaw;
        look.pitch = look.targetPitch;
        await new Promise((done) => requestAnimationFrame(done));
      }
    },
    { values, lead },
  );

const waitForPhone = (page) =>
  page.waitForFunction(
    () =>
      window.spike &&
      document.body.classList.contains("ready") &&
      window.spike.state.phone === "open" &&
      !window.spike.state.busy &&
      window.spike.state.volume,
    null,
    { timeout: 60000 },
  );

// the scene is set up for the capture: the set's orientation pinned, the hour pinned with the default sunrise and
// sunset, and the battery held full
const prepare = async (page, set, hour) => {
  await page.route("**/api/home*", async (route) => {
    // no weather, so the sun keeps the 7 and 19 schedule (renderer.js applyDaylight) and the sky stays clear
    const response = await route.fetch();
    const body = await response.json().catch(() => ({}));
    await route.fulfill({ json: { ...body, weather: null } });
  });
  await page.addInitScript(() => {
    localStorage.setItem("introSeen", "1");
    // chosen 3d, so the head script never gives the capture the 2d scene, and a capture slow enough to step the
    // quality ladder down never sends it to the flat site
    localStorage.setItem("2d", "0");
  });
  await page.goto(`${SERVER}/?dev`);
  await waitForPhone(page);

  // the dev panel's device choice, so the phone keeps the set's orientation when the window is widened
  const busy = await page.evaluate((orientation) => {
    const select = document.getElementById("device-select");
    select.value = orientation;
    select.dispatchEvent(new Event("change"));
    return window.spike.state.busy;
  }, set.orientation);
  if (!busy) {
    throw new Error("the phone didn't build again for the pinned orientation");
  }
  await waitForPhone(page);
  const portrait = await page.evaluate(() => window.spike.state.portrait);
  if (portrait !== (set.orientation === "portrait")) {
    throw new Error(`the phone isn't in ${set.orientation}`);
  }

  // the hour goes before the panel it updates is removed
  const light = await page.evaluate((hour) => {
    window.spike.statusBar.setBattery(0, 0.001);
    return {
      ...window.spike.daylight(hour),
      weather: window.spike.weather().data,
    };
  }, hour);
  const expected = daylight(hour, SUN.sunrise, SUN.sunset);
  if (
    light.weather !== null ||
    Math.abs(light.day - expected.day) > 1e-9 ||
    Math.abs(light.warm - expected.warm) > 1e-9
  ) {
    throw new Error(
      `the light isn't pinned to ${hour}:00 with sunrise 7 and sunset 19: ${JSON.stringify(light)}`,
    );
  }
  return light;
};

// the desk's photo, its screen mask, and the hour's monitor images at full size. night's monitors are the photo's
// own, which leaves those two blank. the lighting map follows the monitors, so the textures and the map have to stay
// put for a second
const waitForDesk = async (page, hour) => {
  const { from, to } = wallpaperAt(hour);
  const wants = {
    map: FULL_PHOTO_WIDTH,
    wallMask: FULL_PHOTO_WIDTH,
    wallFrom: from === NIGHT ? 1 : FULL_PHOTO_WIDTH,
    wallTo: to === NIGHT ? 1 : FULL_PHOTO_WIDTH,
  };
  await page.evaluate(() => window.spike.backdrop.loadRest());
  let last = null;
  let steady = 0;
  for (let tries = 0; tries < 240 && steady < 4; tries++) {
    await page.waitForTimeout(250);
    const now = await page.evaluate((wants) => {
      const sky = window.spike.backdrop.scene.children.find(
        (c) => c.material && c.material.uniforms,
      );
      const u = sky.material.uniforms;
      const full = Object.entries(wants).every(
        ([name, width]) => u[name].value && u[name].value.image.width === width,
      );
      const ids = ["map", "wallMask", "wallFrom", "wallTo"].map(
        (name) => u[name].value.uuid,
      );
      return full ? [...ids, window.__cap.main.environment.uuid].join() : null;
    }, wants);
    steady = now && now === last ? steady + 1 : 0;
    last = now;
  }
  if (steady < 4) {
    throw new Error("the desk's full photos never finished loading");
  }
};

// the desk alone through a 90 degree camera for each cube face, sharp as it shows with the phone closed and blurred
// as it shows with it open (backdrop.js). a face the photo doesn't reach is left out, since the clamped view can't
// reach past the photo's edge either
const captureDesk = async (page, out, height) => {
  const size =
    Math.ceil(height / Math.tan(((DESK_FOV / 2) * Math.PI) / 180) / 4) * 4;
  const faces = {};
  for (const [name, face] of Object.entries(FACES)) {
    const reads = {};
    for (const [look, blur] of [
      ["sharp", 0],
      ["blur", 1],
    ]) {
      const base64 = await page.evaluate(
        ({ face, size, blur }) => {
          const spike = window.spike;
          const r = spike.renderer();
          const backdrop = spike.backdrop;
          const V = backdrop.camera.position.constructor;
          const camera = new backdrop.camera.constructor(90, 1, 1, 400);
          camera.up.set(...face.up);
          camera.lookAt(new V(...face.dir));
          camera.updateMatrixWorld(true);
          const was = {
            set(x, y) {
              this.x = x;
              this.y = y;
              return this;
            },
          };
          r.getSize(was);
          const ratio = r.getPixelRatio();
          backdrop.update(0, backdrop.camera.aspect, blur);
          r.setPixelRatio(1);
          r.setSize(size, size, false);
          r.setRenderTarget(null);
          r.setClearColor(0x000000, 0);
          r.clear(true, true, true);
          r.render(backdrop.scene, camera);
          const gl = r.getContext();
          const raw = new Uint8Array(size * size * 4);
          gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, raw);
          r.setPixelRatio(ratio);
          r.setSize(was.x, was.y, false);
          return window.__cap.toBase64(raw);
        },
        { face, size, blur },
      );
      // with the same read for both keys, the matte only turns it top down and takes the alpha out
      const raw = fromBase64(base64);
      reads[look] = matte(raw, raw, size, size);
    }
    let drawn = false;
    for (let i = 3; i < reads.sharp.length && !drawn; i += 4) {
      drawn = reads.sharp[i] > 0;
    }
    if (!drawn) {
      continue;
    }
    for (const [look, rgba] of Object.entries(reads)) {
      writeFileSync(
        path.join(out, `desk-${name}-${look}.png`),
        encodePng(rgba, size, size),
      );
    }
    faces[name] = face;
  }
  return { size, fov: 90, blur: 1, faces };
};

// the drag's tables for closing and opening, measured the way fold.js foldTable measures them, at the window's own
// size: the phone posed along the fold with its move, and where the flap's outer edge and the outer corners land
const captureDrag = async (page, orientation, rest, stage) => {
  const axis = orientation === "portrait" ? "y" : "x";
  const gestures = {
    close: {
      action: "close",
      from: rest,
      to: stage,
      foldFrom: 0,
      foldTo: 1,
      sign: 1,
    },
    open: {
      action: "open",
      from: stage,
      to: rest,
      foldFrom: 1,
      foldTo: 0,
      sign: -1,
    },
  };
  const result = {};
  for (const [name, g] of Object.entries(gestures)) {
    const poses = Array.from({ length: FOLD_SAMPLES + 1 }, (_, i) =>
      foldPoseAt(
        g.from,
        g.to,
        g.foldFrom,
        g.foldTo,
        i / FOLD_SAMPLES,
        g.action,
      ),
    );
    const measured = await page.evaluate((poses) => {
      const spike = window.spike;
      const saved = { ...spike.pose };
      const out = poses.map((p) => {
        Object.assign(spike.pose, p, { idle: 0 });
        const corners = spike.poseCorners();
        const edge = spike.flapEdge();
        return { corners, edge: [edge.x, edge.y] };
      });
      Object.assign(spike.pose, saved);
      return out;
    }, poses);
    const edge = measured.map((m) => m.edge[axis === "x" ? 0 : 1]);
    const { table, span } = dragTable(
      edge,
      measured.map((m) => m.corners),
      g.sign,
    );
    result[name] = {
      axis,
      sign: g.sign,
      span: round(span, 2),
      samples: measured.map((m, i) => [
        round(poses[i].fold, 6),
        round(m.edge[0], 2),
        round(m.edge[1], 2),
      ]),
      table: table.map((p) => round(p, 6)),
    };
  }
  return result;
};

export const capture = async ({ setName, lighting }) => {
  const set = SETS[setName];
  const hour = LIGHTING[lighting];
  const { width, height } = set.window;
  const wide = {
    width: width + 2 * MARGIN.x,
    height: height + MARGIN.top + MARGIN.bottom,
  };
  const out = path.join(SITE, ".media", "flat", `${setName}-${lighting}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const steps = set.steps();
  const started = Date.now();

  const require = createRequire(path.join(SITE, "apps", "web", "package.json"));
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ args: GPU_ARGS });
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
    page.on(
      "console",
      (m) =>
        m.type() === "error" &&
        console.log("console error:", m.text().slice(0, 300)),
    );
    const light = await prepare(page, set, hour);
    await installHelpers(page, DUO);
    await waitForDesk(page, hour);

    const timeline = await page.evaluate(() => ({
      ...window.spike.timeline(false),
      foldStartTime: window.spike.foldStartTime(),
    }));
    const desk = set.desk ? await captureDesk(page, out, height) : null;
    const drag = await captureDrag(
      page,
      set.orientation,
      timeline.rest,
      timeline.stage,
    );

    // the desk is left out of the frames, so the loop stops drawing it
    await page.evaluate(() => {
      window.spike.backdrop.draw = () => {};
      document.getElementById("panel")?.remove();
      document.getElementById("page").style.visibility = "hidden";
    });
    const found = await page.evaluate(() => window.__cap.discover());
    if (found.length !== 3 || found.includes("null")) {
      throw new Error(
        `expected the cover, flap, and body screens, found ${found}`,
      );
    }
    const valuesAt = (step) => ({
      ...timeline.rest,
      fold: step.fold,
      idle: 0,
      blur: 0,
    });

    // first, at the window's own size: where the corners land, and the hands checked against the pose the scene
    // reports for the step's hand fold
    const first = [];
    for (const [i, step] of steps.entries()) {
      let off = Infinity;
      let pass = null;
      for (let tries = 0; tries < POSE_TRIES && off > POSE_LIMIT; tries++) {
        await settle(page, valuesAt(step), step.lead);
        pass = await page.evaluate((hand) => {
          const drawn = window.__cap.bones();
          window.spike.state.hands.update(hand);
          return {
            drawn,
            bones: window.__cap.bones(),
            corners: window.__cap.corners(),
          };
        }, step.hand);
        off = largestOffset(pass.drawn, pass.bones, [0, 0]);
      }
      if (off > POSE_LIMIT) {
        throw new Error(
          `step ${i}'s hands never reached the pose for hand fold ${step.hand}, they're ${off.toFixed(1)} px off`,
        );
      }
      first.push(pass);
    }

    // then the frames in the wider view, with the camera's framing of the window kept by a view offset, so the
    // hands are never cut by the window's edge. the scene builds the phone again for the new size (index.js waits
    // 150 ms after a resize), so its new screens are found once it has. the poses come from the first pass, so the
    // new placement doesn't matter
    await page.evaluate(() => {
      window.__cap.old = window.__cap.meshes();
    });
    await page.setViewportSize(wide);
    await page.waitForFunction(
      () => {
        const cap = window.__cap;
        const names = cap.discover();
        return (
          names.length === 3 &&
          cap.meshes().every((m) => m && !cap.old.includes(m)) &&
          window.spike.state.phone === "open" &&
          !window.spike.state.busy &&
          window.spike.state.volume
        );
      },
      null,
      { timeout: 30000 },
    );
    console.log("the phone was built again for the wider view");
    // the quality ladder resizes the renderer and sets the camera's aspect from the window once frames run slow,
    // which the reads make them, so the wider view is set again right before every read
    await page.evaluate(
      ({ width, height, wide, margin }) => {
        window.__cap.wide = () => {
          const cam = window.spike.camera();
          const r = window.spike.renderer();
          r.setPixelRatio(1);
          r.setSize(wide.width, wide.height);
          cam.aspect = width / height;
          cam.setViewOffset(
            width,
            height,
            -margin.x,
            -margin.top,
            wide.width,
            wide.height,
          );
        };
      },
      { width, height, wide, margin: MARGIN },
    );

    const shift = [MARGIN.x, MARGIN.top];
    const frames = [];
    let retries = 0;
    let worst = 0;
    for (const [i, step] of steps.entries()) {
      let read = null;
      let off = Infinity;
      for (let tries = 0; tries < POSE_TRIES && off > POSE_LIMIT; tries++) {
        retries += tries > 0 ? 1 : 0;
        await settle(page, valuesAt(step), step.lead);
        // the pose is measured and the frame read in one step, so nothing moves the phone between them. each frame
        // is drawn twice with the screens in two solid key colors and read straight from the drawing buffer, since
        // toDataURL on the webgl canvas gave an earlier frame and a screenshot shows the pinned html through the holes
        read = await page.evaluate(async () => {
          const cap = window.__cap;
          const spike = window.spike;
          cap.wide();
          const corners = cap.corners();
          const bones = cap.bones();
          const r = spike.renderer();
          const gl = r.getContext();
          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          const Basic = cap.found[0].material.constructor;
          cap.keys = cap.keys || [
            new Basic({ color: 0xff00ff, toneMapped: false }),
            new Basic({ color: 0x00ff00, toneMapped: false }),
          ];
          const reads = cap.keys.map((key) => {
            cap.found.forEach((s) => {
              s.mesh.material = key;
            });
            r.setRenderTarget(null);
            r.setClearColor(0x000000, 0);
            r.clear(true, true, true);
            r.render(cap.main, spike.camera());
            const raw = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
            return raw;
          });
          cap.found.forEach((s) => {
            s.mesh.material = s.material;
          });
          return {
            w,
            h,
            corners,
            bones,
            magenta: await cap.toBase64(reads[0]),
            green: await cap.toBase64(reads[1]),
          };
        });
        const cornerPoints = (c) => [...c.screens.flat(), ...c.body, ...c.flap];
        off = Math.max(
          largestOffset(
            cornerPoints(read.corners),
            cornerPoints(first[i].corners),
            shift,
          ),
          largestOffset(read.bones, first[i].bones, shift),
        );
      }
      worst = Math.max(worst, off);
      if (off > POSE_LIMIT) {
        throw new Error(
          `frame ${i} never reached its pose, its corners or hands are ${off.toFixed(1)} px off`,
        );
      }
      if (read.w !== wide.width || read.h !== wide.height) {
        throw new Error(`frame ${i} was drawn at ${read.w} x ${read.h}`);
      }
      const rgba = matte(
        fromBase64(read.magenta),
        fromBase64(read.green),
        read.w,
        read.h,
      );
      writeFileSync(
        path.join(out, `${pad(i, steps.length)}.png`),
        encodePng(rgba, read.w, read.h),
      );
      const c = first[i].corners;
      frames.push({
        fold: step.fold,
        lead: step.lead,
        hand: step.hand,
        t: step.t,
        corners: {
          screens: c.screens.map(roundPoints),
          depths: c.depths.map((d) => round(d, 4)),
          body: roundPoints(c.body),
          flap: roundPoints(c.flap),
        },
      });
      if (i % 20 === 0) {
        console.log(`frame ${i} of ${steps.length}`);
      }
    }

    const after = await page.evaluate(() => ({
      failed: document.documentElement.classList.contains("scene-failed"),
      battery: window.spike.statusBar.status,
      charger: Boolean(window.spike.charger()),
    }));
    if (after.failed || pageErrors.length) {
      throw new Error(
        `the scene failed during the capture: ${pageErrors.join(" | ")}`,
      );
    }
    if (after.battery.charging || after.battery.level < 100 || after.charger) {
      throw new Error(
        `the battery moved during the capture: ${JSON.stringify(after)}`,
      );
    }

    writeFileSync(path.join(out, "frames.json"), JSON.stringify(frames));
    writeFileSync(
      path.join(out, "meta.json"),
      JSON.stringify({
        set: setName,
        lighting,
        orientation: set.orientation,
        window: { width, height },
        margin: MARGIN,
        light: { hour, ...SUN, day: light.day, warm: light.warm },
        screens: SCREEN_NAMES,
        foldStartTime: timeline.foldStartTime,
        dragTable: drag,
        desk,
        inputsHash: inputsHash(),
      }),
    );
    return {
      out,
      frames: frames.length,
      retries,
      worst,
      desk: desk ? Object.keys(desk.faces) : [],
      seconds: Math.round((Date.now() - started) / 1000),
    };
  } finally {
    await browser.close();
  }
};

const argument = (args, name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const setName = argument(args, "set");
  const lighting = argument(args, "lighting");
  if (!SETS[setName] || !(lighting in LIGHTING)) {
    console.error(
      `usage: node tools/capture-flat/capture.mjs --set <${Object.keys(SETS).join("|")}> --lighting <${Object.keys(LIGHTING).join("|")}>`,
    );
    process.exit(1);
  }
  const result = await capture({ setName, lighting });
  console.log(
    `captured ${result.frames} frames to ${result.out} in ${result.seconds} s`,
  );
  console.log(
    `frames that needed another settle: ${result.retries}, largest pose offset accepted: ${result.worst.toFixed(2)} px`,
  );
  console.log(`desk faces: ${result.desk.join(", ") || "none"}`);
}
