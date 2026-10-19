import * as THREE from "three";
import { unpin } from "./pin.js";
import { glyphRect } from "./screens.js";
import { state, pose, settings } from "./state.js";
import { tween, ease, cancelGroup } from "./tween.js";
import { camera } from "./renderer.js";
import { music } from "./home.js";
import { openPhone, blockNextClick } from "./fold.js";
import { signal, guard, failScene } from "./lifetime.js";
import { reducedMotion } from "./quality.js";
import { requestApp, requestHome } from "./navigation.js";

// the apps' background, ios's dark appearance. flat.css's #page column colors go with it
export const APP_BACKGROUND = "#000000";

// the page's own <main id="page">, which the scene pins onto the app window and never moves or copies
export let pageEl = null;

// the page's home bar goes home on a swipe up (or a click, or enter, for a mouse or a keyboard). it's a link to / for
// the flat site, so in 3d its click is taken over, going Back when that leads home. the page's content is swapped
// under it, so this listens on #page
export const initAppWindow = (page) => {
    pageEl = page;
    pageEl.addEventListener("pointerdown", guard((event) => {
        if (event.target.closest && event.target.closest(".home-bar")) {
            startHomeSwipe(event);
        }
    }), { signal });
    pageEl.addEventListener("click", guard((event) => {
        const bar = event.target.closest && event.target.closest(".home-bar");
        if (!bar || !document.documentElement.classList.contains("has-3d")) {
            return;
        }
        event.preventDefault();
        if (!requestHome()) {
            closeApp().catch(failScene);
        }
    }), { signal });
};

// the layout places youtube's player over the music page's slot while #page shows as the flat page at full zoom, so
// it hears when that starts and stops. the loop calls this each frame
let pageFlatListener = () => {};
let reportedFlat = false;
export const setPageFlatListener = (fn) => {
    pageFlatListener = fn;
};
export const reportPageFlat = () => {
    if (state.pageFlat === reportedFlat) {
        return;
    }
    reportedFlat = state.pageFlat;
    pageFlatListener(reportedFlat);
};

// a tap on an icon or a widget goes to the app's page, and the open follows. the spike ignored taps while the phone
// moved, which still holds except in the intro, where the app opens once it's over
export const tapApp = (app, { from = null, path = app.path } = {}) => {
    if (state.zoomed || (state.busy && state.phone !== null)) {
        return;
    }
    if (!requestApp(app, { from, path })) {
        openApp(app, { from }).catch(failScene);
    }
};

export const tapFromCover = (app) => {
    if (state.busy || state.phone !== "closed") {
        return;
    }
    if (!requestApp(app)) {
        openFromCover(app).catch(failScene);
    }
};

export const setAppVisible = (visible) => {
    state.appVisible = visible;
};

// the open app's own icon is left out of the home screen while its window shows, since a window let go mid swipe can
// fly in from below it and the icon would show past the window's top. the window lands right on it, and the reset puts
// it back in the same frame. a widget the window grew out of stays, since the window fades into it
const hideOpenIcon = () => {
    state.screen.composite.setHidden(state.openFromWidget ? null : state.openIcon);
};

export const resetAppWindow = () => {
    state.pageFade = null;
    if (!state.screen) {
        return;
    }
    state.screen.appHole.visible = false;
    state.screen.composite.setHidden(null);
    state.screen.texture.repeat.set(1, 1);
    state.screen.texture.offset.set(0, 0);
    state.screen.material.color.setScalar(1);
};

// at full zoom #page drops its transform and is the flat page itself, with sharp text, where the spike showed a
// copy over everything. the loop does the writes (see placePage), and #page keeps its own scroll either way
export const showFlat = () => {
    state.pageFlat = true;
    setAppVisible(false);
};

export const hideFlat = () => {
    if (!state.pageFlat) {
        return;
    }
    state.pageFlat = false;
    setAppVisible(true);
};

