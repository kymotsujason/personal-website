import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { FADE_OUT, SHOW_FOR } from "../scene/shared/motion.js";
import { screenLayout } from "../scene/shared/placement.js";
import { faceQuads } from "./screens.js";
import { handLoop } from "./handLoop.js";
import { frameSize } from "./frames.js";
import { mapPoint, homography } from "./warp.js";
import {
  barBoxes,
  barOpacityAt,
  buttonAt,
  createVolume,
  hitAreas,
  polygonHas,
  sinkAt,
  upButton,
} from "./volume.js";

beforeAll(() => {
  const { window } = new JSDOM("<!doctype html><body></body>");
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("addEventListener", () => {});
});
afterAll(() => vi.unstubAllGlobals());

const load = (folder) =>
  JSON.parse(
    readFileSync(
      new URL(`../../public/flat/${folder}/manifest.json`, import.meta.url),
      "utf8",
    ),
  );
const landscape = load("volume-landscape-day-full");
const portrait = load("volume-portrait-day-full");
const same = (p) => p;

const inFrame = (manifest, pose, which, i = 0, key = "hull") => {
  const [x, y] = manifest.volume.poses[pose][which][key][i];
  return [x + manifest.margin.x, y + manifest.margin.top];
};

test("the hit areas split at the gap", () => {
  [
    { manifest: landscape, axis: 0 },
    { manifest: portrait, axis: 1 },
  ].forEach(({ manifest, axis }) => {
    ["open", "closed"].forEach((pose, k) => {
      const areas = hitAreas({ manifest, fold: k, project: same });
      const { near, far } = manifest.volume.poses[pose];
      const edge = near.hit.find((p) =>
        far.hit.some((q) => q[0] === p[0] && q[1] === p[1]),
      )[axis];
      const margin = axis === 0 ? manifest.margin.x : manifest.margin.top;
      const split = edge + margin;
      const along = (v, across) => (axis === 0 ? [v, across] : [across, v]);
      const [cx, cy] = areas.nearSide;
      const across = axis === 0 ? cy : cx;
      // inside the overlap both hulls hold the point, so only the split decides, and past it one hull does
      const nearIsLower = areas.nearSide[axis] < split;
      const inNear = (v) => polygonHas(areas.near, along(v, across));
      const inFar = (v) => polygonHas(areas.far, along(v, across));
      // the hulls overlap a few px across the split, and the split alone decides there
      const both = [-4, -3, -2, -1, 1, 2, 3, 4].filter(
        (d) => inNear(split + d) && inFar(split + d),
      );
      expect(both.length).toBeGreaterThan(0);
      both.forEach((d) => {
        const lowerSide = d < 0;
        expect(buttonAt(areas, ...along(split + d, across))).toBe(
          lowerSide === nearIsLower ? "near" : "far",
        );
      });
      expect(buttonAt(areas, -50, -50)).toBeNull();
    });
  });
});

test("a press outside both hulls, or on one alone, goes where it landed", () => {
  const areas = hitAreas({ manifest: landscape, fold: 0, project: same });
  const [x, y] = inFrame(landscape, "open", "near", 0);
  expect(buttonAt(areas, x + 1, y + 1)).toBe("near");
  const [fx, fy] = inFrame(landscape, "open", "far", 3);
  expect(buttonAt(areas, fx - 1, fy - 1)).toBe("far");
  expect(buttonAt(areas, x - 40, y)).toBeNull();
});

test("the areas follow the chain, and the split follows with them", () => {
  const project = ([x, y]) => [x * 0.5 + 100, y * 0.5 + 50];
  const flat = hitAreas({ manifest: landscape, fold: 0, project: same });
  const moved = hitAreas({ manifest: landscape, fold: 0, project });
  const [lx, ly] = project([flat.edge[0][0] - 1.5, flat.nearSide[1]]);
  const [ux, uy] = project([flat.edge[0][0] + 1.5, flat.nearSide[1]]);
  expect(buttonAt(moved, lx, ly)).toBe("near");
  expect(buttonAt(moved, ux, uy)).toBe("far");
});

