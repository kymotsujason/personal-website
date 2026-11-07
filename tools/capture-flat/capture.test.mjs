import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import {
  MERGE,
  dragTable,
  encodePng,
  foldCurves,
  foldList,
  largestOffset,
  matte,
} from "./capture.mjs";

// the frame a player shows at each ms of a curve, taken as the list's nearest fold
const nearestIndex = (list, fold) => {
  let best = 0;
  for (let i = 1; i < list.length; i++) {
    if (Math.abs(list[i] - fold) < Math.abs(list[best] - fold)) {
      best = i;
    }
  }
  return best;
};

// a pixel as the gl buffer holds it: premultiplied, a hand of color `hand` covering `cover` of it over a key
// color that covers the rest, or over nothing when key is null
const pixel = (hand, cover, key) => {
  const under = key ? [...key, 255] : [0, 0, 0, 0];
  return [0, 1, 2, 3].map((c) =>
    Math.round(cover * (c === 3 ? 255 : hand[c]) + (1 - cover) * under[c]),
  );
};
const MAGENTA = [255, 0, 255];
const GREEN = [0, 255, 0];

test("foldList holds a frame at most about 20 ms on each curve", () => {
  const list = foldList();
  for (const curve of foldCurves()) {
    let shown = -1;
    let held = 0;
    let worst = 0;
    for (let ms = 0; ms <= curve.time; ms++) {
      const fold = curve.fold(ms / curve.time);
      const index = nearestIndex(list, fold);
      if (index !== shown) {
        shown = index;
        held = 0;
      }
      // a frame counts as held while the fold has moved off it by more than half the merge distance, since the
      // merge already accepts a frame that close to the fold as the same picture
      if (Math.abs(list[shown] - fold) > MERGE / 2) {
        held++;
        worst = Math.max(worst, held);
      }
    }
    assert.ok(worst <= 20, `${curve.name} holds a frame for ${worst} ms`);
  }
});

test("foldList holds a frame too long when it's spaced evenly by fold", () => {
  // the spike's mistake, 33 folds spaced evenly, measured the same way as above, so the check can fail
  const even = Array.from({ length: 33 }, (_, i) => 1 - i / 32);
  const intro = foldCurves().find((c) => c.name === "full intro");
  let shown = -1;
  let held = 0;
  let worst = 0;
  for (let ms = 0; ms <= intro.time; ms++) {
    const fold = intro.fold(ms / intro.time);
    const index = nearestIndex(even, fold);
    if (index !== shown) {
      shown = index;
      held = 0;
    }
    if (Math.abs(even[shown] - fold) > MERGE / 2) {
      held++;
      worst = Math.max(worst, held);
    }
  }
  assert.ok(worst > 40, `even spacing held a frame for only ${worst} ms`);
});

test("foldList starts at 1 and ends at 0", () => {
  const list = foldList();
  assert.equal(list[0], 1);
  assert.equal(list[list.length - 1], 0);
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i] < list[i - 1], `fold ${i} doesn't go down`);
    assert.ok(
      list[i - 1] - list[i] >= MERGE,
      `folds ${i - 1} and ${i} are ${list[i - 1] - list[i]} apart`,
    );
  }
});

test("foldList has every curve's 60 Hz folds within the merge distance", () => {
  const list = foldList();
  for (const curve of foldCurves()) {
    const steps = Math.ceil(curve.time / (1000 / 60));
    for (let k = 0; k <= steps; k++) {
      const fold = curve.fold(Math.min(1, k / steps));
      const near = Math.min(...list.map((f) => Math.abs(f - fold)));
      assert.ok(near < MERGE, `${curve.name} at step ${k} is ${near} away`);
    }
  }
});

test("foldList curves follow the 3d scene's timings", () => {
  const byName = Object.fromEntries(foldCurves().map((c) => [c.name, c]));
  assert.equal(byName["full intro"].time, 1100);
  assert.equal(byName["fast intro"].time, 700);
  assert.equal(byName["close key"].time, 900);
  assert.equal(byName["open key"].time, 1000);
  // the keys raise an inOutSine progress to a 1.6 power (fold.js)
  const half = (1 - Math.cos(Math.PI * 0.5)) / 2;
  assert.ok(
    Math.abs(byName["close key"].fold(0.5) - Math.pow(half, 1.6)) < 1e-12,
  );
  assert.ok(
    Math.abs(byName["open key"].fold(0.5) - Math.pow(1 - half, 1.6)) < 1e-12,
  );
  for (const curve of foldCurves()) {
    const ends = [curve.fold(0), curve.fold(1)].sort();
    assert.deepEqual(ends, [0, 1], `${curve.name} doesn't run between 0 and 1`);
  }
});

