import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { guard, setFail, sceneSignal, sceneFetch, endFetches, loadingManager, every, endScene } from "./lifetime.js";

test("a guarded handler hands what it throws to the failure, and what it rejects with", async () => {
    const failures = [];
    setFail((reason) => failures.push(reason));
    const thrown = new Error("thrown");
    const rejected = new Error("rejected");
    assert.equal(guard(() => {
        throw thrown;
    })(), undefined);
    await guard(async () => {
        throw rejected;
    })().catch(() => {});
    assert.deepEqual(failures, [thrown, rejected]);
    assert.equal(guard((a, b) => a + b)(2, 3), 5);
});

// the scene's fetch signal lasts the page's life, so a listener left on it for each fetch would pile up
const sceneListeners = () => getEventListeners(sceneSignal(), "abort").length;

test("with AbortSignal.any, a fetch adds no listener to the scene's fetches, and ends with its own signal", async () => {
    if (typeof AbortSignal.any !== "function") {
        return;
    }
    const realFetch = globalThis.fetch;
    let seen = null;
    globalThis.fetch = async (url, { signal }) => {
        seen = signal;
        return { ok: true };
    };
    try {
        const before = sceneListeners();
        const own = new AbortController();
        const fetching = sceneFetch("/ping.txt", { signal: own.signal });
        assert.equal(sceneListeners(), before);
        assert.equal(getEventListeners(own.signal, "abort").length, 0);
        await fetching;
        assert.equal(seen.aborted, false);
        own.abort();
        assert.equal(seen.aborted, true);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("without AbortSignal.any, a fetch takes its listener off the scene's fetches once it settles, and still ends with its own signal", async () => {
    const any = AbortSignal.any;
    const realFetch = globalThis.fetch;
    let seen = null;
    AbortSignal.any = undefined;
    globalThis.fetch = async (url, { signal }) => {
        seen = signal;
        return { ok: true };
    };
    try {
        const before = sceneListeners();
        const own = new AbortController();
        const fetching = sceneFetch("/ping.txt", { signal: own.signal });
        assert.equal(sceneListeners(), before + 1);
        await fetching;
        assert.equal(sceneListeners(), before);
        assert.equal(seen.aborted, false);
        own.abort();
        assert.equal(seen.aborted, true);
    } finally {
        AbortSignal.any = any;
        globalThis.fetch = realFetch;
    }
});

test("the scene's fetches all end together, the three loaders' included and one in flight, and stay ended", async () => {
    const realFetch = globalThis.fetch;
    const seen = [];
    globalThis.fetch = (url, { signal }) => new Promise((resolve, reject) => {
        seen.push(signal);
        signal.addEventListener("abort", () => reject(signal.reason));
    });
    try {
        const inFlight = sceneFetch("/slow.bin");
        const withOwn = sceneFetch("/slow2.bin", { signal: new AbortController().signal });
        assert.equal(sceneSignal().aborted, false);
        assert.deepEqual(seen.map((signal) => signal.aborted), [false, false]);
        endFetches();
        assert.equal(sceneSignal().aborted, true);
        assert.deepEqual(seen.map((signal) => signal.aborted), [true, true]);
        await assert.rejects(inFlight);
        await assert.rejects(withOwn);
        assert.equal(loadingManager.abortController.signal.aborted, true);
        // three's own manager would make a fresh controller after an abort
        loadingManager.abort();
        assert.equal(loadingManager.abortController.signal.aborted, true);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("an interval stops when the scene ends, and none starts after", () => {
    const id = every(() => {}, 1000);
    assert.notEqual(id, null);
    const realClear = globalThis.clearInterval;
    const cleared = [];
    globalThis.clearInterval = (clearedId) => {
        cleared.push(clearedId);
        realClear(clearedId);
    };
    try {
        endScene();
    } finally {
        globalThis.clearInterval = realClear;
    }
    assert.deepEqual(cleared, [id]);
    assert.equal(every(() => {}, 1000), null);
});
