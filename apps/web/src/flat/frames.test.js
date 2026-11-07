import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  PHONE_PX_FULL,
  phoneHeightPx,
  chooseLighting,
  createFrameIndex,
  frameTimes,
  sizeFor,
} from "./frames.js";

const frame = (fold, extra = {}) => ({
  fold,
  lead: 0,
  hand: fold,
  t: null,
  atlas: null,
  pieces: [],
  shared: [],
  ...extra,
});
const manifestOf = (frames) => ({ frames, shared: [] });
const foldSet = (folds) => manifestOf(folds.map((fold) => frame(fold)));

// a portrait opening: the hands lead with the phone closed, then the phone unfolds
const leadSet = manifestOf([
  frame(1, { lead: 0, hand: 1, t: 0 }),
  frame(1, { lead: 0.3, hand: 0.997, t: 100 }),
  frame(1, { lead: 0.7, hand: 0.993, t: 200 }),
  frame(1, { lead: 1, hand: 0.99, t: 300 }),
  frame(0.98, { lead: 1 }),
  frame(0.5, { lead: 1 }),
  frame(0, { lead: 1 }),
]);

const realManifest = (folder) =>
  JSON.parse(
    readFileSync(
      new URL(`../../public/flat/${folder}/manifest.json`, import.meta.url),
      "utf8",
    ),
  );

const linear = (t) => t;
const inOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const inOutSineInverse = (p) => Math.acos(1 - 2 * p) / Math.PI;

test("frameFor picks the nearest fold", () => {
  const { frameFor } = createFrameIndex(foldSet([1, 0.8, 0.5, 0.2, 0]));
  expect(frameFor(0.62)).toBe(2);
  expect(frameFor(0.7)).toBe(1);
  expect(frameFor(0.8)).toBe(1);
  expect(frameFor(0.07)).toBe(4);
  expect(frameFor(1.2)).toBe(0);
  expect(frameFor(-0.1)).toBe(4);

  const rising = createFrameIndex(foldSet([0, 0.3, 1]));
  expect(rising.frameFor(0.25)).toBe(1);
  expect(rising.frameFor(0.9)).toBe(2);
});

test("frameFor uses the hand fold above 0.99 in a lead set", () => {
  const { frameFor } = createFrameIndex(leadSet);
  expect(frameFor(1, 0, 1)).toBe(0);
  expect(frameFor(1, 0.3, 0.997)).toBe(1);
  expect(frameFor(1, 0.6, 0.994)).toBe(2);
  // the phone's last bit of travel to 0.99 isn't drawn, the hands wait at 0.99
  expect(frameFor(0.995, 1, 0.99)).toBe(3);
  expect(frameFor(0.98, 1, 0.98)).toBe(4);
  expect(frameFor(0.4, 1, 0.4)).toBe(5);
  // with no hand fold given, it's worked out from the lead the way handFold does
  expect(frameFor(1, 0.7)).toBe(2);

  // a set with no lead frames picks by the phone fold everywhere
  const plain = createFrameIndex(foldSet([1, 0.995, 0.98]));
  expect(plain.frameFor(0.996, 0, 0.98)).toBe(1);

  const portrait = realManifest("portrait-open-day-half");
  const real = createFrameIndex(portrait);
  const picked = portrait.frames[real.frameFor(1, 0.5, 0.995)];
  expect(picked.fold).toBe(1);
  expect(picked.hand).toBeCloseTo(0.995, 6);
  expect(portrait.frames[real.frameFor(0.993, 1, 0.99)].hand).toBe(0.99);
});

test("indexAt picks the nearest timed frame", () => {
  const timed = manifestOf([0, 16.667, 33.333, 50].map((t) => frame(0, { t })));
  const { indexAt } = createFrameIndex(timed);
  expect(indexAt(20)).toBe(1);
  expect(indexAt(30)).toBe(2);
  expect(indexAt(-5)).toBe(0);
  expect(indexAt(1000)).toBe(3);

  expect(createFrameIndex(leadSet).indexAt(240)).toBe(2);
  expect(createFrameIndex(foldSet([1, 0])).indexAt(10)).toBe(null);
});