test("matte gives alpha 0 where both keys show the screen and 1 where they agree", () => {
  // two pixels in one row: the bare screen, then something opaque in front of it
  const m = Uint8Array.from([...MAGENTA, 255, 90, 140, 200, 255]);
  const g = Uint8Array.from([...GREEN, 255, 90, 140, 200, 255]);
  const out = matte(m, g, 2, 1);
  assert.deepEqual([...out.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual([...out.slice(4, 8)], [90, 140, 200, 255]);
});

test("matte keeps a half covered edge pixel at half alpha", () => {
  const hand = [200, 100, 50];
  // a thumb's edge half over the screen, then a hand's outer edge half over nothing
  const m = Uint8Array.from([
    ...pixel(hand, 0.5, MAGENTA),
    ...pixel(hand, 0.5, null),
  ]);
  const g = Uint8Array.from([
    ...pixel(hand, 0.5, GREEN),
    ...pixel(hand, 0.5, null),
  ]);
  const out = matte(m, g, 2, 1);
  for (const at of [0, 4]) {
    const [r, gg, b, a] = out.slice(at, at + 4);
    assert.ok(Math.abs(a - 128) <= 1, `alpha ${a} at ${at}`);
    assert.ok(Math.abs(r - 200) <= 2, `red ${r} at ${at}`);
    assert.ok(Math.abs(gg - 100) <= 2, `green ${gg} at ${at}`);
    assert.ok(Math.abs(b - 50) <= 2, `blue ${b} at ${at}`);
  }
});

test("matte turns the gl buffer's bottom up rows top down", () => {
  // the buffer's first row is the picture's bottom
  const m = Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255]);
  const out = matte(m, m, 1, 2);
  assert.deepEqual([...out], [40, 50, 60, 255, 10, 20, 30, 255]);
});

test("largestOffset measures the corners against the first pass shifted by the margin", () => {
  const first = [
    [10, 20],
    [30, 40],
  ];
  assert.equal(
    largestOffset(
      [
        [330, 180],
        [350, 200],
      ],
      first,
      [320, 160],
    ),
    0,
  );
  assert.equal(
    largestOffset(
      [
        [330, 180],
        [353, 204],
      ],
      first,
      [320, 160],
    ),
    5,
  );
  assert.throws(() => largestOffset([[330, 180]], first, [320, 160]));
});

test("dragTable advances the fold while the edge is behind the pointer, capped by the corners' move", () => {
  // the edge moves 2 px a sample and the corners 1 px, so a px of pointer is half a sample
  const n = 8;
  const edge = Array.from({ length: n + 1 }, (_, i) => 100 + 2 * i);
  const corners = Array.from({ length: n + 1 }, (_, i) => [[i, 0]]);
  const free = dragTable(edge, corners, 1, n);
  assert.equal(free.span, 16);
  assert.equal(free.table[0], 0);
  assert.equal(free.table[2], 1 / n);
  assert.equal(free.table[free.table.length - 1], 1);
  // the corners move 4 px a sample, past the 2.5 px cap, so each px of pointer takes one sample at most
  const fast = dragTable(
    Array.from({ length: n + 1 }, (_, i) => 100 + 8 * i),
    Array.from({ length: n + 1 }, (_, i) => [[4 * i, 0]]),
    1,
    n,
  );
  for (let k = 1; k < fast.table.length; k++) {
    assert.ok(fast.table[k] - fast.table[k - 1] <= 1 / n + 1e-12);
  }
});

test("encodePng writes rows a png decoder reads back", () => {
  const rgba = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const png = encodePng(rgba, 1, 3);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1);
  assert.equal(png.readUInt32BE(20), 3);
  const idat = png.indexOf("IDAT");
  const length = png.readUInt32BE(idat - 4);
  const raw = inflateSync(png.subarray(idat + 4, idat + 4 + length));
  // each row starts with filter type 0
  assert.deepEqual([...raw], [0, 1, 2, 3, 4, 0, 5, 6, 7, 8, 0, 9, 10, 11, 12]);
});
