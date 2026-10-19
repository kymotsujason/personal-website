import * as THREE from "three";
import { state, pose, DUO } from "./state.js";
import { tween, ease, cancelGroup } from "./tween.js";
import { camera, backdrop } from "./renderer.js";
import { centerComp, setFold, leadOpen, leadTo } from "./device.js";
import { closeApp } from "./appWindow.js";
import { requestHome } from "./navigation.js";
import { idleDrift } from "./loop.js";
import { signal, guard, failScene } from "./lifetime.js";
import { reducedMotion } from "./quality.js";

// closing and opening the phone. a swipe drives the fold directly (the hands follow the fold), and on release it
// finishes or springs back. keys play the same motion on their own
const FOLD_TIME = { close: 900, open: 1000 };
// what has to happen before the fold can move
const prepareClose = () => {
    cancelGroup("intro");
    pose.blur = 0;
};

const closedPose = () => ({ ...state.poses.stage, idle: 0 });
const openPose = () => ({ ...state.poses.rest, idle: 0 });

const POSE_FIELDS = ["x", "y", "z", "rx", "ry", "rz"];

// one progress value drives both the distance and the fold. closing backs away early and folds late, opening unfolds
// early and moves in late, so the flap never swings up into the camera while the phone is still close
const foldPoseAt = (from, to, foldFrom, foldTo, p, action) => {
    const move = action === "close" ? 1 - Math.pow(1 - p, 2.2) : Math.pow(p, 2.2);
    const fold = action === "close" ? Math.pow(p, 1.6) : 1 - Math.pow(1 - p, 1.6);
    const out = { fold: foldFrom + (foldTo - foldFrom) * fold };
    POSE_FIELDS.forEach((k) => {
        out[k] = from[k] + (to[k] - from[k]) * move;
    });
    return out;
};

const setFoldProgress = (from, to, foldFrom, foldTo, p, action) => {
    Object.assign(pose, foldPoseAt(from, to, foldFrom, foldTo, p, action));
};

// where the flap's outer edge lands on screen (along the swipe's axis) through a fold. that edge is the part a swipe
// grabs, open or closed, so the swipe moves the fold to keep it under the pointer. the scene is posed here only to
// measure, and put back after
const FOLD_SAMPLES = 480;
// the most any corner of the phone may move on screen for each px the pointer moves
const MAX_FOLLOW = 2.5;
const CATCH_UP = 80;
const foldTable = (g) => {
    const root = state.root;
    const v = new THREE.Vector3();
    const position = root.position.clone();
    const rotation = root.rotation.clone();
    const toScreen = () => {
        v.project(camera);
        return [(v.x + 1) * 0.5 * innerWidth, (1 - v.y) * 0.5 * innerHeight];
    };
    const edge = [];
    const corners = [];
    for (let i = 0; i <= FOLD_SAMPLES; i++) {
        const p = foldPoseAt(g.from, g.to, g.foldFrom, g.foldTo, i / FOLD_SAMPLES, g.action);
        root.position.set(p.x, p.y + centerComp(p.fold), p.z);
        root.rotation.set(p.rx, p.ry, p.rz);
        setFold(p.fold);
        root.updateMatrixWorld(true);
        v.set(-DUO.halfW, 0, 0).applyMatrix4(state.flap.matrixWorld);
        const e = toScreen();
        edge.push(g.axis === "x" ? e[0] : e[1]);
        corners.push([[-DUO.halfW, state.flap], [DUO.halfW, state.body]].flatMap(([x, frame]) => [-1, 1].map((sy) => {
            v.set(x, (sy * DUO.bodyH) / 2, 0).applyMatrix4(frame.matrixWorld);
            return toScreen();
        })));
    }
    root.position.copy(position);
    root.rotation.copy(rotation);
    setFold(pose.fold);
    root.updateMatrixWorld(true);

    // for each px the pointer has moved, how far through the fold to be. the fold advances while the edge is behind the
    // pointer, but never moves the phone more than MAX_FOLLOW px per pointer px. early in a fold the flap lifts toward
    // the camera and its edge swings outward, against the swipe, so there the edge can't follow and the fold just
    // moves at that capped pace until the edge comes across and meets the pointer
    const ahead = edge.map((x) => (x - edge[0]) * g.sign);
    const moved = (a, b) => Math.max(...corners[a].map((c, k) => Math.hypot(c[0] - corners[b][k][0], c[1] - corners[b][k][1])));
    const span = Math.max(...ahead);
    const table = [0];
    let i = 0;
    for (let k = 1; i < FOLD_SAMPLES; k++) {
        const from = i;
        while (i < FOLD_SAMPLES && ahead[i] < k && moved(from, i + 1) <= MAX_FOLLOW) {
            i++;
        }
        // a single sample step bigger than the cap still has to be taken, or the fold would stop there
        if (i === from && ahead[i] < k) {
            i++;
        }
        table.push(i / FOLD_SAMPLES);
    }
    return { table, span };
};

