// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, expect, test } from "vitest";
import { place } from "../scene/shared/placement.js";
import { DUO, FOV } from "../scene/state.js";
import {
  createStage,
  chainMatrix,
  projectPoint,
  stageGeometry,
} from "./stage.js";

const manifestOf = (folder) =>
  JSON.parse(
    // under jsdom import.meta.url isn't a file url, and vitest runs from apps/web
    readFileSync(
      path.join(process.cwd(), "public/flat", folder, "manifest.json"),
      "utf8",
    ),
  );
const landscape = manifestOf("landscape-day-full");
const landscapeHalf = manifestOf("landscape-day-half");
const portrait = manifestOf("portrait-open-day-full");

const TAN_HALF = Math.tan((FOV / 2) * (Math.PI / 180));
const frameAt = (manifest, fold) =>
  manifest.frames.reduce((best, frame) =>
    Math.abs(frame.fold - fold) < Math.abs(best.fold - fold) ? frame : best,
  );
// a point the capture recorded in its window's px, moved into the frames' own px
const inFrame = (manifest, [x, y]) => [
  x + manifest.margin.x,
  y + manifest.margin.top,
];
const boxOf = (points) => ({
  left: Math.min(...points.map((p) => p[0])),
  right: Math.max(...points.map((p) => p[0])),
  top: Math.min(...points.map((p) => p[1])),
  bottom: Math.max(...points.map((p) => p[1])),
});
const through = (geometry, pose, fold, points) => {
  const m = chainMatrix(geometry, pose, fold);
  return points.map((p) => projectPoint(m, p));
};

// the 3d scene's own math, written out apart from the stage: the root at the pose (with portrait's hinge shift in y),
// turned by three's default xyz euler, seen through a camera at the origin looking down -z with FOV vertically
const shiftOf = (fold, isPortrait) =>
  isPortrait ? -(DUO.halfW / 2) * Math.min(Math.max(fold, 0), 1) : 0;
const rotate = ([x, y, z], { rx, ry, rz }) => {
  // z, then y, then x, which is three's matrix rx * ry * rz for the order xyz
  const [cz, sz, cy, sy, cx, sx] = [rz, rz, ry, ry, rx, rx].map((a, i) =>
    i % 2 === 0 ? Math.cos(a) : Math.sin(a),
  );
  const [x1, y1] = [x * cz - y * sz, x * sz + y * cz];
  const [x2, z2] = [x1 * cy + z * sy, -x1 * sy + z * cy];
  return [x2, y1 * cx - z2 * sx, y1 * sx + z2 * cx];
};
const project3d = ({ width, height }, pose, shift, local) => {
  const [x, y, z] = rotate(local, pose);
  const world = [x + pose.x, y + pose.y + shift, z + pose.z];
  const f = height / (2 * TAN_HALF);
  return [
    width / 2 + (f * world[0]) / -world[2],
    height / 2 - (f * world[1]) / -world[2],
  ];
};
// a point the capture recorded, back on the phone: the ray through its px from the capture camera, met with the plane
// the given distance in front of the phone's center, in the root's own frame
const backOnPhone = (manifest, fold, [px, py], front) => {
  const isPortrait = manifest.orientation === "portrait";
  const { width, height } = manifest.window;
  const rest = place({ width, height, portrait: isPortrait }).rest;
  const f = height / (2 * TAN_HALF);
  const along = -rest.z - front;
  const x = ((px - width / 2) / f) * along;
  const y = (-(py - height / 2) / f) * along;
  return [x - rest.x, y - rest.y - shiftOf(fold, isPortrait), -along - rest.z];
};

test("the capture pose maps the frames onto the window they were captured in", () => {
  for (const manifest of [landscape, portrait, landscapeHalf]) {
    const { width, height } = manifest.window;
    const scale = manifest.scale;
    const geometry = stageGeometry({
      width: width / scale,
      height: height / scale,
      manifest,
    });
    const rest = place({
      width,
      height,
      portrait: manifest.orientation === "portrait",
    }).rest;
    for (const fold of [0, 0.5, 1]) {
      const m = chainMatrix(geometry, rest, fold);
      for (const p of [
        [0, 0],
        [width, 0],
        [width / 2, height / 3],
        [width, height],
      ]) {
        const [x, y] = projectPoint(m, inFrame(manifest, p));
        expect(x).toBeCloseTo(p[0] / scale, 6);
        expect(y).toBeCloseTo(p[1] / scale, 6);
      }
    }
  }
});

test("the zoom pose fills the window with the screen", () => {
  for (const [width, height] of [
    [1280, 800],
    [2560, 1080],
  ]) {
    for (const manifest of [landscape, landscapeHalf]) {
      const geometry = stageGeometry({ width, height, manifest });
      const open = frameAt(manifest, 0);
      expect(open.fold).toBe(0);
      const screen = [...open.corners.screens[1], ...open.corners.screens[2]];
      const zoom = place({ width, height, portrait: false }).zoom;
      const box = boxOf(
        through(
          geometry,
          zoom,
          0,
          screen.map((p) => inFrame(manifest, p)),
        ),
      );
      expect(Math.abs(box.right - box.left - width)).toBeLessThan(0.5);
      expect(Math.abs((box.left + box.right) / 2 - width / 2)).toBeLessThan(
        0.5,
      );
    }
  }
});

