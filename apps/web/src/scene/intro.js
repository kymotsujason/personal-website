import * as THREE from "three";
import { state, pose, DUO, TAP_FOLD } from "./state.js";
import { tween, ease, cancelAll } from "./tween.js";
import { camera, backdrop } from "./renderer.js";
import { centerComp, setFold, leadOpen, LEAD, loadVolume } from "./device.js";
import { siteData, dropScrub } from "./home.js";
import { pageEl, openApp, hideFlat, resetAppWindow, setAppVisible, dropHomeSwipe } from "./appWindow.js";
import { resumeIdle, dropGesture } from "./fold.js";
import { read, write } from "../lib/storage.js";
import { failScene } from "./lifetime.js";
import { reducedMotion } from "./quality.js";
import { shown } from "./loop.js";

const POSE_KEYS = ["x", "y", "z", "rx", "ry", "rz"];
// ms into the fast intro when the phone starts to unfold. in portrait the hands get under the edge first
const FAST_FOLD_AT = { landscape: 0, portrait: 100 };

// each part of the move eases out on its own clock: the rise slows gradually and carries a little climb into the
// opening, the approach overlaps the unfold, and the tilt squares up as it's taken out. nothing turns a corner, so
// nothing reads as a stop between coming into view and opening
export const MOVE = {
    rise: { keys: ["x", "y"], time: 1500, power: 4.5 },
    approach: { keys: ["z"], time: 2100, power: 2.5 },
    turn: { keys: ["rx", "ry", "rz"], time: 1100, power: 3 }
};
export const moveTotal = () => Math.max(...Object.values(MOVE).map((m) => m.time));

export const moveAt = (ms, start, rest) => {
    const out = {};
    Object.values(MOVE).forEach(({ keys, time, power }) => {
        const u = 1 - Math.pow(1 - THREE.MathUtils.clamp(ms / time, 0, 1), power);
        keys.forEach((k) => {
            out[k] = start[k] + (rest[k] - start[k]) * u;
        });
    });
    return out;
};

// the first moment the closed device is fully in the window with room below it, so the unfold starts right then
export const foldStartTime = (start, rest) => {
    const saved = { position: state.root.position.clone(), rotation: state.root.rotation.clone() };
    let found = moveTotal();
    for (let ms = 200; ms <= moveTotal(); ms += 25) {
        const p = moveAt(ms, start, rest);
        state.root.position.set(p.x, p.y + centerComp(1), p.z);
        state.root.rotation.set(p.rx, p.ry, p.rz);
        setFold(1);
        state.root.updateMatrixWorld(true);
        const corners = [[0, -1], [DUO.halfW, -1], [0, 1], [DUO.halfW, 1]].map(([x, sign]) => new THREE.Vector3(x, (sign * DUO.bodyH) / 2, 0).applyMatrix4(state.body.matrixWorld).project(camera));
        const bottom = (Math.min(...corners.map((v) => v.y)) + 1) / 2;
        const inside = corners.every((v) => Math.abs(v.x) <= 0.98 && v.y <= 0.98);
        if (inside && bottom >= 0.04) {
            found = ms;
            break;
        }
    }
    state.root.position.copy(saved.position);
    state.root.rotation.copy(saved.rotation);
    setFold(pose.fold);
    state.root.updateMatrixWorld(true);
    return found;
};

// the capture build's failure tests make the intro throw once the page has faded in (see capture.js)
let introHook = null;
export const setIntroHook = (fn) => {
    introHook = fn;
};

