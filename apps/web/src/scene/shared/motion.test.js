import { test } from "node:test";
import assert from "node:assert/strict";
import { MOVE, moveAt, LEAD, FOLD_TIME, FOLD_SAMPLES, MAX_FOLLOW, foldPoseAt, springOut, idleDrift, ease } from "./motion.js";
import { ease as tweenEase } from "../tween.js";

test("the intro's move keeps the 3D scene's timings", () => {
    assert.deepEqual(MOVE.rise, { keys: ["x", "y"], time: 1500, power: 4.5 });
    const start = { x: 1, y: 2, z: 3, rx: 4, ry: 5, rz: 6 };
    const rest = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
    assert.deepEqual(moveAt(0, start, rest), start);
    assert.deepEqual(moveAt(5000, start, rest), rest);
});

test("the lead and the fold keep the 3D scene's numbers", () => {
    assert.deepEqual(LEAD, { fold: 0.01, time: 300 });
    assert.deepEqual(FOLD_TIME, { close: 900, open: 1000 });
    assert.equal(FOLD_SAMPLES, 480);
    assert.equal(MAX_FOLLOW, 2.5);
});

test("a close backs away early and folds late", () => {
    const from = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
    const to = { x: 0, y: 0, z: -10, rx: 0, ry: 0, rz: 0 };
    const half = foldPoseAt(from, to, 0, 1, 0.5, "close");
    assert.ok(Math.abs(half.z - -10 * (1 - 0.5 ** 2.2)) < 1e-12);
    assert.ok(Math.abs(half.fold - 0.5 ** 1.6) < 1e-12);
});

test("the app window's spring matches the 3D curve", () => {
    assert.ok(Math.abs(springOut(0.5) - (1 - 0.5 ** 3.2)) < 1e-12);
});

test("the idle drift matches the 3D formula", () => {
    const drift = idleDrift(1, 1);
    assert.ok(Math.abs(drift.x - Math.sin(0.6 + 1) * 0.05) < 1e-12);
    assert.ok(Math.abs(drift.y - Math.sin(0.9) * 0.06) < 1e-12);
    assert.ok(Math.abs(drift.z - Math.sin(0.5 + 2) * 0.08) < 1e-12);
});

test("ease is the tween module's own", () => {
    assert.equal(ease, tweenEase);
});
