// the intro, as scene/intro.js plays it: the hands raise the closed phone into view and unfold it (full), or bring it
// the short way in from below as it opens (fast), while the desk goes from sharp to blurred. the Web Animations API
// drives it, with every easing sampled into keyframes (no css linear()) and an end keyframe on each animation, since
// one without it falls back to the element's own style when it ends. the frames flip on the times the unfold reaches
// them, and the screens are warped onto each frame's corners on the same times
import {
  FAST_FOLD_AT,
  FAST_MOVE_MS,
  INTRO_UNFOLD_MS,
  LEAD,
  ease,
  moveAt,
  moveTotal,
} from "../scene/shared/motion.js";
import { TAP_FOLD } from "../scene/state.js";
import { curveInverse, frameTimes } from "./frames.js";
import { chainTransform } from "./stage.js";

const SAMPLE_MS = 1000 / 60;
const POSE_KEYS = ["x", "y", "z", "rx", "ry", "rz"];
const FACES = ["cover", "flap", "body"];

const clamp01 = (t) => Math.min(Math.max(t, 0), 1);
const smoothstep = (t) => t * t * (3 - 2 * t);

// what the page load shows, by scene/intro.js arrive's rules: with reduced motion the phone is already open (on the
// page's app, or the home screen), an app page the head script marked "page" shows at once, and otherwise the intro
// plays, the fast one for a returning visit
export const arrivalKind = ({
  arrival,
  from = null,
  reduced = false,
  hasApp = false,
  seen = false,
}) => {
  // a handoff from 3d shows the page as a 3d resize does: the app zoomed, or the home screen with the phone open
  if (reduced || from === "3d") {
    return hasApp ? "page" : "open";
  }
  const given = arrival || (seen ? "fast" : "full");
  if (given === "page" && hasApp) {
    return "page";
  }
  return given === "fast" || (given === "page" && seen) ? "fast" : "full";
};

// when each frame shows: the closed phone from the start, a portrait lead's frames on their own times (captured over
// LEAD.time, squeezed into the lead's real length), and the rest from frameTimes along the unfold. each shows until the
// next one starts, and a frame with no time of its own is left out
const showTimes = ({ manifest, curve, foldStart, unfoldMs, lead, total }) => {
  const times = frameTimes(manifest, curve, foldStart, unfoldMs);
  let latest = 0;
  const starts = manifest.frames.map((frame, i) => {
    let at = times[i];
    if (i === 0) {
      at = 0;
    } else if (lead && Number.isFinite(frame.t)) {
      at = Math.round(lead.start + (frame.t * lead.duration) / LEAD.time);
    }
    latest = Math.min(Math.max(latest, at), total);
    return latest;
  });
  return starts.flatMap((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : total;
    return end > start ? [{ index, start, end }] : [];
  });
};

// the full or fast intro's timeline for a set, or null for an arrival that plays none. times are ms from its start
export const introPlan = ({ kind, manifest }) => {
  if (kind !== "full" && kind !== "fast") {
    return null;
  }
  const full = kind === "full";
  const portrait = manifest.orientation === "portrait";
  const foldStart = full
    ? manifest.foldStartTime
    : FAST_FOLD_AT[portrait ? "portrait" : "landscape"];
  const unfoldMs = full ? INTRO_UNFOLD_MS.full : INTRO_UNFOLD_MS.fast;
  const curve = full ? ease.inOutSine : ease.outSine;
  const total = Math.max(
    full ? moveTotal() : FAST_MOVE_MS,
    foldStart + unfoldMs,
  );
  // as leadOpen in scene/intro.js: the hands lead over LEAD.time ending as the unfold starts, or over the fast
  // intro's short wait
  const lead = portrait
    ? {
        start: Math.max(0, foldStart - LEAD.time),
        duration: full ? LEAD.time : Math.min(LEAD.time, foldStart),
      }
    : null;
  const foldAt = (ms) => 1 - curve(clamp01((ms - foldStart) / unfoldMs));
  const poseAt = (ms, poses) => {
    if (full) {
      return moveAt(ms, poses.fullStart, poses.rest);
    }
    const u = ease.outCubic(clamp01(ms / FAST_MOVE_MS));
    return Object.fromEntries(
      POSE_KEYS.map((k) => [
        k,
        poses.fastStart[k] + (poses.rest[k] - poses.fastStart[k]) * u,
      ]),
    );
  };
  return {
    kind,
    total,
    foldStart,
    unfoldMs,
    lead,
    foldAt,
    poseAt,
    unlockAt: foldStart + unfoldMs * curveInverse(curve, 1 - TAP_FOLD),
    frames: showTimes({ manifest, curve, foldStart, unfoldMs, lead, total }),
  };
};

