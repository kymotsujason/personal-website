import { test } from "node:test";
import assert from "node:assert/strict";
import { swapSchedule } from "./charger.js";

const near = (a, b) => Math.abs(a - b) < 1e-9;

test("the right hand has its one handed grip before the left hand starts to leave", () => {
    assert.deepEqual(swapSchedule(0, 0.35, 2), { right: 0, left: 0 });
    const half = swapSchedule(0.175, 0.35, 2);
    assert.ok(near(half.right, 0.5));
    assert.equal(half.left, 0);
    assert.deepEqual(swapSchedule(0.35, 0.35, 2), { right: 1, left: 0 });
});

test("the right hand keeps its one handed grip until the left hand is back", () => {
    const mid = swapSchedule(1.2, 0.35, 2);
    assert.equal(mid.right, 1);
    assert.ok(near(mid.left, 0.85));
    const back = swapSchedule(2.35, 0.35, 2);
    assert.equal(back.right, 1);
    assert.ok(near(back.left, 2));
});

test("the right hand goes back to its own grip only after the left hand's part is done", () => {
    const half = swapSchedule(2.525, 0.35, 2);
    assert.ok(near(half.right, 0.5));
    assert.ok(near(half.left, 2));
    assert.deepEqual(swapSchedule(2.7, 0.35, 2), { right: 0, left: 2 });
});

test("with no one handed grip the left hand's part starts at once and the right hand isn't scheduled", () => {
    assert.deepEqual(swapSchedule(0, 0, 2), { right: null, left: 0 });
    assert.deepEqual(swapSchedule(1.5, 0, 2), { right: null, left: 1.5 });
    assert.deepEqual(swapSchedule(3, 0, 2), { right: null, left: 2 });
});
