import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import {
  FAST_FOLD_AT,
  INTRO_UNFOLD_MS,
  LEAD,
  ease,
  moveTotal,
} from "../scene/shared/motion.js";
import { frameTimes } from "./frames.js";
import { arrivalKind, introPlan, playIntro } from "./intro.js";

const realManifest = (folder) =>
  JSON.parse(
    readFileSync(
      new URL(`../../public/flat/${folder}/manifest.json`, import.meta.url),
      "utf8",
    ),
  );

const landscape = realManifest("landscape-day-half");
const portrait = realManifest("portrait-open-day-half");

// each frame shows from its start until the next one's, with no gap and no overlap, and the last until the end
const expectAbutting = (plan) => {
  expect(plan.frames[0].start).toBe(0);
  plan.frames.forEach((shown, i) => {
    expect(shown.end).toBeGreaterThan(shown.start);
    if (i > 0) {
      expect(shown.start).toBe(plan.frames[i - 1].end);
      expect(shown.index).toBeGreaterThan(plan.frames[i - 1].index);
    }
  });
  expect(plan.frames[plan.frames.length - 1].end).toBe(plan.total);
};

test("the full intro's frame times follow the inOutSine unfold from foldStartTime", () => {
  const plan = introPlan({ kind: "full", manifest: landscape });
  const foldStart = landscape.foldStartTime;
  expect(foldStart).toBe(700);
  expect(plan.total).toBe(moveTotal());
  expectAbutting(plan);

  const times = frameTimes(landscape, ease.inOutSine, foldStart, 1100);
  // the closed phone shows from the start of the rise, and every later frame from the time the unfold reaches it
  expect(plan.frames[0].index).toBe(0);
  plan.frames.slice(1).forEach(({ index, start }) => {
    expect(start).toBe(times[index]);
  });
  expect(plan.frames[1].start).toBeGreaterThanOrEqual(foldStart);
  expect(plan.frames[plan.frames.length - 1].index).toBe(
    landscape.frames.length - 1,
  );

  expect(plan.foldAt(0)).toBe(1);
  expect(plan.foldAt(foldStart)).toBe(1);
  expect(plan.foldAt(foldStart + 550)).toBeCloseTo(0.5, 9);
  expect(plan.foldAt(foldStart + INTRO_UNFOLD_MS.full)).toBeCloseTo(0, 9);
  expect(plan.foldAt(plan.total)).toBe(0);

  // the move is the 3d scene's, from fullStart to rest
  const poses = {
    fullStart: { x: 1, y: -2, z: -30, rx: -1.15, ry: 0.28, rz: -0.12 },
    rest: { x: 0, y: 0, z: -20, rx: 0, ry: 0, rz: 0 },
  };
  expect(plan.poseAt(0, poses)).toEqual(poses.fullStart);
  expect(plan.poseAt(plan.total, poses)).toEqual(poses.rest);

  // the icons take taps once the unfold reads as open, as in 3d
  expect(plan.foldAt(plan.unlockAt)).toBeCloseTo(0.12, 6);
});

test("the fast intro starts the unfold at FAST_FOLD_AT", () => {
  const flat = introPlan({ kind: "fast", manifest: landscape });
  const at = FAST_FOLD_AT.landscape;
  expect(flat.total).toBe(Math.max(650, at + INTRO_UNFOLD_MS.fast));
  expectAbutting(flat);
  const times = frameTimes(landscape, ease.outSine, at, INTRO_UNFOLD_MS.fast);
  flat.frames
    .slice(1)
    .forEach(({ index, start }) => expect(start).toBe(times[index]));
  expect(flat.foldAt(at + INTRO_UNFOLD_MS.fast / 2)).toBeCloseTo(
    1 - ease.outSine(0.5),
    9,
  );

  // in portrait the hands get under the edge over the first FAST_FOLD_AT ms, squeezed from the lead's 300 ms, and the
  // phone unfolds after
  const tall = introPlan({ kind: "fast", manifest: portrait });
  const tallAt = FAST_FOLD_AT.portrait;
  expect(tallAt).toBe(100);
  expect(tall.total).toBe(tallAt + INTRO_UNFOLD_MS.fast);
  expectAbutting(tall);
  const leadFrames = tall.frames.filter(
    ({ index }) => Number.isFinite(portrait.frames[index].t) && index > 0,
  );
  expect(leadFrames.length).toBeGreaterThan(10);
  leadFrames.forEach(({ index, start }) => {
    const { t } = portrait.frames[index];
    expect(start).toBe(Math.round((t * tallAt) / LEAD.time));
    expect(start).toBeLessThanOrEqual(tallAt);
  });
  const foldFrames = tall.frames.filter(
    ({ index }) => !Number.isFinite(portrait.frames[index].t),
  );
  const tallTimes = frameTimes(
    portrait,
    ease.outSine,
    tallAt,
    INTRO_UNFOLD_MS.fast,
  );
  expect(foldFrames[0].start).toBeGreaterThan(tallAt);
  foldFrames.forEach(({ index, start }) =>
    expect(start).toBe(tallTimes[index]),
  );
  expect(tall.foldAt(tallAt)).toBe(1);

  // the full portrait intro leads over the 300 ms before the unfold
  const fullTall = introPlan({ kind: "full", manifest: portrait });
  const lastLead = fullTall.frames.find(
    ({ index }) => portrait.frames[index].t === LEAD.time,
  );
  expect(lastLead.start).toBe(portrait.foldStartTime);
  expectAbutting(fullTall);
});

