import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { segmentDistance, handMatrix } from "./hands.js";

// the battery easter egg's cable. when the battery hits 1% the left hand lets go, reaches down out of view, comes back
// pinching a white usb c plug and pushes it into the port on the flap's bottom edge (the half with the cover screen,
// so the left panel open in landscape, the top one in portrait, per apple's product shots), then goes back to its grip. in
// portrait the port is on the phone's left side, so the hand holds the plug in a pinch posed for it (keys/pinch.json),
// with the wrist still coming from below, instead of the key grip, which would turn the whole forearm in from the side. at
// 100% it does the same in reverse. the plug and the cable live in the device frame (the root), the cable trails out of
// view below, and the hand is pulled toward its targets through the hands module's override

// apple's current woven usb c cable, in cm. the metal tip is the usb c size (a pill 8.25 by 2.4 mm), the white housing
// is about one and a half times as long as it is wide with the tip filling most of its width (from apple's product
// photo), and the woven cable comes straight out of it through a thin lip, with no tapered strain relief
const SHELL = { w: 0.825, h: 0.66, d: 0.24 };
const HOUSING = { w: 0.95, h: 1.4, d: 0.5 };
const COLLAR = 0.08;
const CABLE_RADIUS = 0.17;
// the weave's period along the cable, and how many times it goes around
const WEAVE = 0.28;
const WEAVE_AROUND = 4;
// how far out from the port the plug lines up before it goes in, and where the hand fetches it from, out of view
const LINE_UP = 2.4;
// cm between the top of the fist and the phone's edge once the plug is in
const HOLD_CLEAR = 0.1;
// the plug turned in the fist around the squeeze, so the hand sits to the left of the cable with the thumb lying across
// its front, the way a left hand holds a cable it's about to plug in
const PLUG_TILT = THREE.MathUtils.degToRad(-69.1);
const FETCH = new THREE.Vector3(-4, -18, 2);
// the cable's far end, well below the frame
const TRAIL = new THREE.Vector3(-4, -45, 6);
// where the cable heads once it's past the fist, from 9 cm below the plug
const BEND = new THREE.Vector3(-1, -3, 1.5);

// the left hand in a key grip, the way people hold a plug: the pad of the thumb's last segment presses the plug's front
// face against the side of the index finger's middle segment, with the thumb lying across the front (nail toward the
// viewer), the index curled behind, and the other fingers curled below. found by searching the rig's joints for skin
// touching both flat faces, no finger in the plug or in the cable's path down through the fist, and no thumb in the
// fingers. the fist reaches about 1.2 cm above the squeeze, and the plug is held that far down so the fist stays clear
// of the phone's edge
const PINCH = { px: 0, py: 0, pz: 0, yaw: 0, pitch: 0, roll: 0, c1: 81.3, c2: 91.3, c3: 25, dI: 4.8, dM: -0.1, dR: 5.6, dP: 2.1, t1x: -20, t1z: 49.8, t2: 42.6, t3: 23.9 };
// letting go: the fist loosens so the fingers stand 1.7 mm off the plug and the thumb 6 mm, clear of the phone and the
// cable, solved in place with the plug in the port
let OPEN = { ...PINCH, c1: 74.1, c2: 100.6, c3: 22.2, dI: 4.5, dM: 3.8, dR: 5, dP: -2, t1x: -14, t1z: 50, t2: 42.1, t3: 30.4 };

