import { test } from "node:test";
import assert from "node:assert/strict";
import { wallpaperAt } from "./monitors.js";

test("each time of day shows its own image, as timewall switches them", () => {
    assert.deepEqual(wallpaperAt(2), { from: 2, to: 2, t: 1 });
    assert.deepEqual(wallpaperAt(8), { from: 3, to: 3, t: 1 });
    assert.deepEqual(wallpaperAt(12), { from: 0, to: 0, t: 1 });
    assert.deepEqual(wallpaperAt(18), { from: 1, to: 1, t: 1 });
    assert.deepEqual(wallpaperAt(23), { from: 2, to: 2, t: 1 });
});

test("a change crossfades over the few minutes after it", () => {
    const sunrise = wallpaperAt(6.05);
    assert.equal(sunrise.from, 2);
    assert.equal(sunrise.to, 3);
    assert.ok(Math.abs(sunrise.t - 0.5) < 1e-9, `t was ${sunrise.t}`);
    assert.deepEqual(wallpaperAt(6), { from: 2, to: 3, t: 0 });
    assert.equal(wallpaperAt(21.02).from, 1);
    assert.equal(wallpaperAt(21.02).to, 2);
});

test("hours past midnight or below zero wrap round the day", () => {
    assert.deepEqual(wallpaperAt(26), wallpaperAt(2));
    assert.deepEqual(wallpaperAt(-1), wallpaperAt(23));
});