// how far through the fold to be once the pointer has moved d px along the swipe
const progressAt = (table, d) => {
    if (d <= 0) {
        return 0;
    }
    const k = Math.floor(d);
    if (k >= table.length - 1) {
        return 1;
    }
    return table[k] + (table[k + 1] - table[k]) * (d - k);
};

// carries a fold from progress p0 to p1, for the keys and for finishing or undoing a swipe
const runFold = (g, p0, p1, duration, easing) => tween({
    to: {}, duration, easing: (t) => t,
    onUpdate: (t) => setFoldProgress(g.from, g.to, g.foldFrom, g.foldTo, p0 + (p1 - p0) * easing(t), g.action)
});

// stops the idle drift where it is, by moving the pose to where the drift had it, so a fold starts without a jump
const settleIdle = () => {
    cancelGroup("idle");
    const drift = idleDrift(performance.now() / 1000, pose.idle);
    pose.x += drift.x;
    pose.y += drift.y;
    pose.z += drift.z;
    pose.idle = 0;
};

// eases the drift back in from still, instead of switching it on in one frame
export const resumeIdle = () => {
    tween({ to: { idle: 1 }, duration: 900, easing: ease.inOutSine, group: "idle" });
};

const finishOpen = () => {
    resumeIdle();
    state.phone = "open";
};

// gives back "done" once the phone is shut, "cancelled" when a rebuild or an intro took over first, or nothing
// when it couldn't start
export const closePhone = async () => {
    if (state.busy || state.zoomed || state.phone !== "open") {
        return;
    }
    state.busy = true;
    prepareClose();
    settleIdle();
    // with reduced motion the phone is shut at once, with no fold to watch
    if (reducedMotion.matches) {
        Object.assign(pose, closedPose(), { fold: 1 });
        resumeIdle();
        state.phone = "closed";
        state.busy = false;
        return "done";
    }
    const g = { action: "close", from: { ...pose }, to: closedPose(), foldFrom: pose.fold, foldTo: 1 };
    if ((await runFold(g, 0, 1, FOLD_TIME.close, ease.inOutSine)) === "cancelled") {
        return "cancelled";
    }
    resumeIdle();
    state.phone = "closed";
    state.busy = false;
    return "done";
};

// gives back "done" once the phone is open, "cancelled" when a rebuild or an intro took over first, or nothing
// when it couldn't start
export const openPhone = async () => {
    if (state.busy || state.phone !== "closed") {
        return;
    }
    state.busy = true;
    settleIdle();
    backdrop.lookAhead();
    // with reduced motion the phone is open at once, and the hands don't go ahead of an unfold that isn't played
    if (reducedMotion.matches) {
        Object.assign(pose, openPose(), { fold: 0 });
        finishOpen();
        state.busy = false;
        return "done";
    }
    if ((await leadOpen()) === "cancelled") {
        return "cancelled";
    }
    const g = { action: "open", from: { ...pose }, to: openPose(), foldFrom: pose.fold, foldTo: 0 };
    if ((await runFold(g, 0, 1, FOLD_TIME.open, ease.inOutSine)) === "cancelled") {
        return "cancelled";
    }
    finishOpen();
    state.busy = false;
    return "done";
};

// screen px bounds of points given in a part's own frame
const projectBounds = (points) => {
    const px = points.map(([v, frame]) => {
        const n = v.clone().applyMatrix4(frame.matrixWorld).project(camera);
        return [(n.x + 1) * 0.5 * innerWidth, (1 - n.y) * 0.5 * innerHeight];
    });
    const xs = px.map((p) => p[0]);
    const ys = px.map((p) => p[1]);
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
};

