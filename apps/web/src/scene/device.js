import * as THREE from "three";
import { UNITS } from "./handsModel.js";
import { bakePart, applyFinish, cameraSolid } from "./phoneModel.js";
import { drawHome, iconTexture, mapScreenUV, appWindowMaterial, glassUniforms, glassMaterial, setGlassPlane } from "./screens.js";
import { createComposite, skyRectFor } from "./composite.js";
import { createBlur } from "./blur.js";
import { createWallpaper } from "./wallpaper.js";
import { LEVEL_STEPS } from "./musicInfo.js";
import { createHands, handMatrix, LIMITS } from "./hands.js";
import { state, pose, settings, DUO, FOV, HOME_FILL } from "./state.js";
import { tween, ease } from "./tween.js";
import { renderer, scene, camera, backdrop, focusBlur, phoneGlow, MATERIALS, holeMaterial, applyDaylight, applyWeather, currentWeather } from "./renderer.js";
import { applyWallpaperMotion } from "./quality.js";
import { music, statusBar, buildWidgets, buildHomeContent, fillGithub, fitLines, applyStatus, showMusic, refreshStatus } from "./home.js";
import { APP_BACKGROUND, pageEl, tapApp, tapFromCover, setAppVisible } from "./appWindow.js";
import { sceneFetch, signal } from "./lifetime.js";

const PX_PER_CM = 54.4;

let cssLayer = null;
export const initDevice = (layer) => {
    cssLayer = layer;
};

// the baked hand keys and the rig, fetched before the device is built
let landscapeBaked = null;
let supportGrips = null;
let pinchGrips = null;
let portraitGrips = null;
export let handsRig = null;
const fetchJson = async (url) => {
    const response = await sceneFetch(url);
    if (!response.ok) {
        throw new Error(`${url} answered ${response.status}`);
    }
    return response.json();
};
export const loadKeys = async () => {
    [landscapeBaked, supportGrips, pinchGrips, portraitGrips, handsRig] = await Promise.all([
        fetchJson("/keys/landscape-baked.json"),
        fetchJson("/keys/support.json"),
        fetchJson("/keys/pinch.json"),
        fetchJson("/keys/portrait-grips.json"),
        fetchJson("/models/hands-rig.json")
    ]);
};

// corner radii in order tl, tr, br, bl
const roundedRectShape = (xmin, xmax, ymin, ymax, radii) => {
    const [tl, tr, br, bl] = radii;
    const shape = new THREE.Shape();
    shape.moveTo(xmin + bl, ymin);
    shape.lineTo(xmax - br, ymin);
    shape.quadraticCurveTo(xmax, ymin, xmax, ymin + br);
    shape.lineTo(xmax, ymax - tr);
    shape.quadraticCurveTo(xmax, ymax, xmax - tr, ymax);
    shape.lineTo(xmin + tl, ymax);
    shape.quadraticCurveTo(xmin, ymax, xmin, ymax - tl);
    shape.lineTo(xmin, ymin + bl);
    shape.quadraticCurveTo(xmin, ymin, xmin + bl, ymin);
    return shape;
};

const hole = (xmin, xmax, ymin, ymax, radii, back) => {
    // a back face is built mirrored in x, since turning it around to face -z flips x again
    const shape = back
        ? roundedRectShape(-xmax, -xmin, ymin, ymax, [radii[1], radii[0], radii[3], radii[2]])
        : roundedRectShape(xmin, xmax, ymin, ymax, radii);
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 10), holeMaterial);
    if (back) {
        mesh.geometry.rotateY(Math.PI);
        mesh.position.z = -DUO.depth / 2 - 0.002;
    } else {
        mesh.position.z = DUO.depth / 2 + 0.002;
    }
    return mesh;
};

// the hands are skin colored in code, with no texture, so phones and desktops load the same small file
const handMaterial = () => MATERIALS.hand[settings.hands === "hands-clay" ? "clay" : "real"];

