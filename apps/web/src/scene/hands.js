import * as THREE from "three";

// with the wrist zeroed, the left hand points its fingers along +y, palm toward +z, knuckles spread along x,
// and the right hand is the mirror image. both bases send the fingers behind the device (-z) with the palms
// facing the side edges and the knuckle line running up the edge
const BASIS = {
    Left: new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)),
    Right: new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0))
};
const FINGERS = ["Index", "Middle", "Ring", "Pinky"];
const FINGER_OFFSET = { Index: "dI", Middle: "dM", Ring: "dR", Pinky: "dP" };
const FINGER_SPREAD = { Index: "sI", Middle: "sM", Ring: "sR", Pinky: "sP" };
const PARAMS = ["px", "py", "pz", "yaw", "pitch", "roll", "c1", "c2", "c3", "dI", "dM", "dR", "dP", "sI", "sM", "sR", "sP", "t1x", "t1z", "t2", "t3"];

// anatomical ranges in degrees, every search is clamped to these
export const LIMITS = {
    c1: [-15, 90], c2: [-10, 105], c3: [-10, 80],
    dI: [-25, 25], dM: [-25, 25], dR: [-25, 25], dP: [-25, 25],
    sI: [-20, 20], sM: [-20, 20], sR: [-20, 20], sP: [-20, 20],
    t1x: [-50, 50], t1z: [-50, 50], t2: [-10, 60], t3: [-10, 80]
};

const ONE = new THREE.Vector3(1, 1, 1);
const rad = THREE.MathUtils.degToRad;

// a pose can carry its own base orientation `q` ([x, y, z, w]), and yaw, pitch, and roll then adjust it in device axes
export const handMatrix = (side, pose) => {
    const sign = side === "Left" ? 1 : -1;
    const base = pose.q ? new THREE.Quaternion(...pose.q) : new THREE.Quaternion().setFromRotationMatrix(BASIS[side]);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sign * rad(pose.yaw));
    const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rad(pose.pitch));
    const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), sign * rad(pose.roll));
    const quaternion = yaw.multiply(pitch).multiply(roll).multiply(base);
    return new THREE.Matrix4().compose(new THREE.Vector3(pose.px, pose.py, pose.pz), quaternion, ONE);
};

export const shiftPose = (pose, dx, dy, dz) => ({ ...pose, px: pose.px + dx, py: pose.py + dy, pz: pose.pz + dz });

// the turn q and shift t that best carry the points `from` onto `to` (q * from + t), each pair counted by its weight
// (horn's quaternion method). the rig's two hands aren't exact mirrors, so this lines one hand's bones up with the
// other's mirrored ones instead of copying its pose
export const fitTurn = (from, to, weights) => {
    const total = weights.reduce((a, w) => a + w, 0);
    const centroid = (points) => points.reduce((a, p, i) => a.addScaledVector(p, weights[i] / total), new THREE.Vector3());
    const fromCenter = centroid(from);
    const toCenter = centroid(to);
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    from.forEach((p, i) => {
        const a = p.clone().sub(fromCenter).toArray();
        const b = to[i].clone().sub(toCenter).toArray();
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                S[row][col] += weights[i] * a[row] * b[col];
            }
        }
    });
    const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
    const N = [
        [xx + yy + zz, yz - zy, zx - xz, xy - yx],
        [yz - zy, xx - yy - zz, xy + yx, zx + xz],
        [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
        [xy - yx, zx + xz, yz + zy, -xx - yy + zz]
    ];
    // the largest eigenvector by power iteration, shifted so every eigenvalue is positive
    const shift = [xx, xy, xz, yx, yy, yz, zx, zy, zz].reduce((a, v) => a + Math.abs(v), 0);
    let v = [1, 0.1, 0.1, 0.1];
    for (let it = 0; it < 300; it++) {
        const w = N.map((row, k) => row.reduce((acc, val, c) => acc + val * v[c], 0) + shift * v[k]);
        const len = Math.hypot(...w);
        v = w.map((x) => x / len);
    }
    const q = new THREE.Quaternion(v[1], v[2], v[3], v[0]).normalize();
    return { q, t: toCenter.clone().sub(fromCenter.clone().applyQuaternion(q)) };
};

const withDefaults = (pose) => ({ dI: 0, dM: 0, dR: 0, dP: 0, sI: 0, sM: 0, sR: 0, sP: 0, ...pose });

// each joint's added turn in degrees for one finger: curl (about x) from the shared c1 to c3 plus the finger's own curl
// offset, which bends the tip joint less, and spread (about z, toward the thumb side) at the base joint only
export const fingerAngles = (rawPose, finger) => {
    const pose = withDefaults(rawPose);
    const offset = pose[FINGER_OFFSET[finger]];
    return [pose.c1, pose.c2, pose.c3].map((angle, i) => ({
        x: THREE.MathUtils.clamp(angle + offset * [1, 1, 0.7][i], -15, 105),
        z: i === 0 ? pose[FINGER_SPREAD[finger]] : 0
    }));
};