// a stage, screens, and desk that record what's asked of them, with elements whose animate() is a spy
const fakeParts = (manifest) => {
  const animate = vi.fn(() => ({
    finished: new Promise(() => {}),
    cancel: () => {},
  }));
  const element = () => ({ animate, style: {} });
  const calls = [];
  const rest = { x: 0, y: 0, z: -20, rx: 0, ry: 0, rz: 0 };
  const stage = {
    placed: {
      rest,
      fullStart: { ...rest, rx: -1 },
      fastStart: { ...rest, rx: -0.3 },
    },
    geometry: null,
    setPose: (pose) => calls.push(["pose", pose]),
    setFold: (fold) => calls.push(["fold", fold]),
    layers: { screens: element(), frames: element() },
    frameLayer: {
      elements: manifest.frames.map(element),
      frameFor: (fold) => (fold === 0 ? manifest.frames.length - 1 : 0),
      hide: () => calls.push(["hide"]),
    },
  };
  const screens = {
    cover: element(),
    flap: element(),
    body: element(),
    place: (frame) => calls.push(["place", frame.fold]),
    faceStyles: () => ({}),
  };
  const desk = {
    blurLayer: element(),
    setBlur: (t) => calls.push(["blur", t]),
  };
  return { animate, calls, parts: { stage, screens, desk, manifest } };
};

// the phone is left open and settled at rest, with the desk blurred, and nothing animates
const expectOpenAtRest = ({ animate, calls, parts }) => {
  expect(animate).not.toHaveBeenCalled();
  const last = (kind) => calls.filter((c) => c[0] === kind).pop();
  expect(last("fold")[1]).toBe(0);
  expect(last("pose")[1]).toEqual(parts.stage.placed.rest);
  expect(last("place")[1]).toBe(0);
  expect(last("blur")[1]).toBe(1);
};

test("a page arrival skips the intro", async () => {
  // an app page reloaded or reached by Back shows at once, as 3d's arrive does
  expect(arrivalKind({ arrival: "page", hasApp: true, seen: true })).toBe(
    "page",
  );
  // with no app for the page it plays the intro the visit would have had
  expect(arrivalKind({ arrival: "page", hasApp: false, seen: true })).toBe(
    "fast",
  );
  expect(arrivalKind({ arrival: "page", hasApp: false, seen: false })).toBe(
    "full",
  );
  expect(arrivalKind({ arrival: "full", seen: true })).toBe("full");
  expect(arrivalKind({ arrival: "fast", seen: true })).toBe("fast");
  expect(arrivalKind({ seen: true })).toBe("fast");
  expect(arrivalKind({ seen: false })).toBe("full");
  expect(introPlan({ kind: "page", manifest: landscape })).toBe(null);

  const fake = fakeParts(landscape);
  const intro = playIntro("page", fake.parts);
  intro.start();
  expect(await intro.finished).toBe("skipped");
  expectOpenAtRest(fake);

  // a played intro animates
  const played = fakeParts(landscape);
  playIntro("full", played.parts);
  expect(played.calls.find((c) => c[0] === "fold")[1]).toBe(1);
});

test("reduced motion skips the intro", async () => {
  expect(arrivalKind({ arrival: "full", reduced: true, hasApp: false })).toBe(
    "open",
  );
  expect(arrivalKind({ arrival: "fast", reduced: true, hasApp: true })).toBe(
    "page",
  );
  expect(introPlan({ kind: "open", manifest: portrait })).toBe(null);

  const fake = fakeParts(portrait);
  const intro = playIntro("open", fake.parts);
  intro.start();
  expect(await intro.finished).toBe("skipped");
  await intro.unlocked;
  expectOpenAtRest(fake);
});