// the wrist bones get parented to anchors in device space, and hands.js moves the anchors between keyframes
const attachHands = () => {
    const { mesh, bones } = state.handModel;
    mesh.material = handMaterial();
    mesh.frustumCulled = false;
    const anchors = { Left: new THREE.Group(), Right: new THREE.Group() };
    ["Left", "Right"].forEach((side) => {
        state.root.add(anchors[side]);
        const bone = bones[`J_${side}`];
        anchors[side].add(bone);
        bone.position.set(0, 0, 0);
        bone.rotation.set(0, 0, 0);
    });
    state.hands = createHands({
        fbx: state.handModel,
        root: state.root,
        frames: { flap: state.flap, body: state.body, device: state.root, hinge: state.hingeTurn },
        setFold,
        anchors,
        solids: [
            { frame: "body", min: [0, -DUO.bodyH / 2, -DUO.depth / 2], max: [DUO.halfW, DUO.bodyH / 2, DUO.depth / 2], screen: true },
            { frame: "flap", min: [-DUO.halfW, -DUO.bodyH / 2, -DUO.depth / 2], max: [0, DUO.bodyH / 2, DUO.depth / 2], screen: true },
            ...(state.cameraSolid ? [{ frame: "body", ...state.cameraSolid }] : []),
            ...(state.hingeSolid ? [{ frame: "hinge", hard: true, ...state.hingeSolid }] : [])
        ]
    });
    state.hands.setKeys(handKeys(), keyOptions());
    setFold(pose.fold);
    return mesh;
};

// setKeys poses the phone at each key's fold to measure it, so it's put back at its own fold after, or the frame would
// be drawn with the phone at the last key's fold (fully open, for a flash, when an opening starts)
// portrait's few posed keys are joined by a curve through them (hands.js foldHermite), so the hands don't stop at each
export const keyOptions = () => ({ smooth: state.portrait });
export const placeKeys = (keys) => {
    state.hands.setKeys(keys, keyOptions());
    setFold(pose.fold);
    state.root.updateMatrixWorld(true);
};

// opening, the thumbs come off the closed phone's front and get under its free edge in the first 0.01 of the fold. eased
// in, that much of the fold takes a few frames, so the thumbs jumped. the hands go ahead along the path over LEAD.time
// with the phone still closed, and then hold there (handFold takes the lesser of the two) until the fold catches up
export const LEAD = { fold: 0.01, time: 300 };
export const handFold = () => (state.portrait && (state.posing || state.foldPath === "open") ? Math.min(pose.fold, 1 - LEAD.fold * state.lead) : pose.fold);
export const leadTo = (to, delay = 0, time = LEAD.time) => {
    const from = state.lead;
    return tween({ to: {}, duration: time * Math.abs(to - from), delay, easing: (t) => t, onUpdate: (t) => {
        state.lead = from + (to - from) * ease.inOutSine(t);
    } });
};
export const leadOpen = (delay = 0, time = LEAD.time) => {
    if (!state.portrait || !state.hands) {
        return Promise.resolve();
    }
    if (state.foldPath !== "open") {
        state.foldPath = "open";
        placeKeys(handKeys());
    }
    return leadTo(1, delay, time);
};

export const handKeys = () => {
    // landscape is baked frame by frame from keys/landscape-authored.json, checked for overlap with spike.sweep.
    // portrait's grips are posed by eye in the pose editor, with one path for opening (the thumbs lift the top half)
    // and another for closing (the index fingers push it down)
    return state.portrait ? portraitGrips[state.foldPath] : landscapeBaked;
};

const pickPortrait = () => {
    if (settings.device === "landscape") {
        return false;
    }
    if (settings.device === "portrait") {
        return true;
    }
    return innerHeight > innerWidth;
};