export const segmentDistance = (p, a, b) => {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const len = abx * abx + aby * aby + abz * abz;
    let t = len > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len : 0;
    t = Math.min(Math.max(t, 0), 1);
    const dx = p.x - (a.x + abx * t);
    const dy = p.y - (a.y + aby * t);
    const dz = p.z - (a.z + abz * t);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

// signed distance from a point to a box in the box's frame: how far outside it, or how deep inside (negative), to
// its nearest face
export const signedBoxDistance = (p, min, max) => {
    const dx = Math.max(min[0] - p.x, 0, p.x - max[0]);
    const dy = Math.max(min[1] - p.y, 0, p.y - max[1]);
    const dz = Math.max(min[2] - p.z, 0, p.z - max[2]);
    if (dx > 0 || dy > 0 || dz > 0) {
        return Math.hypot(dx, dy, dz);
    }
    return -Math.min(p.x - min[0], max[0] - p.x, p.y - min[1], max[1] - p.y, p.z - min[2], max[2] - p.z);
};

// the parts of a hand that rest on the phone while it holds it. a skin point belongs to the part its dominant bone is
// in, the thumb's base (Thumb1) counts as palm, and the forearm (J_Left, J_Right) is none
export const CONTACT_GROUPS = ["thumb", "index", "middle", "ring", "pinky", "palm"];

export const contactGroup = (dominant) => {
    const match = /_Hand(Thumb|Index|Middle|Ring|Pinky)?(\d)?$/.exec(dominant);
    if (!match) {
        return null;
    }
    if (!match[1] || (match[1] === "Thumb" && match[2] === "1")) {
        return "palm";
    }
    return match[1].toLowerCase();
};

// nothing while a part floats no more than `band` or sinks no more than `inside`, and the square of how far past
// either it goes. a part's gap is its nearest skin to the surface, signed, so once it's inside it's the deepest point,
// and the overlap term alone was too weak to keep one finger from sinking while the rest were pulled on. a group this
// pass had no points for is skipped, since infinity would make every pose tie
export const contactCost = (gaps, band, weight, inside = band) => CONTACT_GROUPS.reduce((c, group) => {
    const gap = gaps[group];
    if (!Number.isFinite(gap)) {
        return c;
    }
    return c + weight * (Math.max(0, gap - band) ** 2 + Math.max(0, -gap - inside) ** 2);
}, 0);

// more keys than this means a baked list, joined by a curve instead of eased per key
const DENSE_KEYS = 20;

// a curve through keys spaced unevenly along the fold: the value at `fold` between key 1 (at f1) and key 2 (at f2), with
// each key's slope taken from its two neighbors over the fold between them, so the motion keeps its speed through every
// key instead of stopping at it. a missing neighbor is passed as a copy of its key, which makes that slope one sided
export const foldHermite = (p0, p1, p2, p3, f0, f1, f2, f3, fold) => {
    if (f2 === f1) {
        return p1;
    }
    const m1 = f0 === f1 ? (p2 - p1) / (f2 - f1) : (p2 - p0) / (f2 - f0);
    const m2 = f3 === f2 ? (p2 - p1) / (f2 - f1) : (p3 - p1) / (f3 - f1);
    const h = f2 - f1;
    const u = (fold - f1) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * h * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * h * m2;
};

// the uniform catmull-rom curve through p1 and p2, with p0 and p3 setting the slopes, at t from 0 to 1
const catmullRom = (p0, p1, p2, p3, t) => {
    const t2 = t * t;
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t2 * t);
};

// how far a baked step may move from the one before when the other hand is weighed in: cm, degrees of turn, degrees
// per joint, and how much a turn costs against staying put
const STEADY = { spread: 0.35, turn: 3, joint: 4, wTurn: 0.5 };

// how hard a holding hand's parts are pulled onto the phone, how far off it they may float, and how far inside it
// they may sit before the overlap term counts them. jason, 2026-10-15: float up to 0.5 mm and sink up to 1.5 mm, since
// the search couldn't hold 0.5 mm inside and skin squashes against a phone anyway
const W_CONTACT = 200;
const CONTACT_BAND = 0.05;
const CONTACT_INSIDE = 0.15;
const CONTACT_MARGIN = -CONTACT_INSIDE;
// how far skin keeps off a hard solid (see overlap), whatever margin a search asks for
const HARD_CLEAR = 0.05;
// with the contact pull on, overlap has to cost ten times as much, or sinking a millimeter past the allowance comes out
// cheaper than letting one part float
const W_DEVICE_HOLD = 4000;
// what each point of finger skin over an open inner screen costs, enough that a finger on the screen costs more than
// one floating a couple of centimeters off the back
const W_SCREEN = 200;

