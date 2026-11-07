// resizing and turning the 2d scene, as the 3d scene builds the phone again from the address on a resize (scene/index.js
// rebuild). a resize in the same orientation fits the stage and the desk to the window, and one across it turns: the
// old orientation's frames go first, then the new one's load and decode under a black cover, which has
// TURN_DEADLINE_MS of visible time before the visit drops to the plain flat page, as a failed load does

export const RESIZE_WAIT_MS = 150;
export const TURN_DEADLINE_MS = 10000;

// a square window is landscape, as chooseSet has it
export const portraitFor = ({ width, height }) => height > width;

export const resizeKind = ({ portrait, width, height }) =>
  portraitFor({ width, height }) === portrait ? "fit" : "turn";

// the orientation's opening set, the one an arrival mounts (index.js chooseSet), with the cable in while it charges
export const turnSetFor = ({ portrait, charging }) =>
  `${charging ? "cable-" : ""}${portrait ? "portrait-open" : "landscape"}`;

// onLate runs once ms of the page being visible have passed, the way the head script's watchdog counts, unless the
// stop it gives back is called first
export const visibleDeadline = (ms, onLate, { doc = document } = {}) => {
  let left = ms;
  let since = 0;
  let timer = null;
  let over = false;
  const run = () => {
    if (over || timer !== null || doc.hidden) {
      return;
    }
    since = performance.now();
    timer = setTimeout(() => {
      timer = null;
      stop();
      onLate();
    }, left);
  };
  const pause = () => {
    if (timer === null) {
      return;
    }
    clearTimeout(timer);
    timer = null;
    left -= performance.now() - since;
  };
  const onVisibility = () => (doc.hidden ? pause() : run());
  const stop = () => {
    over = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    doc.removeEventListener("visibilitychange", onVisibility);
  };
  doc.addEventListener("visibilitychange", onVisibility);
  run();
  return stop;
};

// onResize runs RESIZE_WAIT_MS after the last resize of a burst, as 3d waits. pending() is true from a resize until it
// has run, and again() puts it off for another wait (a resize that comes before the first frame)
export const watchResize = (onResize, { signal, wait = RESIZE_WAIT_MS }) => {
  let timer = null;
  const again = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onResize();
    }, wait);
  };
  addEventListener("resize", again, { signal });
  signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      timer = null;
    },
    { once: true },
  );
  return { pending: () => timer !== null, again };
};
