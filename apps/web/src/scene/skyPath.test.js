import { test } from "node:test";
import assert from "node:assert/strict";
import { arcPoint, peakFor, sunPlace, moonPlace, rimAngle } from "./skyPath.js";

const near = (a, b) => Math.abs(a - b) < 1e-9;

test("a body rises at the left edge, peaks halfway, and sets at the right edge", () => {
    assert.deepEqual(arcPoint(6, 6, 18, 0.8), { x: 0.06, y: 0 });
    const noon = arcPoint(12, 6, 18, 0.8);
    assert.ok(near(noon.x, 0.5) && near(noon.y, 0.8), JSON.stringify(noon));
    const set = arcPoint(18, 6, 18, 0.8);
    assert.ok(near(set.x, 0.94) && near(set.y, 0), JSON.stringify(set));
});

test("a body that's down has no place", () => {
    assert.equal(arcPoint(5, 6, 18, 0.8), null);
    assert.equal(arcPoint(19, 6, 18, 0.8), null);
});

test("a stretch across midnight is found from the small hours too", () => {
    const at = arcPoint(3, 22, 33, 0.8);
    assert.ok(near(at.x, 0.06 + 0.88 * (5 / 11)), JSON.stringify(at));
});

test("longer days climb higher, between half way and nearly the top", () => {
    assert.equal(peakFor(8), 0.45);
    assert.equal(peakFor(16), 0.95);
    assert.equal(peakFor(4), 0.45);
    assert.equal(peakFor(20), 0.95);
    assert.ok(peakFor(10.85) > 0.45 && peakFor(10.85) < 0.95);
});

test("the sun is up between sunrise and sunset and down otherwise", () => {
    const sun = { sunrise: 7.53, sunset: 18.38, polar: null };
    const day = sunPlace(13, sun);
    assert.equal(day.up, 1);
    assert.ok(day.y > 0.45 && day.x > 0.06 && day.x < 0.94, JSON.stringify(day));
    assert.equal(sunPlace(22, sun).up, 0);
});

test("a sunset past midnight on the visitor's clock still makes a day", () => {
    assert.equal(sunPlace(1, { sunrise: 15.53, sunset: 2.38, polar: null }).up, 1);
    assert.equal(sunPlace(8, { sunrise: 15.53, sunset: 2.38, polar: null }).up, 0);
});

test("polar night has no sun and polar day keeps it low all day", () => {
    assert.equal(sunPlace(12, { sunrise: 0, sunset: 0, polar: "night" }).up, 0);
    const midnightSun = sunPlace(0, { sunrise: 0, sunset: 0, polar: "day" });
    assert.equal(midnightSun.up, 1);
    assert.ok(midnightSun.y > 0 && midnightSun.y < 0.45, JSON.stringify(midnightSun));
});

test("the moon is up during one of its stretches and carries its phase", () => {
    const moon = { phase: 0.132, ups: [[-12.6, -4.75], [12.52, 19.85]] };
    const up = moonPlace(15, moon);
    assert.equal(up.up, 1);
    assert.equal(up.phase, 0.132);
    assert.equal(moonPlace(21, moon).up, 0);
    assert.equal(moonPlace(15, null).up, 0);
});

test("the glass rims light from the sun's side, as a css gradient angle that runs away from it", () => {
    const up = { x: 0.5, y: 1, up: 1 };
    const right = { x: 1, y: 0.5, up: 1 };
    const down = { x: 0.5, y: -1, up: 0 };
    assert.equal(rimAngle(up, down, 1), 180);
    assert.equal(rimAngle(right, down, 1), 270);
});

test("with the sun down the rims light from the moon, and with neither up, from above", () => {
    const sunDown = { x: 0.5, y: -1, up: 0 };
    const moonLeft = { x: 0, y: 0.5, up: 1 };
    assert.equal(rimAngle(sunDown, moonLeft, 1), 90);
    assert.equal(rimAngle(sunDown, { x: 0.5, y: -1, up: 0 }, 1), 180);
});