export const createHands = ({ fbx, root, frames, setFold, anchors, solids }) => {
    const { bones, bind, mesh } = fbx;
    const skeleton = mesh.skeleton;
    let keys = { Left: [], Right: [] };
    // whether the keys are a few posed ones to join with foldHermite, instead of easing in and out of each
    let smooth = false;

    const boneName = (side, short) => {
        if (short === "wrist") {
            return `J_${side}`;
        }
        if (short === "Hand") {
            return `J_${side}_Hand`;
        }
        return `J_${side}_Hand${short}`;
    };

    // skin samples, bucketed by hand, with each vertex's dominant bone so thumb points can be picked out
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const skinIndex = geometry.attributes.skinIndex;
    const skinWeight = geometry.attributes.skinWeight;
    const samples = { Left: [], Right: [] };
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
        let best = 0;
        for (let k = 1; k < 4; k++) {
            if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, best)) {
                best = k;
            }
        }
        const dominant = skeleton.bones[skinIndex.getComponent(i, best)].name;
        const side = dominant.startsWith("J_Left") ? "Left" : "Right";
        v.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix);
        samples[side].push({
            base: v.clone(),
            indices: [0, 1, 2, 3].map((k) => skinIndex.getComponent(i, k)),
            weights: [0, 1, 2, 3].map((k) => skinWeight.getComponent(i, k)),
            dominant
        });
    }

    const boneMatrices = skeleton.bones.map(() => new THREE.Matrix4());
    const rootInverse = new THREE.Matrix4();
    const term = new THREE.Vector3();

    const skin = (side, stride) => {
        rootInverse.copy(root.matrixWorld).invert();
        skeleton.bones.forEach((bone, i) => {
            boneMatrices[i].multiplyMatrices(rootInverse, bone.matrixWorld).multiply(skeleton.boneInverses[i]);
        });
        const out = [];
        const list = samples[side];
        for (let i = 0; i < list.length; i += stride) {
            const s = list[i];
            const p = new THREE.Vector3();
            for (let k = 0; k < 4; k++) {
                if (s.weights[k] > 0) {
                    term.copy(s.base).applyMatrix4(boneMatrices[s.indices[k]]);
                    p.addScaledVector(term, s.weights[k]);
                }
            }
            out.push({ p, dominant: s.dominant });
        }
        return out;
    };

    const devicePosition = (name, target) => target.setFromMatrixPosition(bones[name].matrixWorld).applyMatrix4(rootInverse);

    const capsuleSegments = (side) => {
        const segs = [["Hand", "Index1"], ["Hand", "Middle1"], ["Hand", "Ring1"], ["Hand", "Pinky1"], ["Index1", "Pinky1"]];
        FINGERS.forEach((f) => {
            segs.push([`${f}1`, `${f}2`], [`${f}2`, `${f}3`], [`${f}3`, `${f}4`]);
        });
        return segs.map(([a, b]) => ({ a: boneName(side, a), b: boneName(side, b), palm: a === "Hand" || a === "Index1" && b === "Pinky1" }));
    };

    // capsule radii from the rest pose skin: a low percentile of each segment's own vertices, so only a real
    // overlap counts, not the thumb resting against the side of the index finger
    const radii = { Left: [], Right: [] };
    root.updateMatrixWorld(true);
    ["Left", "Right"].forEach((side) => {
        const points = skin(side, 1);
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        radii[side] = capsuleSegments(side).map((seg) => {
            devicePosition(seg.a, a);
            devicePosition(seg.b, b);
            const d = points.filter((pt) => pt.dominant === seg.a).map((pt) => segmentDistance(pt.p, a, b)).sort((x, y) => x - y);
            const pick = d.length ? d[Math.floor(d.length * 0.3)] : 0.6;
            return Math.min(Math.max(pick, 0.35), 1.4);
        });
    });

    // solids are boxes given in the local frame of a device half, so collisions stay right while the flap turns
    const solidInverse = solids.map(() => new THREE.Matrix4());
    const local = new THREE.Vector3();

    // total and deepest overlap of one hand with the device halves, and of its thumb with its own palm and fingers
    // `margin` grows the device boxes, so a pose can be asked to keep clear of the surface instead of touching it. a hard
    // solid always keeps skin HARD_CLEAR off, since a holding hand's margin lets it sit 0.15 cm in, and a box thinner
    // than that (the hinge cover is 0.13) could be passed right through without counting
    const overlap = (side, stride, margin = 0, given = null) => {
        root.updateMatrixWorld(true);
        const points = given || skin(side, stride);
        solids.forEach((solid, i) => {
            solidInverse[i].copy(frames[solid.frame].matrixWorld).invert().multiply(root.matrixWorld);
        });
        let device = 0;
        let deviceMax = 0;
        points.forEach(({ p }) => {
            solids.forEach((solid, i) => {
                local.copy(p).applyMatrix4(solidInverse[i]);
                const depth = (solid.hard ? Math.max(margin, HARD_CLEAR) : margin) + Math.min(
                    local.x - solid.min[0], solid.max[0] - local.x,
                    local.y - solid.min[1], solid.max[1] - local.y,
                    local.z - solid.min[2], solid.max[2] - local.z
                );
                if (depth > 0) {
                    device += depth;
                    deviceMax = Math.max(deviceMax, depth);
                }
            });
        });

        const segs = capsuleSegments(side).map((seg, i) => ({
            a: devicePosition(seg.a, new THREE.Vector3()),
            b: devicePosition(seg.b, new THREE.Vector3()),
            r: radii[side][i]
        }));
        let self = 0;
        let selfMax = 0;
        points.forEach(({ p, dominant }) => {
            if (!/Thumb[234]$/.test(dominant)) {
                return;
            }
            segs.forEach((seg) => {
                const depth = seg.r - segmentDistance(p, seg.a, seg.b) - 0.05;
                if (depth > 0) {
                    self += depth;
                    selfMax = Math.max(selfMax, depth);
                }
            });
        });
        return { device, deviceMax, self, selfMax, count: points.length };
    };

    // how far a hand's skin is from the phone at its closest, 0 when touching or inside. `only` limits it to the bones
    // whose names match, like the thumb, to check a grip is still holding on
    const deviceGap = (side, only = null) => {
        root.updateMatrixWorld(true);
        solids.forEach((solid, i) => {
            solidInverse[i].copy(frames[solid.frame].matrixWorld).invert().multiply(root.matrixWorld);
        });
        let gap = Infinity;
        skin(side, 1).forEach(({ p, dominant }) => {
            if (only && !only.test(dominant)) {
                return;
            }
            solids.forEach((solid, i) => {
                local.copy(p).applyMatrix4(solidInverse[i]);
                const dx = Math.max(solid.min[0] - local.x, 0, local.x - solid.max[0]);
                const dy = Math.max(solid.min[1] - local.y, 0, local.y - solid.max[1]);
                const dz = Math.max(solid.min[2] - local.z, 0, local.z - solid.max[2]);
                gap = Math.min(gap, Math.hypot(dx, dy, dz));
            });
        });
        return gap;
    };

    // how many points of finger skin are over a screen that faces out, from just inside it to 3 cm in front: the inner
    // screens (each half's +z face) until the phone is nearly shut, then the cover screen (the flap's -z face). the
    // camera block isn't marked as a screen
    const fingersOnScreen = (side, fold, stride = 1, given = null) => {
        const open = fold < 0.9;
        root.updateMatrixWorld(true);
        const points = given || skin(side, stride);
        solids.forEach((solid, i) => {
            solidInverse[i].copy(frames[solid.frame].matrixWorld).invert().multiply(root.matrixWorld);
        });
        let count = 0;
        points.forEach(({ p, dominant }) => {
            if (!/(Index|Middle|Ring|Pinky)\d$/.test(dominant)) {
                return;
            }
            solids.forEach((solid, i) => {
                if (!solid.screen || (!open && solid.frame !== "flap")) {
                    return;
                }
                local.copy(p).applyMatrix4(solidInverse[i]);
                const over = local.x > solid.min[0] && local.x < solid.max[0] && local.y > solid.min[1] && local.y < solid.max[1];
                const height = open ? local.z - solid.max[2] : solid.min[2] - local.z;
                if (over && height > -0.05 && height < 3) {
                    count++;
                }
            });
        });
        return count;
    };

    // each contact group's nearest skin to the phone, signed (negative inside), at the current pose
    const contactGaps = (side, stride = 1, given = null) => {
        root.updateMatrixWorld(true);
        const points = given || skin(side, stride);
        solids.forEach((solid, i) => {
            solidInverse[i].copy(frames[solid.frame].matrixWorld).invert().multiply(root.matrixWorld);
        });
        const gaps = Object.fromEntries(CONTACT_GROUPS.map((group) => [group, Infinity]));
        points.forEach(({ p, dominant }) => {
            const group = contactGroup(dominant);
            if (!group) {
                return;
            }
            solids.forEach((solid, i) => {
                local.copy(p).applyMatrix4(solidInverse[i]);
                gaps[group] = Math.min(gaps[group], signedBoxDistance(local, solid.min, solid.max));
            });
        });
        return gaps;
    };

    // how deep the two hands sit in each other: each one's skin against the other's finger and palm volumes, with a
    // small allowance so fingers can rest against each other without counting
    const between = (stride, margin = 0.05) => {
        root.updateMatrixWorld(true);
        rootInverse.copy(root.matrixWorld).invert();
        const volumes = (side) => capsuleSegments(side).map((seg, i) => ({
            a: devicePosition(seg.a, new THREE.Vector3()),
            b: devicePosition(seg.b, new THREE.Vector3()),
            r: radii[side][i]
        }));
        const vols = { Left: volumes("Left"), Right: volumes("Right") };
        let total = 0;
        let deepest = 0;
        [["Left", "Right"], ["Right", "Left"]].forEach(([side, other]) => {
            skin(side, stride).forEach(({ p }) => {
                vols[other].forEach((v) => {
                    const depth = v.r - segmentDistance(p, v.a, v.b) - margin;
                    if (depth > 0) {
                        total += depth;
                        deepest = Math.max(deepest, depth);
                    }
                });
            });
        });
        return { total, deepest };
    };

    // the same against an other hand that holds still, with its skin and volumes taken once (`fixed`, from holdStill)
    const holdStill = (other) => {
        root.updateMatrixWorld(true);
        rootInverse.copy(root.matrixWorld).invert();
        const volumes = capsuleSegments(other).map((seg, i) => ({
            a: devicePosition(seg.a, new THREE.Vector3()),
            b: devicePosition(seg.b, new THREE.Vector3()),
            r: radii[other][i]
        }));
        const strides = {};
        return { other, volumes, skinAt: (stride) => (strides[stride] ||= skin(other, stride).map(({ p }) => p)) };
    };
    const betweenFixed = (side, stride, fixed, margin = 0.05, given = null) => {
        rootInverse.copy(root.matrixWorld).invert();
        const mine = capsuleSegments(side).map((seg, i) => ({
            a: devicePosition(seg.a, new THREE.Vector3()),
            b: devicePosition(seg.b, new THREE.Vector3()),
            r: radii[side][i]
        }));
        let total = 0;
        const add = (p, v) => {
            const depth = v.r - segmentDistance(p, v.a, v.b) - margin;
            if (depth > 0) {
                total += depth;
            }
        };
        (given || skin(side, stride)).forEach(({ p }) => fixed.volumes.forEach((v) => add(p, v)));
        fixed.skinAt(stride).forEach((p) => mine.forEach((v) => add(p, v)));
        return total;
    };

    const applyJoints = (side, rawPose) => {
        const pose = withDefaults(rawPose);
        FINGERS.forEach((finger) => {
            fingerAngles(pose, finger).forEach(({ x, z }, i) => {
                const bone = bones[`J_${side}_Hand${finger}${i + 1}`];
                bone.rotation.copy(bind[bone.name]);
                bone.rotation.x += rad(x);
                bone.rotation.z += rad(z);
            });
        });
        const t1 = bones[`J_${side}_HandThumb1`];
        const t2 = bones[`J_${side}_HandThumb2`];
        const t3 = bones[`J_${side}_HandThumb3`];
        t1.rotation.copy(bind[t1.name]);
        t1.rotation.x += rad(pose.t1x);
        t1.rotation.z += rad(pose.t1z);
        t2.rotation.copy(bind[t2.name]);
        t2.rotation.x += rad(pose.t2);
        t3.rotation.copy(bind[t3.name]);
        t3.rotation.x += rad(pose.t3);
    };

    const deviceFrom = (frame) => new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(frames[frame].matrixWorld);

    const placeAnchor = (side, pose) => {
        handMatrix(side, pose).decompose(anchors[side].position, anchors[side].quaternion, new THREE.Vector3());
        applyJoints(side, pose);
    };

    const setKeys = (next, options = {}) => {
        smooth = Boolean(options.smooth);
        keys = { Left: [], Right: [] };
        Object.entries(next).forEach(([side, list]) => {
            keys[side] = list
                .map((key) => {
                    setFold(key.fold);
                    root.updateMatrixWorld(true);
                    const local = deviceFrom(key.frame).invert().multiply(handMatrix(side, key.pose));
                    return { ...key, pose: withDefaults(key.pose), local };
                })
                .sort((a, b) => b.fold - a.fold);
        });
    };

    const blendPose = (a, b, t) => {
        const out = {};
        PARAMS.forEach((p) => {
            out[p] = a[p] + (b[p] - a[p]) * t;
        });
        return out;
    };

    const positionA = new THREE.Vector3();
    const positionB = new THREE.Vector3();
    const curveP = [0, 1, 2, 3].map(() => new THREE.Vector3());
    const curveQ = [0, 1, 2, 3].map(() => new THREE.Quaternion());
    // switchable from the console, to compare against easing at every key
    const blending = { curve: true };
    const quaternionA = new THREE.Quaternion();
    const quaternionB = new THREE.Quaternion();
    const scratch = new THREE.Vector3();

    // the blended wrist transform and joint angles for one hand at the current fold
    const blendAt = (side, fold) => {
        const list = keys[side];
        let i = list.findIndex((key) => key.fold <= fold);
        if (i === -1) {
            i = list.length - 1;
        }
        const next = list[i];
        const prev = list[Math.max(i - 1, 0)];
        let t = prev === next ? 1 : (prev.fold - fold) / (prev.fold - next.fold);
        t = THREE.MathUtils.clamp(t, 0, 1);
        // baked keys sit every 0.005 or so of the fold, so they're joined by a smooth curve through their neighbors.
        // easing in and out of each of them, as the few authored keys do, stopped the hand at every baked step, and
        // with 160 to 200 of them across the opening that read as shaking
        if ((list.length > DENSE_KEYS || (smooth && list.length > 2)) && blending.curve) {
            const before = list[Math.max(i - 2, 0)];
            const after = list[Math.min(i + 1, list.length - 1)];
            const curve = smooth
                ? (a, b, c, d) => foldHermite(a, b, c, d, before.fold, prev.fold, next.fold, after.fold, THREE.MathUtils.clamp(fold, next.fold, prev.fold))
                : (a, b, c, d) => catmullRom(a, b, c, d, t);
            const at = (key, p, q) => deviceFrom(key.frame).multiply(key.local).decompose(p, q, scratch);
            at(before, curveP[0], curveQ[0]);
            at(prev, curveP[1], curveQ[1]);
            at(next, curveP[2], curveQ[2]);
            at(after, curveP[3], curveQ[3]);
            const position = new THREE.Vector3(
                curve(curveP[0].x, curveP[1].x, curveP[2].x, curveP[3].x),
                curve(curveP[0].y, curveP[1].y, curveP[2].y, curveP[3].y),
                curve(curveP[0].z, curveP[1].z, curveP[2].z, curveP[3].z)
            );
            // the four turns on the same side as the middle one first, since q and -q are the same turn
            [0, 2, 3].forEach((k) => {
                if (curveQ[k].dot(curveQ[1]) < 0) {
                    curveQ[k].set(-curveQ[k].x, -curveQ[k].y, -curveQ[k].z, -curveQ[k].w);
                }
            });
            const quaternion = new THREE.Quaternion(
                curve(curveQ[0].x, curveQ[1].x, curveQ[2].x, curveQ[3].x),
                curve(curveQ[0].y, curveQ[1].y, curveQ[2].y, curveQ[3].y),
                curve(curveQ[0].z, curveQ[1].z, curveQ[2].z, curveQ[3].z),
                curve(curveQ[0].w, curveQ[1].w, curveQ[2].w, curveQ[3].w)
            ).normalize();
            const joints = {};
            PARAMS.forEach((n) => {
                joints[n] = curve(before.pose[n], prev.pose[n], next.pose[n], after.pose[n]);
            });
            return { position, quaternion, joints };
        }
        t = t * t * (3 - 2 * t);

        deviceFrom(prev.frame).multiply(prev.local).decompose(positionA, quaternionA, scratch);
        deviceFrom(next.frame).multiply(next.local).decompose(positionB, quaternionB, scratch);
        const position = new THREE.Vector3().lerpVectors(positionA, positionB, t);
        const quaternion = new THREE.Quaternion().slerpQuaternions(quaternionA, quaternionB, t);
        if (prev.arc) {
            const lift = Math.sin(Math.PI * t);
            position.x += prev.arc[0] * lift;
            position.y += prev.arc[1] * lift;
            position.z += prev.arc[2] * lift;
        }
        return { position, quaternion, joints: blendPose(prev.pose, next.pose, t) };
    };

    // a hand can be pulled off its baked pose toward another one given in the device frame (the charging cable uses
    // this for the left hand). weight 0 is the baked pose, 1 is the override
    const overrides = { Left: null, Right: null };
    const setOverride = (side, override) => {
        overrides[side] = override;
    };
    // where each hand sits without its override, as of the last update
    const baked = { Left: null, Right: null };

    const update = (fold) => {
        ["Left", "Right"].forEach((side) => {
            if (!keys[side].length) {
                return;
            }
            const { position: p, quaternion: q, joints: bakedJoints } = blendAt(side, fold);
            baked[side] = p.clone();
            let joints = bakedJoints;
            const o = overrides[side];
            if (o && o.weight > 0) {
                // an override either pulls the hand to a pose, or only nudges the baked one by `offset`
                if (o.position) {
                    p.lerp(o.position, o.weight);
                }
                if (o.offset) {
                    p.addScaledVector(o.offset, o.weight);
                }
                // `turn` lets the rotation lag the move, when a hand has to back off before it turns
                if (o.quaternion) {
                    q.slerp(o.quaternion, o.turn ?? o.weight);
                }
                // joints can also be a path of their own from the baked pose, for moves that need a waypoint
                if (typeof o.joints === "function") {
                    joints = o.joints(withDefaults(bakedJoints), o.weight);
                } else if (o.joints) {
                    joints = blendPose(withDefaults(bakedJoints), withDefaults(o.joints), o.weight);
                }
            }
            anchors[side].position.copy(p);
            anchors[side].quaternion.copy(q);
            applyJoints(side, joints);
            anchors[side].updateMatrixWorld(true);
        });
    };

    // the blended pose as a flat pose in device space, ready to seed a correcting keyframe
    const sample = (side, fold) => {
        setFold(fold);
        root.updateMatrixWorld(true);
        const { position: p, quaternion: q, joints } = blendAt(side, fold);
        return { ...joints, q: [q.x, q.y, q.z, q.w], px: p.x, py: p.y, pz: p.z, yaw: 0, pitch: 0, roll: 0 };
    };

    const getKeys = () => keys;

    // skin points at the cut end of each wrist, in world space, to check the cut never shows on screen
    const wristPoints = (side) => {
        root.updateMatrixWorld(true);
        return skin(side, 1).filter((pt) => pt.dominant === `J_${side}`).map((pt) => pt.p.clone().applyMatrix4(root.matrixWorld));
    };

    // the same pose carried along with a half from one fold to another, as a device space pose at the new fold
    const carry = (side, pose, frame, fromFold, toFold) => {
        setFold(fromFold);
        root.updateMatrixWorld(true);
        const local = deviceFrom(frame).invert().multiply(handMatrix(side, pose));
        setFold(toFold);
        root.updateMatrixWorld(true);
        const m = deviceFrom(frame).multiply(local);
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        m.decompose(p, q, new THREE.Vector3());
        return { ...withDefaults(pose), q: [q.x, q.y, q.z, q.w], px: p.x, py: p.y, pz: p.z, yaw: 0, pitch: 0, roll: 0 };
    };

    // frame by frame: each step searches near the previous step (carried with its half) and is pulled toward the
    // authored blend, so neighbors stay close and the motion can't jump through the device between them
    const bakeStep = ({ side, fold, prevFold, prev, frame, spread = 1, turn = 10, joint = 12, wOther = 0, hold = 0 }) => {
        const target = sample(side, fold);
        const seed = prev ? carry(side, prev, frame, prevFold, fold) : target;
        const vary = { px: [seed.px - spread, seed.px + spread], py: [seed.py - spread, seed.py + spread], pz: [seed.pz - spread, seed.pz + spread], yaw: [-turn, turn], pitch: [-turn, turn], roll: [-turn, turn] };
        ["c1", "c2", "c3", "dI", "dM", "dR", "dP", "t1x", "t1z", "t2", "t3"].forEach((n) => {
            vary[n] = [seed[n] - joint, seed[n] + joint];
        });
        // joints lean toward the last step so a step can't flip to another solution, but near an authored key the
        // pull toward the authored blend takes over, so the motion lands on the grips that were actually set
        const nearest = Math.min(...keys[side].map((k) => Math.abs(k.fold - fold)));
        let ramp = Math.max(0, 1 - nearest / 0.25);
        ramp = ramp * ramp * (3 - 2 * ramp);
        const wTarget = 0.01 + 0.08 * ramp;
        const wSeed = 0.03;
        const prior = {};
        ["c1", "c2", "c3", "dI", "dM", "dR", "dP", "t1x", "t1z", "t2", "t3"].forEach((n) => {
            prior[n] = [(target[n] * wTarget + seed[n] * wSeed) / (wTarget + wSeed), wTarget + wSeed];
        });
        if (prev) {
            prior.px = [seed.px, 1];
            prior.py = [seed.py, 1];
            prior.pz = [seed.pz, 1];
        }
        const pull = {
            position: new THREE.Vector3(target.px, target.py, target.pz),
            quaternion: new THREE.Quaternion(...target.q),
            wp: 2 + 20 * ramp,
            wq: 0.02 + 0.2 * ramp
        };
        // the other hand's term outweighs these priors by a lot, so with it on, each step stays close to the last (a
        // step could otherwise land on a different way around the other hand than its neighbor, and the hand shook). the
        // contact pull has many good poses too, and a holding right hand baked without this jumped a centimeter
        if (wOther > 0 || hold > 0) {
            ["px", "py", "pz"].forEach((n) => {
                vary[n] = [seed[n] - STEADY.spread, seed[n] + STEADY.spread];
            });
            ["yaw", "pitch", "roll"].forEach((n) => {
                vary[n] = [-STEADY.turn, STEADY.turn];
                prior[n] = [0, STEADY.wTurn];
            });
            ["c1", "c2", "c3", "dI", "dM", "dR", "dP", "t1x", "t1z", "t2", "t3"].forEach((n) => {
                vary[n] = [seed[n] - STEADY.joint, seed[n] + STEADY.joint];
            });
        }
        // with the other hand weighed in, it's posed at its own keys for this fold first, so this one works around it
        if (wOther > 0) {
            setFold(fold);
            root.updateMatrixWorld(true);
            update(fold);
        }
        // a holding hand (hold 1) is pulled onto the phone and may sit just inside it, while a reaching one (hold 0)
        // keeps today's 1.5 mm of clearance. hold ramps between the two, so taking hold doesn't jump
        const margin = 0.15 + (CONTACT_MARGIN - 0.15) * hold;
        const result = search({ side, fold, base: seed, vary, prior, pull, samples: 400, refine: 50, rounds: 1, wDevice: 400 + (W_DEVICE_HOLD - 400) * hold, wSelf: 400, wOther, strides: [4, 1], margin, thumbFront: true, contact: W_CONTACT * hold });
        result.pose.q = seed.q;
        return { fold, frame, pose: result.pose, deviceMax: result.deviceMax, selfMax: result.selfMax, betweenMax: result.betweenMax };
    };

    // which bones and which half the deepest device overlaps belong to, at the current pose
    const detail = (side, fold) => {
        setFold(fold);
        root.updateMatrixWorld(true);
        update(fold);
        root.updateMatrixWorld(true);
        const points = skin(side, 1);
        solids.forEach((solid, i) => {
            solidInverse[i].copy(frames[solid.frame].matrixWorld).invert().multiply(root.matrixWorld);
        });
        const hits = {};
        points.forEach(({ p, dominant }) => {
            solids.forEach((solid, i) => {
                local.copy(p).applyMatrix4(solidInverse[i]);
                const depth = Math.min(
                    local.x - solid.min[0], solid.max[0] - local.x,
                    local.y - solid.min[1], solid.max[1] - local.y,
                    local.z - solid.min[2], solid.max[2] - local.z
                );
                if (depth > 0) {
                    const key = `${solid.frame} ${dominant.replace(`J_${side}_Hand`, "")}`;
                    hits[key] = Math.max(hits[key] || 0, Math.round(depth * 100) / 100);
                }
            });
        });
        return hits;
    };

    // the deepest overlap anywhere in the opening, the check the keyframes have to pass
    const sweep = (steps = 40) => {
        const rows = [];
        for (let i = 0; i <= steps; i++) {
            const fold = 1 - i / steps;
            setFold(fold);
            root.updateMatrixWorld(true);
            update(fold);
            ["Left", "Right"].forEach((side) => {
                if (!keys[side].length) {
                    return;
                }
                const o = overlap(side, 1);
                rows.push({ fold: Math.round(fold * 100) / 100, side, deviceMax: Math.round(o.deviceMax * 100) / 100, selfMax: Math.round(o.selfMax * 100) / 100, gap: Math.round(deviceGap(side) * 100) / 100, thumbGap: Math.round(deviceGap(side, /Thumb[34]$/) * 100) / 100, contact: Object.fromEntries(Object.entries(contactGaps(side)).map(([group, gap]) => [group, Math.round(gap * 100) / 100])), screen: fingersOnScreen(side, fold) });
            });
            if (keys.Left.length && keys.Right.length) {
                rows.push({ fold: Math.round(fold * 100) / 100, side: "both", betweenMax: Math.round(between(1).deepest * 100) / 100 });
            }
        }
        const worst = (field) => rows.filter((r) => field in r).reduce((a, b) => (b[field] > a[field] ? b : a));
        return { worstDevice: worst("deviceMax"), worstSelf: worst("selfMax"), worstBetween: rows.some((r) => "betweenMax" in r) ? worst("betweenMax") : null, rows };
    };

    // random search then shrinking jitter over the params in `vary` (clamped to LIMITS), scored at `fold`.
    // targets are bone points in device space, any axis can be null to leave it free
    // `prior` pulls params toward a relaxed hand ({ name: [value, weight] }), so the search prefers a natural curl
    // `pull` draws the wrist toward a transform ({ position, quaternion, wp, wq }), in cm and degrees
    const search = ({ side, fold, base, vary, targets = {}, boxes = [], prior = {}, pull = null, samples: count = 5000, refine = 120, rounds = 2, wDevice = 80, wSelf = 80, wOther = 0, strides = [16, 4], margin = 0, thumbFront = false, contact = 0, band = CONTACT_BAND, inside = CONTACT_INSIDE }) => {
        setFold(fold);
        root.updateMatrixWorld(true);
        const point = new THREE.Vector3();
        const groups = {
            fingers: FINGERS.flatMap((f) => [2, 3, 4].map((i) => `J_${side}_Hand${f}${i}`)),
            thumb: [2, 3, 4].map((i) => `J_${side}_HandThumb${i}`),
            palm: [`J_${side}_Hand`, ...FINGERS.map((f) => `J_${side}_Hand${f}1`)]
        };
        groups.all = [...groups.fingers, ...groups.thumb, ...groups.palm];
        const ranges = {};
        Object.entries(vary).forEach(([n, [lo, hi]]) => {
            const limit = LIMITS[n];
            ranges[n] = limit ? [Math.max(lo, limit[0]), Math.min(hi, limit[1])] : [lo, hi];
        });

        const fixed = wOther > 0 ? holdStill(side === "Left" ? "Right" : "Left") : null;
        const cost = (pose, stride) => {
            placeAnchor(side, pose);
            anchors[side].updateMatrixWorld(true);
            root.updateMatrixWorld(true);
            rootInverse.copy(root.matrixWorld).invert();
            let c = 0;
            // an optional fifth value weights depth on its own, so a fingertip can be pinned to the back but loose sideways
            Object.entries(targets).forEach(([short, [x, y, z, w, wz = w]]) => {
                devicePosition(boneName(side, short), point);
                if (x !== null) {
                    c += w * (point.x - x) ** 2;
                }
                if (y !== null) {
                    c += w * (point.y - y) ** 2;
                }
                if (z !== null) {
                    c += wz * (point.z - z) ** 2;
                }
            });
            boxes.forEach((box) => {
                groups[box.bones].forEach((name) => {
                    devicePosition(name, point);
                    const depth = Math.min(
                        point.x - box.min[0], box.max[0] - point.x,
                        point.y - box.min[1], box.max[1] - point.y,
                        point.z - box.min[2], box.max[2] - point.z
                    );
                    if (depth > 0) {
                        c += box.w * depth;
                    }
                });
            });
            Object.entries(prior).forEach(([n, [value, w]]) => {
                c += w * (pose[n] - value) ** 2;
            });
            // over a half's face, thumb joints stay on its screen side, so the thumb can't slip behind the device. only the
            // halves have a screen side, so the camera block and the hinge cover are left out
            if (thumbFront) {
                solids.filter((solid) => solid.screen).forEach((solid) => {
                    const inverse = new THREE.Matrix4().copy(frames[solid.frame].matrixWorld).invert();
                    groups.thumb.forEach((name) => {
                        point.setFromMatrixPosition(bones[name].matrixWorld).applyMatrix4(inverse);
                        const over = point.x > solid.min[0] && point.x < solid.max[0] && point.y > solid.min[1] && point.y < solid.max[1];
                        if (over && point.z < solid.max[2] + 0.3) {
                            c += 60 * (solid.max[2] + 0.3 - point.z);
                        }
                        // near an edge the thumb tip can sit at the seam, but it can't slip around to the back (the thumb's
                        // base does wrap around the edge from behind, so this only holds the tip)
                        const near = point.x > solid.min[0] - 3 && point.x < solid.max[0] + 3 && point.y > solid.min[1] - 3 && point.y < solid.max[1] + 3;
                        if (name.endsWith("Thumb4") && near && point.z < solid.min[2] + 0.2) {
                            c += 60 * (solid.min[2] + 0.2 - point.z);
                        }
                    });
                });
            }
            if (pull) {
                const anchor = anchors[side];
                c += pull.wp * anchor.position.distanceToSquared(pull.position);
                c += pull.wq * THREE.MathUtils.radToDeg(anchor.quaternion.angleTo(pull.quaternion)) ** 2;
            }
            // skinned once for the four terms below instead of once in each
            const points = skin(side, stride);
            const o = overlap(side, stride, margin, points);
            c += (wDevice * o.device * stride) / 10 + (wSelf * o.self * stride) / 10;
            if (contact > 0) {
                c += contactCost(contactGaps(side, stride, points), band, contact, inside);
            }
            // the contact pull would lay fingers across the inner screen or wrap them onto its margin to reach the nearest
            // surface, so finger skin over it costs per point while the phone is more open than closed. the keys were baked
            // with this gate, while the sweep reports the count at every fold. it applies to a reaching hand too, which
            // shouldn't lay its fingers on the screen any more than a holding one
            if (thumbFront && fold <= 0.5) {
                c += (W_SCREEN * fingersOnScreen(side, fold, stride, points) * stride) / 10;
            }
            // the other hand stays where it was posed, so this hand works around it
            if (fixed) {
                c += (wOther * betweenFixed(side, stride, fixed, 0.05, points) * stride) / 10;
            }
            return c;
        };

        const names = Object.keys(ranges);
        const make = (fill) => {
            const pose = withDefaults({ ...base });
            names.forEach((n) => {
                pose[n] = fill(n);
            });
            return pose;
        };
        const [coarse, fine] = strides;
        let best = { c: cost(withDefaults({ ...base }), coarse), pose: withDefaults({ ...base }) };
        for (let i = 0; i < count; i++) {
            const pose = make((n) => ranges[n][0] + Math.random() * (ranges[n][1] - ranges[n][0]));
            const c = cost(pose, coarse);
            if (c < best.c) {
                best = { c, pose };
            }
        }
        best.c = cost(best.pose, fine);
        for (let round = 0; round < rounds; round++) {
            for (let s = 0.25; s > 0.004; s *= 0.85) {
                for (let i = 0; i < refine; i++) {
                    const pose = make((n) => {
                        const [lo, hi] = ranges[n];
                        return THREE.MathUtils.clamp(best.pose[n] + (Math.random() - 0.5) * s * (hi - lo), lo, hi);
                    });
                    const c = cost(pose, fine);
                    if (c < best.c) {
                        best = { c, pose };
                    }
                }
            }
        }
        placeAnchor(side, best.pose);
        anchors[side].updateMatrixWorld(true);
        const final = overlap(side, 1);
        const apart = between(1);
        const rounded = {};
        Object.entries(best.pose).forEach(([k, val]) => {
            rounded[k] = Math.round(val * 1000) / 1000;
        });
        return {
            cost: Math.round(best.c * 10) / 10,
            deviceMax: Math.round(final.deviceMax * 100) / 100,
            selfMax: Math.round(final.selfMax * 100) / 100,
            betweenMax: Math.round(apart.deepest * 100) / 100,
            pose: rounded
        };
    };

    const measure = (side, pose, fold) => {
        setFold(fold);
        placeAnchor(side, withDefaults(pose));
        anchors[side].updateMatrixWorld(true);
        return overlap(side, 1);
    };

    // the finger and palm volumes at the current pose, in device space, for checking one hand against something else
    const capsules = (side) => {
        root.updateMatrixWorld(true);
        rootInverse.copy(root.matrixWorld).invert();
        return capsuleSegments(side).map((seg, i) => ({
            a: devicePosition(seg.a, new THREE.Vector3()),
            b: devicePosition(seg.b, new THREE.Vector3()),
            r: radii[side][i]
        }));
    };

    return { contactWeights: { contact: W_CONTACT, wDevice: W_DEVICE_HOLD, margin: CONTACT_MARGIN }, setKeys, getKeys, update, setOverride, bakedPosition: (side) => baked[side], steady: STEADY, blending, deviceGap, contactGaps, fingersOnScreen, capsules, overlapNow: (side, margin = 0) => overlap(side, 1, margin), betweenNow: (stride = 1) => between(stride), skinPoints: (side, stride = 1) => skin(side, stride), search, sweep, measure, sample, detail, carry, bakeStep, wristPoints, applyJoints, radii };
};
