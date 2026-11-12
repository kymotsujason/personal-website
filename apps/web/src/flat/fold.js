// closing and opening the 2d phone, as scene/fold.js does it: Escape and Enter play the fold on their own, and a swipe
// from the border drives it directly, following the flap's edge under the pointer through the manifest's drag table,
// then finishes or springs back on release. the loop draws whatever these leave in the scene's pose, fold, and lead
import {
  CATCH_UP,
  FOLD_TIME,
  LEAD,
  ease,
  foldPoseAt,
} from "../scene/shared/motion.js";

// how far through the fold to be once the pointer has moved d px along the swipe (fold.js progressAt), with d in the
// table's own px
export const progressAt = (table, d) => {
  if (d <= 0) {
    return 0;
  }
  const k = Math.floor(d);
  if (k >= table.length - 1) {
    return 1;
  }
  return table[k] + (table[k + 1] - table[k]) * (d - k);
};

// the drag's progress through the fold and its travel (its share of the swipe's span) once the pointer has moved
// along px in the window. the table and its span are in the capture's px at the set's scale, so the pointer's travel is
// divided by how many window px one frame px covers. the grabbed edge keeps the offset from the pointer it had on the
// press, and the few px the pointer moved before the swipe took hold are made up over the next CATCH_UP px
export const dragAt = ({ drag, along, lead = 0, scale = 1 }) => {
  const shown = along - lead * Math.max(0, 1 - (along - lead) / CATCH_UP);
  const d = shown / scale;
  return {
    progress: progressAt(drag.table, d),
    travel: Math.min(Math.max(d / drag.span, 0), 1),
  };
};

// a flick finishes from anywhere, otherwise it goes to whichever end the edge is closer to on screen. a cancelled
// swipe springs back. speed is in window px per ms along the swipe
export const releaseOf = ({ type, speed, travel, progress, action }) => {
  const finish =
    type === "pointerup" && (speed > 0.4 || (travel > 0.5 && speed > -0.4));
  const remaining = finish ? 1 - progress : progress;
  const time = Math.max(
    180,
    (action === "close" ? FOLD_TIME.close : FOLD_TIME.open) * remaining,
  );
  return { finish, time };
};

// portrait's hands take the opening or the closing path, picked as the fold leaves either end, so a fold turned back
// partway keeps the path it started on instead of jumping to the other (scene/loop.js)
export const pathAfter = ({ path, lastFold, fold }) => {
  if (fold === lastFold || (lastFold > 0.001 && lastFold < 0.999)) {
    return path;
  }
  return fold < lastFold ? "open" : "close";
};

// a swipe starts on the border on one side, widened both ways since the border alone is only about 10 px: a little
// onto the screen's edge, and further out past the body's edge. landscape closes from the left side and opens from the
// right, portrait closes from the top and opens from the bottom. edges are the phone's outer bounds and its screen's
// in window px
const BORDER_OUTSIDE = 36;
const BORDER_INSIDE = 20;
export const gestureFor = ({ edges, x, y, phone, portrait }) => {
  const { outer, inner } = edges;
  const alongY = y >= outer.top && y <= outer.bottom;
  const alongX = x >= outer.left && x <= outer.right;
  if (phone === "open") {
    if (
      !portrait &&
      alongY &&
      x <= inner.left + BORDER_INSIDE &&
      x >= outer.left - BORDER_OUTSIDE
    ) {
      return { action: "close", axis: "x", sign: 1 };
    }
    if (
      portrait &&
      alongX &&
      y <= inner.top + BORDER_INSIDE &&
      y >= outer.top - BORDER_OUTSIDE
    ) {
      return { action: "close", axis: "y", sign: 1 };
    }
    return null;
  }
  if (
    !portrait &&
    alongY &&
    x >= inner.right - BORDER_INSIDE &&
    x <= outer.right + BORDER_OUTSIDE
  ) {
    return { action: "open", axis: "x", sign: -1 };
  }
  if (
    portrait &&
    alongX &&
    y >= inner.bottom - BORDER_INSIDE &&
    y <= outer.bottom + BORDER_OUTSIDE
  ) {
    return { action: "open", axis: "y", sign: -1 };
  }
  return null;
};

