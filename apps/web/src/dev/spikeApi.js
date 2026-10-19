// window.spike, the debugging and baking api the rebake scripts (tools/REBAKE.md) and the pose comparison drive. it
// loads in dev with ?dev, and reaches into the scene's modules directly
import * as THREE from "three";
import { drawHome, drawGradient } from "../scene/screens.js";
import { glassFor } from "../scene/skyLevel.js";
import { state, pose, DUO } from "../scene/state.js";
import { cancelAll, ease } from "../scene/tween.js";
import { renderer, scene, camera, backdrop, hemiLight, keyLight, weather, currentWeather, setHourOverride, applyDaylight } from "../scene/renderer.js";
import { reducedMotion, skyMotion, setSkyMotion, applyWallpaperMotion } from "../scene/quality.js";
import { centerComp, setFold, keyOptions, handKeys } from "../scene/device.js";
import { music, statusBar, siteData, refreshStatus } from "../scene/home.js";
import { openApp, closeApp } from "../scene/appWindow.js";
import { moveAt, foldStartTime, moveTotal, MOVE } from "../scene/intro.js";
import { closePhone, openPhone, phoneEdges, gestureFor } from "../scene/fold.js";
import { idleDrift } from "../scene/loop.js";
import { sceneStarted } from "../scene/index.js";
import { settleLimit } from "../scene/navigation.js";
import { showDaylight } from "./panel.js";

// found by searching against grip targets in device space, each hand separately since the rig's hands aren't exact mirrors
// grips from the apple and cnet references, found by spike.search with skin collision. q is the base orientation:
// BEHIND has the palm against the back with the fingers up and inward, the way both hands hold the open duo
const quatFromBasis = (x, y, z) => {
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z)));
    return [q.x, q.y, q.z, q.w];
};
// ONE_HAND is the right hand alone on the closed duo, palm on the back with the fingers crossing it toward the hinge edge
const ONE_HAND = quatFromBasis([0.6, 0.8, 0], [0.8, -0.6, 0], [0, 0, -1]);
const BEHIND = {
    Left: quatFromBasis([0.707, -0.707, 0], [0.707, 0.707, 0], [0, 0, 1]),
    Right: quatFromBasis([0.707, 0.707, 0], [0.707, -0.707, 0], [0, 0, -1])
};

const POSES = {
    leftOpen: { q: BEHIND.Left, px: -16.8, py: -13.8, pz: -0.3, yaw: 23.6, pitch: 15.7, roll: -4.1, c1: -9.9, c2: 31.7, c3: 13.3, dI: -0.6, dM: -9.4, dR: -6.8, dP: -3.4, t1x: -11.4, t1z: -4.7, t2: 36.7, t3: 80 },
    rightClosed: { q: ONE_HAND, px: 7.7, py: -6.6, pz: -3.8, yaw: 5.8, pitch: -21.4, roll: -19.6, c1: 27.7, c2: 42.4, c3: 65.2, dI: 4.3, dM: -1.4, dR: 0.5, dP: -5.2, t1x: 40.8, t1z: 50, t2: 31.9, t3: 79.9 },
    rightLift: { q: ONE_HAND, px: 7.7, py: -6.6, pz: -3, yaw: 13, pitch: -21.4, roll: -14.1, c1: 27.7, c2: 42.4, c3: 65.2, dI: 4.3, dM: -1.4, dR: 0.5, dP: -5.2, t1x: 41.5, t1z: 50, t2: 41.2, t3: 62.7 },
    rightOpen: { q: BEHIND.Right, px: 12.6, py: -17.3, pz: -1.8, yaw: 16.6, pitch: -4.5, roll: 16.1, c1: -14.5, c2: 7.3, c3: 12.8, dI: 7, dM: -1.3, dR: -0.8, dP: -12.1, t1x: 5, t1z: -9, t2: 42.9, t3: 44.5 }
};

