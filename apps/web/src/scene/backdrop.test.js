import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

// the desk loads its photos through three's loaders and a worker, which need a browser, so the loaders' load is stood
// in for by one that answers from a list of urls that fail, and the worker by a class each test picks. the bitmap path
// is the one browsers take, so createImageBitmap is set before backdrop.js reads it
globalThis.createImageBitmap = () => {};
globalThis.location = { href: "http://localhost/" };
const { createBackdrop, DESK } = await import("./backdrop.js");

const renderer = { capabilities: { getMaxAnisotropy: () => 1 }, initTexture: () => {}, copyTextureToTexture: () => {} };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// every url asked for, in order, and the ones that fail, each for as many asks as given (Infinity for always)
let asked = [];
let failing = new Map();
const answer = (url, onLoad, onError) => {
    asked.push(url);
    const left = failing.get(url) ?? 0;
    if (left > 0) {
        failing.set(url, left - 1);
        setTimeout(onError, 0);
        return;
    }
    setTimeout(() => onLoad({ width: 256, height: 256, close: () => {} }), 0);
};
THREE.ImageBitmapLoader.prototype.load = function (url, onLoad, onProgress, onError) {
    answer(url, onLoad, onError);
};
THREE.TextureLoader.prototype.load = function (url, onLoad, onProgress, onError) {
    answer(url, (image) => onLoad(new THREE.Texture(image)), onError);
};
const reset = (fails, worker) => {
    asked = [];
    failing = new Map(fails.map((url) => [url, Infinity]));
    globalThis.Worker = worker;
};

test("the desk shows when neither copy of the screen mask loads", async () => {
    reset([DESK.wall.maskSmall, DESK.wall.mask], undefined);
    const backdrop = createBackdrop(renderer, () => {});
    backdrop.setWallpaper(12);
    for (let i = 0; i < 5; i++) {
        await settle();
    }
    assert.ok(asked.includes(DESK.wall.mask));
    assert.equal(backdrop.ready(), true);
});

test("a full image asked for after the photo worker failed to start loads on the page instead of waiting forever", async () => {
    const posted = [];
    // a worker whose script didn't load: an error event, and every message after it dropped
    class DeadWorker {
        constructor() {
            setTimeout(() => this.onerror(new Event("error")), 0);
        }
        postMessage(data) {
            posted.push(data.url);
        }
        terminate() {}
    }
    reset([], DeadWorker);
    const backdrop = createBackdrop(renderer, () => {});
    backdrop.setWallpaper(12);
    await settle();
    await settle();
    backdrop.loadRest();
    for (let i = 0; i < 5; i++) {
        await settle();
    }
    assert.ok(asked.includes(DESK.src), "the desk's full photo went to the page once the worker failed");
    backdrop.setWallpaper(18);
    for (let i = 0; i < 5; i++) {
        await settle();
    }
    assert.ok(asked.includes(DESK.wall.src(1)), "a later full image went to the page too");
    assert.ok(!posted.includes(new URL(DESK.wall.src(1), location.href).href), "nothing more was posted to the dead worker");
});

test("a wallpaper image that failed is asked for again the next time it's wanted", async () => {
    reset([], undefined);
    failing.set(DESK.wall.small(0), 1);
    const backdrop = createBackdrop(renderer, () => {});
    backdrop.setWallpaper(12);
    await settle();
    await settle();
    backdrop.setWallpaper(18);
    await settle();
    await settle();
    backdrop.setWallpaper(12);
    await settle();
    await settle();
    assert.equal(asked.filter((url) => url === DESK.wall.small(0)).length, 2);
});
