// the idle drift, from idleDrift in scene/shared/motion.js: three small looping sways of the phone at rest, as an offset
// the draw adds to the pose, weighted by idle (0 to 1). as in scene/fold.js, a motion that starts holds the phone where
// the drift had it (settle) so it begins without a jump, and the drift eases back in over RESUME_MS once the phone is
// still. the drift asks the loop for frames only while it's running, so a phone at rest in an app costs nothing
import { ease, idleDrift } from "../scene/shared/motion.js";

export const RESUME_MS = 900;

// scene is the phone's state: pose, calm (the rest rule), drawing, unlocked, busy, zoomed, and reduced(). settle is
// called when busy turns on, and sync from the loop's draw
export const createDrift = ({
  scene,
  loop,
  clock = () => performance.now(),
}) => {
  let idle = 0;
  let removeStep = null;
  let resuming = false;

  const wanted = () =>
    !scene.calm &&
    scene.drawing &&
    scene.unlocked &&
    !scene.busy &&
    !scene.zoomed &&
    !scene.reduced();

  const settle = () => {
    loop.cancelGroup("idle");
    resuming = false;
    if (idle === 0 || !scene.pose) {
      idle = 0;
      return;
    }
    const drift = idleDrift(clock() / 1000, idle);
    scene.pose = {
      ...scene.pose,
      x: scene.pose.x + drift.x,
      y: scene.pose.y + drift.y,
      z: scene.pose.z + drift.z,
    };
    idle = 0;
  };

  const resume = () => {
    const from = idle;
    resuming = true;
    loop
      .tween({
        duration: RESUME_MS,
        easing: ease.inOutSine,
        group: "idle",
        onUpdate: (k) => {
          idle = from + (1 - from) * k;
        },
      })
      .then(() => {
        resuming = false;
      });
  };

  const tick = () => {
    if (wanted()) {
      if (!resuming && idle < 1) {
        resume();
      }
      return;
    }
    if (idle > 0) {
      settle();
    }
    removeStep?.();
    removeStep = null;
  };

  // after a frame that ran for another reason, the step starts if the phone is at rest and the drift is on
  const sync = () => {
    if (!removeStep && (wanted() || idle > 0)) {
      removeStep = loop.add(tick, -2);
    }
  };
  loop.onDraw(sync);

  return {
    at: (now) => idleDrift(now / 1000, idle),
    settle,
    sync,
    idle: () => idle,
  };
};