const measure = () => {
    const bodyW = state.portrait ? DUO.bodyH : DUO.halfW * 2;
    const bodyH = state.portrait ? DUO.halfW * 2 : DUO.bodyH;
    const screenW = state.portrait ? DUO.screenH : DUO.halfScreenW * 2;
    const screenH = state.portrait ? DUO.halfScreenW * 2 : DUO.screenH;

    const aspect = innerWidth / innerHeight;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const homeDist = Math.max(bodyH / (HOME_FILL * 2 * tanHalf), bodyW / (HOME_FILL * 2 * tanHalf * aspect));

    // cover: the screen fills the window in one dimension exactly and overflows in the other
    const zoomDist = Math.min(screenH / (2 * tanHalf), screenW / (2 * tanHalf * aspect));
    const visibleH = (dist) => 2 * dist * tanHalf;
    const appW = (screenW / (visibleH(zoomDist) * aspect)) * innerWidth;
    const appH = (screenH / visibleH(zoomDist)) * innerHeight;

    return {
        appW,
        appH,
        rest: { x: 0, y: 0, z: -homeDist, rx: 0, ry: 0, rz: 0 },
        // the opening plays at the home distance. in landscape the closed slab sits centered so it's fully in view,
        // in portrait the body half stays low while the lid opens upward, then rises a little into the home pose
        // closed and fully in view with room below it, a little farther back and lower than home, so the unfold can
        // carry it up and closer into the home pose in one motion
        stage: state.portrait
            ? { x: 0, y: -0.9, z: -homeDist * 1.12, rx: 0.05, ry: 0, rz: 0 }
            : { x: 0, y: -0.5, z: -homeDist * 1.1, rx: 0.05, ry: 0, rz: 0 },
        // zoomDist is where the screen itself has to be, and the screen sits in front of the device's center plane by
        // half its depth, so the device stops that much farther back. without this the app ended 1.55% larger than
        // the window and visibly shrank when the flat page took over
        zoom: { x: 0, y: 0, z: -(zoomDist + DUO.depth / 2 + 0.003), rx: 0, ry: 0, rz: 0 },
        fullStart: {
            x: bodyW * 0.1, y: -visibleH(homeDist) * 0.75 - bodyH * 0.4,
            z: -homeDist * 1.25, rx: -1.15, ry: 0.28, rz: -0.12
        },
        fastStart: { x: 0, y: -bodyH * 0.18, z: -homeDist * 1.06, rx: -0.28, ry: 0.05, rz: -0.03 }
    };
};

// in portrait the hinge keeps the closed slab centered by shifting it up half a device as it closes, which made the
// whole device sink while opening. this cancels that shift in world space, so the body half holds still and the lid
// opens upward (the halves and the hands keep their relative layout, since all of it sits under the root)
export const centerComp = (fold) => (state.portrait ? -(DUO.halfW / 2) * THREE.MathUtils.clamp(fold, 0, 1) : 0);

export const setFold = (fold) => {
    const closed = THREE.MathUtils.clamp(fold, 0, 1);
    // the left half (the flap, with the cover screen on its back) swings over onto the right half, like a book
    state.pivot.rotation.y = Math.PI * closed;
    if (state.hingeTurn) {
        state.hingeTurn.rotation.y = (Math.PI * closed) / 2;
    }
    // keep the closed slab centered, it covers x in [0, halfW] and sits half a body forward
    state.hinged.position.x = -(DUO.halfW / 2) * closed;
    state.hinged.position.z = -(DUO.depth / 2 + DUO.gap / 2) * closed;
};

const deviceSpace = new THREE.Vector3();
const rootInverse = new THREE.Matrix4();

// orders a local rect's corners by where they appear in device space at the current (reference) fold
const surfaceCorners = (owner, xmin, xmax, ymin, ymax, z) => {
    rootInverse.copy(state.root.matrixWorld).invert();
    const local = [[xmin, ymin], [xmax, ymin], [xmin, ymax], [xmax, ymax]].map(([x, y]) => {
        deviceSpace.set(x, y, z).applyMatrix4(owner.matrixWorld).applyMatrix4(rootInverse);
        return { local: new THREE.Vector3(x, y, z), dx: deviceSpace.x, dy: deviceSpace.y };
    });
    const byTop = [...local].sort((a, b) => b.dy - a.dy);
    const top = byTop.slice(0, 2).sort((a, b) => a.dx - b.dx);
    const bottom = byTop.slice(2).sort((a, b) => a.dx - b.dx);
    const tl = top[0];
    return {
        corners: [top[0].local, top[1].local, bottom[0].local, bottom[1].local],
        width: Math.hypot(top[1].dx - tl.dx, top[1].dy - tl.dy),
        height: Math.hypot(bottom[0].dx - tl.dx, bottom[0].dy - tl.dy),
        origin: { dx: tl.dx, dy: tl.dy }
    };
};

const makeScreenEl = (className, w, h, radiusPx) => {
    const el = document.createElement("div");
    el.className = className;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.borderRadius = radiusPx;
    cssLayer.appendChild(el);
    return el;
};

