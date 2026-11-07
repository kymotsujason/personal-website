// what the 2d scene runs at rest (the spec's "What runs at rest on a slow device"): the idle drift, the rain's motion,
// and frosted glass keep the gpu busy, so every device starts without them. one that came through 2dAuto keeps it that
// way for the visit, and any other (half size frames included, Jason's call on 2026-11-07) gets them once the frame
// meter has shown the intro's unfold, the unfold itself and not the whole intro, mostly under UNFOLD_MS per frame. this isn't the slow path
// (index.js slowPathFor), which only decides how apps and the picture are drawn while things move

import { autoRecent } from "./meter.js";

export const UNFOLD_MS = 20;
// the share of frames that must come in under UNFOLD_MS for the unfold to count as mostly under it
export const MOSTLY = 0.75;
// frames needed before the meter says anything
export const MIN_FRAMES = 20;

// 2dAuto counts while it's recent, as the head script reads it
export const staysCalm = ({ auto = null } = {}) => autoRecent(auto);

// the gaps between frames, each in ms. verdict is null until there are enough, then "fast" when most were under
// UNFOLD_MS and "slow" when not
export const createMeter = () => {
  const gaps = [];
  return {
    push: (ms) => {
      if (Number.isFinite(ms) && ms > 0) {
        gaps.push(ms);
      }
    },
    count: () => gaps.length,
    verdict: () => {
      if (gaps.length < MIN_FRAMES) {
        // too few frames to judge, unless they took as long as MIN_FRAMES frames at UNFOLD_MS, which is slow already
        const total = gaps.reduce((sum, ms) => sum + ms, 0);
        return total >= MIN_FRAMES * UNFOLD_MS ? "slow" : null;
      }
      const quick = gaps.filter((ms) => ms < UNFOLD_MS).length;
      return quick / gaps.length >= MOSTLY ? "fast" : "slow";
    },
  };
};

// measures opening folds from the loop's frames. frame({ fold, dt }) is called for each frame drawn, with the fold (1
// closed, 0 open) and the gap since the last frame in ms. it counts the gaps while the fold is opening, and gives back
// a verdict ("fast" or "slow", or null when the fold gave too few frames) on the frame the fold reaches open. a fold
// turned back, or a close, counts for nothing
export const createFoldMeter = () => {
  let previous = null;
  let current = null;
  return {
    frame: ({ fold, dt }) => {
      const moving = fold > 0 && fold < 1;
      const opening = previous !== null && fold < previous;
      let verdict = null;
      if (moving && opening) {
        current ??= createMeter();
        current.push(dt);
      } else if (current && !moving) {
        verdict = fold <= 0 ? current.verdict() : null;
        current = null;
      } else if (current && moving) {
        current = null;
      }
      previous = fold;
      return verdict;
    },
  };
};

// feeds the meter the gaps between animation frames until stop() is called (the intro plays as web animations, so the
// loop isn't running to measure them). the first frame only starts the clock. take says whether a frame's gap counts,
// and once done says so, the watch ends and onDone runs
export const watchFrames = (
  meter,
  {
    frame = requestAnimationFrame,
    take = () => true,
    done = () => false,
    onDone = () => {},
  } = {},
) => {
  let last = null;
  let stopped = false;
  const tick = (now) => {
    if (stopped) {
      return;
    }
    if (done()) {
      stopped = true;
      onDone();
      return;
    }
    if (last !== null && take()) {
      meter.push(now - last);
    }
    last = now;
    frame(tick);
  };
  frame(tick);
  return () => {
    stopped = true;
  };
};
