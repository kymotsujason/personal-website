import { test } from "node:test";
import assert from "node:assert/strict";
import { tween, cancelGroup, cancelAll, runTweens } from "./tween.js";
import { pose } from "./state.js";

const linear = (t) => t;

test("a tween resolves done once runTweens passes its end", async () => {
    pose.x = 0;
    const start = performance.now();
    const done = tween({ to: { x: 10 }, duration: 100, easing: linear });
    runTweens(start + 50);
    assert.ok(pose.x > 0 && pose.x < 10);
    runTweens(start + 150);
    assert.equal(pose.x, 10);
    assert.equal(await done, "done");
});

test("cancelAll resolves every pending tween with cancelled", async () => {
    let updated = false;
    const a = tween({ to: {}, duration: 100, easing: linear, onUpdate: () => (updated = true) });
    const b = tween({ to: {}, duration: 100, easing: linear, group: "fold" });
    const c = tween({ to: {}, duration: 100, delay: 5000, easing: linear, group: "intro" });
    cancelAll();
    assert.deepEqual(await Promise.all([a, b, c]), ["cancelled", "cancelled", "cancelled"]);
    // a cancelled tween is gone, so a later frame doesn't run it
    runTweens(performance.now() + 10000);
    assert.equal(updated, false);
});

test("cancelGroup resolves only that group's tweens", async () => {
    const start = performance.now();
    const fold = tween({ to: {}, duration: 100, easing: linear, group: "fold" });
    const intro = tween({ to: {}, duration: 100, easing: linear, group: "intro" });
    const loose = tween({ to: {}, duration: 100, easing: linear });
    cancelGroup("fold");
    assert.equal(await fold, "cancelled");
    let introResult = null;
    let looseResult = null;
    intro.then((r) => (introResult = r));
    loose.then((r) => (looseResult = r));
    await Promise.resolve();
    assert.equal(introResult, null);
    assert.equal(looseResult, null);
    runTweens(start + 200);
    assert.equal(await intro, "done");
    assert.equal(await loose, "done");
});