// the volume buttons and the charging cable are chunks of their own. the buttons load once the intro has played, and the
// cable once the battery is low or charging, since it only shows then. a rebuild after that makes them again
let volumeModule = null;
let volumeLoading = null;
let chargerModule = null;
let chargerLoading = null;
// a chunk that didn't load isn't asked for again this page load, since the battery's ticks would ask each time
let volumeFailed = false;
let chargerFailed = false;
const CHARGER_BELOW = 5;

const buildVolume = (body, flap) => {
    const buttons = volumeModule ? body.getObjectByName("Buttons") : null;
    if (!buttons) {
        return;
    }
    state.volume = volumeModule.createVolumeButtons({
        body,
        flap,
        buttons,
        depth: DUO.depth,
        top: DUO.bodyH / 2,
        portrait: state.portrait,
        level: music.level(),
        steps: LEVEL_STEPS,
        step: (delta) => music.stepLevel(delta)
    });
};

// a chunk that won't load leaves the scene without the buttons or the cable, which it can do without
const importChunk = (load, what) =>
    load().catch((error) => {
        console.warn(`${what} didn't load`, error);
        return null;
    });

export const loadVolume = async () => {
    if (!volumeModule && !volumeFailed) {
        volumeLoading ??= importChunk(() => import("./volume.js"), "the volume buttons");
        volumeModule = await volumeLoading;
        volumeLoading = null;
        volumeFailed = !volumeModule;
    }
    if (volumeModule && !state.volume && state.body && !signal.aborted) {
        buildVolume(state.body, state.flap);
        renderer.compile(scene, camera);
    }
};

// the charging cable's port, centred on the flap's bottom edge (flap x runs from -halfW at its outer edge to 0 at the
// hinge). if the battery is already charging, the cable starts plugged in
const buildCharger = (root, flap) => {
    const charger = chargerModule.createCharger({
        root,
        frame: flap,
        port: new THREE.Vector3(-DUO.halfW / 2, -DUO.bodyH / 2, 0),
        getHands: () => state.hands,
        getBones: () => (state.handModel ? state.handModel.bones : {}),
        // while the left hand is off for the cable, the right holds the phone alone: little finger under the bottom
        // edge, thumb pressing the screen, fingers flat on the back. searched per state, carried to the current fold.
        // closed in landscape the right hand already holds it alone, so there's none
        getSupport: () => {
            const grip = supportGrips[state.portrait ? "portrait" : "landscape"]?.[pose.fold < 0.5 ? "open" : "closed"];
            return grip && state.hands ? state.hands.carry("Right", grip.pose, "body", grip.fold, pose.fold) : null;
        },
        // the left hand's pinch on the plug with it in the port, carried with the top half to the current fold, in
        // portrait only
        getPinch: () => {
            const grip = pinchGrips[state.portrait ? "portrait" : "landscape"]?.[pose.fold < 0.5 ? "open" : "closed"];
            if (!grip || !state.hands) {
                return null;
            }
            const carried = state.hands.carry("Left", grip.pose, "flap", grip.fold, pose.fold);
            const position = new THREE.Vector3();
            const quaternion = new THREE.Quaternion();
            handMatrix("Left", carried).decompose(position, quaternion, new THREE.Vector3());
            const joints = Object.fromEntries(Object.keys(LIMITS).map((n) => [n, carried[n]]));
            return { position, quaternion, joints, release: { ...joints, ...grip.release } };
        },
        onChange: () => refreshStatus()
    });
    charger.snap(statusBar.status.charging);
    return charger;
};

// the plug and cable only show while charging, so their shaders are compiled when they're made instead of stalling the
// first plug (about 50 ms of the first one's worst frame on a 4x slowed cpu)
const compileCharger = () => {
    const { plug, cable } = state.charger.objects;
    const shown = [plug.visible, cable.visible];
    plug.visible = true;
    cable.visible = true;
    renderer.compile(scene, camera);
    [plug.visible, cable.visible] = shown;
};

export const loadCharger = async () => {
    if (!chargerModule && !chargerFailed) {
        chargerLoading ??= importChunk(() => import("./charger.js"), "the charging cable");
        chargerModule = await chargerLoading;
        chargerLoading = null;
        chargerFailed = !chargerModule;
    }
    if (chargerModule && !state.charger && state.root && !signal.aborted) {
        state.charger = buildCharger(state.root, state.flap);
        compileCharger();
    }
};

