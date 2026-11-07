// the 2d scene's last step for a device that's still too slow (the spec's "Failure"), the same shape as the 3d one in
// scene/quality.js. it measures only while frames change (the intro, folds, app opens, and charger runs), since the
// phone at rest costs almost nothing, and skips the first SKIP_MS of each motion, where every frame lays out once. once
// DECIDE_MS of that motion has been measured over the visit, most of its frames over SLOW_MS (under 20 fps) says slow,
// and slow holds. index.js then waits for the phone to be at rest, saves flatAuto, and drops to the plain flat page. it's
// a different rule from rest.js's, which only decides whether the drift, the rain's motion, and frosted glass turn on

export const SKIP_MS = 200;
export const DECIDE_MS = 3000;
export const SLOW_MS = 50;

// the head script keeps a device the 3d scene sent here (2dAuto) or one this step sent to the flat page (flatAuto) for
// AUTO_DAYS, and the 2d scene reads 2dAuto the same way (head.js autoRecent, which can't import this)
export const AUTO_DAYS = 30;

export const autoRecent = (saved, now = Date.now()) => {
  const at = Number(saved);
  if (!at) {
    return false;
  }
  const age = now - at;
  return age >= 0 && age < AUTO_DAYS * 24 * 60 * 60 * 1000;
};

// frame({ now, moving, fresh }) is called for each frame with its time and whether anything moves on it, and gives
// back the verdict, null until it says "slow". fresh says the frame has no gap of its own (the loop's first frame after
// it slept), so a motion's clock starts on it. pause() is for a hidden tab, which runs no frames, so the gap across it
// never counts
export const createSlowMeter = () => {
  // the last frame's time in this motion and how far into it that was, both null at rest
  let last = null;
  let into = null;
  let measured = 0;
  let frames = 0;
  let slow = 0;
  let verdict = null;

  const judge = () => {
    if (verdict === null && measured >= DECIDE_MS && slow > frames / 2) {
      verdict = "slow";
    }
    return verdict;
  };

  const pause = () => {
    last = null;
    into = null;
  };

  const frame = ({ now, moving, fresh = false }) => {
    if (!moving) {
      pause();
      return verdict;
    }
    if (last === null || fresh) {
      last = now;
      into = 0;
      return verdict;
    }
    const gap = now - last;
    // only the part of a gap past the motion's first SKIP_MS counts, though the frame is judged by its whole gap
    const past = Math.min(gap, into + gap - SKIP_MS);
    if (past > 0) {
      measured += past;
      frames++;
      if (gap > SLOW_MS) {
        slow++;
      }
    }
    last = now;
    into += gap;
    return judge();
  };

  return {
    frame,
    pause,
    verdict: () => verdict,
    measured: () => measured,
    counted: () => ({ frames, slow }),
  };
};