const mixColor = (a, b, t) => {
    const ca = new THREE.Color(a);
    return "#" + ca.lerp(new THREE.Color(b), t).getHexString();
};

const lerpRect = (a, b, t) => ({
    x0: a.x0 + (b.x0 - a.x0) * t,
    y0: a.y0 + (b.y0 - a.y0) * t,
    x1: a.x1 + (b.x1 - a.x1) * t,
    y1: a.y1 + (b.y1 - a.y1) * t
});

// the app window at k (0 = the icon, 1 = the whole screen), the way ios grows an app out of its icon: the window's
// rect and corner radius grow, it starts in the icon's color and the app's content fades in as it gets big, and the
// home screen behind it zooms in a little around the icon and dims
const setAppWindow = (k, icon, app) => {
    const { fullW, fullH, radiusPx } = state.screen;
    placeAppWindow(lerpRect(icon, { x0: 0, y0: 0, x1: fullW, y1: fullH }, k), icon.radius + (radiusPx - icon.radius) * k, k, k, icon, app);
};

// the app window at any rect in the screen's px. look is how far it has grown out of its icon, for its color, its
// content, and the icon's letter, and home is how far the home screen behind it has zoomed in and dimmed. opening
// and closing move all three together, while a swipe up keeps the app's look and lets the window go anywhere. crop is
// how far the cutout has closed in on #page (see below), 1 while a swipe carries the window and 0 otherwise
const placeAppWindow = (rect, radius, look, home, icon, app, crop = 0) => {
    const { appHole, full, fullW, fullH, texture, material } = state.screen;
    const k = look;

    const [tl, tr, bl] = full.corners;
    const at = (x, y) => new THREE.Vector3(
        tl.x + ((tr.x - tl.x) * x) / fullW + ((bl.x - tl.x) * y) / fullH,
        tl.y + ((tr.y - tl.y) * x) / fullW + ((bl.y - tl.y) * y) / fullH,
        tl.z
    );
    const surface = state.surfaces.app;
    surface.corners = [at(rect.x0, rect.y0), at(rect.x1, rect.y0), at(rect.x0, rect.y1), at(rect.x1, rect.y1)];
    const { appW, appH } = state.poses;
    const elementPxPerScreenPx = appW / (rect.x1 - rect.x0);
    state.appEl.style.borderRadius = `${radius * elementPxPerScreenPx}px`;
    state.appEl.style.background = mixColor(app.color, APP_BACKGROUND, THREE.MathUtils.smoothstep(k, 0.15, 0.6));
    // #page is laid out at the window's size and centered in the app window, as if it were inside it, so it takes the
    // window's corners in its own px. the canvas over it is opaque outside the window's rounded cutout, which clips it
    // the way the app window clipped the spike's copy. a css clip-path here made the first frame of a close take 25 s
    // under swiftshader
    const page = state.surfaces.page;
    const offsetX = (appW - page.w) / 2;
    const offsetY = (appH - page.h) / 2;
    const toX = (u) => rect.x0 + (u * (rect.x1 - rect.x0)) / appW;
    const toY = (v) => rect.y0 + (v * (rect.y1 - rect.y0)) / appH;
    const px0 = toX(offsetX);
    const px1 = toX(offsetX + page.w);
    const py0 = toY(offsetY);
    const py1 = toY(offsetY + page.h);
    page.corners = [at(px0, py0), at(px1, py0), at(px0, py1), at(px1, py1)];
    page.opacity = String(THREE.MathUtils.clamp((k - 0.35) / 0.4, 0, 1));
    // the window is the whole screen, which runs past a window shaped unlike it, and #page covers only the part the
    // window shows. a swipe's card shrinks it all into view, so its cutout closes in on #page, or the card would show
    // the window's bare background above and below it
    const hole = lerpRect(rect, { x0: px0, y0: py0, x1: px1, y1: py1 }, crop);
    appHole.visible = true;
    appHole.material.uniforms.rect.value.set(hole.x0, hole.y0, hole.x1, hole.y1);
    appHole.material.uniforms.radius.value = radius;
    // grown out of a widget, the window fades in over it as it grows, the way ios opens one, and back into it on the
    // way home. out of an icon it covers the icon from the start
    appHole.material.uniforms.opacity.value = state.openFromWidget ? THREE.MathUtils.smoothstep(k, 0.2, 0.6) : 1;
    // while small the window still looks like the icon, so its letter rides along and fades as the app appears
    const splash = state.appSplash;
    splash.textContent = app.glyph;
    splash.style.fontSize = `${26 * elementPxPerScreenPx}px`;
    splash.style.opacity = state.openFromWidget ? "0" : String(1 - THREE.MathUtils.smoothstep(k, 0.08, 0.35));

    const zoom = 1 + 0.08 * home;
    const cx = (icon.x0 + icon.x1) / 2 / fullW;
    const cy = 1 - (icon.y0 + icon.y1) / 2 / fullH;
    texture.repeat.set(1 / zoom, 1 / zoom);
    texture.offset.set(cx * (1 - 1 / zoom), cy * (1 - 1 / zoom));
    material.color.setScalar(1 - 0.3 * home);
};