// each face's keyframes, one per frame where its warp, stack, or visibility changes, held (step-end) until the next
const faceTracks = (plan, manifest, screens) => {
  const tracks = Object.fromEntries(FACES.map((name) => [name, []]));
  const last = {};
  plan.frames.forEach(({ index, start }) => {
    const styles = screens.faceStyles(manifest.frames[index], manifest);
    FACES.forEach((name) => {
      const style = styles[name];
      if (!style) {
        return;
      }
      const key = {
        visibility: style.visible ? "visible" : "hidden",
        zIndex: String(style.zIndex),
        transform: style.transform ?? last[name]?.transform ?? "none",
      };
      const before = last[name];
      if (
        before &&
        before.visibility === key.visibility &&
        before.zIndex === key.zIndex &&
        before.transform === key.transform
      ) {
        return;
      }
      last[name] = key;
      tracks[name].push({
        ...key,
        offset: start / plan.total,
        easing: "step-end",
      });
    });
  });
  return FACES.filter((name) => last[name]).map((name) => [
    screens[name],
    [...tracks[name], { ...last[name], offset: 1 }],
  ]);
};

// places the arrival's first frame at once (the closed phone at the intro's start pose, or for an arrival with no
// intro the phone open at rest), and gives back start(), which plays the intro from the animation frame it's called
// in. finished settles with "done", "skipped", or "cancelled", and unlocked once the unfold reads as open (TAP_FOLD),
// when the 3d scene lets the icons take taps. finish() jumps to the end, and cancel() stops where it is
export const playIntro = (kind, { stage, screens, desk, manifest }) => {
  const plan = introPlan({ kind, manifest });
  let resolveFinished = () => {};
  let resolveUnlocked = () => {};
  const finished = new Promise((resolve) => {
    resolveFinished = resolve;
  });
  const unlocked = new Promise((resolve) => {
    resolveUnlocked = resolve;
  });
  let animations = [];
  let over = false;

  const settle = () => {
    stage.setFold(0);
    stage.setPose(stage.placed.rest);
    screens.place(manifest.frames[stage.frameLayer.frameFor(0)], manifest);
    desk.setBlur(1);
  };

  // the end state goes in before the animations go, in the same task, so no frame shows between them
  const stop = (result) => {
    if (over) {
      return;
    }
    over = true;
    if (result !== "cancelled") {
      settle();
    }
    animations.forEach((animation) => animation.cancel());
    animations = [];
    stage.layers.frames.classList.add("lean");
    resolveUnlocked();
    resolveFinished(result);
  };

  if (!plan) {
    settle();
    return {
      plan,
      start: () => stop("skipped"),
      finish: () => stop("skipped"),
      cancel: () => stop("cancelled"),
      elapsed: () => 0,
      finished,
      unlocked,
    };
  }

  const poses = stage.placed;
  stage.setFold(1);
  stage.setPose(plan.poseAt(0, poses));
  screens.place(manifest.frames[plan.frames[0].index], manifest);
  desk.setBlur(0);

  const start = () => {
    if (over || animations.length > 0) {
      return;
    }
    const startTime = document.timeline.currentTime;
    const { total } = plan;
    const samples = [];
    for (let ms = 0; ms < total; ms += SAMPLE_MS) {
      samples.push(ms);
    }
    samples.push(total);
    const layerKeys = samples.map((ms) => ({
      offset: ms / total,
      transform: chainTransform(
        stage.geometry,
        plan.poseAt(ms, poses),
        plan.foldAt(ms),
        { functions: true },
      ),
    }));
    // the 3d desk blurs with the open share eased by smoothstep (scene/loop.js)
    const deskKeys = samples.map((ms) => ({
      offset: ms / total,
      opacity: String(smoothstep(1 - plan.foldAt(ms))),
    }));
    const timing = { duration: total, fill: "forwards" };
    const main = stage.layers.frames.animate(layerKeys, timing);
    animations.push(
      main,
      stage.layers.screens.animate(layerKeys, timing),
      desk.blurLayer.animate(deskKeys, timing),
    );
    stage.frameLayer.hide();
    // the intro shows each frame by animating its visibility, so they stay in the layout while it plays
    stage.layers.frames.classList.remove("lean");
    const { elements } = stage.frameLayer;
    plan.frames.forEach(({ index, start: from, end }, i) => {
      const last = i === plan.frames.length - 1;
      animations.push(
        elements[index].animate(
          [{ visibility: "visible" }, { visibility: "visible" }],
          {
            delay: from,
            duration: end - from,
            fill: last ? "forwards" : "none",
          },
        ),
      );
    });
    faceTracks(plan, manifest, screens).forEach(([el, keys]) => {
      animations.push(el.animate(keys, timing));
    });
    const marker = new Animation(
      new KeyframeEffect(null, null, { duration: plan.unlockAt }),
      document.timeline,
    );
    animations.push(marker);
    // one start time for all of them, so the frames, the screens, and the move can't drift apart
    animations.forEach((animation) => {
      animation.startTime = startTime;
    });
    marker.finished.then(resolveUnlocked, () => {});
    main.finished.then(
      () => stop("done"),
      () => {},
    );
  };

  return {
    plan,
    start,
    finish: () => stop("done"),
    cancel: () => stop("cancelled"),
    // ms into the intro, for a motion that takes over from where it is
    elapsed: () => Number(animations[0]?.currentTime ?? 0),
    finished,
    unlocked,
  };
};
