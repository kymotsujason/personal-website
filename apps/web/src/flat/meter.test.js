import { expect, test } from "vitest";
import {
  AUTO_DAYS,
  DECIDE_MS,
  SKIP_MS,
  SLOW_MS,
  autoRecent,
  createSlowMeter,
} from "./meter.js";

// one motion of frames every gap ms for ms ms, from start, then a frame at rest
const play = (meter, { start, ms, gap }) => {
  let verdict = null;
  for (let t = start; t <= start + ms; t += gap) {
    verdict = meter.frame({ now: t, moving: true }) ?? verdict;
  }
  return meter.frame({ now: start + ms + gap, moving: false }) ?? verdict;
};

test("the meter needs 3 s of motion", () => {
  const meter = createSlowMeter();
  // slow frames, but each motion's 2.2 s gives about 1.9 s past its skip, so the first doesn't decide and the second does
  expect(play(meter, { start: 0, ms: 2200, gap: 80 })).toBe(null);
  expect(meter.measured()).toBeLessThan(DECIDE_MS);
  expect(play(meter, { start: 10000, ms: 2200, gap: 80 })).toBe("slow");
  expect(meter.measured()).toBeGreaterThanOrEqual(DECIDE_MS);

  // the same 4.4 s of frames that mostly come in under 50 ms decide nothing, and the meter goes on measuring
  const quick = createSlowMeter();
  expect(play(quick, { start: 0, ms: 2200, gap: 17 })).toBe(null);
  expect(play(quick, { start: 10000, ms: 2200, gap: 17 })).toBe(null);
  expect(quick.measured()).toBeGreaterThanOrEqual(DECIDE_MS);

  // most means more than half: frames at exactly 50 ms aren't over it
  const edge = createSlowMeter();
  expect(play(edge, { start: 0, ms: 4000, gap: SLOW_MS })).toBe(null);
});

test("the meter skips each motion's first 200 ms", () => {
  // a motion that stalls in its first 200 ms, as the first frames of a fold do while every frame lays out, and runs
  // quickly after
  const meter = createSlowMeter();
  const motion = (start) => {
    meter.frame({ now: start, moving: true });
    meter.frame({ now: start + 190, moving: true });
    for (let t = start + 200; t <= start + 1200; t += 16) {
      meter.frame({ now: t, moving: true });
    }
    meter.frame({ now: start + 1300, moving: false });
  };
  for (let i = 0; i < 4; i++) {
    motion(i * 5000);
  }
  // the stall's 190 ms and the gap of 10 ms after it start inside the first 200 ms, so neither counts
  expect(meter.counted()).toEqual({ frames: 4 * 62, slow: 0 });
  expect(meter.measured()).toBe(4 * 992);
  expect(meter.verdict()).toBe(null);
});

test("a crossing gap counts only its part past 200 ms", () => {
  const meter = createSlowMeter();
  meter.frame({ now: 0, moving: true });
  meter.frame({ now: 150, moving: true });
  // 150 to 450 crosses the skip's end, so its last 250 ms count
  meter.frame({ now: 450, moving: true });
  expect(meter.measured()).toBe(250);
  expect(meter.counted()).toEqual({ frames: 1, slow: 1 });
  // a gap that ends right at 200 ms has nothing past it
  const edge = createSlowMeter();
  edge.frame({ now: 0, moving: true });
  edge.frame({ now: SKIP_MS, moving: true });
  expect(edge.counted()).toEqual({ frames: 0, slow: 0 });
});

test("a slept loop's motion starts its clock on its first frame", () => {
  // the loop's first frame after it slept has no gap of its own, and the motion starts there, not a frame later
  const meter = createSlowMeter();
  meter.frame({ now: 0, moving: false });
  meter.frame({ now: 5000, moving: true, fresh: true });
  meter.frame({ now: 5280, moving: true });
  meter.frame({ now: 5560, moving: true });
  meter.frame({ now: 5840, moving: true });
  // 80 ms of the first gap, then two whole ones
  expect(meter.measured()).toBe(640);
  expect(meter.counted()).toEqual({ frames: 3, slow: 3 });
  // a fresh frame inside a motion starts it again, since the gap before it isn't a frame
  meter.frame({ now: 9000, moving: true, fresh: true });
  meter.frame({ now: 9100, moving: true });
  expect(meter.measured()).toBe(640);
});

test("a hidden tab's gap never counts, and a device's own long frames do", () => {
  const meter = createSlowMeter();
  meter.frame({ now: 0, moving: true });
  meter.frame({ now: 300, moving: true });
  // the tab was hidden, so no frames ran, and the next frame starts the clock again
  meter.pause();
  meter.frame({ now: 60000, moving: true });
  meter.frame({ now: 60100, moving: true });
  // 0 to 300 gave its last 100 ms, and the 59.7 s across the pause and the 100 ms inside the new skip gave nothing
  expect(meter.counted()).toEqual({ frames: 1, slow: 1 });
  expect(meter.measured()).toBe(100);

  // frames over a second each on a device that slow still count
  const crawl = createSlowMeter();
  for (let t = 0; t <= 6000; t += 1200) {
    crawl.frame({ now: t, moving: true });
  }
  expect(crawl.counted()).toEqual({ frames: 5, slow: 5 });
  expect(crawl.verdict()).toBe("slow");
});

test("a slow verdict holds, and the frames at rest count for nothing", () => {
  const meter = createSlowMeter();
  for (let t = 0; t < 100000; t += 200) {
    meter.frame({ now: t, moving: false });
  }
  expect(meter.measured()).toBe(0);
  expect(
    play(meter, { start: 200000, ms: SKIP_MS + DECIDE_MS + 100, gap: 60 }),
  ).toBe("slow");
  expect(play(meter, { start: 300000, ms: 20000, gap: 16 })).toBe("slow");
});

test("2dAuto counts for 30 days, as the head script reads it", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  expect(AUTO_DAYS).toBe(30);
  expect(autoRecent(String(now - 29 * day), now)).toBe(true);
  expect(autoRecent(String(now), now)).toBe(true);
  expect(autoRecent(String(now - 31 * day), now)).toBe(false);
  // a time in the future, junk, and nothing don't count
  expect(autoRecent(String(now + day), now)).toBe(false);
  expect(autoRecent("junk", now)).toBe(false);
  expect(autoRecent(null, now)).toBe(false);
  expect(autoRecent("1760000000000", now)).toBe(false);
});