const projected = new THREE.Vector3();

// a point on the page to the inner screen's own px, through the screen's perspective as it's drawn now
const toScreenPx = (clientX, clientY) => {
    const home = state.surfaces.home;
    const corners = home.corners.map((c) => {
        projected.copy(c).applyMatrix4(home.owner.matrixWorld).project(camera);
        return [(projected.x + 1) * 0.5 * innerWidth, (1 - projected.y) * 0.5 * innerHeight];
    });
    const [x, y] = unpin(home.w, home.h, corners, [clientX, clientY]);
    return { x, y };
};

const springOut = (t) => 1 - Math.pow(1 - t, 3.2);

export const openFromCover = async (app, opts) => {
    if (state.busy || state.phone !== "closed") {
        return;
    }
    // a rebuild, an intro, or a jump to another address took over while it opened, so the tap is dropped
    if ((await openPhone()) !== "done" || state.phone !== "open") {
        return;
    }
    return openApp(app, opts);
};

// from is the box the window grows out of (the app's icon unless a widget opened it). instant opens it at once with
// no animation (an app named in the address on load, see showFromAddress)
export const openApp = async (app, { from = null, instant = false } = {}) => {
    if (state.busy || state.zoomed) {
        return;
    }
    state.busy = true;
    cancelGroup("intro");
    pose.blur = 0;
    if (pose.fold > 0) {
        tween({ to: { fold: 0 }, duration: 160, easing: ease.outCubic });
    }
    state.openApp = app;
    // the music app shows the player, so it loads even for an app opened from the address, with no tap first
    if (app.name === "Music") {
        music.loadPlayer();
    }
    state.openIcon = from || glyphRect(state.screen.homeEl, app.name);
    state.openFromWidget = Boolean(from);
    const fading = !instant && reducedMotion.matches;
    if (!fading) {
        hideOpenIcon();
        setAppWindow(instant ? 1 : 0, state.openIcon, app);
        setAppVisible(true);
    }

    // the window grows out of the icon while the hand brings the phone closer. the approach starts on the tap and
    // moves fastest at first, like the hand reacting, instead of easing in from a standstill
    if (instant) {
        Object.assign(pose, state.poses.zoom, { idle: 0, fold: 0 });
    } else if (fading) {
        // with reduced motion #page fades in over the home screen on the apps' background, with no zoom, and the
        // phone takes the zoomed pose under it once it covers everything
        state.pageFade = 0;
        if ((await crossfade(0, 1)) === "cancelled") {
            return;
        }
        state.pageFade = null;
        hideOpenIcon();
        setAppWindow(1, state.openIcon, app);
        setAppVisible(true);
        Object.assign(pose, state.poses.zoom, { idle: 0, fold: 0 });
    } else {
        const ends = await Promise.all([
            tween({ to: {}, duration: 520, easing: (t) => t, onUpdate: (t) => setAppWindow(springOut(t), state.openIcon, app) }),
            tween({ to: { ...state.poses.zoom, idle: 0 }, duration: 600, easing: ease.outCubic })
        ]);
        // a rebuild or a new intro took over, and set the state itself
        if (ends.includes("cancelled")) {
            return;
        }
    }
    state.zoomed = true;
    state.busy = false;
    if (settings.flatAtFullZoom) {
        showFlat();
    }
};

