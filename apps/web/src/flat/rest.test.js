import { expect, test } from "vitest";
import { MIN_FRAMES, createMeter, startsCalm, watchFrames } from "./rest.js";

test("a device through 2dAuto, at half size, or found slow starts calm", () => {
  expect(startsCalm({ auto: "1760000000000", size: "full" })).toBe(true);
  expect(startsCalm({ auto: null, size: "half" })).toBe(true);
  expect(startsCalm({ auto: null, size: "full", flatSlow: true })).toBe(true);
  expect(startsCalm({ auto: null, size: "full" })).toBe(false);
});

test("the meter says fast only when most of the unfold's frames came in under 20 ms", () => {
  const feed = (gaps) => {
    const meter = createMeter();
    gaps.forEach((g) => meter.push(g));
    return meter.verdict();
  };
  expect(feed(Array(MIN_FRAMES - 1).fill(16.7))).toBeNull();
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
