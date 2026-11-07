// looking around the desk, the phone's trail, and the mouse dodge, as scene/look.js and scene/loop.js have them. the
// view (yaw and pitch of the desk camera, in degrees) eases toward where a drag put it, clamped so its edge stays
// inside the photo (scene/shared/lookLimits.js, which the 3d desk uses too). the phone trails the view while it
// catches up and moves out of the mouse's way, and both are offsets the draw adds to the pose (motionPose), since the
// folds and the apps own the pose itself
import {
  AVOID_GAIN,
  AVOID_MAX,
  DESK_FOV,
  DESK_REST_PITCH,
  LOOK_SLOP,
} from "../scene/shared/motion.js";
import {
  clampLook,
  createLimits,
  restPitchFor,
} from "../scene/shared/lookLimits.js";
import { blockNextClick } from "./fold.js";

export const REST_VIEW = { yaw: 0, pitch: restPitchFor(DESK_REST_PITCH) };

const limits = createLimits(REST_VIEW.pitch);

export const clampView = (target, aspect) => clampLook(limits, target, aspect);

export const createView = () => ({
  yaw: REST_VIEW.yaw,
  pitch: REST_VIEW.pitch,
  targetYaw: REST_VIEW.yaw,
  targetPitch: REST_VIEW.pitch,
});

export const lookBy = (view, dYaw, dPitch, aspect) => {
  const next = clampView(
    { yaw: view.targetYaw + dYaw, pitch: view.targetPitch + dPitch },
    aspect,
  );
  view.targetYaw = next.yaw;
  view.targetPitch = next.pitch;
};

