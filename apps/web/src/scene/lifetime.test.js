import { test } from "node:test";
import assert from "node:assert/strict";
import { guard, setFail, sceneSignal, endFetches, loadingManager, every, endScene } from "./lifetime.js";

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

test("the scene's fetches all end together, the three loaders' included, and stay ended", () => {
    const own = new AbortController();
    const both = sceneSignal(own.signal);
    assert.equal(both.aborted, false);
    assert.equal(sceneSignal().aborted, false);
    endFetches();
    assert.equal(both.aborted, true);
    assert.equal(sceneSignal().aborted, true);
    assert.equal(loadingManager.abortController.signal.aborted, true);
    // three's own manager would make a fresh controller after an abort
    loadingManager.abort();
    assert.equal(loadingManager.abortController.signal.aborted, true);
});

test("an interval stops when the scene ends, and none starts after", () => {
    const id = every(() => {}, 1000);
    assert.notEqual(id, null);
    endScene();
    assert.equal(every(() => {}, 1000), null);
});