test("frameTimes abut with no gap", () => {
  const set = foldSet([1, 0.75, 0.5, 0.25, 0]);
  // each frame starts at the midpoint between its fold and the previous one's, rounded once
  expect(frameTimes(set, linear, 100, 333)).toEqual([100, 142, 225, 308, 391]);

  const folds = [1, 0.97, 0.9, 0.81, 0.6, 0.33, 0.12, 0.04, 0];
  const times = frameTimes(foldSet(folds), inOutSine, 700, 1100);
  expect(times).toHaveLength(folds.length);
  expect(times[0]).toBe(700);
  times.forEach((time, i) => {
    expect(Number.isInteger(time)).toBe(true);
    if (i > 0) {
      const mid = (1 - folds[i - 1] + (1 - folds[i])) / 2;
      expect(time).toBe(Math.round(700 + 1100 * inOutSineInverse(mid)));
      expect(time).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });
});

test("frameTimes ends at the last frame", () => {
  const times = frameTimes(foldSet([1, 0.6, 0.2, 0]), linear, 0, 1000);
  expect(times).toEqual([0, 200, 600, 900]);
  // the last frame shows from the last midpoint until the end, so it's the one on screen when the curve ends
  expect(times[times.length - 1]).toBeLessThan(1000);

  // a closing set runs the other way and gets the same times
  expect(frameTimes(foldSet([0, 0.4, 0.8, 1]), linear, 0, 1000)).toEqual([
    0, 200, 600, 900,
  ]);

  // the lead frames all count as the hands' wait at 0.99, which the unfold from 1 passes at 10 ms, and the intro times
  // them from their own t instead
  expect(frameTimes(leadSet, linear, 0, 1000)).toEqual([
    0, 10, 10, 10, 15, 260, 750,
  ]);
});

test("frameFor and frameTimes swap from the lead to the fold frames at the same fold", () => {
  // the hands wait at 0.99 while the phone's last bit of travel isn't drawn, so both count the lead's end as 0.99
  const { frameFor } = createFrameIndex(leadSet);
  expect(frameFor(0.986, 1)).toBe(3);
  expect(frameFor(0.984, 1)).toBe(4);
  // the unfold runs from the closed phone (1) as the intro plays it, 1 - curve(u), and frameFor at the fold reached a
  // ms before and after each frame's time picks the frame before and that frame
  const agree = (manifest, curve, durationMs) => {
    const times = frameTimes(manifest, curve, 0, durationMs);
    const index = createFrameIndex(manifest);
    const foldAt = (ms) => 1 - curve(Math.min(Math.max(ms / durationMs, 0), 1));
    const first = manifest.frames.findIndex((f) => f.fold < 0.99);
    expect(index.frameFor(foldAt(times[first] - 1), 1)).toBe(first - 1);
    expect(index.frameFor(foldAt(times[first] + 1), 1)).toBe(first);
    expect(index.frameFor(foldAt(times[first + 1] + 1), 1)).toBe(first + 1);
  };
  agree(leadSet, linear, 1000);
  agree(realManifest("portrait-open-day-half"), inOutSine, 1100);
});

test("chooseLighting gives day at noon, night at 23, dusk at 19", () => {
  expect(chooseLighting(12)).toBe("day");
  expect(chooseLighting(23)).toBe("night");
  expect(chooseLighting(19)).toBe("dusk");
  expect(chooseLighting(7)).toBe("dusk");
  expect(chooseLighting(3)).toBe("night");
});

test("sizeFor is half below the threshold", () => {
  expect(sizeFor({ phonePx: PHONE_PX_FULL - 1 })).toBe("half");
  expect(sizeFor({ phonePx: PHONE_PX_FULL })).toBe("full");
  expect(sizeFor({ phonePx: PHONE_PX_FULL * 2 })).toBe("full");
  expect(sizeFor({ phonePx: Number.NaN })).toBe("half");
  expect(sizeFor({})).toBe("half");
});

test("phoneHeightPx is 688 px for an 800 px tall landscape window", () => {
  expect(
    phoneHeightPx({ width: 1280, height: 800, portrait: false }),
  ).toBeCloseTo(688, 0);
});

test("phoneHeightPx follows the width in a narrow window", () => {
  const wide = phoneHeightPx({ width: 1600, height: 800, portrait: false });
  const narrow = phoneHeightPx({ width: 800, height: 800, portrait: false });
  expect(narrow).toBeLessThan(wide);
});
