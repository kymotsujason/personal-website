// what the 2d scene runs at rest (the spec's "What runs at rest on a slow device"): the idle drift, the rain's motion,
// and frosted glass keep the gpu busy, so a device that came through 2dAuto, gets half size frames, or was found slow
// by the 2d scene starts without them, and gets them once the frame meter has shown the intro's unfold mostly under
// UNFOLD_MS per frame. this isn't the slow path (index.js slowPathFor), which only decides how apps and the picture
// are drawn while things move

export const UNFOLD_MS = 20;
// the share of frames that must come in under UNFOLD_MS for the unfold to count as mostly under it
export const MOSTLY = 0.75;
// frames needed before the meter says anything
export const MIN_FRAMES = 20;

export const startsCalm = ({ auto = null, size, flatSlow = false } = {}) =>
  auto !== null || size === "half" || Boolean(flatSlow);

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
        return null;
      }
      const quick = gaps.filter((ms) => ms < UNFOLD_MS).length;
      return quick / gaps.length >= MOSTLY ? "fast" : "slow";
    },
  };
};

// feeds the meter the gaps between animation frames until stop() is called (the intro plays as web animations, so the
// loop isn't running to measure them). the first frame only starts the clock
export const watchFrames = (meter, { frame = requestAnimationFrame } = {}) => {
  let last = null;
  let stopped = false;
  const tick = (now) => {
    if (stopped) {
      return;
    }
    if (last !== null) {
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