// another page on the window that's already open, in the new app's color, with #page's new content fading in. #page
// already holds the new page. with no app open it opens the app. the fade is a web animation, so it leaves #page's
// inline styles to the loop
const FADE_IN_MS = 220;
export const fadeTo = async (app) => {
    if (!state.zoomed) {
        return openApp(app);
    }
    if (state.busy) {
        return;
    }
    state.openApp = app;
    state.openIcon = glyphRect(state.screen.homeEl, app.name);
    state.openFromWidget = false;
    hideOpenIcon();
    setAppWindow(1, state.openIcon, app);
    if (pageEl.animate) {
        pageEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN_MS, easing: "ease-out" });
    }
};

// the swipe up from the home bar, the way ios does it: the window shrinks as it's pulled up, with the point that was
// grabbed staying under the pointer, so it can be carried anywhere while the home screen comes back behind it. only
// on release does it fly into its icon, if it was pulled far enough up or flicked, or spring back to fill the screen
const HOME_SHRINK = 0.65;
const HOME_DISTANCE = 0.2;
const HOME_FLICK = 0.5;
// the most the card rises, as a share of the screen's height. it rises one for one with the finger at first, then
// slower and slower toward this, as ios does, and the whole card stays on the screen
const HOME_LIFT = 0.42;
// the card's gap from the window's edges, as a share of the screen's height, and how far into the pull it takes to
// blend from the whole screen into its motion, for each share of its size it has to lose on the way, so it shrinks at
// the same rate in any window. the zoomed screen covers the window, so in a window shaped unlike the screen it runs
// past two of the window's edges, and the card moves in a frame the size of the part that shows
const HOME_EDGE = 0.03;
const HOME_FIT = 0.45;
const rubberBand = (distance, limit) => limit * (1 - 1 / (distance / limit + 1));
// the part of the screen the window shows, in the screen's px
const shownScreenRect = () => {
    const { fullW, fullH } = state.screen;
    const tl = toScreenPx(0, 0);
    const tr = toScreenPx(innerWidth, 0);
    const bl = toScreenPx(0, innerHeight);
    const br = toScreenPx(innerWidth, innerHeight);
    return {
        x0: Math.max(0, tl.x, bl.x),
        y0: Math.max(0, tl.y, tr.y),
        x1: Math.min(fullW, tr.x, br.x),
        y1: Math.min(fullH, bl.y, br.y)
    };
};
// the largest screen shaped frame that fits inside the shown part less the gap, centered, as its corner and its size
// against the whole screen
const homeFrame = (shown) => {
    const { fullW, fullH } = state.screen;
    const edge = HOME_EDGE * fullH;
    const f = Math.min(1, (shown.x1 - shown.x0 - edge * 2) / fullW, (shown.y1 - shown.y0 - edge * 2) / fullH);
    return { x0: (shown.x0 + shown.x1 - fullW * f) / 2, y0: (shown.y0 + shown.y1 - fullH * f) / 2, f };
};
// a card edge's start along one axis, kept between a and b. inside the last zone px before either end it slows the
// way the rise does, so it never reaches the end and never stops dead
const softBetween = (v, a, b, zone) => {
    if (b <= a) {
        return (a + b) / 2;
    }
    const k = Math.min(zone, (b - a) / 2);
    if (v < a + k) {
        return a + k - rubberBand(a + k - v, k);
    }
    if (v > b - k) {
        return b - k + rubberBand(v - (b - k), k);
    }
    return v;
};
let homeSwipe = null;
const startHomeSwipe = (event) => {
    if (state.busy || !state.zoomed || homeSwipe) {
        return;
    }
    homeSwipe = { id: event.pointerId, x0: event.clientX, y0: event.clientY, armed: false, lastY: event.clientY, lastT: performance.now(), speed: 0 };
};
export const installHomeSwipe = () => {
    addEventListener("pointermove", guard((event) => {
        if (!homeSwipe || event.pointerId !== homeSwipe.id) {
            return;
        }
        if (!homeSwipe.armed) {
            if (homeSwipe.y0 - event.clientY < 8) {
                return;
            }
            homeSwipe.armed = true;
            state.busy = true;
            hideFlat();
            homeSwipe.grab = toScreenPx(homeSwipe.x0, homeSwipe.y0);
            homeSwipe.shown = shownScreenRect();
            homeSwipe.frame = homeFrame(homeSwipe.shown);
        }
        const now = performance.now();
        homeSwipe.speed = (homeSwipe.lastY - event.clientY) / Math.max(now - homeSwipe.lastT, 1);
        homeSwipe.lastY = event.clientY;
        homeSwipe.lastT = now;
        const { fullW, fullH, radiusPx } = state.screen;
        const { grab, shown, frame } = homeSwipe;
        // past the window's edge the screen's perspective maps the pointer to the wrong side, so it's held to the window
        const at = toScreenPx(THREE.MathUtils.clamp(event.clientX, 0, innerWidth), THREE.MathUtils.clamp(event.clientY, 0, innerHeight));
        const raw = Math.max(grab.y - at.y, 0);
        const pulled = THREE.MathUtils.clamp(raw / fullH, 0, 1);
        homeSwipe.pulled = pulled;
        // the card shrinks about the grabbed spot, which moves sideways with the finger and rises by the rubber banded drag,
        // all inside the frame, and its edges slow as they near the shown part's edges
        // the pull is measured against the frame, so a frame the whole screen moves just as ios does, and a smaller one
        // still rises one for one with the finger at first and loses height at the same rate
        const scale = frame.f * (1 - HOME_SHRINK * Math.min(raw / (fullH * frame.f), 1));
        const w = fullW * scale;
        const h = fullH * scale;
        const spotX = frame.x0 + grab.x * frame.f + (at.x - grab.x);
        const spotY = frame.y0 + grab.y * frame.f - rubberBand(raw, fullH * frame.f * HOME_LIFT);
        const edge = HOME_EDGE * fullH;
        const x0 = softBetween(spotX - grab.x * scale, shown.x0, shown.x1 - w, edge);
        const y0 = softBetween(spotY - grab.y * scale, shown.y0, shown.y1 - h, edge);
        // it starts as the whole screen, which may run past the window, and blends into that motion over the first part of
        // the pull, a little faster at first so it answers the finger at once, and easing into the motion with no corner
        const fitPull = Math.max(HOME_FIT * (1 - frame.f), 0.02);
        const blend = Math.sin((Math.min(pulled / fitPull, 1) * Math.PI) / 2);
        homeSwipe.rect = lerpRect({ x0: 0, y0: 0, x1: fullW, y1: fullH }, { x0, y0, x1: x0 + w, y1: y0 + h }, blend);
        homeSwipe.home = 1 - pulled;
        placeAppWindow(homeSwipe.rect, radiusPx, 1, homeSwipe.home, state.openIcon, state.openApp, 1);
        event.preventDefault();
    }), { capture: true, passive: false, signal });
    addEventListener("pointerup", endHomeSwipe, { capture: true, signal });
    addEventListener("pointercancel", endHomeSwipe, { capture: true, signal });
};
const endHomeSwipe = guard(async (event) => {
    if (!homeSwipe || event.pointerId !== homeSwipe.id) {
        return;
    }
    const swipe = homeSwipe;
    homeSwipe = null;
    if (!swipe.armed) {
        return;
    }
    blockNextClick();
    state.busy = false;
    const { fullW, fullH, radiusPx } = state.screen;
    if (swipe.rect && event.type === "pointerup" && (swipe.pulled > HOME_DISTANCE || swipe.speed > HOME_FLICK)) {
        // the close carries on from where the window was let go, and the navigation home waits for it
        closeApp({ rect: swipe.rect, radius: radiusPx, home: swipe.home, crop: 1 }).catch(failScene);
        requestHome();
        return;
    }
    state.busy = true;
    if (swipe.rect) {
        const full = { x0: 0, y0: 0, x1: fullW, y1: fullH };
        const end = await tween({ to: {}, duration: 300, easing: ease.outCubic, onUpdate: (t) => placeAppWindow(lerpRect(swipe.rect, full, t), radiusPx, 1, swipe.home + (1 - swipe.home) * t, state.openIcon, state.openApp, 1 - t) });
        if (end === "cancelled") {
            return;
        }
    }
    state.busy = false;
    if (settings.flatAtFullZoom) {
        showFlat();
    }
});