// true when the straight line from the camera to a world point passes through either half first
const blockedByDevice = (point) => {
    const from = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    return [
        { half: state.body, min: [0, -DUO.bodyH / 2, -DUO.depth / 2], max: [DUO.halfW, DUO.bodyH / 2, DUO.depth / 2] },
        { half: state.flap, min: [-DUO.halfW, -DUO.bodyH / 2, -DUO.depth / 2], max: [0, DUO.bodyH / 2, DUO.depth / 2] }
    ].some(({ half, min, max }) => {
        const inverse = new THREE.Matrix4().copy(half.matrixWorld).invert();
        const a = from.clone().applyMatrix4(inverse);
        const b = point.clone().applyMatrix4(inverse);
        let t0 = 0;
        let t1 = 0.999;
        for (let i = 0; i < 3; i++) {
            const d = b.getComponent(i) - a.getComponent(i);
            const o = a.getComponent(i);
            if (Math.abs(d) < 1e-9) {
                if (o < min[i] || o > max[i]) {
                    return false;
                }
                continue;
            }
            let ta = (min[i] - o) / d;
            let tb = (max[i] - o) / d;
            if (ta > tb) {
                [ta, tb] = [tb, ta];
            }
            t0 = Math.max(t0, ta);
            t1 = Math.min(t1, tb);
            if (t0 > t1) {
                return false;
            }
        }
        return true;
    });
};

