import * as THREE from "three";
import { cornerPin, facing } from "./pin.js";
import { state, pose, TAP_FOLD, FOV } from "./state.js";
import { runTweens } from "./tween.js";
import { renderer, scene, camera, backdrop, focusBlur } from "./renderer.js";
import { frameTimes, stepQuality, reducedMotion, laterLevel } from "./quality.js";
import { homeCache, refreshStatus } from "./home.js";
import { centerComp, setFold, handFold, placeKeys, handKeys } from "./device.js";
import { APP_BACKGROUND, reportPageFlat } from "./appWindow.js";
import { phoneEdges } from "./fold.js";
import { avoid } from "./look.js";
import { failScene, guard } from "./lifetime.js";
import { SHADER_PERIOD } from "./wallpaper.js";

let lastFrame = performance.now();
// the rain and snow's own clock, which moves every frame unless the sky is held still
let fallClock = 0;
let onShown = () => {};
// set when the scene fails, so no frame after that does any work or asks for another
let stopped = false;
export const stopLoop = () => {
    stopped = true;
};
// run at the start of each frame, for the capture build's readout (see capture.js)
let frameHook = null;
export const setFrameHook = (fn) => {
    frameHook = fn;
};

// how far the screen's tilt turns the light on the glass rims
const TILT_GAIN = 1.6;
const tiltNormal = new THREE.Vector3();

const projected = new THREE.Vector3();

// a surface that isn't showing is hidden with visibility, not display, so its html keeps its layout. the screen
// textures are drawn from that layout, and a status redraw while the phone is closed would otherwise measure zero
// pinning runs every frame and was the costliest function in a frame's script, so a surface is only pinned again once a
// corner has moved a quarter px, and its visibility is only written when it changes
const setShown = (surface, shown) => {
    if (surface.shown !== shown) {
        surface.shown = shown;
        surface.el.style.visibility = shown ? "visible" : "hidden";
    }
};

const pin = (surface, show) => {
    if (!show) {
        setShown(surface, false);
        return;
    }
    const corners = surface.corners.map((c) => {
        projected.copy(c).applyMatrix4(surface.owner.matrixWorld).project(camera);
        return [(projected.x + 1) * 0.5 * innerWidth, (1 - projected.y) * 0.5 * innerHeight];
    });
    // hide surfaces turned away or nearly edge on, the homography blows up there
    if (facing(corners) < 4) {
        setShown(surface, false);
        return;
    }
    setShown(surface, true);
    const last = surface.pinned;
    if (last && corners.every((c, i) => Math.abs(c[0] - last[i][0]) < 0.25 && Math.abs(c[1] - last[i][1]) < 0.25)) {
        return;
    }
    surface.pinned = corners;
    surface.el.style.transform = cornerPin(surface.w, surface.h, corners);
};

// #page in one of four ways: pinned onto the app window while it opens, closes, or is swiped, a plain flat page at
// full zoom with every transform cleared (so its text is sharp and nothing reflows), hidden while the home screen
// shows, or fading in or out over the phone on the apps' background, for an open or a close with reduced motion. at
// full zoom the canvas drops under the css layer, since it sits over #page and the phone can still shake there, and
// the app window stays pinned over it, covering the window, so the phone's screen color shows around the page's
// column the way the spike's flat page covered everything. hiding the canvas instead stalled swiftshader for
// about 25 s when it showed again. only inline styles are used, so clearing them gives back the flat page
const placePage = () => {
    const page = state.surfaces.page;
    if (!page) {
        return;
    }
    const mode = state.pageFade !== null ? "fading" : state.pageFlat ? "flat" : state.appVisible ? "pinned" : "hidden";
    if (mode !== page.mode) {
        page.mode = mode;
        page.pinned = null;
        page.shownOpacity = null;
        const fading = mode === "fading";
        Object.assign(page.el.style, { transform: "", opacity: "", willChange: mode === "pinned" ? "transform" : "", zIndex: fading ? "1" : "", background: fading ? APP_BACKGROUND : "" });
        renderer.domElement.style.zIndex = mode === "flat" ? "-1" : "";
    }
    if (mode === "flat") {
        setShown(page, true);
        return;
    }
    if (mode === "fading") {
        setShown(page, true);
    } else {
        pin(page, mode === "pinned");
    }
    if (mode === "hidden") {
        return;
    }
    const opacity = mode === "fading" ? String(state.pageFade) : page.opacity;
    if (opacity !== page.shownOpacity) {
        page.shownOpacity = opacity;
        page.el.style.opacity = opacity;
    }
};