test("extreme windows", () => {
  for (const [width, height, manifest] of [
    [3840, 1080, landscape],
    [360, 740, portrait],
  ]) {
    const isPortrait = manifest.orientation === "portrait";
    const geometry = stageGeometry({ width, height, manifest });
    const rest = place({ width, height, portrait: isPortrait }).rest;
    // the open phone's outer corners where the 3d scene draws them in this window, from the halves' sizes
    const halfW = isPortrait ? DUO.bodyH / 2 : DUO.halfW;
    const halfH = isPortrait ? DUO.halfW : DUO.bodyH / 2;
    const phone = boxOf(
      [
        [-halfW, -halfH, 0],
        [halfW, -halfH, 0],
        [halfW, halfH, 0],
        [-halfW, halfH, 0],
      ].map((p) => project3d({ width, height }, rest, 0, p)),
    );
    // the frames' whole captured box, margins included, where the chain puts it
    const frame = {
      width: manifest.window.width + 2 * manifest.margin.x,
      height:
        manifest.window.height + manifest.margin.top + manifest.margin.bottom,
    };
    const captured = boxOf(
      through(geometry, rest, 0, [
        [0, 0],
        [frame.width, 0],
        [frame.width, frame.height],
        [0, frame.height],
      ]),
    );
    expect(phone.left).toBeGreaterThan(captured.left);
    expect(phone.right).toBeLessThan(captured.right);
    expect(phone.top).toBeGreaterThan(captured.top);
    expect(phone.bottom).toBeLessThan(captured.bottom);
    // and the phone in the frames lands where the 3d scene draws it, so the box above is the frames' phone too
    const open = frameAt(manifest, 0);
    const drawn = boxOf(
      through(
        geometry,
        rest,
        0,
        [...open.corners.body, ...open.corners.flap].map((p) =>
          inFrame(manifest, p),
        ),
      ),
    );
    for (const side of ["left", "right", "top", "bottom"]) {
      expect(Math.abs(drawn[side] - phone[side])).toBeLessThan(1);
    }
  }
});

test("the chain turns the frames the way the 3d scene turns the phone", () => {
  const cases = [
    // the intro's start, closed and tilted, at a window unlike the capture's
    [landscape, 1, "fullStart", 1600, 900, 0],
    [portrait, 1, "fullStart", 768, 1024, 0],
    [portrait, 1, "fastStart", 390, 844, 0],
    // the closing move, and a made up turn on every axis
    [landscape, 0, "stage", 1280, 800, 2],
    [landscape, 0, "turn", 1440, 900, 2],
  ];
  for (const [manifest, fold, poseName, width, height, screen] of cases) {
    const isPortrait = manifest.orientation === "portrait";
    const placed = place({ width, height, portrait: isPortrait });
    const pose =
      poseName === "turn"
        ? { ...placed.rest, x: 1.5, y: -0.8, rx: 0.3, ry: -0.4, rz: 0.2 }
        : placed[poseName];
    const geometry = stageGeometry({ width, height, manifest });
    const frame = frameAt(manifest, fold);
    expect(frame.fold).toBe(fold);
    // the cover sits in front of the closed slab, the open screens on the body's face (device.js hole, 0.002 out)
    const front =
      fold === 1 ? DUO.depth + DUO.gap / 2 + 0.002 : DUO.depth / 2 + 0.002;
    const quad = frame.corners.screens[screen];
    const chained = through(
      geometry,
      pose,
      fold,
      quad.map((p) => inFrame(manifest, p)),
    );
    quad.forEach((p, i) => {
      const local = backOnPhone(manifest, fold, p, front);
      const [x, y] = project3d(
        { width, height },
        pose,
        shiftOf(fold, isPortrait),
        local,
      );
      expect(Math.hypot(x - chained[i][0], y - chained[i][1])).toBeLessThan(1);
    });
  }
});

test("the charger's tilt turns the phone about its own x and then y, after its pose", () => {
  const width = 1280;
  const height = 800;
  const placed = place({ width, height, portrait: false });
  const geometry = stageGeometry({ width, height, manifest: landscape });
  const frame = frameAt(landscape, 0);
  const front = DUO.depth / 2 + 0.002;
  const quad = frame.corners.screens[2];
  const pose = { ...placed.rest, x: 0.6, rx: 0.12, ry: -0.2, rz: 0.05 };
  for (const tilt of [
    { tx: -0.1, ty: 0 },
    { tx: 0, ty: 0.1 },
    { tx: 0.07, ty: -0.04 },
  ]) {
    const chained = through(
      geometry,
      { ...pose, ...tilt },
      0,
      quad.map((p) => inFrame(landscape, p)),
    );
    quad.forEach((p, i) => {
      const local = backOnPhone(landscape, 0, p, front);
      const tilted = rotate(rotate(local, { rx: 0, ry: tilt.ty, rz: 0 }), {
        rx: tilt.tx,
        ry: 0,
        rz: 0,
      });
      const [x, y] = project3d({ width, height }, pose, 0, tilted);
      expect(Math.hypot(x - chained[i][0], y - chained[i][1])).toBeLessThan(1);
    });
  }
});