// dt in seconds. the view eases toward the target, which reads as a head turning instead of a picture sliding
export const stepView = (view, dt, aspect) => {
  const next = clampView(
    { yaw: view.targetYaw, pitch: view.targetPitch },
    aspect,
  );
  view.targetYaw = next.yaw;
  view.targetPitch = next.pitch;
  const k = 1 - Math.exp(-dt * 12);
  view.yaw += (view.targetYaw - view.yaw) * k;
  view.pitch += (view.targetPitch - view.pitch) * k;
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// how far the view still has to go, which the phone's trail follows
export const trailOf = (view) => ({
  yaw: clamp(view.targetYaw - view.yaw, -12, 12),
  pitch: clamp(view.targetPitch - view.pitch, -12, 12),
});

// where the phone should be moved to, in window px, for a mouse at (x, y), or null when the dodge doesn't apply: only a
// mouse, with the phone closed and still, and no drag of the desk going. outer is the phone's bounds as drawn, and the
// move it has now is taken off them, so it's where the phone would be without it and can't chase itself
export const dodgeFor = ({
  pointerType,
  phone,
  busy,
  looking,
  x,
  y,
  outer,
  avoid,
  width,
  height,
}) => {
  if (pointerType !== "mouse" || phone !== "closed" || busy || looking) {
    return null;
  }
  const left = outer.left - avoid.x;
  const right = outer.right - avoid.x;
  const top = outer.top - avoid.y;
  const bottom = outer.bottom - avoid.y;
  const dx = x - clamp(x, left, right);
  const dy = y - clamp(y, top, bottom);
  let tx = -dx * AVOID_GAIN;
  let ty = -dy * AVOID_GAIN;
  const cap = AVOID_MAX * Math.min(width, height);
  const len = Math.hypot(tx, ty);
  if (len > cap) {
    tx *= cap / len;
    ty *= cap / len;
  }
  return { tx, ty };
};

// dt in seconds. off puts the target back to nothing, and the move eases there
export const stepAvoid = (avoid, dt, off) => {
  if (off) {
    avoid.tx = 0;
    avoid.ty = 0;
  }
  const k = 1 - Math.exp(-dt * 4);
  avoid.x += (avoid.tx - avoid.x) * k;
  avoid.y += (avoid.ty - avoid.y) * k;
};

// the pose with the drift, the dodge (window px, a slight tilt with it), and the trail added, as scene/loop.js adds
// them to the phone's root. focal is the window's focal length in px, which turns px into cm at the pose's distance
export const motionPose = ({ pose, drift, avoid, trail, focal }) => {
  const perPx = -pose.z / focal;
  return {
    ...pose,
    x: pose.x + drift.x + avoid.x * perPx,
    y: pose.y + drift.y - avoid.y * perPx,
    z: pose.z + drift.z,
    rx: pose.rx - trail.pitch * 0.004 + avoid.y * 0.0003,
    ry: pose.ry - trail.yaw * 0.006 + avoid.x * 0.0004,
    rz: pose.rz - avoid.x * 0.0003,
  };
};

const SETTLED = 1e-3;

// scene is the phone's state, with edges(), reduced(), and wake(), and folds gives gesture() for a swipe that is
// already going. loop is the scene's loop
export const createLook = ({ scene, loop, folds }) => {
  const view = createView();
  const avoid = { tx: 0, ty: 0, x: 0, y: 0 };
  let drag = null;
  let removeStep = null;

  const aspect = () => innerWidth / innerHeight;

  const settled = () =>
    Math.abs(view.targetYaw - view.yaw) < SETTLED &&
    Math.abs(view.targetPitch - view.pitch) < SETTLED &&
    Math.abs(avoid.tx - avoid.x) < 0.01 &&
    Math.abs(avoid.ty - avoid.y) < 0.01;

  const dodgeOff = () =>
    scene.phone !== "closed" || scene.busy || scene.reduced();

  const step = (now, dt) => {
    stepView(view, dt / 1000, aspect());
    stepAvoid(avoid, dt / 1000, dodgeOff());
    if (settled()) {
      view.yaw = view.targetYaw;
      view.pitch = view.targetPitch;
      // the dodge snaps too, or the draw hook below would start the step again for the rest of the visit
      avoid.x = avoid.tx;
      avoid.y = avoid.ty;
      removeStep?.();
      removeStep = null;
    }
  };

  // runs the step only while there's something to ease, so the phone at rest asks for no frames
  const ensure = () => {
    if (!removeStep) {
      removeStep = loop.add(step, -1);
    }
  };

  // the dodge has to ease back out when the phone starts to move, which no pointer event announces
  loop.onDraw(() => {
    if (!removeStep && (avoid.x !== 0 || avoid.y !== 0) && dodgeOff()) {
      ensure();
    }
  });

  // the phone's bounds as drawn, which include the dodge's move
  const drawnOuter = () => scene.edges().outer;

  const onPhone = (x, y) => {
    const outer = drawnOuter();
    return (
      x >= outer.left && x <= outer.right && y >= outer.top && y <= outer.bottom
    );
  };

  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) {
      return;
    }
    if (drag.moved) {
      blockNextClick();
    }
    drag = null;
    document.body.classList.remove("looking");
  };

  // the listeners, all on the window and removed with signal. guard wraps each so a throw fails the scene
  const install = ({ signal, guard }) => {
    // with the phone closed, dragging anywhere but the phone looks around the desk. the desk moves with the pointer, like
    // grabbing it, and a press that doesn't move still taps through to the cover's icons
    addEventListener(
      "pointerdown",
      guard((event) => {
        if (
          !scene.unlocked ||
          folds.gesture() ||
          scene.busy ||
          scene.phone !== "closed" ||
          onPhone(event.clientX, event.clientY)
        ) {
          return;
        }
        drag = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
      }),
      { capture: true, signal },
    );
    addEventListener(
      "pointermove",
      guard((event) => {
        if (!drag || event.pointerId !== drag.id) {
          return;
        }
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < LOOK_SLOP) {
          return;
        }
        drag.moved = true;
        document.body.classList.add("looking");
        const degPerPx = DESK_FOV / innerHeight;
        lookBy(view, -dx * degPerPx, dy * degPerPx, aspect());
        drag.x = event.clientX;
        drag.y = event.clientY;
        event.preventDefault();
        ensure();
        scene.wake();
      }),
      { capture: true, passive: false, signal },
    );
    // a held drag on a touch screen would otherwise scroll the page underneath
    addEventListener(
      "touchmove",
      guard((event) => {
        if (drag && drag.moved) {
          event.preventDefault();
        }
      }),
      { passive: false, signal },
    );
    addEventListener("pointerup", guard(endDrag), { capture: true, signal });
    addEventListener("pointercancel", guard(endDrag), {
      capture: true,
      signal,
    });

    // with the phone closed, it moves out of the way of the mouse, since where the cursor is over the desk is likely
    // where the visitor is looking
    addEventListener(
      "pointermove",
      guard((event) => {
        if (
          event.pointerType !== "mouse" ||
          !scene.unlocked ||
          scene.phone !== "closed" ||
          scene.busy ||
          (drag && drag.moved)
        ) {
          return;
        }
        // the grab cursor only over the desk, since a press on the phone doesn't drag the view
        const over = onPhone(event.clientX, event.clientY);
        if (over !== document.body.classList.contains("over-phone")) {
          document.body.classList.toggle("over-phone", over);
        }
        const target = dodgeFor({
          pointerType: event.pointerType,
          phone: scene.phone,
          busy: scene.busy,
          looking: false,
          x: event.clientX,
          y: event.clientY,
          outer: drawnOuter(),
          avoid,
          width: innerWidth,
          height: innerHeight,
        });
        if (target && !scene.reduced()) {
          avoid.tx = target.tx;
          avoid.ty = target.ty;
          ensure();
          scene.wake();
        }
      }),
      { signal },
    );
    document.documentElement.addEventListener(
      "mouseleave",
      guard(() => {
        avoid.tx = 0;
        avoid.ty = 0;
        ensure();
        scene.wake();
      }),
      { signal },
    );
  };

  // opening the phone brings the view back to center
  const lookAhead = () => {
    const next = clampView(REST_VIEW, aspect());
    view.targetYaw = next.yaw;
    view.targetPitch = next.pitch;
    ensure();
  };

  const stop = () => {
    removeStep?.();
    removeStep = null;
    drag = null;
    document.body.classList.remove("looking", "over-phone");
  };

  return {
    install,
    lookAhead,
    stop,
    view,
    avoid,
    trail: () => trailOf(view),
    dragging: () => Boolean(drag?.moved),
  };
};