// a drag ate this press, so the release mustn't also count as a tap on an icon or a button. a drag doesn't always
// produce a click, so the blocker expires instead of waiting to eat the next real tap
export const blockNextClick = () => {
  const blockClick = (event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  addEventListener("click", blockClick, { capture: true, once: true });
  setTimeout(
    () => removeEventListener("click", blockClick, { capture: true }),
    300,
  );
};

// scene holds the phone's state, which the loop draws: pose, fold, lead, path, phone ("open" or "closed"), busy,
// zoomed, portrait, and placed (the poses for this window), with reduced(), edges() (the phone's bounds in window px),
// dragScale() (window px per frame px), drag (the manifest's dragTable), takeOver() (stops an intro still playing,
// where it is), and wake() (one more frame). loop is the scene's loop
export const createFolds = ({ scene, loop }) => {
  const closedPose = () => ({ ...scene.placed.stage });
  const openPose = () => ({ ...scene.placed.rest });

  const setFoldProgress = (g, p) => {
    const next = foldPoseAt(g.from, g.to, g.foldFrom, g.foldTo, p, g.action);
    const { fold, ...pose } = next;
    scene.pose = pose;
    scene.fold = fold;
  };

  // carries a fold from progress p0 to p1, for the keys and for finishing or undoing a swipe
  const runFold = (g, p0, p1, duration, easing) =>
    loop.tween({
      duration,
      group: "fold",
      onUpdate: (_, t) => setFoldProgress(g, p0 + (p1 - p0) * easing(t)),
    });

  // what has to happen before the fold can move: an intro still playing its last stretch stops where it is
  const prepare = () => {
    scene.takeOver();
    loop.cancelGroup("intro");
  };

  // one lead at a time, so a lead back left over from a press can't outlast an open's lead and pull the thumbs back
  const leadTo = (to, delay = 0, time = LEAD.time) => {
    loop.cancelGroup("lead");
    const from = scene.lead;
    return loop.tween({
      duration: time * Math.abs(to - from),
      delay,
      group: "lead",
      onUpdate: (_, t) => {
        scene.lead = from + (to - from) * ease.inOutSine(t);
      },
    });
  };

  // opening in portrait, the thumbs go ahead along the opening path before the fold moves (scene/device.js)
  const leadOpen = (delay = 0, time = LEAD.time) => {
    if (!scene.portrait) {
      return Promise.resolve("done");
    }
    scene.path = "open";
    return leadTo(1, delay, time);
  };

  // a charger run holds a fold pressed during it until it ends, about 2.7 s, or up to 3.5 s (SWAP_CAP in charger.js)
  // while a slow fold set decode lands the cable. with none going, the fold starts in the same task, as it always has
  const afterCharger = async () => {
    while (scene.charger?.busy()) {
      await scene.charger.idle();
    }
  };

  // gives back "done" once the phone is shut, "cancelled" when something took over first, or nothing when it
  // couldn't start
  const closePhone = async () => {
    if (scene.charger?.busy()) {
      await afterCharger();
    }
    if (scene.busy || scene.zoomed || scene.phone !== "open") {
      return;
    }
    scene.busy = true;
    prepare();
    // with reduced motion the phone is shut at once, with no fold to watch
    if (scene.reduced()) {
      scene.pose = closedPose();
      scene.fold = 1;
      scene.phone = "closed";
      scene.busy = false;
      scene.wake();
      return "done";
    }
    const g = {
      action: "close",
      from: { ...scene.pose },
      to: closedPose(),
      foldFrom: scene.fold,
      foldTo: 1,
    };
    if (
      (await runFold(g, 0, 1, FOLD_TIME.close, ease.inOutSine)) === "cancelled"
    ) {
      return "cancelled";
    }
    scene.phone = "closed";
    scene.busy = false;
    scene.wake();
    return "done";
  };

  // gives back "done" once the phone is open, "cancelled" when something took over first, or nothing when it
  // couldn't start
  const openPhone = async () => {
    if (scene.charger?.busy()) {
      await afterCharger();
    }
    if (scene.busy || scene.phone !== "closed") {
      return;
    }
    scene.busy = true;
    scene.lookAhead?.();
    // with reduced motion the phone is open at once, and the hands don't go ahead of an unfold that isn't played
    if (scene.reduced()) {
      scene.pose = openPose();
      scene.fold = 0;
      scene.phone = "open";
      scene.busy = false;
      scene.wake();
      return "done";
    }
    if ((await leadOpen()) === "cancelled") {
      return "cancelled";
    }
    const g = {
      action: "open",
      from: { ...scene.pose },
      to: openPose(),
      foldFrom: scene.fold,
      foldTo: 0,
    };
    if (
      (await runFold(g, 0, 1, FOLD_TIME.open, ease.inOutSine)) === "cancelled"
    ) {
      return "cancelled";
    }
    scene.phone = "open";
    scene.busy = false;
    scene.wake();
    return "done";
  };

  let gesture = null;

  // a press on the open border sends the thumbs ahead, so a press that never becomes a swipe sends them back. an open
  // a key or a tap started since then has the lead now, and keeps it
  const leadBack = (g) => {
    if (g.action === "open" && !scene.busy && scene.phone === "closed") {
      leadTo(0);
    }
  };

  // a resize drops a swipe in progress, since its poses and its scale were measured on the window it replaced. the
  // release still eats its click
  const dropGesture = () => {
    if (gesture) {
      gesture.dropped = true;
    }
  };

  const onDown = (event) => {
    // no swipes while an app is open, so they can't get in the way of the app's own scrolling and dragging, and none
    // while the charger holds the folds
    if (
      scene.busy ||
      scene.charger?.busy() ||
      scene.zoomed ||
      gesture ||
      !scene.unlocked ||
      (scene.phone !== "open" && scene.phone !== "closed")
    ) {
      return;
    }
    const found = gestureFor({
      edges: scene.edges(),
      x: event.clientX,
      y: event.clientY,
      phone: scene.phone,
      portrait: scene.portrait,
    });
    if (!found) {
      return;
    }
    gesture = {
      ...found,
      id: event.pointerId,
      phone: scene.phone,
      x0: event.clientX,
      y0: event.clientY,
      armed: false,
      progress: 0,
      travel: 0,
      lastT: performance.now(),
      lastD: 0,
      speed: 0,
    };
    // the thumbs get ready on the press, before the drag moves the fold
    if (found.action === "open") {
      leadOpen();
    }
  };

  const onMove = (event) => {
    if (!gesture || event.pointerId !== gesture.id || gesture.dropped) {
      return;
    }
    const g = gesture;
    const along =
      (g.axis === "x" ? event.clientX - g.x0 : event.clientY - g.y0) * g.sign;
    const across = Math.abs(
      g.axis === "x" ? event.clientY - g.y0 : event.clientX - g.x0,
    );
    if (!g.armed) {
      // it only becomes a fold once the finger clearly moves the right way, so taps still work
      if (across > 14 && across > along) {
        leadBack(g);
        gesture = null;
        return;
      }
      if (along < 10) {
        return;
      }
      // a key or a navigation moved the phone since the press, and the swipe would fight that move
      if (
        scene.busy ||
        scene.zoomed ||
        scene.charger?.busy() ||
        scene.phone !== g.phone
      ) {
        leadBack(g);
        gesture = null;
        return;
      }
      g.armed = true;
      scene.busy = true;
      prepare();
      g.lead = along;
      g.from = { ...scene.pose };
      g.to = g.action === "close" ? closedPose() : openPose();
      if (g.action === "open") {
        scene.lookAhead?.();
      }
      g.foldFrom = scene.fold;
      g.foldTo = g.action === "close" ? 1 : 0;
      g.drag = scene.drag[g.action];
      g.scale = scene.dragScale();
    }
    const now = performance.now();
    g.speed = (along - g.lastD) / Math.max(now - g.lastT, 1);
    g.lastD = along;
    g.lastT = now;
    const { progress, travel } = dragAt({
      drag: g.drag,
      along,
      lead: g.lead,
      scale: g.scale,
    });
    g.progress = progress;
    g.travel = travel;
    setFoldProgress(g, progress);
    scene.wake();
    event.preventDefault();
  };

  const onEnd = async (event) => {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }
    const g = gesture;
    gesture = null;
    if (g.dropped) {
      if (g.armed) {
        blockNextClick();
      }
      return;
    }
    if (!g.armed) {
      leadBack(g);
      return;
    }
    blockNextClick();
    const { finish, time } = releaseOf({
      type: event.type,
      speed: g.speed,
      travel: g.travel,
      progress: g.progress,
      action: g.action,
    });
    // with reduced motion only the drag itself moves the fold, and the release lands on its end at once
    if (scene.reduced()) {
      setFoldProgress(g, finish ? 1 : 0);
      scene.wake();
    } else if (
      (await runFold(g, g.progress, finish ? 1 : 0, time, ease.outCubic)) ===
      "cancelled"
    ) {
      return;
    }
    const endsClosed = (g.action === "close") === finish;
    if (endsClosed && g.action === "open") {
      leadTo(0);
    }
    scene.phone = endsClosed ? "closed" : "open";
    scene.busy = false;
    scene.wake();
  };

  // escape and enter, the way scene/fold.js has them. onEscapeApp takes escape while an app is open
  const onKey = (event, onEscapeApp) => {
    if (!scene.unlocked) {
      return undefined;
    }
    if (event.key === "Escape") {
      if (scene.zoomed) {
        onEscapeApp();
      } else {
        return closePhone();
      }
    } else if (
      event.key === "Enter" &&
      !event.target?.closest?.("a, button, input, [role=button], [role=slider]")
    ) {
      // on a button or link, Enter is that element's own activation, such as a cover icon opening its app
      return openPhone();
    }
  };

  // the listeners, all on the window and removed with signal. guard wraps each so a throw fails the scene
  const install = ({ signal, guard, onEscapeApp }) => {
    addEventListener("pointerdown", guard(onDown), { capture: true, signal });
    addEventListener("pointermove", guard(onMove), {
      capture: true,
      passive: false,
      signal,
    });
    // a held swipe on a touch screen would otherwise scroll the page underneath
    addEventListener(
      "touchmove",
      guard((event) => {
        if (gesture && gesture.armed) {
          event.preventDefault();
        }
      }),
      { passive: false, signal },
    );
    addEventListener("pointerup", guard(onEnd), { capture: true, signal });
    addEventListener("pointercancel", guard(onEnd), { capture: true, signal });
    addEventListener(
      "keydown",
      guard((event) => onKey(event, onEscapeApp)),
      { signal },
    );
  };

  return {
    closePhone,
    openPhone,
    leadOpen,
    leadTo,
    dropGesture,
    install,
    gesture: () => gesture,
  };
};