const setUp = () => {
  document.body.innerHTML =
    '<div id="stage"><div id="css-layer"></div><main id="page"></main></div>';
  return {
    stageEl: document.getElementById("stage"),
    pageEl: document.getElementById("page"),
  };
};

beforeEach(() => {
  Object.assign(window, { innerWidth: 1280, innerHeight: 800 });
});

test("the stage puts the screens behind #page, the cards over it, and the frames in front", () => {
  const { stageEl, pageEl } = setUp();
  const stage = createStage({ stageEl, pageEl, manifest: landscape });
  const order = [...stageEl.children];
  expect(order.indexOf(stage.layers.screens)).toBe(order.indexOf(pageEl) - 1);
  expect(order.indexOf(stage.layers.cards)).toBe(order.indexOf(pageEl) + 1);
  expect(order.indexOf(stage.layers.frames)).toBe(order.indexOf(pageEl) + 2);
  expect(stage.layers.cards.hidden).toBe(true);
  stage.setPose(stage.placed.rest);
  expect(stage.layers.cards.style.transform).toBe(
    stage.layers.frames.style.transform,
  );
  for (const layer of [
    stage.layers.screens,
    stage.layers.cards,
    stage.layers.frames,
  ]) {
    expect(layer.style.width).toBe("1920px");
    expect(layer.style.height).toBe("1160px");
  }
  stage.destroy();
  expect(stageEl.children).toHaveLength(2);
});

test("a pose facing the camera gets a 2d transform, a turned one the 3d chain", () => {
  const { stageEl, pageEl } = setUp();
  const stage = createStage({ stageEl, pageEl, manifest: landscape });
  const placed = place({ width: 1280, height: 800, portrait: false });
  stage.setFold(0, 0);
  stage.setPose(placed.rest);
  const { screens, frames } = stage.layers;
  expect(frames.style.transform).toMatch(/^matrix\(/);
  expect(screens.style.transform).toBe(frames.style.transform);
  stage.setPose(placed.fullStart);
  expect(frames.style.transform).toMatch(
    /^translate\(.*perspective\(.*rotateX\(/,
  );
  expect(screens.style.transform).toBe(frames.style.transform);
  stage.destroy();
});

test("fit places the stage again for a new window size", () => {
  const { stageEl, pageEl } = setUp();
  const stage = createStage({ stageEl, pageEl, manifest: landscape });
  stage.setFold(0, 0);
  stage.setPose(stage.placed.rest);
  const before = stage.layers.frames.style.transform;
  Object.assign(window, { innerWidth: 1600, innerHeight: 900 });
  stage.fit();
  expect(stage.placed).toEqual(
    place({ width: 1600, height: 900, portrait: false }),
  );
  expect(stage.layers.frames.style.transform).not.toBe(before);
  stage.destroy();
});

test("placePage follows the 3d scene's four modes", () => {
  const { stageEl, pageEl } = setUp();
  const stage = createStage({ stageEl, pageEl, manifest: landscape });
  const placed = place({ width: 1280, height: 800, portrait: false });
  stage.setFold(0, 0);
  stage.setPose(placed.zoom);

  stage.placePage("hidden");
  expect(pageEl.style.visibility).toBe("hidden");
  expect(pageEl.style.pointerEvents).toBe("none");

  stage.placePage("pinned", { opacity: 0.5 });
  expect(pageEl.style.visibility).toBe("visible");
  expect(pageEl.style.transform).toMatch(/^matrix/);
  expect(pageEl.style.willChange).toBe("transform");
  expect(pageEl.style.opacity).toBe("0.5");
  expect(pageEl.style.pointerEvents).toBe("none");
  // at full zoom #page is pinned at the window's own size and place
  const m = pageEl.style.transform
    .replace(/^matrix\(|\)$/g, "")
    .split(",")
    .map(Number);
  expect(m[0]).toBeCloseTo(1, 3);
  expect(m[3]).toBeCloseTo(1, 3);
  expect(Math.abs(m[4])).toBeLessThan(0.5);
  expect(Math.abs(m[5])).toBeLessThan(0.5);

  stage.placePage("flat");
  expect(pageEl.style.transform).toBe("");
  expect(pageEl.style.opacity).toBe("");
  expect(pageEl.style.visibility).toBe("visible");
  expect(pageEl.style.pointerEvents).toBe("");
  expect(stage.layers.frames.style.zIndex).toBe("-1");

  stage.placePage("fading", { opacity: 0.25 });
  expect(pageEl.style.zIndex).toBe("1");
  expect(pageEl.style.background).not.toBe("");
  expect(pageEl.style.opacity).toBe("0.25");
  expect(stage.layers.frames.style.zIndex).toBe("");
  stage.destroy();
});
