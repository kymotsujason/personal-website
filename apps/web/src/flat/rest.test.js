import { expect, test } from "vitest";
import {
  MIN_FRAMES,
  createFoldMeter,
  createMeter,
  staysCalm,
  watchFrames,
} from "./rest.js";

test("a device through 2dAuto stays calm, and no other does, half size included", () => {
  expect(staysCalm({ auto: "1760000000000" })).toBe(true);
  expect(staysCalm({ auto: null })).toBe(false);
});

test("the meter says fast only when most of the unfold's frames came in under 20 ms", () => {
  const feed = (gaps) => {
    const meter = createMeter();
    gaps.forEach((g) => meter.push(g));
    return meter.verdict();
  };
  expect(feed(Array(MIN_FRAMES - 1).fill(16.7))).toBeNull();
  // a few long frames that took as long as MIN_FRAMES frames at 20 ms are slow, not too few to judge
  expect(feed(Array(8).fill(60))).toBe("slow");
  expect(feed(Array(8).fill(40))).toBeNull();
  expect(feed(Array(60).fill(16.7))).toBe("fast");
  expect(feed(Array(60).fill(33.3))).toBe("slow");
  // a few hitches in a smooth run still count as mostly fast, and a run of long frames doesn't
  expect(feed([...Array(54).fill(16.7), ...Array(6).fill(45)])).toBe("fast");
  expect(feed([...Array(40).fill(16.7), ...Array(20).fill(25)])).toBe("slow");
});

test("watching frames feeds the gaps between them", () => {
  const meter = createMeter();
  const queue = [];
  const stop = watchFrames(meter, { frame: (fn) => queue.push(fn) });
  [0, 16, 33, 50].forEach((t) => queue.shift()(t));
  expect(meter.count()).toBe(3);
  stop();
  queue.shift()(70);
  expect(meter.count()).toBe(3);
});

test("only the frames take counts, and the watch ends when done says so", () => {
  const meter = createMeter();
  const queue = [];
  let counting = false;
  let over = false;
  let ended = 0;
  watchFrames(meter, {
    frame: (fn) => queue.push(fn),
    take: () => counting,
    done: () => over,
    onDone: () => {
      ended += 1;
    },
  });
  queue.shift()(0);
  queue.shift()(16);
  expect(meter.count()).toBe(0);
  counting = true;
  queue.shift()(32);
  queue.shift()(48);
  expect(meter.count()).toBe(2);
  counting = false;
  queue.shift()(64);
  expect(meter.count()).toBe(2);
  over = true;
  queue.shift()(80);
  expect(ended).toBe(1);
  expect(queue).toHaveLength(0);
});

// a fold from `from` to `to` over frames of dt ms, ending on `to`, as the loop would draw it. gives the last verdict
const playFold = (folds, from, to, frames, dt) => {
  let verdict = null;
  for (let i = 1; i <= frames; i++) {
    const fold = from + ((to - from) * i) / frames;
    verdict = folds.frame({ fold, dt }) ?? verdict;
  }
  return verdict;
};

test("a close alone judges nothing, and an opening fold gives its verdict when it ends", () => {
  const folds = createFoldMeter();
  folds.frame({ fold: 0, dt: 0 });
  expect(playFold(folds, 0, 1, 60, 16.7)).toBeNull();
  expect(playFold(folds, 1, 0, 60, 16.7)).toBe("fast");
});

test("an opening fold counts only its own frames, and a slow one says slow", () => {
  const folds = createFoldMeter();
  folds.frame({ fold: 1, dt: 0 });
  expect(playFold(folds, 1, 0, 60, 33.3)).toBe("slow");
});

test("a fold too short to give frames judges nothing, and the next one is measured again", () => {
  const folds = createFoldMeter();
  folds.frame({ fold: 1, dt: 0 });
  expect(playFold(folds, 1, 0, MIN_FRAMES - 5, 16.7)).toBeNull();
  folds.frame({ fold: 1, dt: 0 });
  expect(playFold(folds, 1, 0, 40, 16.7)).toBe("fast");
});

test("a fold turned back before it opens counts for nothing", () => {
  const folds = createFoldMeter();
  folds.frame({ fold: 1, dt: 0 });
  // opens a third of the way in 30 smooth frames, then closes again
  expect(playFold(folds, 1, 0.6, 30, 16.7)).toBeNull();
  expect(playFold(folds, 0.6, 1, 30, 16.7)).toBeNull();
  // the next opening starts a fresh count of its own, so a short one still gives nothing
  expect(playFold(folds, 1, 0, 10, 16.7)).toBeNull();
});