test("a moving phone carries the nearer rest pose's hulls between the two", () => {
  const at = (fold) =>
    hitAreas({ manifest: landscape, fold, project: same }).near[0];
  const open = inFrame(landscape, "open", "near", 0);
  const closed = inFrame(landscape, "closed", "near", 0);
  expect(at(0)).toEqual(open);
  expect(at(1)).toEqual(closed);
  const mid = at(0.25);
  expect(mid[0]).toBeLessThan(open[0]);
  expect(mid[0]).toBeGreaterThan(closed[0]);
});

test("the up button follows the orientation", () => {
  expect(upButton(false)).toBe("far");
  expect(upButton(true)).toBe("near");
  expect(landscape.volume.up).toBe(
    upButton(landscape.orientation === "portrait"),
  );
  expect(portrait.volume.up).toBe(
    upButton(portrait.orientation === "portrait"),
  );
});

test("the button sinks in 60 ms and comes back over 140", () => {
  expect(sinkAt(-5)).toBe(0);
  expect(sinkAt(0)).toBe(0);
  expect(sinkAt(60)).toBe(1);
  expect(sinkAt(130)).toBeGreaterThan(0);
  expect(sinkAt(130)).toBeLessThan(1);
  expect(sinkAt(200)).toBe(0);
  expect(barOpacityAt(SHOW_FOR - 1)).toBe(1);
  expect(barOpacityAt(SHOW_FOR + FADE_OUT / 2)).toBeCloseTo(0.5);
  expect(barOpacityAt(Infinity)).toBe(0);
});

test("the bar lies over the buttons on the body open and the cover closed", () => {
  [landscape, portrait].forEach((manifest) => {
    const isPortrait = manifest.orientation === "portrait";
    const boxes = barBoxes(isPortrait);
    const axis = isPortrait ? 1 : 0;
    [
      ["body", "open", 0],
      ["cover", "closed", 2],
    ].forEach(([face, pose, frame]) => {
      const box = boxes[face];
      const quad = faceQuads(manifest.frames[frame], manifest)[face].quad;
      const size = faceBox(face, isPortrait);
      const unit = [
        [0, 0],
        [size.w, 0],
        [size.w, size.h],
        [0, size.h],
      ];
      const to = homography(unit, quad);
      const center = mapPoint(to, [box.x + box.w / 2, box.y + box.h / 2]);
      const hits = ["near", "far"].flatMap((which) =>
        manifest.volume.poses[pose][which].hit.map(([x, y]) => [
          x + manifest.margin.x,
          y + manifest.margin.top,
        ]),
      );
      const values = hits.map((p) => p[axis]);
      const middle = (Math.min(...values) + Math.max(...values)) / 2;
      expect(Math.abs(center[axis] - middle)).toBeLessThan(5);
    });
  });
});

// the face's own px size, from the layout the screens use
const faceBox = (face, turned) => {
  const l = screenLayout(turned);
  return face === "body" ? l.body : l.cover;
};

const makeScene = (manifest, extra = {}) => {
  const frames = Array.from({ length: 4 }, () => document.createElement("div"));
  const rest = [document.createElement("div")];
  const host = document.createElement("div");
  const screens = {
    body: document.createElement("div"),
    cover: document.createElement("div"),
  };
  host.append(screens.body, screens.cover);
  return {
    frames,
    rest,
    screens,
    scene: {
      volumeSet: { manifest, layer: { elements: frames } },
      stage: {
        toWindow: same,
        frames: { elements: rest, frameFor: () => 0 },
      },
      screens,
      drawing: true,
      unlocked: true,
      zoomed: false,
      busy: false,
      fold: 0,
      lead: 0,
      portrait: manifest.orientation === "portrait",
      ...extra,
    },
  };
};

const middleOf = (manifest, pose, which) => {
  const hit = manifest.volume.poses[pose][which].hit;
  return [
    hit.reduce((s, p) => s + p[0], 0) / 4 + manifest.margin.x,
    hit.reduce((s, p) => s + p[1], 0) / 4 + manifest.margin.top,
  ];
};

