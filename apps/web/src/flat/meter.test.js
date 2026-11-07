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

  // a motion's start is also a frame after a gap long enough to be a pause (a hidden tab), so that gap never counts
  const paused = createSlowMeter();
  paused.frame({ now: 0, moving: true });
  paused.frame({ now: 300, moving: true });
  paused.frame({ now: 5300, moving: true });
  paused.frame({ now: 5400, moving: true });
  paused.frame({ now: 5500, moving: true });
  paused.frame({ now: 5600, moving: true });
  expect(paused.counted()).toEqual({ frames: 1, slow: 1 });
  expect(paused.measured()).toBe(100);
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