let introRun = 0;
// the start pose of an intro waiting for the page to fade in, which a rebuild places again (see holdIntro)
let waiting = null;
const runIntro = async (fast) => {
    const run = ++introRun;
    cancelAll();
    hideFlat();
    resetAppWindow();
    state.zoomed = false;
    setAppVisible(false);
    const placeStart = () => {
        const start = fast ? state.poses.fastStart : state.poses.fullStart;
        Object.assign(pose, start, { blur: fast ? 10 : 18, idle: 0, fold: 1 });
        state.lead = 0;
        state.busy = true;
    };
    placeStart();
    waiting = placeStart;
    // the page fades in from black once the desk has drawn, which can be a while after the models load, so the intro
    // waits for it and plays as the page appears. an intro started again since then takes over, and anything that
    // moved the phone while it was black is put back
    await shown;
    if (run !== introRun) {
        return;
    }
    waiting = null;
    if (introHook) {
        introHook();
    }
    cancelAll();
    placeStart();
    // the icons take taps once the unfold is in its last stretch and already reads as open. the rest of the settling
    // keeps playing, and opening an app cancels it, snaps the last of the fold flat, and carries on from there
    let unlock;
    const unlocked = new Promise((resolve) => {
        unlock = resolve;
    });
    const unlockNearFlat = () => {
        if (pose.fold < TAP_FOLD) {
            unlock();
        }
    };
    let unfolded;
    if (fast) {
        tween({ to: { ...state.poses.rest, idle: 1 }, duration: 650, easing: ease.outCubic, group: "intro" });
        tween({ to: { blur: 0 }, duration: 450, easing: ease.inOutSine, group: "intro" });
        // the unfold starts as the page fades in, while the phone is still moving into place (low enough in landscape
        // that its bottom edge is cut off for the first few frames), so the two motions run together. the cover swings
        // towards the camera, so its first 20 or so degrees barely change it on screen, and an unfold eased in from a
        // standstill read as a pause after the fade. leaving closed with some speed reads as a soft start instead
        const foldAt = state.portrait ? FAST_FOLD_AT.portrait : FAST_FOLD_AT.landscape;
        leadOpen(Math.max(0, foldAt - LEAD.time), Math.min(LEAD.time, foldAt));
        unfolded = tween({ to: { fold: 0 }, duration: 700, delay: foldAt, easing: ease.outSine, group: "intro", onUpdate: unlockNearFlat });
    } else {
        const total = moveTotal();
        const { fullStart, rest } = state.poses;
        const foldAt = foldStartTime(fullStart, rest);
        tween({
            to: {}, duration: total, easing: (t) => t, group: "intro",
            onUpdate: (t) => {
                Object.assign(pose, moveAt(t * total, fullStart, rest));
                pose.idle = Math.max(0, (t - 0.85) / 0.15);
            }
        });
        tween({ to: { blur: 0 }, duration: 550, delay: 100, easing: ease.inOutSine, group: "intro" });
        leadOpen(Math.max(0, foldAt - LEAD.time));
        unfolded = tween({ to: { fold: 0 }, duration: 1100, delay: foldAt, easing: ease.inOutSine, group: "intro", onUpdate: unlockNearFlat });
    }
    unfolded.then(unlock);
    unfolded.then(() => backdrop.loadRest()).catch(failScene);
    // the volume buttons are a later chunk, loaded once the phone has settled
    unfolded.then(loadVolume).catch(failScene);
    // a rebuild or another intro cancelled this one before it unlocked, and set the state itself
    if ((await unlocked) === "cancelled") {
        return;
    }
    // written once the intro has played, so a first visit cut off partway still gets the full intro next time. that's
    // at the unlock, since an app opening there cancels the last of the unfold
    write("local", "introSeen", "1");
    state.phone = "open";
    state.busy = false;

    const app = appForPage();
    if (app) {
        await openApp(app);
    }
};

// the intro runs on after arrive and the scene's start have returned, so a throw in it fails the scene from here
export const playIntro = (fast) => runIntro(fast).catch(failScene);

// a rebuild while an intro waits for the page to fade in puts the phone back at the intro's start, with the new
// poses, and leaves the rest to the intro, which then opens the address's app. gives back whether one was waiting
export const holdIntro = () => {
    if (!waiting) {
        return false;
    }
    waiting();
    return true;
};

// the app for the page: the one a navigation in flight is going to once its page is known, or else the one #page's
// data-app names, which is the server's answer, so a not found page under an app's path isn't that app. null on the
// home screen
export const appForPage = () => {
    const name = state.pendingPage ?? (pageEl ? pageEl.dataset.app : null);
    return siteData.apps.find((a) => a.name === name) || null;
};

// a swipe or a scrub held from before is dropped where the phone is set at once, since it would go on moving the
// phone or the bar from where it was. its release still eats its click
const dropHeld = () => {
    dropGesture();
    dropHomeSwipe();
    dropScrub();
};

// the phone open and settled at once, and the page's app open on it, instead of the intro. gives back whether there
// was one
export const showFromAddress = (app = appForPage()) => {
    if (!app) {
        return false;
    }
    dropHeld();
    cancelAll();
    hideFlat();
    resetAppWindow();
    state.zoomed = false;
    setAppVisible(false);
    Object.assign(pose, state.poses.rest, { idle: 1, blur: 0, fold: 0 });
    state.busy = false;
    state.phone = "open";
    resumeIdle();
    openApp(app, { instant: true }).catch(failScene);
    return true;
};

// the phone open and settled at once on the home screen, with no app
export const showHome = () => {
    dropHeld();
    cancelAll();
    hideFlat();
    resetAppWindow();
    state.zoomed = false;
    setAppVisible(false);
    Object.assign(pose, state.poses.rest, { idle: 1, blur: 0, fold: 0 });
    state.busy = false;
    state.phone = "open";
    resumeIdle();
};

// the head script picked the arrival (see lib/head.js): "page" shows the address's app at once at full zoom, and
// otherwise the intro plays, full or fast, and opens the address's app after it
export const arrive = () => {
    // with reduced motion the scene fades in with the phone already open, on the page's app or the home screen
    if (reducedMotion.matches) {
        if (!showFromAddress()) {
            showHome();
        }
        loadVolume().catch(failScene);
        return;
    }
    const seen = read("local", "introSeen") === "1";
    const arrival = window.__arrival || (seen ? "fast" : "full");
    if (arrival === "page" && showFromAddress()) {
        loadVolume().catch(failScene);
        return;
    }
    // a page the scene has no app for plays the intro the visit would have had otherwise
    playIntro(arrival === "fast" || (arrival === "page" && seen));
};