// how far the phone turns its port edge toward the camera while the cable goes in (radians), and the margin it keeps
// from the window's edges then (of the window's size)
const PRESENT_TILT = 0.1;
const PRESENT_MARGIN = 0.07;
// and how far it lifts while the hand goes for the cable, at most (of the window's height), as if the holding hand
// raises it to make room. it never lifts past the top margin
const PRESENT_LIFT = 0.06;
// the extra shake while one hand holds the open phone (cm, radians), and how far its free half sags (radians)
const SHAKE_MOVE = 0.12;
const SHAKE_TURN = 0.008;
const SAG = 0.035;
// how far the phone gives when the plug is pushed home (cm)
const PLUG_BUMP = 0.35;

// the move (cm, in the scene) for the charging cable: the phone rises by PRESENT_LIFT of the window's height while
// staying whole in view with PRESENT_MARGIN on every side, backing off from the camera if there isn't room to rise
const fitInView = () => {
    const { outer } = phoneEdges();
    const d = -state.root.position.z;
    const mx = innerWidth * PRESENT_MARGIN;
    const my = innerHeight * PRESENT_MARGIN;
    const lift = PRESENT_LIFT * innerHeight;
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    // the phone has to fit with room to rise: between the top margin and the bottom margin raised by the lift
    const scale = Math.max(1, (outer.right - outer.left) / (innerWidth - 2 * mx), (outer.bottom - outer.top) / (innerHeight - 2 * my - lift));
    const s = 1 / scale;
    const box = { left: cx + (outer.left - cx) * s, right: cx + (outer.right - cx) * s, top: cy + (outer.top - cy) * s, bottom: cy + (outer.bottom - cy) * s };
    const shiftX = Math.max(mx - box.left, 0) - Math.max(box.right - (innerWidth - mx), 0);
    // up by the lift (more if the bottom is still past its margin), but never past the top margin
    const room = Math.max(box.top - my, 0);
    const up = Math.min(Math.max(lift, box.bottom - (innerHeight - my)), room);
    const shiftY = -up;
    const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * d * scale) / innerHeight;
    return { x: shiftX * worldPerPx, y: -shiftY * worldPerPx, z: -(d * scale - d) };
};

// the idle drift only translates: any tilt at rest made the screen a true 3d layer, and the browser drew its text
// with missing vertical strips along the layer's tile seams
export const idleDrift = (t, idle) => ({
    x: Math.sin(t * 0.6 + 1) * 0.05 * idle,
    y: Math.sin(t * 0.9) * 0.06 * idle,
    z: Math.sin(t * 0.5 + 2) * 0.08 * idle
});

// ms after the page started when the scene shows even if the desk hasn't loaded, and ms after it shows when the full
// desk images load if the intro hasn't asked for them first
const SHOW_BY = 6000;
const REST_BY = 5000;
// settles once the page has faded in from black, which the intro waits for (see playIntro)
let markShown;
export const shown = new Promise((resolve) => {
    markShown = resolve;
});