// #page's fade for an open or a close with reduced motion (see placePage in loop.js)
const CROSSFADE_MS = 300;
const crossfade = (from, to) => tween({ to: {}, duration: CROSSFADE_MS, easing: (t) => t, onUpdate: (t) => {
    state.pageFade = from + (to - from) * ease.inOutSine(t);
} });

// from is where the window is when the close starts: the whole screen, or wherever a swipe up left it. it flies from
// there into its icon, taking on the icon's look as it goes
export const closeApp = async (from = null) => {
    if (state.busy || !state.zoomed) {
        return;
    }
    state.busy = true;
    // with reduced motion the phone goes back to rest on the home screen under #page, which then fades out. a swipe
    // up let go from anywhere does the same, so only the drag itself moves the window
    if (reducedMotion.matches) {
        state.zoomed = false;
        state.pageFlat = false;
        resetAppWindow();
        setAppVisible(false);
        state.pageFade = 1;
        Object.assign(pose, state.poses.rest, { idle: 1 });
        if ((await crossfade(1, 0)) === "cancelled") {
            return;
        }
        state.pageFade = null;
        state.busy = false;
        return;
    }
    const app = state.openApp;
    const icon = state.openIcon;
    const { fullW, fullH, radiusPx } = state.screen;
    const start = from || { rect: { x0: 0, y0: 0, x1: fullW, y1: fullH }, radius: radiusPx, home: 1, crop: 0 };
    const step = (e) => placeAppWindow(lerpRect(start.rect, icon, e), start.radius + (icon.radius - start.radius) * e, 1 - e, start.home * (1 - e), icon, app, (start.crop ?? 0) * (1 - e));
    step(0);
    hideFlat();
    state.zoomed = false;
    // the window shrinks back into its icon as the phone moves back to its resting distance. the real icon takes over
    // the moment the shrink ends, instead of the window sitting there as a stand in while the phone finishes moving.
    // let go mid swipe, it's already moving, so it flies off at once and eases in
    const shrink = tween({ to: {}, duration: from ? 380 : 460, delay: from ? 0 : 80, easing: (t) => t, onUpdate: (t) => step(from ? ease.outCubic(t) : ease.inOutCubic(t)) })
        .then((end) => {
            if (end === "cancelled") {
                return end;
            }
            resetAppWindow();
            setAppVisible(false);
            return end;
        });
    const ends = await Promise.all([shrink, tween({ to: { ...state.poses.rest, idle: 1 }, duration: 650, easing: ease.inOutCubic })]);
    if (ends.includes("cancelled")) {
        return;
    }
    state.busy = false;
};
