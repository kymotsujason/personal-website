import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DUO, FOV } from "../state.js";
import { PLAN } from "./motion.js";
import { fitInView } from "./placement.js";
import { CHARGE_TOTAL, PLUG_BUMP, PRESENT_TILT, SAG, bumpAt, chargeMove, chargerWanted, handOffAt, liftAt, portOut, shakeAt } from "./charging.js";

const near = (a, b, what, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${what}: ${a} against ${b}`);

// scene/loop.js's fitInView as it was before it moved, with the window and the root's z passed in
const oldFit = (outer, rootZ, innerWidth, innerHeight) => {
    const d = -rootZ;
    const mx = innerWidth * 0.07;
    const my = innerHeight * 0.07;
    const lift = 0.06 * innerHeight;
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    const scale = Math.max(1, (outer.right - outer.left) / (innerWidth - 2 * mx), (outer.bottom - outer.top) / (innerHeight - 2 * my - lift));
    const s = 1 / scale;
    const box = { left: cx + (outer.left - cx) * s, right: cx + (outer.right - cx) * s, top: cy + (outer.top - cy) * s, bottom: cy + (outer.bottom - cy) * s };
    const shiftX = Math.max(mx - box.left, 0) - Math.max(box.right - (innerWidth - mx), 0);
    const room = Math.max(box.top - my, 0);
    const up = Math.min(Math.max(lift, box.bottom - (innerHeight - my)), room);
    const shiftY = -up;
    const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * d * scale) / innerHeight;
    return { x: shiftX * worldPerPx, y: -shiftY * worldPerPx, z: -(d * scale - d) };
};

test("fitInView gives what scene/loop.js gave before it moved", () => {
    const cases = [
        [{ left: 159, right: 1121, top: 56, bottom: 744 }, -23.88, 1280, 800],
        [{ left: 400, right: 880, top: 56, bottom: 744 }, -23.88, 1280, 800],
        [{ left: 20, right: 580, top: 300, bottom: 880 }, -40.1, 600, 900],
        [{ left: -40, right: 430, top: 100, bottom: 700 }, -55, 390, 844]
    ];
    cases.forEach(([outer, z, width, height], i) => {
        const want = oldFit(outer, z, width, height);
        const got = fitInView({ outer, z, width, height });
        ["x", "y", "z"].forEach((k) => near(got[k], want[k], `case ${i} ${k}`, 1e-12));
    });
    // the open phone at 1280 by 800 is 688 px tall, more than the 640 left with the margins and the lift, so it backs off
    // from the camera, and rises
    const lifted = fitInView({ outer: { left: 159, right: 1121, top: 56, bottom: 744 }, z: -23.88, width: 1280, height: 800 });
    near(lifted.z, -23.88 * (688 / 640 - 1), "backed off", 1e-9);
    assert.ok(lifted.y > 0, `rises ${lifted.y}`);
});

// the 3d port's pose in the device frame (charger.js portPose and portOut), from device.js's groups
const threePortOut = (portrait, fold) => {
    const root = new THREE.Group();
    const roll = new THREE.Group();
    roll.rotation.z = portrait ? -Math.PI / 2 : 0;
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
    pivot.rotation.y = Math.PI * fold;
    hinged.position.x = -(DUO.halfW / 2) * fold;
    hinged.position.z = -(DUO.depth / 2 + DUO.gap / 2) * fold;
    root.updateMatrixWorld(true);
    const m = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(flap.matrixWorld);
    const q = new THREE.Quaternion();
    m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    return new THREE.Vector3(0, -1, 0).applyQuaternion(q);
};

test("the port faces out of the flap's bottom edge, open and closed, in both orientations", () => {
    for (const portrait of [false, true]) {
        for (const fold of [0, 0.5, 1]) {
            const want = threePortOut(portrait, fold);
            const got = portOut(portrait);
            near(got[0], want.x, `${portrait} ${fold} x`, 1e-9);
            near(got[1], want.y, `${portrait} ${fold} y`, 1e-9);
            near(got[2], want.z, `${portrait} ${fold} z`, 1e-9);
        }
    }
});

// scene/loop.js's charger move on a root at the pose, as three composes it
const threeMove = ({ pose, left, fit, seconds, portrait, fold, appVisible }) => {
    const root = new THREE.Group();
    root.position.set(pose.x, pose.y, pose.z);
    root.rotation.set(pose.rx, pose.ry, pose.rz);
    const shaky = handOffAt(left) * THREE.MathUtils.clamp(1 - fold, 0, 1);
    if (shaky > 0) {
        const shake = shakeAt(seconds);
        root.position.x += shake.x * shaky;
        root.position.y += shake.y * shaky;
        if (!appVisible) {
            root.rotation.x += shake.rx * shaky;
            root.rotation.y += shake.ry * shaky;
            if (portrait) {
                root.rotation.x -= SAG * shaky;
            } else {
                root.rotation.z += SAG * shaky;
            }
        }
    }
    const present = liftAt(left);
    if (present > 0) {
        const out = new THREE.Vector3(...portOut(portrait));
        const axis = new THREE.Vector3().crossVectors(out, new THREE.Vector3(0, 0, 1)).normalize();
        root.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, PRESENT_TILT * present));
        root.position.x += fit.x * present;
        root.position.y += fit.y * present;
        root.position.z += fit.z * present;
        const bump = bumpAt(left);
        if (bump > 0) {
            root.position.addScaledVector(out.clone().applyQuaternion(root.quaternion), -PLUG_BUMP * bump);
        }
    }
    root.updateMatrix();
    return root.matrix;
};

// the 2d pose as the stage's chain turns it: the pose's xyz turn, then the tilt about x and then y
const poseMatrix = (p) => {
    const m = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
    m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(p.rx, p.ry, p.rz, "XYZ")));
    m.multiply(new THREE.Matrix4().makeRotationX(p.tx ?? 0));
    m.multiply(new THREE.Matrix4().makeRotationY(p.ty ?? 0));
    return m;
};

test("chargeMove moves the pose as scene/loop.js moves the 3d root", () => {
    const pose = { x: 0.3, y: -0.2, z: -23.9, rx: 0.02, ry: -0.01, rz: 0.005 };
    const fit = { x: 0.4, y: 1.3, z: -2.1 };
    const b3 = PLAN.away + PLAN.bring + PLAN.push;
    for (const portrait of [false, true]) {
        for (const fold of [0, 1]) {
            for (const appVisible of [false, true]) {
                for (const left of [0, 0.1, 0.45, 0.9, b3 - 0.05, b3 + 0.05, b3 + 0.2, 1.8, CHARGE_TOTAL]) {
                    const args = { pose, left, fit, seconds: 12.34, portrait, fold, appVisible };
                    const want = threeMove(args).elements;
                    const got = poseMatrix(chargeMove(args)).elements;
                    want.forEach((v, i) => near(got[i], v, `${portrait} ${fold} ${appVisible} ${left} [${i}]`, 1e-9));
                }
            }
        }
    }
});

test("the run's curves rest at both ends", () => {
    [liftAt, bumpAt, handOffAt].forEach((fn) => {
        near(fn(0), 0, `${fn.name} at 0`);
        near(fn(CHARGE_TOTAL), 0, `${fn.name} at the end`);
    });
    near(liftAt(1), 1, "lift while the hand is away");
    near(handOffAt(1), 1, "hand off while away");
    near(CHARGE_TOTAL, 2, "the left hand's part");
});

test("the cable is wanted at 5% and below, and while charging", () => {
    assert.equal(chargerWanted({ level: 6, charging: false }), false);
    assert.equal(chargerWanted({ level: 5, charging: false }), true);
    assert.equal(chargerWanted({ level: 100, charging: true }), true);
});