// the open phone drawn once, with the desk blurred behind it and the intro's blur over it, while the page is still
// black. three compiles each shader ahead (renderer.compile), but some of the gpu's setup for drawing a shader a new
// way can wait for a real draw, which would otherwise be the unfold. an iphone's log didn't show it helping or hurting.
// the next frame puts the fold and the desk's blur back from the pose
const warmUp = () => {
    setFold(0);
    state.root.updateMatrixWorld(true);
    backdrop.update(0, innerWidth / innerHeight, 1);
    if (state.screen.composite.render()) {
        state.homeLaidOut = true;
    }
    renderer.clear();
    backdrop.draw(renderer, false);
    renderer.clearDepth();
    renderer.render(scene, camera);
    focusBlur.draw(4 * renderer.getPixelRatio());
};

// anything a frame throws fails the scene, and the frame asks for no next one
const loop = (now) => {
    if (stopped) {
        return;
    }
    try {
        frame(now);
    } catch (error) {
        failScene(error);
    }
};

const frame = (now) => {
    if (frameHook) {
        frameHook(now);
    }
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    frameTimes.push(now - lastFrame);
    lastFrame = now;

    // what the screens show changed (the music card, an image loading, the github graph). it's drawn once here, and
    // waits while the phone or an app is moving, since it was redrawing both screens a few times during the unfold.
    // screens never drawn yet are drawn at once, so the phone never opens onto a blank one
    if (state.screensChanged && state.screen && (!state.busy || !homeCache.has(state.screen.homeEl))) {
        state.screensChanged = false;
        state.statusChanged = false;
        refreshStatus(true);
    } else if (state.statusChanged && !state.busy) {
        state.statusChanged = false;
        refreshStatus();
    }
    runTweens(now);

    const root = state.root;
    // with reduced motion there's no idle drift and no move out of the mouse's way
    const drift = idleDrift(now / 1000, reducedMotion.matches ? 0 : pose.idle);
    // the move out of the mouse's way only applies while the phone is closed, and eases back as it opens
    if (state.phone !== "closed" || state.busy || reducedMotion.matches) {
        avoid.tx = 0;
        avoid.ty = 0;
    }
    const ka = 1 - Math.exp(-dt * 4);
    avoid.x += (avoid.tx - avoid.x) * ka;
    avoid.y += (avoid.ty - avoid.y) * ka;
    const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * -pose.z) / innerHeight;
    root.position.set(
        pose.x + drift.x + avoid.x * worldPerPx,
        pose.y + centerComp(pose.fold) + drift.y - avoid.y * worldPerPx,
        pose.z + drift.z
    );
    // while the view catches up with a drag, the phone trails it a little, like it's in the hands of someone turning
    const look = backdrop.look;
    const swayYaw = THREE.MathUtils.clamp(look.targetYaw - look.yaw, -12, 12);
    const swayPitch = THREE.MathUtils.clamp(look.targetPitch - look.pitch, -12, 12);
    // a slight tilt with the move to the side, so it reads as a hand carrying the phone instead of a slide
    root.rotation.set(pose.rx - swayPitch * 0.004 + avoid.y * 0.0003, pose.ry - swayYaw * 0.006 + avoid.x * 0.0004, pose.rz - avoid.x * 0.0003);
    // with the left hand off to fetch the cable, one hand holds the open phone, so it shakes more and its free half
    // sags a little until the hand is back. the tilt is left out while an app's html is showing, since tilting that
    // layer made the browser drop strips of its text
    const shaky = (state.charger ? state.charger.handOff() : 0) * THREE.MathUtils.clamp(1 - pose.fold, 0, 1);
    if (shaky > 0) {
        const t = now / 1000;
        root.position.x += (Math.sin(t * 5.3) * 0.6 + Math.sin(t * 8.9 + 1.3) * 0.4) * SHAKE_MOVE * shaky;
        root.position.y += (Math.sin(t * 6.1 + 0.7) * 0.6 + Math.sin(t * 9.7 + 2.1) * 0.4) * SHAKE_MOVE * shaky;
        if (!state.appVisible) {
            root.rotation.x += Math.sin(t * 4.7 + 0.4) * SHAKE_TURN * shaky;
            root.rotation.y += Math.sin(t * 5.9 + 1.9) * SHAKE_TURN * shaky;
            // the left half droops in landscape, the top half tips back in portrait
            if (state.portrait) {
                root.rotation.x -= SAG * shaky;
            } else {
                root.rotation.z += SAG * shaky;
            }
        }
    }
    // while the cable goes in, the phone moves just enough to be whole in view with a margin all round, and turns its
    // port edge a touch toward the camera. the move is worked out once per plug, from where the phone was
    const present = state.charger ? state.charger.lift() : 0;
    if (present > 0) {
        if (!state.chargeFit) {
            state.chargeFit = fitInView();
        }
        const out = state.charger.portOut();
        const axis = new THREE.Vector3().crossVectors(out, new THREE.Vector3(0, 0, 1)).normalize();
        root.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, PRESENT_TILT * present));
        root.position.x += state.chargeFit.x * present;
        root.position.y += state.chargeFit.y * present;
        root.position.z += state.chargeFit.z * present;
        // the push seats the plug with a small nudge up, and the phone settles back
        const bump = state.charger.bump();
        if (bump > 0) {
            root.position.addScaledVector(out.clone().applyQuaternion(root.quaternion), -PLUG_BUMP * bump);
        }
    } else {
        state.chargeFit = null;
    }
    setFold(pose.fold);
    root.updateMatrixWorld(true);
    if (state.charger) {
        state.charger.step(dt);
    }
    if (state.volume) {
        state.volume.update(now);
    }
    // the hands take the opening or the closing path, picked as the fold leaves either end, so a fold turned back
    // half way keeps the path it started on instead of jumping to the other
    if (state.hands && state.portrait && !state.posing && pose.fold !== state.lastFold) {
        if (state.lastFold <= 0.001 || state.lastFold >= 0.999) {
            const foldPath = pose.fold < state.lastFold ? "open" : "close";
            if (foldPath !== state.foldPath) {
                state.foldPath = foldPath;
                placeKeys(handKeys());
            }
            if (foldPath === "close") {
                state.lead = 0;
            }
        }
    }
    state.lastFold = pose.fold;
    if (state.hands) {
        state.hands.update(handFold());
    }
    // the screens look through the moving glass at content fixed to the body, from where the camera really is
    state.glass.toBody.value.copy(state.body.matrixWorld).invert();
    state.glass.eye.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(state.glass.toBody.value);

    // the desk is sharp with the phone closed and blurs as it opens, so it comes into focus whenever the phone folds
    const open = THREE.MathUtils.clamp(1 - pose.fold, 0, 1);
    // a device the quality ladder has stepped all the way down keeps the desk sharp (see quality.js)
    backdrop.update(dt, innerWidth / innerHeight, laterLevel >= 2 ? 0 : open * open * (3 - 2 * open));
    // the phone stays in front of the camera while the view turns, so the desk's lighting turns the other way around
    // it. three samples the map through the inverse of this rotation, which makes it the backdrop camera's own turn
    scene.environmentRotation.set(-THREE.MathUtils.degToRad(backdrop.look.pitch), THREE.MathUtils.degToRad(backdrop.look.yaw), 0, "XYZ");
    // the sky moves on, then the screens' icons are laid over it, before the frame that maps them. the sky stops
    // while an app fills the screen, since none of it shows then, and while the phone or an app is moving, since each
    // of its frames lays both screens out again with their blur and mipmaps (74 times in an intro and 18 in an app
    // opening, measured on a pc). it catches up once they're still. a page opened straight into an app, or a rebuild
    // while one is open, makes a sky that was never drawn, so it's drawn once anyway, or a swipe home shows black
    // the rain and snow fall every frame on the screens' glass, even while the sky itself waits (precipitation.js)
    const fall = state.wallpaper.precipitation();
    if (!state.wallpaper.still()) {
        fallClock = (fallClock + dt) % SHADER_PERIOD;
    }
    state.glass.precipKind.value = fall.kind;
    state.glass.precipK.value = fall.intensity;
    state.glass.precipFade.value = fall.fade;
    state.glass.precipDay.value = fall.day;
    state.glass.precipTime.value = fallClock;
    const skyDue = (!state.zoomed && !state.busy) || !state.wallpaper.drawn();
    if (skyDue && state.wallpaper.update(now / 1000)) {
        if (state.glassLevel.frosted) {
            state.frost.render();
        }
        state.screen.composite.invalidate();
        state.cover.composite.invalidate();
    }
    // the glass rims catch the light by how the screen faces the camera: tilted right, the light moves right. the
    // corners' order can make the normal point into the phone, so it's turned to face the camera first
    tiltNormal.copy(state.screen.normal).transformDirection(state.body.matrixWorld).transformDirection(camera.matrixWorldInverse);
    if (tiltNormal.z < 0) {
        tiltNormal.negate();
    }
    // the rims follow the tilt only while nothing is moving. while the phone or an app moves, the tilt changed every
    // other frame, and each change laid the whole inner screen out again with its mipmaps
    if (state.glassLevel.tilt && !state.busy) {
        state.screen.composite.setTilt(tiltNormal.x * TILT_GAIN, -tiltNormal.y * TILT_GAIN);
    }
    // each screen is only laid out while it can be seen: the inner one unless the phone is shut, the cover unless it's
    // fully open. a hidden one stays marked as changed, so it catches up the moment it shows. the inner one is also
    // laid out once at the start, while the page is still black, since its first layout makes its textures, which
    // would otherwise happen on the frame where the unfold begins
    if (pose.fold < 1 || !state.homeLaidOut) {
        if (state.screen.composite.render()) {
            state.homeLaidOut = true;
        }
    }
    if (pose.fold > 0) {
        state.cover.composite.render();
    }
    renderer.clear();
    backdrop.draw(renderer, !state.busy);
    renderer.clearDepth();
    renderer.render(scene, camera);
    // the intro's blur, in css px like the filter it replaced (see focus.js)
    if (pose.blur > 0.05 && laterLevel < 2) {
        focusBlur.draw(pose.blur * renderer.getPixelRatio());
    }
    // the page stays black until this frame has the desk behind the phone, or a few seconds pass in case an image
    // never loads
    if (!document.body.classList.contains("ready") && (backdrop.ready() || now > SHOW_BY)) {
        if (!state.warmedUp) {
            state.warmedUp = true;
            warmUp();
            requestAnimationFrame(loop);
            return;
        }
        document.body.classList.add("ready");
        onShown();
        markShown();
        // the full desk images wait for the intro to finish (playIntro), since decoding and uploading a 4096 wide image
        // stalled a slowed phone for about 75 ms mid unfold. this is in case no intro plays
        setTimeout(guard(() => backdrop.loadRest()), REST_BY);
    }

    const s = state.surfaces;
    pin(s.home, pose.fold < TAP_FOLD && !state.appVisible);
    pin(s.app, state.appVisible || state.pageFlat);
    placePage();
    // the app only takes clicks while it's open and still. while it opens, is dragged, springs back, or closes, a click
    // would land on a page that's moving, and the home screen's own taps wait for the close to end (state.busy)
    const appLive = state.zoomed && !state.busy;
    if (state.appEl && appLive !== state.appLive) {
        state.appLive = appLive;
        state.appEl.style.pointerEvents = appLive ? "" : "none";
        s.page.el.style.pointerEvents = appLive ? "" : "none";
    }
    pin(s.cover, state.phone === "closed" && !state.busy);
    reportPageFlat();
    const closedNow = state.phone === "closed" && !state.busy;
    if (closedNow !== document.body.classList.contains("closed")) {
        document.body.classList.toggle("closed", closedNow);
    }

    stepQuality(now);

    requestAnimationFrame(loop);
};

export const startLoop = (shown) => {
    if (stopped) {
        return;
    }
    onShown = shown;
    requestAnimationFrame(loop);
};
