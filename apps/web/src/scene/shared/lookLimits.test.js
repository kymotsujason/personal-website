import { test } from "node:test";
import assert from "node:assert/strict";
import { DESK_REST_PITCH } from "./motion.js";
import { PITCH_LIMITS, clampLook, createLimits, restPitchFor } from "./lookLimits.js";
import { DESK } from "../backdrop.js";

test("the desk's extents come from the shared limits", () => {
    assert.equal(DESK.lonMin, -100.72);
    assert.equal(DESK.lonMax, 83.16);
    assert.equal(DESK.forward, -14);
    assert.equal(DESK.topLat, 50);
    assert.equal(DESK.restPitch, DESK_REST_PITCH);
});

test("the clamp at 1280 by 800 is the one the 3d desk had", () => {
    const rest = restPitchFor(DESK_REST_PITCH);
    assert.equal(rest, DESK_REST_PITCH);
    const limits = createLimits(rest);
    const aspect = 1280 / 800;
    const left = clampLook(limits, { yaw: -500, pitch: rest }, aspect);
    const right = clampLook(limits, { yaw: 500, pitch: rest }, aspect);
    assert.ok(Math.abs(left.yaw - -33.4484) < 1e-3);
    assert.ok(Math.abs(right.yaw - 43.8896) < 1e-3);
    assert.deepEqual(PITCH_LIMITS.map((v) => Math.round(v * 10) / 10), [-23.1, 12.5]);
    assert.equal(clampLook(limits, { yaw: 0, pitch: 99 }, aspect).pitch, PITCH_LIMITS[1]);
});
