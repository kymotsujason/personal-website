// the 2d scene's one animation frame loop. every motion but the intro (the folds, the apps, and what later steps add)
// runs from here, as the 3d scene runs from scene/loop.js: each frame runs the tweens, then the steps added to it, then
// the draws, which set the frame, the wrappers, the screens, and #page together, so none of them can drift apart under
// load. it sleeps while nothing moves, and wake() asks for one more frame after a change made outside it
export const createLoop = ({
  onError = (error) => {
    throw error;
  },
  frame = (fn) => requestAnimationFrame(fn),
  clock = () => performance.now(),
} = {}) => {
  let tweens = [];
  let steps = [];
  let draws = [];
  let pending = false;
  let stopped = false;
  let last = null;

  const request = () => {
    if (pending || stopped) {
      return;
    }
    pending = true;
    frame(run);
  };

  const runTweens = (now) => {
    const running = tweens;
    tweens = [];
    const kept = running.filter((tw) => {
      if (tw.over) {
        return false;
      }
      if (now < tw.start) {
        return true;
      }
      const t =
        tw.duration > 0 ? Math.min((now - tw.start) / tw.duration, 1) : 1;
      tw.onUpdate(tw.easing(t), t);
      if (t >= 1) {
        tw.over = true;
        tw.resolve("done");
        return false;
      }
      return true;
    });
    // a tween an update started joins the ones still running, and first runs next frame
    tweens = [...kept, ...tweens.filter((tw) => !tw.over)];
  };

  const run = (now) => {
    pending = false;
    if (stopped) {
      return;
    }
    try {
      const dt = last === null ? 0 : Math.min(now - last, 50);
      last = now;
      runTweens(now);
      steps.forEach(({ fn }) => fn(now, dt));
      draws.forEach((fn) => fn(now, dt));
    } catch (error) {
      stopped = true;
      onError(error);
      return;
    }
    if (tweens.length > 0 || steps.length > 0) {
      request();
    } else {
      last = null;
    }
  };

  // onUpdate gets the eased progress and the linear one. resolves "done" once it ends, or "cancelled" when
  // cancelGroup or cancelAll stops it first, where it is
  const tween = ({
    duration,
    delay = 0,
    easing = (t) => t,
    onUpdate = () => {},
    group = null,
  }) =>
    new Promise((resolve) => {
      if (stopped) {
        resolve("cancelled");
        return;
      }
      tweens.push({
        start: clock() + delay,
        duration,
        easing,
        onUpdate,
        group,
        resolve,
        over: false,
      });
      request();
    });

  const cancelWhere = (match) => {
    const stopping = tweens.filter(match);
    tweens = tweens.filter((tw) => !match(tw));
    stopping.forEach((tw) => {
      tw.over = true;
      tw.resolve("cancelled");
    });
  };

  const cancelGroup = (group) => cancelWhere((tw) => tw.group === group);
  const cancelAll = () => cancelWhere(() => true);

  // a step runs every frame while it's added, and keeps the loop awake. lower orders run first
  const add = (fn, order = 0) => {
    const entry = { fn, order };
    steps = [...steps, entry].sort((a, b) => a.order - b.order);
    request();
    return () => {
      steps = steps.filter((s) => s !== entry);
    };
  };

  // a draw runs at the end of every frame the loop runs, after the tweens and the steps
  const onDraw = (fn) => {
    draws = [...draws, fn];
    return () => {
      draws = draws.filter((d) => d !== fn);
    };
  };

  const stop = () => {
    cancelAll();
    stopped = true;
    steps = [];
    draws = [];
  };

  return {
    tween,
    cancelGroup,
    cancelAll,
    add,
    onDraw,
    wake: request,
    stop,
    busy: () => tweens.length > 0,
  };
};