// where the thumb passes while the fingers curl or uncurl, lifted clear of the index. going straight from the hold to the
// grip, the curling index swept through the thumb (up to 6 mm in). searched against the four baked holds (portrait
// and landscape, open and closed), to the grip and to the release, with no overlap at any step
const THUMB_VIA = { t1x: 15.1, t1z: 43.9, t2: 13.6, t3: 36.7 };
const THUMB_KEYS = ["t1x", "t1z", "t2", "t3"];
const JOINT_KEYS = ["c1", "c2", "c3", "dI", "dM", "dR", "dP", "sI", "sM", "sR", "sP", ...THUMB_KEYS];
// cm the hand moves on its way between the hold and the plug. first it slides 4 cm straight away from the other hand,
// since the two hands' fingers rest against each other behind the phone (the paths tried before this went through
// them, by up to 0.8 cm). then it swings outward from the middle of the phone, down past the port, and back behind the phone. the
// fingers curl around the cable with the gap toward the viewer, so going back lets the cable out through that gap
// instead of through a finger, and the swing keeps the fingers off the phone's edge
const ARC = { out: 3, down: 4, back: 5, backDelay: 0.1, backStart: 0, slide: 4, slideTime: 0.3 };
// where along the way from the hold (0) to the plug or the fetch (1) the hand turns between the two: only once it has
// slid clear of the other hand, and done before it's near the plug, since a turn swings the fingertips several cm (in
// portrait it turns about 107 degrees)
const TURN = { from: 0.3, to: 0.8 };
// how far the right hand opens (degrees of curl and thumb bend), swings its thumb out at the base (degrees), and eases
// out (cm) midway between its grips, so the thumb goes around the edge instead of through it
const SWAP = { open: 15, thumb: 15, out: 4, t1x: 25, t1z: 25 };
const turnAt = (f) => smooth(clamp01((f - TURN.from) / (TURN.to - TURN.from)));

const ease = {
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3)
};

// a pill (a rectangle with fully round ends) in the xy plane, w across and d thick
const pillShape = (w, d) => {
    const r = d / 2;
    const a = w / 2 - r;
    const shape = new THREE.Shape();
    shape.moveTo(-a, -r);
    shape.lineTo(a, -r);
    shape.absarc(a, 0, r, -Math.PI / 2, Math.PI / 2, false);
    shape.lineTo(-a, r);
    shape.absarc(-a, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
    return shape;
};

// the pill pushed out along +y from 0 to length, thin across z, like the usb c tip
const pillPrism = (w, d, length) => {
    const geometry = new THREE.ExtrudeGeometry(pillShape(w, d), { depth: length, bevelEnabled: false, curveSegments: 10 });
    geometry.rotateX(-Math.PI / 2);
    return geometry;
};

// a woven jacket: two sets of diagonal strands crossing over and under, light with soft shading between them
const weaveTexture = () => {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = (x + y) / size;
            const v = (x - y + size) / size;
            const a = Math.sin(u * Math.PI * 4);
            const b = Math.sin(v * Math.PI * 4);
            // which strand is on top switches every crossing, so it reads as woven instead of a grid
            const over = Math.sign(Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI * 2));
            const shade = 0.82 + 0.18 * Math.max(over > 0 ? Math.abs(a) : Math.abs(b), 0.15);
            const i = (y * size + x) * 4;
            image.data[i] = image.data[i + 1] = image.data[i + 2] = Math.round(255 * shade);
            image.data[i + 3] = 255;
        }
    }
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
};

const lerpJoints = (a, b, t) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + (b[k] - a[k]) * t]));
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(Math.max(t, 0), 1);
// from a baked pose (at 0) to `target` (at 1): the thumb lifts to THUMB_VIA first, the fingers curl in the middle, then
// the thumb comes down onto its place in the target
// how much of the path the thumb takes to leave the hold for the waypoint, and on the way back to settle onto the phone
// from it. short, so it lands once the hand is all but back instead of pressing into the glass on the way
const VIA = { leave: 0.12 };
// where along the way the fingers curl into the grip (and on the way back, open out of it), once they're clear of the
// phone's back
const CURL = { from: 0.35, to: 0.85 };
const viaThumb = (target) => (baked, u) => {
    const curl = smooth(clamp01((u - CURL.from) / (CURL.to - CURL.from)));
    const out = { ...baked };
    JOINT_KEYS.forEach((k) => {
        if (!THUMB_KEYS.includes(k)) {
            // the key grip has no spreads, so it leaves them at the rig's own
            out[k] = (baked[k] ?? 0) + ((target[k] ?? 0) - (baked[k] ?? 0)) * curl;
        } else if (u < VIA.leave) {
            out[k] = baked[k] + (THUMB_VIA[k] - baked[k]) * smooth(u / VIA.leave);
        } else if (u < 0.55) {
            out[k] = THUMB_VIA[k];
        } else {
            out[k] = THUMB_VIA[k] + (target[k] - THUMB_VIA[k]) * smooth((u - 0.55) / 0.45);
        }
    });
    return out;
};
const TO_PINCH = viaThumb(PINCH);