// the battery is about to need the cable when it's low, and does while it's charging (a visit that starts in the middle
// of a charge starts with the cable in)
export const chargerWanted = (status) => status.charging || status.level <= CHARGER_BELOW;

export const watchCharger = (status) => {
    if (!chargerModule && !chargerFailed && chargerWanted(status)) {
        loadCharger();
    }
};

export const buildDevice = () => {
    if (state.root) {
        scene.remove(state.root);
    }
    if (state.screen) {
        state.screen.composite.dispose();
        state.screen.icons.dispose();
        state.screen.ink.dispose();
        state.cover.composite.dispose();
        state.cover.icons.dispose();
        state.cover.ink.dispose();
    }
    if (state.wallpaper) {
        state.wallpaper.dispose();
        state.frost.dispose();
    }
    cssLayer.innerHTML = "";

    state.portrait = pickPortrait();
    state.poses = measure();

    const root = new THREE.Group();
    const roll = new THREE.Group();
    // in portrait the flap ends up on top, so it lifts like a lid
    roll.rotation.z = state.portrait ? -Math.PI / 2 : 0;
    const hinged = new THREE.Group();
    const body = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.position.z = DUO.depth / 2 + DUO.gap / 2;
    const flap = new THREE.Group();
    flap.position.z = -pivot.position.z;

    root.add(roll);
    roll.add(hinged);
    hinged.add(body, pivot);
    pivot.add(flap);
    state.root = root;
    state.hinged = hinged;
    state.pivot = pivot;

    const { halfW, halfScreenW, screenH, screenR } = DUO;
    const sy = screenH / 2;
    // the phone model when it loaded (phoneModel.js), baked fresh for this build
    const phoneFinish = MATERIALS.phone[settings.finish] || MATERIALS.phone["star-white"];
    const shell = (name) => {
        const part = bakePart(state.phoneModel.parts[name], UNITS);
        applyFinish(part, phoneFinish);
        return part;
    };
    state.hingeTurn = null;
    state.cameraSolid = null;
    state.volume = null;
    state.hingeSolid = null;
    if (state.phoneModel) {
        flap.add(shell("Flap"));
        body.add(shell("Body"));
        buildVolume(body, flap);
        // the hinge cover turns about the pivot line by half the fold (setFold), so it's placed relative to a group there
        state.hingeTurn = new THREE.Group();
        state.hingeTurn.position.copy(pivot.position);
        const cover = shell("HingeCover");
        // its bounds before it's placed, moved by where it's placed. the halves' boxes stop at the hinge line, and closed
        // in landscape the fingers curl round the cover, which went through it unseen
        const coverBox = cameraSolid(cover);
        cover.position.copy(pivot.position).negate();
        state.hingeSolid = { min: new THREE.Vector3(...coverBox.min).add(cover.position).toArray(), max: new THREE.Vector3(...coverBox.max).add(cover.position).toArray() };
        state.hingeTurn.add(cover);
        hinged.add(state.hingeTurn);
        state.cameraSolid = cameraSolid(bakePart(state.phoneModel.parts.CameraBlock, UNITS));
    }
    // the screens are textured parts of the model, drawn in the same pass as the phone, so the home screen can't drift
    // from it the way warped html behind the canvas did. the halves overlap a hair at the hinge so no seam shows
    const seam = 0.02;
    const glass = glassUniforms();
    const screenMaterial = glassMaterial(glass, PX_PER_CM);
    const coverMaterial = glassMaterial(glass, PX_PER_CM);
    const flapScreen = hole(-halfScreenW, seam, -sy, sy, [screenR, 0.001, 0.001, screenR], false);
    flapScreen.material = screenMaterial;
    flap.add(flapScreen);
    const bodyScreen = hole(-seam, halfScreenW, -sy, sy, [0.001, screenR, screenR, 0.001], false);
    bodyScreen.material = screenMaterial;
    body.add(bodyScreen);
    const coverX = -halfW / 2;
    const coverScreen = hole(coverX - DUO.coverW / 2, coverX + DUO.coverW / 2, -DUO.coverH / 2, DUO.coverH / 2, Array(4).fill(DUO.coverR), true);
    coverScreen.material = coverMaterial;
    flap.add(coverScreen);


    state.flap = flap;
    state.body = body;
    state.hands = null;

    const handKind = settings.hands;
    if (handKind.startsWith("hands") && state.handModel) {
        root.add(attachHands());
    }

    const z = DUO.depth / 2 + 0.003;

    // reference: open, for the inner screen's layout and the uvs of both halves
    setFold(0);
    root.updateMatrixWorld(true);
    const full = surfaceCorners(body, -halfScreenW, halfScreenW, -sy, sy, z);
    const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    mapScreenUV(flapScreen, rootInverse, full);
    mapScreenUV(bodyScreen, rootInverse, full);

    // reference: closed, for the cover screen on the back of the flap
    setFold(1);
    root.updateMatrixWorld(true);
    const cover = surfaceCorners(flap, coverX - DUO.coverW / 2, coverX + DUO.coverW / 2, -DUO.coverH / 2, DUO.coverH / 2, -DUO.depth / 2 - 0.003);
    mapScreenUV(coverScreen, new THREE.Matrix4().copy(root.matrixWorld).invert(), cover);
    // the cover's content plane is where the cover lies when closed, in the body's frame
    const bodyInverse = new THREE.Matrix4().copy(body.matrixWorld).invert();
    const coverPlane = cover.corners.map((c) => c.clone().applyMatrix4(flap.matrixWorld).applyMatrix4(bodyInverse));
    setFold(pose.fold);

    const fullW = full.width * PX_PER_CM;
    const fullH = full.height * PX_PER_CM;
    const radius = `${screenR * PX_PER_CM}px`;

    // the html home screen stays, invisible, on top of the textured one so the icons still take clicks, and its live
    // layout is what the texture is drawn from
    // where a point in the body's frame lands on the open inner screen, in its px
    const [innerTl, innerTr, innerBl] = full.corners;
    const innerU = innerTr.clone().sub(innerTl);
    const innerV = innerBl.clone().sub(innerTl);
    const toInnerPx = (p) => {
        const rel = p.clone().sub(innerTl);
        return [(rel.dot(innerU) / innerU.lengthSq()) * fullW, (rel.dot(innerV) / innerV.lengthSq()) * fullH];
    };
    const pxBounds = (points) => {
        const px = points.map(toInnerPx);
        const xs = px.map((q) => q[0]);
        const ys = px.map((q) => q[1]);
        return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    };
    const coverW = cover.width * PX_PER_CM;
    const coverH = cover.height * PX_PER_CM;
    // closed, the cover lies right over the body's half of the inner screen. its content continues there when opened,
    // in the same layout and the same spot, and the flap's half gets widgets
    const mainRect = { ...pxBounds(coverPlane), w: coverW, h: coverH };
    const sideRect = pxBounds([new THREE.Vector3(-halfScreenW, -sy, 0), new THREE.Vector3(0, sy, 0)]);
    const placePanel = (el, r) => Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });

    const homeEl = makeScreenEl("screen hit", fullW, fullH, radius);
    const sidePanel = document.createElement("div");
    sidePanel.className = "panel side";
    sidePanel.appendChild(buildWidgets(homeEl));
    placePanel(sidePanel, sideRect);
    const mainPanel = document.createElement("div");
    mainPanel.className = "panel main";
    mainPanel.appendChild(buildHomeContent(tapApp));
    placePanel(mainPanel, mainRect);
    homeEl.append(sidePanel, mainPanel);
    fillGithub(homeEl);
    fitLines(homeEl);
    applyStatus(homeEl);
    // the weather sky behind the icons, at the inner screen's px
    state.wallpaper = createWallpaper(renderer, { width: fullW, height: fullH, ...currentWeather() });
    const sky = state.wallpaper.texture;
    // the sky blurred, for the widgets' frosted glass to show
    state.frost = createBlur(renderer, sky, fullW, fullH);
    const frosted = { frost: state.frost.texture, skyAspect: fullW / fullH, light: state.wallpaper.uniforms };
    const homeLayers = drawHome(homeEl, 2, null, true, false);
    const homeIcons = iconTexture(homeLayers.base);
    const homeInk = iconTexture(homeLayers.ink);
    const homeComposite = createComposite(renderer, {
        width: homeIcons.image.width,
        height: homeIcons.image.height,
        sky,
        icons: homeIcons,
        ink: homeInk,
        skyRect: skyRectFor(fullW, fullH, { x: 0, y: 0, w: fullW, h: fullH }),
        size: { w: fullW, h: fullH },
        ...frosted
    });
    screenMaterial.map = homeComposite.texture;
    // the cover is a home screen too, with its own invisible html on top for taps. tapping an app there unfolds the
    // phone straight into it. its wallpaper is the part of the inner one it lies over
    const coverEl = makeScreenEl("screen hit", coverW, coverH, `${DUO.coverR * PX_PER_CM}px`);
    coverEl.appendChild(buildHomeContent(tapFromCover));
    applyStatus(coverEl);
    const coverFrame = { x: -mainRect.x, y: -mainRect.y, w: fullW, h: fullH };
    const coverLayers = drawHome(coverEl, 2, coverFrame, true, false);
    const coverIcons = iconTexture(coverLayers.base);
    const coverInk = iconTexture(coverLayers.ink);
    const coverComposite = createComposite(renderer, {
        width: coverIcons.image.width,
        height: coverIcons.image.height,
        sky,
        icons: coverIcons,
        ink: coverInk,
        skyRect: skyRectFor(coverW, coverH, coverFrame),
        size: { w: coverW, h: coverH },
        ...frosted
    });
    coverMaterial.map = coverComposite.texture;

    // the app window cutout, a rounded rect in home screen px mapped onto the body's screen plane
    const [tl, tr, bl] = full.corners;
    const appHole = new THREE.Mesh(new THREE.ShapeGeometry(roundedRectShape(-halfScreenW, halfScreenW, -sy, sy, Array(4).fill(screenR)), 10), appWindowMaterial());
    appHole.position.z = DUO.depth / 2 + 0.004;
    appHole.renderOrder = 2;
    appHole.visible = false;
    appHole.material.uniforms.tl.value.set(tl.x, tl.y);
    appHole.material.uniforms.u.value.set((tr.x - tl.x) / fullW, (tr.y - tl.y) / fullW);
    appHole.material.uniforms.v.value.set((bl.x - tl.x) / fullH, (bl.y - tl.y) / fullH);
    body.add(appHole);
    // the screen's facing in the body, for how far the phone is tilted from looking straight at the camera
    const [nTl, nTr, nBl] = full.corners;
    const normal = new THREE.Vector3().subVectors(nTr, nTl).cross(new THREE.Vector3().subVectors(nBl, nTl)).normalize();
    state.screen = { material: screenMaterial, texture: homeComposite.texture, icons: homeIcons, composite: homeComposite, appHole, full, fullW, fullH, radiusPx: screenR * PX_PER_CM, homeEl, normal, ink: homeInk };
    state.homeLaidOut = false;
    state.cover = { material: coverMaterial, icons: coverIcons, ink: coverInk, composite: coverComposite, el: coverEl, frame: coverFrame };
    setGlassPlane(screenMaterial, full.corners, fullW, fullH);
    setGlassPlane(coverMaterial, coverPlane, coverW, coverH);
    state.glass = glass;
    applyDaylight();
    applyWeather();
    applyWallpaperMotion();
    showMusic();

    // the app is laid out at its final full window size and shrunk onto the screen, like the ios open animation
    const { appW, appH } = state.poses;
    const appEl = makeScreenEl("screen in-app", appW, appH, `${(screenR * appW) / full.width}px`);
    appEl.style.background = APP_BACKGROUND;
    const appSplash = document.createElement("div");
    appSplash.className = "app-splash";
    appEl.appendChild(appSplash);
    state.appSplash = appSplash;
    state.appEl = appEl;
    state.appLive = null;

    state.surfaces = {
        home: { el: homeEl, w: fullW, h: fullH, owner: body, corners: full.corners },
        app: { el: appEl, w: appW, h: appH, owner: body, corners: full.corners },
        // #page itself, at the window's size and centered in the app window the way the spike laid out its copy
        page: { el: pageEl, w: innerWidth, h: innerHeight, owner: body, corners: full.corners },
        cover: { el: coverEl, w: coverW, h: coverH, owner: flap, corners: cover.corners }
    };
    setAppVisible(false);

    state.charger = chargerModule ? buildCharger(root, flap) : null;

    scene.add(root);
    // the phone's screen glow rides in front of the screen, wherever the phone is
    root.add(phoneGlow);
    phoneGlow.position.set(0, 0, 4);
    if (state.charger) {
        compileCharger();
    }
    backdrop.prewarm(renderer);
    focusBlur.prewarm();
};