// the phone's outer edge and its screen's edge in the window. the strip between them is the border a swipe has to
// start on. closed, the screen is the cover screen, centered on the slab
export const phoneEdges = () => {
    state.root.updateMatrixWorld(true);
    const { halfW, bodyH, coverW, coverH } = DUO;
    const corner = (x, y, frame) => [new THREE.Vector3(x, y, 0), frame];
    if (state.phone === "open") {
        return {
            outer: projectBounds([corner(-halfW, -bodyH / 2, state.flap), corner(-halfW, bodyH / 2, state.flap), corner(halfW, -bodyH / 2, state.body), corner(halfW, bodyH / 2, state.body)]),
            inner: projectBounds(state.surfaces.home.corners.map((c) => [c, state.body]))
        };
    }
    const inset = (halfW - coverW) / 2;
    return {
        outer: projectBounds([corner(0, -bodyH / 2, state.body), corner(0, bodyH / 2, state.body), corner(halfW, -bodyH / 2, state.body), corner(halfW, bodyH / 2, state.body)]),
        inner: projectBounds([corner(inset, -coverH / 2, state.body), corner(inset, coverH / 2, state.body), corner(halfW - inset, -coverH / 2, state.body), corner(halfW - inset, coverH / 2, state.body)])
    };
};

// a swipe starts on the border on one side, widened both ways since the border alone is only about 10 px: a little
// onto the screen's edge, and further out past the body's edge. landscape closes from the left side and opens from
// the right, portrait closes from the top and opens from the bottom
const BORDER_OUTSIDE = 36;
const BORDER_INSIDE = 20;
export const gestureFor = (x, y) => {
    const { outer, inner } = phoneEdges();
    const alongY = y >= outer.top && y <= outer.bottom;
    const alongX = x >= outer.left && x <= outer.right;
    if (state.phone === "open") {
        if (!state.portrait && alongY && x <= inner.left + BORDER_INSIDE && x >= outer.left - BORDER_OUTSIDE) {
            return { action: "close", axis: "x", sign: 1 };
        }
        if (state.portrait && alongX && y <= inner.top + BORDER_INSIDE && y >= outer.top - BORDER_OUTSIDE) {
            return { action: "close", axis: "y", sign: 1 };
        }
        return null;
    }
    if (!state.portrait && alongY && x >= inner.right - BORDER_INSIDE && x <= outer.right + BORDER_OUTSIDE) {
        return { action: "open", axis: "x", sign: -1 };
    }
    if (state.portrait && alongX && y >= inner.bottom - BORDER_INSIDE && y <= outer.bottom + BORDER_OUTSIDE) {
        return { action: "open", axis: "y", sign: -1 };
    }
    return null;
};

export let gesture = null;

// a press on the open border sends the thumbs ahead, so a press that never becomes a swipe sends them back. an open a
// key or a tap started since then has the lead now, and keeps it
const leadBack = (g) => {
    if (g.action === "open" && !state.busy && state.phone === "closed") {
        leadTo(0);
    }
};

// a rebuild drops a swipe in progress, since its poses and its fold table were measured on the phone it replaced. the
// release still eats its click
export const dropGesture = () => {
    if (gesture) {
        gesture.dropped = true;
    }
};