const spike = {
    state,
    pose,
    POSES,
    BEHIND,
    statusBar,
    backdrop,
    charger: () => state.charger,
    camera: () => camera,
    renderer: () => renderer,
    // renders the scene (no background) from a camera at eye looking at target, both in the device frame, as an image
    // url. for looking at things the main camera can't see, like the hand's grip on the plug
    snapshot: (eye, target, size = 600, fov = 30) => {
        const cam = new THREE.PerspectiveCamera(fov, 1, 0.1, 500);
        state.root.updateMatrixWorld(true);
        cam.position.copy(new THREE.Vector3(...eye).applyMatrix4(state.root.matrixWorld));
        cam.up.set(0, 1, 0).applyQuaternion(state.root.getWorldQuaternion(new THREE.Quaternion()));
        cam.lookAt(new THREE.Vector3(...target).applyMatrix4(state.root.matrixWorld));
        const rt = new THREE.WebGLRenderTarget(size, size, { colorSpace: THREE.SRGBColorSpace });
        renderer.setRenderTarget(rt);
        renderer.setClearColor(0x3a3d44, 1);
        renderer.clear();
        renderer.render(scene, cam);
        const pixels = new Uint8Array(size * size * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
        renderer.setRenderTarget(null);
        renderer.setClearColor(0x000000, 0);
        rt.dispose();
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const image = ctx.createImageData(size, size);
        for (let y = 0; y < size; y++) {
            image.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
        }
        ctx.putImageData(image, 0, 0);
        return canvas.toDataURL("image/jpeg", 0.9);
    },
    // draw calls, triangles, and gpu objects for the last frame, for judging what a phone has to do
    renderInfo: () => ({ ...renderer.info.render, ...renderer.info.memory, programs: renderer.info.programs.length, pixelRatio: renderer.getPixelRatio(), size: renderer.getSize(new THREE.Vector2()).toArray() }),
    // pins the hour for the room's light (null goes back to the clock), and says what it's set to
    daylight: (hour) => {
        if (hour !== undefined) {
            setHourOverride(hour);
            showDaylight();
        }
        return applyDaylight();
    },
    // what's playing, for checking the music card and app
    music: () => music.state(),
    // how many moves the navigation's settle makes for one target, lowered by the tests to land a navigation on the last
    settleLimit,
    // what the route answered, and what the sky is showing
    weather: () => ({ data: weather, showing: currentWeather(), level: skyMotion.level, still: reducedMotion.matches || skyMotion.level >= 2 }),
    // pins how far the sky and the glass are turned down (see skyLevel.js), as a slow device would, for testing
    skyLevel: (level) => {
        setSkyMotion({ level, slow: 0, fast: 0, retried: true });
        applyWallpaperMotion();
        return glassFor(level);
    },
    refreshStatus: () => refreshStatus(),
    // the composite against the old canvas, with the old gradient standing in for the sky. a color space or alpha
    // mistake shows as tens of levels, rounding as one or two. over counts channels more than 3 levels off
    checkComposite: () => {
        // the icon canvas is redrawn first, or a clock that ticked since its last draw would differ from the reference
        refreshStatus(true);
        const { homeEl, composite } = state.screen;
        // the two layers flattened, the ink over the base. the glass cards and the ink's darkening over a bright sky
        // aren't in the old canvas, so they show up as differences here
        const layers = drawHome(homeEl, 2);
        const reference = layers.base;
        reference.getContext("2d").setTransform(1, 0, 0, 1, 0, 0);
        reference.getContext("2d").drawImage(layers.ink, 0, 0);
        const stand = new THREE.CanvasTexture(drawGradient(homeEl.offsetWidth, homeEl.offsetHeight, 2));
        stand.colorSpace = THREE.NoColorSpace;
        const sky = composite.sky();
        composite.setSky(stand);
        composite.render();
        const { width, height } = composite.target;
        const pixels = new Uint8Array(width * height * 4);
        renderer.readRenderTargetPixels(composite.target, 0, 0, width, height, pixels);
        composite.setSky(sky);
        stand.dispose();
        if (reference.width !== width || reference.height !== height) {
            return { error: `the canvas is ${reference.width} x ${reference.height} and the composite ${width} x ${height}` };
        }
        const ref = reference.getContext("2d").getImageData(0, 0, width, height).data;
        let max = 0;
        let over = 0;
        let at = null;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // the target's rows run bottom up, the canvas's top down
                const a = ((height - 1 - y) * width + x) * 4;
                const b = (y * width + x) * 4;
                for (let c = 0; c < 3; c++) {
                    const d = Math.abs(pixels[a + c] - ref[b + c]);
                    if (d > max) {
                        max = d;
                        at = { x, y, composite: Array.from(pixels.subarray(a, a + 4)), canvas: Array.from(ref.subarray(b, b + 4)) };
                    }
                    if (d > 3) {
                        over++;
                    }
                }
            }
        }
        return { max, over, at, width, height };
    },
    closePhone: () => closePhone(),
    openPhone: () => openPhone(),
    // the about and home steps of the pose comparison, the way the site's navigation calls them
    openApp: (name, opts) => openApp(siteData.apps.find((a) => a.name === name), opts),
    closeApp: () => closeApp(),
    phoneEdges: () => phoneEdges(),
    gestureFor: (x, y) => gestureFor(x, y),
    // screen px of both halves' outer corners, posed exactly as the next frame will draw them
    poseCorners: () => {
        const drift = idleDrift(performance.now() / 1000, pose.idle);
        state.root.position.set(pose.x + drift.x, pose.y + centerComp(pose.fold) + drift.y, pose.z + drift.z);
        state.root.rotation.set(pose.rx, pose.ry, pose.rz);
        setFold(pose.fold);
        state.root.updateMatrixWorld(true);
        const pts = [[-DUO.halfW, state.flap], [DUO.halfW, state.body]].flatMap(([x, frame]) => [-1, 1].map((sy) => {
            const v = new THREE.Vector3(x, (sy * DUO.bodyH) / 2, 0).applyMatrix4(frame.matrixWorld).project(camera);
            return [(v.x + 1) * 0.5 * innerWidth, (1 - v.y) * 0.5 * innerHeight];
        }));
        return pts;
    },
    // where the flap's outer edge is on screen right now, in px
    flapEdge: () => {
        state.root.updateMatrixWorld(true);
        const v = new THREE.Vector3(-DUO.halfW, 0, 0).applyMatrix4(state.flap.matrixWorld).project(camera);
        return { x: (v.x + 1) * 0.5 * innerWidth, y: (1 - v.y) * 0.5 * innerHeight };
    },
    // the four corners of the closed slab (the body half's box) in screen space, all within the window means in view
    closedInView: (p) => {
        state.root.position.set(p.x, p.y + centerComp(p.fold), p.z);
        state.root.rotation.set(p.rx, p.ry, p.rz);
        setFold(p.fold);
        state.root.updateMatrixWorld(true);
        const corners = [[0, -1], [DUO.halfW, -1], [0, 1], [DUO.halfW, 1]].map(([x, s]) => new THREE.Vector3(x, (s * DUO.bodyH) / 2, 0).applyMatrix4(state.body.matrixWorld).project(camera));
        // margins as a share of the window: bottom is the gap under the slab, side is the tighter of left and right
        const bottom = (Math.min(...corners.map((v) => v.y)) + 1) / 2;
        const top = (1 - Math.max(...corners.map((v) => v.y))) / 2;
        const side = Math.min(...corners.map((v) => (1 - Math.abs(v.x)) / 2));
        return { inView: corners.every((v) => Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1), bottom: +bottom.toFixed(3), top: +top.toFixed(3), side: +side.toFixed(3) };
    },
    // poses the scene like the render loop does (no idle sway) and counts wrist cut points inside the window
    wristOnScreen: (p) => {
        state.root.position.set(p.x, p.y + centerComp(p.fold), p.z);
        state.root.rotation.set(p.rx, p.ry, p.rz);
        setFold(p.fold);
        state.root.updateMatrixWorld(true);
        state.hands.update(p.fold);
        let inside = 0;
        let total = 0;
        const mean = {};
        ["Left", "Right"].forEach((side) => {
            let sx = 0;
            let sy = 0;
            let n = 0;
            state.hands.wristPoints(side).forEach((w) => {
                total += 1;
                const hidden = blockedByDevice(w);
                const v = w.clone().project(camera);
                sx += v.x;
                sy += v.y;
                n += 1;
                if (!hidden && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1) {
                    inside += 1;
                }
            });
            mean[side] = [Math.round((sx / n) * 100) / 100, Math.round((sy / n) * 100) / 100];
        });
        return { inside, total, mean };
    },
    timeline: (fast) => ({ start: fast ? state.poses.fastStart : state.poses.fullStart, stage: state.poses.stage, rest: state.poses.rest }),
    moveAt: (ms) => moveAt(ms, state.poses.fullStart, state.poses.rest),
    foldStartTime: () => foldStartTime(state.poses.fullStart, state.poses.rest),
    moveTotal,
    MOVE,
    ease,
    // lighting experiments: spike.light({ hemi, key, env, tone: "ACES" | "Neutral" | "AgX", exposure })
    light: ({ hemi, key, env, tone, exposure } = {}) => {
        if (hemi !== undefined) {
            hemiLight.intensity = hemi;
        }
        if (key !== undefined) {
            keyLight.intensity = key;
        }
        if (env !== undefined) {
            scene.environmentIntensity = env;
        }
        if (tone) {
            renderer.toneMapping = { ACES: THREE.ACESFilmicToneMapping, Neutral: THREE.NeutralToneMapping, AgX: THREE.AgXToneMapping }[tone];
        }
        if (exposure !== undefined) {
            renderer.toneMappingExposure = exposure;
        }
        return { hemi: hemiLight.intensity, key: keyLight.intensity, env: scene.environmentIntensity, exposure: renderer.toneMappingExposure };
    },
    // mean rendered skin color over every visible hand pixel, plus the share of hand pixels that are near white:
    // renders once as is and once with the hands flat green, and the green pixels mark where the hands are
    skinStats: () => {
        const gl = renderer.getContext();
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const read = () => {
            const buf = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            return buf;
        };
        renderer.render(scene, camera);
        const color = read();
        const mesh = state.handModel.mesh;
        const original = mesh.material;
        mesh.material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const savedTone = renderer.toneMapping;
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.render(scene, camera);
        const mask = read();
        mesh.material = original;
        renderer.toneMapping = savedTone;
        let n = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        let bright = 0;
        for (let i = 0; i < mask.length; i += 4) {
            if (mask[i + 1] > 200 && mask[i] < 60 && mask[i + 2] < 60) {
                n += 1;
                r += color[i];
                g += color[i + 1];
                b += color[i + 2];
                if (color[i + 1] > 215 && color[i + 2] > 205) {
                    bright += 1;
                }
            }
        }
        return n ? { pixels: n, mean: [r / n, g / n, b / n].map(Math.round), nearWhite: Math.round((bright / n) * 100) + "%" } : { pixels: 0 };
    },
    // renders once and reads the canvas pixel under a css point, to compare rendered skin with the texture
    pixel: (x, y) => {
        renderer.render(scene, camera);
        const gl = renderer.getContext();
        const dpr = renderer.getPixelRatio();
        const out = new Uint8Array(4);
        gl.readPixels(Math.round(x * dpr), Math.round((innerHeight - y) * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return Array.from(out);
    },
    ONE_HAND,
    around: (p, dp, da) => ({
        px: [p.px - dp, p.px + dp], py: [p.py - dp, p.py + dp], pz: [p.pz - dp, p.pz + dp],
        yaw: [p.yaw - da, p.yaw + da], pitch: [p.pitch - da, p.pitch + da], roll: [p.roll - da, p.roll + da],
        c1: [-15, 70], c2: [-10, 80], c3: [-10, 60], dI: [-20, 20], dM: [-20, 20], dR: [-20, 20], dP: [-20, 20],
        t1x: [-50, 50], t1z: [-50, 50], t2: [-10, 60], t3: [-10, 80]
    }),
    PRIOR: { c1: [15, 0.002], c2: [20, 0.002], c3: [10, 0.002], dI: [0, 0.003], dM: [0, 0.003], dR: [0, 0.003], dP: [0, 0.003] },
    bonesAt: (side, names) => {
        state.root.updateMatrixWorld(true);
        const inverse = state.root.matrixWorld.clone().invert();
        return names.map((n) => {
            const bone = state.handModel.bones[n === "wrist" ? `J_${side}` : n === "Hand" ? `J_${side}_Hand` : `J_${side}_Hand${n}`];
            return n + " " + bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse).toArray().map((v) => v.toFixed(1)).join(",");
        });
    },
    show: (keys, fold, view = {}) => {
        state.hands.setKeys(keys, keyOptions());
        Object.assign(pose, state.poses.rest, { fold, idle: 0, blur: 0 }, view);
        cancelAll();
        state.busy = false;
    },
    search: (spec) => state.hands.search(spec),
    sweep: (steps) => state.hands.sweep(steps),
    sample: (side, fold) => state.hands.sample(side, fold),
    detail: (side, fold) => state.hands.detail(side, fold),
    // bakes one hand from the authored keys in `authored`, `steps` frames from fold 1 to 0, a chunk at a time
    // `wOther` weighs in the other hand, posed from `authored` (pass its baked keys there to bake around them)
    bake: (side, authored, steps, frameFor, from = 0, to = steps, done = [], wOther = 0, holdFor = () => 0) => {
        for (let i = from; i <= Math.min(to, steps); i++) {
            state.hands.setKeys(authored);
            const fold = 1 - i / steps;
            const last = done[done.length - 1];
            done.push(state.hands.bakeStep({ side, fold, prevFold: last ? last.fold : null, prev: last ? last.pose : null, frame: frameFor(fold), wOther, hold: holdFor(fold) }));
        }
        return done;
    },
    // searches near the blended pose at `fold` for the closest pose with no overlap, riding the given frame
    fix: (side, fold, frame, keysIn, spread = 1.5, turn = 12, samples = 2500) => {
        state.hands.setKeys(keysIn);
        const seed = state.hands.sample(side, fold);
        const vary = { px: [seed.px - spread, seed.px + spread], py: [seed.py - spread, seed.py + spread], pz: [seed.pz - spread, seed.pz + spread], yaw: [-turn, turn], pitch: [-turn, turn], roll: [-turn, turn] };
        ["c1", "c2", "c3", "dI", "dM", "dR", "dP", "t1x", "t1z", "t2", "t3"].forEach((n) => {
            vary[n] = [seed[n] - 20, seed[n] + 20];
        });
        const prior = { px: [seed.px, 0.3], py: [seed.py, 0.3], pz: [seed.pz, 0.3], yaw: [0, 0.002], pitch: [0, 0.002], roll: [0, 0.002] };
        const result = state.hands.search({ side, fold, base: seed, vary, prior, samples });
        result.pose.q = seed.q;
        result.key = { fold, frame, pose: result.pose };
        return result;
    },
    // searches one held key again with the hand's parts drawn onto the phone (hands.js contact), from the blended pose
    // at its fold, for keys made against a different hand's skin
    // `wOther` weighs in the other hand where its keys put it at this fold, and `targets` pulls bone points toward
    // device positions, as search takes them
    touch: (side, fold, frame, keysIn, spread = 2, turn = 20, joint = 40, samples = 6000, tries = 5, { wOther = 0, targets = {} } = {}) => {
        const runs = Math.max(1, tries);
        state.hands.setKeys(keysIn);
        setFold(fold);
        state.root.updateMatrixWorld(true);
        state.hands.update(fold);
        const seed = state.hands.sample(side, fold);
        const vary = { px: [seed.px - spread, seed.px + spread], py: [seed.py - spread, seed.py + spread], pz: [seed.pz - spread, seed.pz + spread], yaw: [-turn, turn], pitch: [-turn, turn], roll: [-turn, turn] };
        ["c1", "c2", "c3", "dI", "dM", "dR", "dP", "t1x", "t1z", "t2", "t3"].forEach((n) => {
            vary[n] = [seed[n] - joint, seed[n] + joint];
        });
        const prior = { px: [seed.px, 0.3], py: [seed.py, 0.3], pz: [seed.pz, 0.3], yaw: [0, 0.002], pitch: [0, 0.002], roll: [0, 0.002] };
        // scored like a holding bake step (hands.js contactWeights), and the best of a few runs kept, since one run's
        // cost varied from under 1 to over 100 and a poor one left parts a millimeter or two off or in
        const { contact, wDevice, margin } = state.hands.contactWeights;
        let best = null;
        for (let i = 0; i < runs; i++) {
            const result = state.hands.search({ side, fold, base: seed, vary, prior, samples, rounds: 4, wDevice, wSelf: 400, wOther, targets, strides: [4, 1], margin, thumbFront: true, contact });
            if (!best || result.cost < best.cost) {
                best = result;
            }
        }
        best.pose.q = seed.q;
        // the last run left the hand at its own pose, so the best one is placed again before its gaps are measured
        state.hands.measure(side, best.pose, fold);
        return { key: { fold, frame, pose: best.pose }, gaps: state.hands.contactGaps(side), deviceMax: best.deviceMax, selfMax: best.selfMax, cost: best.cost };
    },
    measure: (side, p, fold) => state.hands.measure(side, p, fold),
    setKeys: (keys) => state.hands.setKeys(keys),
    rekey: () => state.hands.setKeys(handKeys(), keyOptions()),
    devicePoint: (frame, local, fold) => {
        setFold(fold);
        state.root.updateMatrixWorld(true);
        const half = state[frame];
        const point = new THREE.Vector3(...local).applyMatrix4(half.matrixWorld);
        const result = point.applyMatrix4(state.root.matrixWorld.clone().invert()).toArray().map((v) => Math.round(v * 100) / 100);
        setFold(pose.fold);
        return result;
    },
    handKeys,
    freeze: (values) => {
        cancelAll();
        state.busy = false;
        Object.assign(pose, values);
    }
};

// the status bar and the backdrop are made when the scene starts
sceneStarted.then(() => {
    spike.statusBar = statusBar;
    spike.backdrop = backdrop;
    window.spike = spike;
});