const setup = (manifest, extra) => {
  const hand = handLoop();
  const music = { level: () => 8, stepLevel: vi.fn((d) => 8 + d) };
  const paint = vi.fn();
  const parts = makeScene(manifest, extra);
  const volume = createVolume({
    scene: parts.scene,
    loop: hand.loop,
    music,
    clock: hand.now,
    paint,
  });
  return { ...parts, hand, music, paint, volume };
};

test("a press steps the level up on the up button and down on the other", () => {
  [landscape, portrait].forEach((manifest) => {
    const up = manifest.volume.up;
    const down = up === "near" ? "far" : "near";
    const { volume, music } = setup(manifest);
    expect(volume.pressAt(...middleOf(manifest, "open", up))).toBe(true);
    expect(music.stepLevel).toHaveBeenLastCalledWith(1);
    expect(volume.pressAt(...middleOf(manifest, "open", down))).toBe(true);
    expect(music.stepLevel).toHaveBeenLastCalledWith(-1);
    expect(volume.pressAt(0, 0)).toBe(false);
    expect(music.stepLevel).toHaveBeenCalledTimes(2);
  });
});

test("presses work closed and mid fold, but not zoomed or before the unlock", () => {
  const closed = setup(landscape, { fold: 1 });
  expect(closed.volume.pressAt(...middleOf(landscape, "closed", "far"))).toBe(
    true,
  );
  const moving = setup(landscape, { fold: 0.25, busy: true });
  const at = hitAreas({ manifest: landscape, fold: 0.25, project: same });
  const [x, y] = at.nearSide;
  expect(moving.volume.pressAt(x, y)).toBe(true);
  const zoomed = setup(landscape, { zoomed: true });
  expect(zoomed.volume.pressAt(...middleOf(landscape, "open", "far"))).toBe(
    false,
  );
  const early = setup(landscape, { unlocked: false });
  expect(early.volume.pressAt(...middleOf(landscape, "open", "far"))).toBe(
    false,
  );
});

test("the open rest frame gives up the box while the pressed picture shows", async () => {
  const { volume, scene, frames, rest, hand, paint } = setup(landscape);
  volume.pressAt(...middleOf(landscape, "open", "near"), 0);
  volume.draw(60);
  expect(frames[0].classList.contains("on")).toBe(true);
  expect(frames[1].classList.contains("on")).toBe(false);
  expect(rest[0].style.clipPath).toContain("M1012 209h64v7h-64Z");
  expect(paint).toHaveBeenCalled();
  // the loop stays awake while it runs, and sleeps once the bar has faded
  expect(hand.queued()).toBe(1);
  volume.draw(300);
  expect(frames[0].classList.contains("on")).toBe(false);
  expect(rest[0].style.clipPath).toBe("");
  volume.draw(SHOW_FOR + FADE_OUT + 10);
  await hand.at(SHOW_FOR + FADE_OUT + 10);
  await hand.at(SHOW_FOR + FADE_OUT + 20);
  expect(hand.queued()).toBe(0);
  const canvases = scene.screens.body.querySelectorAll("canvas.flat-volume");
  expect(canvases).toHaveLength(1);
  expect(canvases[0].style.visibility).toBe("hidden");
});

test("no sink is drawn while the phone moves or closed", () => {
  const moving = setup(landscape);
  moving.volume.pressAt(...middleOf(landscape, "open", "near"), 0);
  moving.scene.busy = true;
  moving.volume.draw(60);
  expect(moving.frames[0].classList.contains("on")).toBe(false);
  expect(moving.rest[0].style.clipPath).toBe("");
  const closed = setup(landscape, { fold: 1 });
  closed.volume.pressAt(...middleOf(landscape, "closed", "near"), 0);
  closed.volume.draw(60);
  expect(closed.frames.some((el) => el.classList.contains("on"))).toBe(false);
  expect(
    closed.scene.screens.cover.querySelector(".flat-volume"),
  ).not.toBeNull();
  expect(frameSize(landscape).width).toBe(1920);
});