// a drag ate this press, so the release mustn't also count as a tap on an icon or a button. a drag doesn't always
// produce a click, so the blocker expires instead of waiting to eat the next real tap
export const blockNextClick = () => {
    const blockClick = (e) => {
        e.stopPropagation();
        e.preventDefault();
    };
    addEventListener("click", blockClick, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", blockClick, { capture: true }), 300);
};

// a press on a volume button steps the music's volume, and nothing else gets it (no swipe, no dragging the view, no
// click on what's under it). registered before those, so it's first
const volumeRay = new THREE.Raycaster();
const rayAt = (event) => {
    volumeRay.setFromCamera(new THREE.Vector2((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1), camera);
    return volumeRay;
};

export const installGestures = () => {
    addEventListener("pointerdown", guard((event) => {
        if (!state.volume || state.zoomed || !document.body.classList.contains("ready")) {
            return;
        }
        if (state.volume.tryPress(rayAt(event), performance.now())) {
            event.stopImmediatePropagation();
            event.preventDefault();
            blockNextClick();
        }
    }), { capture: true, signal });
    addEventListener("pointermove", guard((event) => {
        if (event.pointerType !== "mouse" || !state.volume || state.zoomed) {
            return;
        }
        const over = state.volume.isOver(rayAt(event));
        if (over !== document.body.classList.contains("over-volume")) {
            document.body.classList.toggle("over-volume", over);
        }
    }), { signal });

    addEventListener("pointerdown", guard((event) => {
        // no swipes while an app is open, so they can't get in the way of the app's own scrolling and dragging
        if (state.busy || state.zoomed || gesture || (state.phone !== "open" && state.phone !== "closed")) {
            return;
        }
        const found = gestureFor(event.clientX, event.clientY);
        if (!found) {
            return;
        }
        gesture = { ...found, id: event.pointerId, phone: state.phone, x0: event.clientX, y0: event.clientY, armed: false, progress: 0, travel: 0, lastT: performance.now(), lastD: 0, speed: 0 };
        // the thumbs get ready on the press, before the drag moves the fold
        if (found.action === "open") {
            leadOpen();
        }
    }), { capture: true, signal });

    addEventListener("pointermove", guard((event) => {
        if (!gesture || event.pointerId !== gesture.id || gesture.dropped) {
            return;
        }
        const along = (gesture.axis === "x" ? event.clientX - gesture.x0 : event.clientY - gesture.y0) * gesture.sign;
        const across = Math.abs(gesture.axis === "x" ? event.clientY - gesture.y0 : event.clientX - gesture.x0);
        if (!gesture.armed) {
            // it only becomes a fold once the finger clearly moves the right way, so taps still work
            if (across > 14 && across > along) {
                leadBack(gesture);
                gesture = null;
                return;
            }
            if (along < 10) {
                return;
            }
            // a key or a navigation moved the phone since the press, and the swipe would fight that move
            if (state.busy || state.zoomed || state.phone !== gesture.phone) {
                leadBack(gesture);
                gesture = null;
                return;
            }
            gesture.armed = true;
            state.busy = true;
            if (gesture.action === "close") {
                prepareClose();
            }
            settleIdle();
            gesture.lead = along;
            gesture.from = { ...pose };
            gesture.to = gesture.action === "close" ? closedPose() : openPose();
            if (gesture.action === "open") {
                backdrop.lookAhead();
            }
            gesture.foldFrom = pose.fold;
            gesture.foldTo = gesture.action === "close" ? 1 : 0;
            Object.assign(gesture, foldTable(gesture));
        }
        const now = performance.now();
        gesture.speed = (along - gesture.lastD) / Math.max(now - gesture.lastT, 1);
        gesture.lastD = along;
        gesture.lastT = now;
        // the grabbed edge keeps the offset from the pointer it had on the press. the few px the pointer moved before the
        // swipe took hold are made up over the next stretch of the drag, not in one jump
        const shown = along - gesture.lead * Math.max(0, 1 - (along - gesture.lead) / CATCH_UP);
        gesture.progress = progressAt(gesture.table, shown);
        gesture.travel = THREE.MathUtils.clamp(shown / gesture.span, 0, 1);
        setFoldProgress(gesture.from, gesture.to, gesture.foldFrom, gesture.foldTo, gesture.progress, gesture.action);
        event.preventDefault();
    }), { capture: true, passive: false, signal });

    // a held swipe on a touch screen would otherwise scroll the page underneath
    addEventListener("touchmove", guard((event) => {
        if (gesture && gesture.armed) {
            event.preventDefault();
        }
    }), { passive: false, signal });

    addEventListener("pointerup", endGesture, { capture: true, signal });
    addEventListener("pointercancel", endGesture, { capture: true, signal });
};

export const endGesture = guard(async (event) => {
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
    // a flick finishes from anywhere, otherwise it goes to whichever end the edge is closer to on screen. a cancelled
    // swipe springs back, as the home bar's does
    const finish = event.type === "pointerup" && (g.speed > 0.4 || (g.travel > 0.5 && g.speed > -0.4));
    const remaining = finish ? 1 - g.progress : g.progress;
    const time = Math.max(180, (g.action === "close" ? FOLD_TIME.close : FOLD_TIME.open) * remaining);
    if ((await runFold(g, g.progress, finish ? 1 : 0, time, ease.outCubic)) === "cancelled") {
        return;
    }
    const endsClosed = (g.action === "close") === finish;
    if (endsClosed) {
        if (g.action === "open") {
            leadTo(0);
        }
        resumeIdle();
        state.phone = "closed";
    } else {
        finishOpen();
    }
    state.busy = false;
});

export const installKeys = () => {
    addEventListener("keydown", guard((event) => {
        if (event.key === "Escape") {
            // escape goes home the way the home bar does, Back when that leads home
            if (state.zoomed) {
                if (!requestHome()) {
                    closeApp().catch(failScene);
                }
            } else {
                closePhone().catch(failScene);
            }
        } else if (event.key === "Enter" && !event.target.closest?.("a, button, input, [role=button], [role=slider]")) {
            // on a button or link, Enter is that element's own activation, such as a cover icon opening its app
            openPhone().catch(failScene);
        }
    }), { signal });
};
