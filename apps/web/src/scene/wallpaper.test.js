import { test } from "node:test";
import assert from "node:assert/strict";
import { createWallpaper } from "./wallpaper.js";

// stands in for three's renderer. it keeps a copy of the sky shader's uniform values from each draw, which is what
// would reach the gpu. vectors are copied, since the sky reuses them from draw to draw
const copyValue = (value) => {
    if (Array.isArray(value)) {
        return value.map(copyValue);
    }
    return value && typeof value.clone === "function" ? value.clone() : value;
};

const fakeRenderer = () => {
    const draws = [];
    return {
        draws,
        getRenderTarget: () => null,
        setRenderTarget: () => {},
        render: (mesh) => {
            draws.push(Object.fromEntries(Object.entries(mesh.material.uniforms).map(([name, u]) => [name, copyValue(u.value)])));
        }
    };
};

test("a sky built for a scene draws that scene at once, without fading in from clear", () => {
    const renderer = fakeRenderer();
    const sky = createWallpaper(renderer, { width: 100, height: 60, scene: "rain", intensity: "heavy" });
    sky.update(0);
    assert.equal(renderer.draws[0].scene, 5);
    assert.equal(renderer.draws[0].intensity, 1);
    assert.equal(renderer.draws[0].mixAmount, 1);
    assert.deepEqual(sky.weather(), { scene: "rain", intensity: "heavy" });
});

test("a sky built without a scene starts clear", () => {
    const renderer = fakeRenderer();
    const sky = createWallpaper(renderer, { width: 100, height: 60 });
    sky.update(0);
    assert.equal(renderer.draws[0].scene, 0);
    assert.deepEqual(sky.weather(), { scene: "clear", intensity: "moderate" });
});

test("changing the weather later still crossfades", () => {
    const renderer = fakeRenderer();
    const sky = createWallpaper(renderer, { width: 100, height: 60, scene: "clear", intensity: "moderate" });
    sky.update(0);
    sky.setWeather("snow", "heavy");
    sky.update(0.05);
    const last = renderer.draws[renderer.draws.length - 1];
    assert.equal(last.scene, 6);
    assert.ok(last.mixAmount < 1, `mix was ${last.mixAmount}`);
});

// runs the sky for this many seconds at 10 updates a second, the most a single update moves its clock
const runFor = (sky, from, seconds) => {
    for (let t = from; t <= from + seconds; t += 0.1) {
        sky.update(t);
    }
};

test("the shader's time stays small on a long visit, so the streaks keep their precision", () => {
    const renderer = fakeRenderer();
    const sky = createWallpaper(renderer, { width: 100, height: 60, scene: "rain", intensity: "heavy" });
    runFor(sky, 0, 3700);
    const last = renderer.draws[renderer.draws.length - 1];
    assert.ok(last.time < 3600, `time was ${last.time}`);
});

test("lightning still strikes after the shader's time wraps", () => {
    const renderer = fakeRenderer();
    const sky = createWallpaper(renderer, { width: 100, height: 60, scene: "thunder", intensity: "heavy" });
    runFor(sky, 0, 3590);
    const before = renderer.draws.length;
    runFor(sky, 3590, 30);
    const flashes = renderer.draws.slice(before).filter((d) => d.flash > 0.5);
    assert.ok(flashes.length > 0, "no strike in the 30 s around the wrap");
});

test("a strike draws a jagged bolt from the clouds down to the bottom, instead of flashing the whole sky", () => {
    const renderer = fakeRenderer();
    const sky = createWallpaper(renderer, { width: 140, height: 100, scene: "thunder", intensity: "heavy" });
    runFor(sky, 0, 20);
    const strike = renderer.draws.find((d) => d.flash > 0.5);
    assert.ok(strike, "no strike in 20 s");
    assert.ok(strike.boltCount >= 10, `only ${strike.boltCount} segments`);
    const segs = strike.bolt.slice(0, strike.boltCount);
    const ys = segs.flatMap((s) => [s.y, s.w]);
    const xs = segs.flatMap((s) => [s.x, s.z]);
    assert.ok(Math.max(...ys) > 0.7, "the bolt doesn't start up in the clouds");
    assert.ok(Math.min(...ys) < 0.05, "the bolt doesn't reach the bottom");
    assert.ok(Math.max(...xs) - Math.min(...xs) > 0.03, "the bolt is a straight line");
});

test("each strike gets a new bolt", () => {
    const renderer = fakeRenderer();
    const sky = createWallpaper(renderer, { width: 140, height: 100, scene: "thunder", intensity: "heavy" });
    runFor(sky, 0, 60);
    const firsts = [];
    let wasLit = false;
    renderer.draws.forEach((d) => {
        if (d.flash > 0.5 && !wasLit) {
            firsts.push(d.bolt[0].x);
        }
        wasLit = d.flash > 0.5;
    });
    assert.ok(firsts.length >= 3, `only ${firsts.length} strikes in 60 s`);
    assert.ok(new Set(firsts).size > 1, "every strike drew the same bolt");
});

test("the sun sits where the caller puts it", () => {
    const renderer = fakeRenderer();
    const sky = createWallpaper(renderer, { width: 140, height: 100, sun: [0.75, 1.02] });
    sky.update(0);
    assert.deepEqual([renderer.draws[0].sunAt.x, renderer.draws[0].sunAt.y], [0.75, 1.02]);
});

test("setBodies moves the sun and moon, and a still sky draws again to show it", () => {
    const renderer = fakeRenderer();
    const sky = createWallpaper(renderer, { width: 140, height: 100 });
    sky.setStill(true);
    sky.update(0);
    const before = renderer.draws.length;
    sky.setBodies({ sun: { x: 0.3, y: 0.6, up: 1 }, moon: { x: 0.8, y: 0.4, up: 1, phase: 0.25 } });
    sky.update(0.1);
    assert.equal(renderer.draws.length, before + 1);
    const last = renderer.draws[renderer.draws.length - 1];
    assert.deepEqual([last.sunAt.x, last.sunAt.y, last.sunUp], [0.3, 0.6, 1]);
    assert.deepEqual([last.moonAt.x, last.moonAt.y, last.moonUp, last.moonPhase], [0.8, 0.4, 1, 0.25]);
});

test("setBodies with the same places doesn't draw a still sky again", () => {
    const renderer = fakeRenderer();
    const sky = createWallpaper(renderer, { width: 140, height: 100 });
    const bodies = { sun: { x: 0.3, y: 0.6, up: 1 }, moon: { x: 0.8, y: 0.4, up: 0, phase: 0.25 } };
    sky.setStill(true);
    sky.setBodies(bodies);
    sky.update(0);
    const before = renderer.draws.length;
    sky.setBodies(bodies);
    sky.update(0.1);
    assert.equal(renderer.draws.length, before);
});
