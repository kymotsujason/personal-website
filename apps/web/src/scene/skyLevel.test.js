import { test } from "node:test";
import assert from "node:assert/strict";
import { stepSkyLevel, stepLater, glassFor, LATER } from "./skyLevel.js";

const start = { level: 0, slow: 0, fast: 0, retried: false };

test("three slow seconds in a row step the sky down, one level at a time", () => {
    const once = stepSkyLevel({ ...start, slow: 3 });
    assert.equal(once.level, 1);
    assert.equal(once.slow, 0);
    const twice = stepSkyLevel({ ...once, slow: 3 });
    assert.equal(twice.level, 2);
    assert.equal(stepSkyLevel({ ...twice, slow: 3 }).level, 2);
});

test("two slow seconds aren't enough", () => {
    assert.equal(stepSkyLevel({ ...start, slow: 2 }).level, 0);
});

test("thirty fast seconds step the sky back up, so a passing hitch doesn't stop it for the whole visit", () => {
    const up = stepSkyLevel({ level: 2, slow: 0, fast: 30, retried: false });
    assert.equal(up.level, 1);
    assert.equal(up.fast, 0);
    assert.equal(up.retried, true);
});

test("it only steps back up once, so a device that's really too slow doesn't flip back and forth", () => {
    const again = stepSkyLevel({ level: 1, slow: 0, fast: 30, retried: true });
    assert.equal(again.level, 1);
});

test("a sky already at full speed has nothing to step up to", () => {
    assert.equal(stepSkyLevel({ ...start, fast: 30 }).level, 0);
});

test("the glass is frosted and follows the tilt only while the sky runs at full rate", () => {
    assert.deepEqual(glassFor(0), { frosted: true, tilt: true });
    assert.deepEqual(glassFor(1), { frosted: false, tilt: false });
    assert.deepEqual(glassFor(2), { frosted: false, tilt: false });
});

test("past a still sky, three slow seconds in a row take each later step, and they never step back", () => {
    const first = stepLater({ level: 0, slow: 3 });
    assert.deepEqual(first, { level: LATER.simpleGlass, slow: 0 });
    const second = stepLater({ ...first, slow: 3 });
    assert.equal(second.level, LATER.noFocusBlur);
    const third = stepLater({ ...second, slow: 3 });
    assert.equal(third.level, LATER.smallDesk);
    assert.equal(stepLater({ ...third, slow: 3 }).level, LATER.smallDesk);
    assert.equal(stepLater({ level: 1, slow: 2 }).level, 1);
    assert.equal(stepLater({ level: 2, slow: 0 }).level, 2);
});