// the right hand takes its one handed grip before the left lets go, and the left has its grip back before the right
// returns to its own, so the phone always has a hand on it. `swap` is how long the right takes (0 when it has no one
// handed grip) and `run` how long the left hand's part is. gives the right hand's weight toward its one handed grip,
// and how far along its own part the left hand is
export const swapSchedule = (t, swap, run) => {
    const left = Math.min(Math.max(t - swap, 0), run);
    if (swap <= 0) {
        return { right: null, left };
    }
    const into = clamp01(t / swap);
    const out = clamp01((swap * 2 + run - t) / swap);
    return { right: smooth(Math.min(into, out)), left };
};
let TO_OPEN = viaThumb(OPEN);

export const createCharger = ({ root, frame, port, getHands, getBones, getSupport = () => null, getPinch = () => null, onChange = () => {} }) => {
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf5f5f3, roughness: 0.55, clearcoat: 0.15 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xc4c7cc, metalness: 1, roughness: 0.28 });
    const opening = new THREE.MeshBasicMaterial({ color: 0x141414 });
    const weave = weaveTexture();
    const braid = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.8, map: weave, bumpMap: weave, bumpScale: 0.6 });

    // the plug's own frame: +y points into the port, the shell sits in y 0 to SHELL.h, everything else below 0
    const plug = new THREE.Group();
    const shell = new THREE.Mesh(pillPrism(SHELL.w, SHELL.d, SHELL.h), metal);
    const mouth = new THREE.Mesh(new THREE.ShapeGeometry(pillShape(SHELL.w - 0.08, SHELL.d - 0.06), 6), opening);
    mouth.rotation.x = -Math.PI / 2;
    mouth.position.y = SHELL.h + 0.002;
    const housing = new THREE.Mesh(new RoundedBoxGeometry(HOUSING.w, HOUSING.h, HOUSING.d, 4, 0.18), white);
    housing.position.y = -HOUSING.h / 2;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(CABLE_RADIUS + 0.03, CABLE_RADIUS + 0.03, COLLAR, 20), white);
    collar.position.y = -HOUSING.h - COLLAR / 2;
    plug.add(shell, mouth, housing, collar);
    plug.visible = false;
    root.add(plug);

    const cable = new THREE.Mesh(new THREE.BufferGeometry(), braid);
    cable.visible = false;
    cable.frustumCulled = false;
    root.add(cable);

    const rootInverse = new THREE.Matrix4();
    const scratch = new THREE.Vector3();

    // the port's pose in the device frame: on the flap's bottom edge, with +y pointing into the phone
    const portPose = () => {
        rootInverse.copy(root.matrixWorld).invert();
        const m = new THREE.Matrix4().copy(rootInverse).multiply(frame.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(port.x, port.y, port.z));
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        m.decompose(position, quaternion, scratch);
        return { position, quaternion };
    };

    const along = (pose, distance) => pose.position.clone().add(new THREE.Vector3(0, 1, 0).applyQuaternion(pose.quaternion).multiplyScalar(distance));

    // the plug's pose in the hand's own frame for the key grip. the squeeze runs from the thumb's last segment to the
    // index's first knuckle and becomes the plug's thin axis, and the plug points out of the top of the fist (the hand's
    // own finger direction, squared to the squeeze). it's held far enough down the housing that the knuckles stay short
    // of the phone
    let grip = null;
    // the joints of this run's grip on the plug and its release, the key grip's unless a pinch is given
    let held = { pinch: PINCH, open: OPEN, toPinch: TO_PINCH, toOpen: TO_OPEN };
    // the thumb presses one flat face of the plug and the index knuckle the other, so the plug sits in the fist one of
    // two ways round. the hand takes the one with the thumb toward the viewer, which also keeps the fist behind the
    // phone. which one that is flips with the fold, since the port is on the flap
    // set from the console to try one turn, null to choose
    let fixedRoll = null;
    // which way the plug points in the hand: "thumb" along the thumb's last segment, "knuckles" the way the fist leads
    let aim = "knuckles";
    const chooseRoll = (plugInHand, thumb, index) => {
        const p = portPose();
        const plugM = new THREE.Matrix4().compose(p.position, p.quaternion, new THREE.Vector3(1, 1, 1));
        const thumbForward = (roll) => {
            const handM = plugM.clone().multiply(plugInHand.clone().multiply(new THREE.Matrix4().makeRotationY(roll)).invert());
            return thumb.clone().applyMatrix4(handM).z - index.clone().applyMatrix4(handM).z;
        };
        return thumbForward(0) >= thumbForward(Math.PI) ? 0 : Math.PI;
    };
    const measureGrip = () => {
        const hands = getHands();
        const bones = getBones();
        const pinch = getPinch();
        held = pinch
            ? { pinch: pinch.joints, open: pinch.release, toPinch: viaThumb(pinch.joints), toOpen: viaThumb(pinch.release) }
            : { pinch: PINCH, open: OPEN, toPinch: TO_PINCH, toOpen: TO_OPEN };
        hands.applyJoints("Left", held.pinch);
        const anchor = bones.J_Left.parent;
        anchor.updateMatrixWorld(true);
        const toAnchor = new THREE.Matrix4().copy(anchor.matrixWorld).invert();
        const skinToAnchor = toAnchor.clone().multiply(root.matrixWorld);
        // the hand's skin (every other point) and volumes in its own frame with the given joints, for clearRight
        const fistOf = (joints) => {
            hands.applyJoints("Left", joints);
            anchor.updateMatrixWorld(true);
            return {
                fist: hands.skinPoints("Left").map(({ p: v }) => v.clone().applyMatrix4(skinToAnchor)).filter((v, i) => i % 2 === 0),
                fistCaps: hands.capsules("Left").map((c) => ({ a: c.a.clone().applyMatrix4(skinToAnchor), b: c.b.clone().applyMatrix4(skinToAnchor), r: c.r }))
            };
        };
        // a pinch is posed with the plug in the port, so the hand keeps that pose relative to the plug all the way
        if (pinch) {
            const p = portPose();
            const plugM = new THREE.Matrix4().compose(p.position, p.quaternion, new THREE.Vector3(1, 1, 1));
            const handM = new THREE.Matrix4().compose(pinch.position, pinch.quaternion, new THREE.Vector3(1, 1, 1));
            grip = { handFromPlug: plugM.invert().multiply(handM), ...fistOf(held.pinch), opened: fistOf(held.open) };
            return grip;
        }
        const at = (name) => new THREE.Vector3().setFromMatrixPosition(bones[name].matrixWorld).applyMatrix4(toAnchor);
        const thumb = at("J_Left_HandThumb3").add(at("J_Left_HandThumb4")).multiplyScalar(0.5);
        const index = at("J_Left_HandIndex2").lerp(at("J_Left_HandIndex3"), 0.25);
        const contact = thumb.clone().add(index).multiplyScalar(0.5);
        const z = index.clone().sub(thumb).normalize();
        const along = aim === "thumb" ? at("J_Left_HandThumb4").sub(at("J_Left_HandThumb3")) : new THREE.Vector3(0, 1, 0);
        const y = along.addScaledVector(z, -along.dot(z)).normalize().applyAxisAngle(z, PLUG_TILT);
        const x = new THREE.Vector3().crossVectors(y, z);
        // the skin, not the joints, sets how far down the plug is held, so the knuckles stop short of the phone
        const fist = hands.skinPoints("Left").map(({ p }) => p.clone().applyMatrix4(skinToAnchor));
        const reach = Math.max(...fist.map((p) => p.clone().sub(contact).dot(y)));
        const hold = THREE.MathUtils.clamp(reach + HOLD_CLEAR, HOUSING.h / 2, HOUSING.h);
        const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
        const plugInHand = new THREE.Matrix4().compose(contact.clone().addScaledVector(y, hold), rotation, new THREE.Vector3(1, 1, 1));
        const roll = fixedRoll ?? chooseRoll(plugInHand, thumb, index);
        plugInHand.multiply(new THREE.Matrix4().makeRotationY(roll));
        const fistCaps = hands.capsules("Left").map((c) => ({ a: c.a.clone().applyMatrix4(skinToAnchor), b: c.b.clone().applyMatrix4(skinToAnchor), r: c.r }));
        grip = { handFromPlug: plugInHand.clone().invert(), gap: thumb.distanceTo(index), hold, roll, fist: fist.filter((p, i) => i % 2 === 0), fistCaps, opened: fistOf(held.open) };
        return grip;
    };

    const handFor = (plugPosition, plugQuaternion) => {
        const plugM = new THREE.Matrix4().compose(plugPosition, plugQuaternion, new THREE.Vector3(1, 1, 1));
        const handM = plugM.multiply(grip.handFromPlug);
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        handM.decompose(position, quaternion, scratch);
        return { position, quaternion };
    };

    // the right hand slides up the phone, away from the port, when its rest pose would be in the way of the fist at
    // the port (closed in landscape, its palm holds the phone right under the port). it slides along the hinge, since
    // its fingers hook round it and a slide across the phone dragged them into it. tried in 0.5 cm steps against the
    // fist where it'll be with the plug in, both gripping and opened to let go, the smallest slide that clears it wins
    const RIGHT_SLIDE_MAX = 6;
    let rightSlide = null;
    const clearRight = () => {
        rightSlide = null;
        const hands = getHands();
        const rest = hands.bakedPosition ? hands.bakedPosition("Right") : null;
        if (!rest || !hands.capsules) {
            return;
        }
        const p = portPose();
        const hand = handFor(p.position, p.quaternion);
        const handM = new THREE.Matrix4().compose(hand.position, hand.quaternion, new THREE.Vector3(1, 1, 1));
        const shapes = [grip, grip.opened].map((shape) => ({
            fist: shape.fist.map((v) => v.clone().applyMatrix4(handM)),
            fistCaps: shape.fistCaps.map((c) => ({ a: c.a.clone().applyMatrix4(handM), b: c.b.clone().applyMatrix4(handM), r: c.r }))
        }));
        const caps = hands.capsules("Right");
        const skin = hands.skinPoints("Right", 2).map(({ p }) => p);
        const dir = new THREE.Vector3(0, 1, 0);
        const shifted = new THREE.Vector3();
        // each hand's skin against the other's finger and palm volumes, with the right hand slid by k
        const depthIn = (points, volumes, k) => Math.max(...points.map((v) => {
            shifted.copy(v).addScaledVector(dir, k);
            return Math.max(...volumes.map((c) => c.r - segmentDistance(shifted, c.a, c.b)));
        }));
        for (let k = 0; k <= RIGHT_SLIDE_MAX; k += 0.5) {
            const deepest = Math.max(...shapes.map(({ fist, fistCaps }) => Math.max(depthIn(fist, caps, -k), depthIn(skin, fistCaps, k))));
            if (deepest < 0.05) {
                rightSlide = k > 0 ? dir.clone().multiplyScalar(k) : null;
                return;
            }
        }
        rightSlide = dir.clone().multiplyScalar(RIGHT_SLIDE_MAX);
    };

    // the right hand's one handed grip for while the left is off for the cable, in device space at the current fold. when
    // there's one, the right hand doesn't need to slide out of the left's way, since it holds the phone differently
    let support = null;
    const takeSupport = () => {
        const pose = getSupport();
        support = null;
        if (!pose) {
            clearRight();
            return;
        }
        rightSlide = null;
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        handMatrix("Right", pose).decompose(position, quaternion, new THREE.Vector3());
        // outward is away from the middle of the phone, in its plane
        const outward = new THREE.Vector3(position.x, position.y, 0).normalize();
        support = { position, quaternion, joints: pose, outward };
    };

    // the cable is only rebuilt when the plug or its route has moved, since building it costs about 2 ms a frame on a
    // slowed cpu and it sits still for as long as the phone is charging
    const builtFor = { plug: new THREE.Matrix4(), trail: new THREE.Vector3(), bend: new THREE.Vector3(), ready: false };
    const updateCable = () => {
        if (!plug.visible) {
            cable.visible = false;
            builtFor.ready = false;
            return;
        }
        if (builtFor.ready && builtFor.plug.equals(plug.matrix) && builtFor.trail.equals(TRAIL) && builtFor.bend.equals(BEND)) {
            cable.visible = true;
            return;
        }
        builtFor.plug.copy(plug.matrix);
        builtFor.trail.copy(TRAIL);
        builtFor.bend.copy(BEND);
        builtFor.ready = true;
        const start = new THREE.Vector3(0, -HOUSING.h - COLLAR, 0).applyMatrix4(plug.matrix);
        const out = new THREE.Vector3(0, -1, 0).applyQuaternion(plug.quaternion);
        const curve = new THREE.CatmullRomCurve3([
            start,
            start.clone().addScaledVector(out, 2.5),
            // straight on down through the fist before it swings away, so it doesn't cut through the curled fingers
            start.clone().addScaledVector(out, 5),
            start.clone().addScaledVector(out, 9).add(BEND),
            TRAIL.clone().add(new THREE.Vector3(start.x * 0.3, 0, 0))
        ], false, "centripetal");
        cable.geometry.dispose();
        cable.geometry = new THREE.TubeGeometry(curve, 120, CABLE_RADIUS, 14, false);
        // the weave keeps its size however long the cable is
        weave.repeat.set(curve.getLength() / WEAVE, WEAVE_AROUND);
        cable.visible = true;
    };

    // what the plug is doing: "away" (not shown), "held" (in the hand), "in" (in the port)
    let plugState = "away";
    let job = null;
    const setPlugState = (next) => {
        if (next !== plugState) {
            const wasIn = plugState === "in";
            plugState = next;
            if (wasIn !== (next === "in")) {
                onChange(next === "in");
            }
        }
    };

    const placePlug = (position, quaternion) => {
        plug.position.copy(position);
        plug.quaternion.copy(quaternion);
        plug.updateMatrix();
    };

    // jumps straight to plugged or unplugged, for when the phone isn't in view or the hands aren't the posed ones
    const snap = (plugged) => {
        job = null;
        setPlugState(plugged ? "in" : "away");
        plug.visible = plugged;
        const hands = getHands();
        if (hands && hands.setOverride) {
            hands.setOverride("Left", null);
            hands.setOverride("Right", null);
        }
    };

    const start = (plugIn) => {
        const hands = getHands();
        if (!hands || !hands.setOverride || !getBones().J_Left_HandThumb4) {
            snap(plugIn);
            return;
        }
        // turning around mid way runs the same timeline back from where it is, since unplugging is plugging in reversed.
        // it keeps the grip it has, so the hand doesn't jump to the other way round
        if (job) {
            job = { plugIn, t: runTotal() - job.t };
            return;
        }
        measureGrip();
        takeSupport();
        job = { plugIn, t: 0 };
    };

    // the steps, in seconds. plugging in: reach away, come back with the plug, line it up, push it in, let go, return.
    // unplugging is the same path backwards
    const PLAN = { swap: 0.35, away: 0.45, bring: 0.6, push: 0.28, release: 0.17, back: 0.5 };
    const TOTAL = PLAN.away + PLAN.bring + PLAN.push + PLAN.release + PLAN.back;
    const swapTime = () => (support ? PLAN.swap : 0);
    const runTotal = () => TOTAL + 2 * swapTime();
    // how far along the left hand's own part a run is, and the right hand's weight toward its one handed grip
    const scheduleNow = () => swapSchedule(job.plugIn ? job.t : runTotal() - job.t, swapTime(), TOTAL);

    let hold = false;
    // how far the left hand is off its grip, 0 to 1, so the phone can wobble more while one hand holds it
    let handOff = 0;
    const step = (dtIn) => {
        const dt = hold ? 0 : dtIn;
        const hands = getHands();
        if (!job || !hands) {
            if (plugState === "in") {
                const p = portPose();
                placePlug(p.position, p.quaternion);
            }
            updateCable();
            return;
        }
        job.t += dt;
        // unplugging runs the same timeline backwards
        const { right, left: t } = scheduleNow();
        const p = portPose();
        const lined = along(p, -LINE_UP);
        const fetch = p.position.clone().add(FETCH);
        const b1 = PLAN.away;
        const b2 = b1 + PLAN.bring;
        const b3 = b2 + PLAN.push;
        const b4 = b3 + PLAN.release;

        // the swing, as a target offset that comes out as `ARC * sin(pi * u)` once the hand's weight `w` is applied
        const rest = hands.bakedPosition ? hands.bakedPosition("Left") : null;
        const outward = rest ? new THREE.Vector3(rest.x, rest.y, 0).normalize().multiplyScalar(ARC.out) : new THREE.Vector3();
        const swing = outward.addScaledVector(portOut(), ARC.down);
        const back = new THREE.Vector3(0, 0, -ARC.back);
        // the hand slides out along its own layer before it goes back, and on the way in it's level with its hold before
        // it slides in, so its fingers don't pass through the other hand's behind the phone. on the way in (`late`) it
        // also holds off going back until the thumb, which sits in front of the plug, has lifted clear of it
        // before any of that, the hand slides straight away from the other hand (and on the way in, slides straight
        // in last), since the two hands' fingers rest against each other behind the phone and that's the one way out
        // that clears them
        const other = hands.bakedPosition ? hands.bakedPosition("Right") : null;
        const slide = new THREE.Vector3(rest && other ? Math.sign(rest.x - other.x) || -1 : -1, 0, 0).multiplyScalar(ARC.slide);
        // where the hand should be at `f` of the way from its hold (0) to the far end (1), given the anchor pose there.
        // it slides first, then travels, with the swing let in once the slide is done. hands.update lerps from the
        // hold by the weight `w`, so the target is set to land the hand on that point
        const pathTarget = (f, w, far, late) => {
            if (!rest || w <= 1e-4) {
                return far.clone();
            }
            const travel = smooth(clamp01((f - ARC.slideTime) / (1 - ARC.slideTime)));
            const gate = smooth(clamp01((f - ARC.slideTime) / 0.2));
            const slid = smooth(clamp01(f / ARC.slideTime)) * smooth(clamp01((1 - f) / 0.5));
            const backShape = late
                ? Math.sin(Math.PI * f) * smooth(clamp01((1 - f) / ARC.backDelay))
                : Math.sin(Math.PI * f) * smooth(clamp01((f - ARC.backStart) / 0.25));
            const desired = rest.clone().lerp(far, travel)
                .addScaledVector(swing, Math.sin(Math.PI * f) * gate)
                .addScaledVector(back, backShape * gate)
                .addScaledVector(slide, slid);
            return rest.clone().add(desired.sub(rest).divideScalar(w));
        };
        let plugPos;
        let target = null;
        let weight;
        let turn = null;
        let joints = held.pinch;
        if (t < b1) {
            // the hand goes from its grip to where it fetches the plug, out of view
            weight = ease.inOut(t / b1);
            plugPos = fetch;
            const far = handFor(fetch, p.quaternion);
            target = { position: pathTarget(weight, weight, far.position, false), quaternion: far.quaternion };
            joints = held.toPinch;
            turn = turnAt(weight);
            setPlugState(job.plugIn ? "away" : "held");
        } else if (t < b2) {
            const k = ease.inOut((t - b1) / PLAN.bring);
            weight = 1;
            plugPos = fetch.clone().lerp(lined, k);
            setPlugState("held");
        } else if (t < b3) {
            const k = ease.out((t - b2) / PLAN.push);
            weight = 1;
            plugPos = lined.clone().lerp(p.position, k);
            setPlugState("held");
        } else if (t < b4) {
            const k = (t - b3) / PLAN.release;
            weight = 1;
            plugPos = p.position;
            joints = lerpJoints(held.pinch, held.open, k);
            setPlugState("in");
        } else {
            const k = ease.inOut(Math.min((t - b4) / PLAN.back, 1));
            weight = 1 - k;
            plugPos = p.position;
            const far = handFor(p.position, p.quaternion);
            target = { position: pathTarget(1 - k, 1 - k, far.position, true), quaternion: far.quaternion };
            turn = turnAt(1 - k);
            joints = held.toOpen;
            setPlugState("in");
        }
        target = target || handFor(plugPos, p.quaternion);
        hands.setOverride("Left", { position: target.position, quaternion: target.quaternion, joints, weight, turn: turn ?? weight });
        handOff = weight;
        // the right hand holds the phone alone in its one handed grip from before the left lets go until it's back
        if (support) {
            // between the two grips the hand opens a little and eases outward, so its fingers go around the phone's
            // edge instead of through it, then closes on the new grip. zero at both ends, so neither grip changes
            const lift = Math.sin(Math.PI * right);
            const target = right > 1e-3 ? support.position.clone().addScaledVector(support.outward, (SWAP.out * lift) / right) : support.position;
            const joints = (baked, w) => {
                const out = { ...baked };
                Object.keys(support.joints).forEach((k) => {
                    if (typeof support.joints[k] === "number" && typeof baked[k] === "number") {
                        out[k] = baked[k] + (support.joints[k] - baked[k]) * w;
                    }
                });
                ["c1", "c2", "c3"].forEach((k) => {
                    out[k] -= SWAP.open * lift;
                });
                out.t2 -= SWAP.thumb * lift;
                out.t3 -= SWAP.thumb * lift;
                out.t1x += SWAP.t1x * lift;
                out.t1z += SWAP.t1z * lift;
                return out;
            };
            hands.setOverride("Right", { position: target, quaternion: support.quaternion, joints, weight: right });
        } else if (rightSlide) {
            // the right hand makes room while the left brings the plug in, and settles back as the left returns
            let room = 1;
            if (t < b1) {
                room = 0;
            } else if (t < b2) {
                room = ease.inOut((t - b1) / PLAN.bring);
            } else if (t >= b4) {
                room = 1 - ease.inOut(Math.min((t - b4) / PLAN.back, 1));
            }
            hands.setOverride("Right", { offset: rightSlide, weight: room });
        }

        if (plugState === "away") {
            plug.visible = false;
        } else {
            plug.visible = true;
            placePlug(plugPos, p.quaternion);
        }
        updateCable();

        if (job.t >= runTotal()) {
            const plugged = job.plugIn;
            job = null;
            hands.setOverride("Left", null);
            hands.setOverride("Right", null);
            handOff = 0;
            setPlugState(plugged ? "in" : "away");
            plug.visible = plugged;
            updateCable();
        }
    };

    // while the hand works at the port the phone is turned a little to show that edge, like someone finding the port.
    // 0 to 1, rising as the hand leaves and settling once it's back
    const lift = () => {
        if (!job) {
            return 0;
        }
        const t = scheduleNow().left;
        const rise = Math.min(t / PLAN.away, 1);
        const settle = Math.min(Math.max((TOTAL - t) / PLAN.back, 0), 1);
        const k = Math.min(rise, settle);
        return k * k * (3 - 2 * k);
    };
    // 0 to 1 and back as the plug is pushed home: rises through the end of the push, falls through the release
    const bump = () => {
        if (!job) {
            return 0;
        }
        const t = scheduleNow().left;
        const start = PLAN.away + PLAN.bring + PLAN.push * 0.5;
        const end = PLAN.away + PLAN.bring + PLAN.push + PLAN.release + 0.12;
        if (t <= start || t >= end) {
            return 0;
        }
        return Math.sin((Math.PI * (t - start)) / (end - start));
    };
    // the port's outward direction in the device frame
    const portOut = () => new THREE.Vector3(0, -1, 0).applyQuaternion(portPose().quaternion);

    return {
        lift,
        bump,
        handOff: () => (job ? handOff : 0),
        portOut,
        // freezes the animation at time t (seconds) for checking it, then step(0) shows that moment
        debugAt: (t, plugIn = true) => {
            // measured once per run like a real plug, since the hands are already off their rest poses after that
            if (!job) {
                measureGrip();
                takeSupport();
            }
            job = { plugIn, t: Math.min(t, runTotal() - 0.001) };
            hold = true;
            step(0);
        },
        release: () => {
            hold = false;
        },
        get total() {
            return runTotal();
        },
        setAim: (a) => {
            aim = a;
        },
        setOpen: (pose) => {
            OPEN = { ...PINCH, ...pose };
            TO_OPEN = viaThumb(OPEN);
        },
        setCurl: (from, to) => {
            CURL.from = from;
            CURL.to = to;
        },
        setSwap: (values) => {
            Object.assign(SWAP, values);
        },
        setTurn: (from, to) => {
            TURN.from = from;
            TURN.to = to;
        },
        setViaLeave: (u) => {
            VIA.leave = u;
        },
        setArc: (values) => {
            Object.assign(ARC, values);
        },
        setRoll: (r) => {
            fixedRoll = r;
        },
        plugIn: () => start(true),
        unplug: () => start(false),
        snap,
        step,
        busy: () => job !== null,
        plugged: () => plugState === "in",
        grip: () => grip,
        objects: { plug, cable, trail: TRAIL, bend: BEND }
    };
};
