import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// the fold and the app window reach the renderer, the device, the loop, the quality ladder, and the music, which need a
// browser, so those are stood in for. node:test's module mocks need a flag, so without it this file runs itself again
// with the flag
if (typeof mock.module !== "function") {
    test("the open from the cover, with module mocks", () => {
        // node --test marks its own children through NODE_TEST_CONTEXT, which would hand this run's results to the
        // parent instead of setting the exit code, so the child starts without it
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const run = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--test", fileURLToPath(import.meta.url)], { encoding: "utf8", env });
        assert.equal(run.status, 0, run.stdout + run.stderr);
    });
} else {
    mock.module("./renderer.js", { namedExports: { camera: {}, backdrop: { lookAhead: () => {} } } });
    mock.module("./device.js", { namedExports: { centerComp: () => 0, setFold: () => {}, leadOpen: () => Promise.resolve(), leadTo: () => Promise.resolve() } });
    mock.module("./loop.js", { namedExports: { idleDrift: () => ({ x: 0, y: 0, z: 0 }) } });
    mock.module("./home.js", { namedExports: { music: { loadPlayer: () => {} } } });
    mock.module("./quality.js", { namedExports: { reducedMotion: { matches: false } } });

    const { state, pose } = await import("./state.js");
    const { cancelAll, runTweens } = await import("./tween.js");
    const { openPhone, closePhone } = await import("./fold.js");
    const { openFromCover, tapApp, tapFromCover } = await import("./appWindow.js");
    const { setFail } = await import("./lifetime.js");

    const REST = { x: 0, y: 0, z: -40, rx: 0, ry: 0, rz: 0 };
    const STAGE = { x: 0, y: -0.5, z: -44, rx: 0.05, ry: 0, rz: 0 };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const reset = (phone, fold) => {
        cancelAll();
        Object.assign(state, { phone, busy: false, zoomed: false, openApp: null, poses: { rest: REST, stage: STAGE } });
        Object.assign(pose, REST, { fold, idle: 1, blur: 0 });
    };

    test("openPhone gives back done once the phone is open", async () => {
        reset("closed", 1);
        const opened = openPhone();
        await settle();
        runTweens(performance.now() + 5000);
        assert.equal(await opened, "done");
        assert.equal(state.phone, "open");
    });

    test("openPhone gives back cancelled when cancelAll stops it", async () => {
        reset("closed", 1);
        const opened = openPhone();
        await settle();
        cancelAll();
        assert.equal(await opened, "cancelled");
        assert.equal(state.phone, "closed");
    });

    test("closePhone gives back done, or cancelled when cancelAll stops it", async () => {
        reset("open", 0);
        const closed = closePhone();
        runTweens(performance.now() + 5000);
        assert.equal(await closed, "done");
        assert.equal(state.phone, "closed");
        reset("open", 0);
        const stopped = closePhone();
        cancelAll();
        assert.equal(await stopped, "cancelled");
        assert.equal(state.phone, "open");
    });

    test("a tap on the cover drops its app when a rebuild cancels the open", async () => {
        reset("closed", 1);
        const tapped = openFromCover({ name: "About", glyph: "A", color: "#3d405b" });
        await settle();
        // what the resize rebuild does: the tweens go, and busy and zoomed are put back, with the phone left closed
        cancelAll();
        state.busy = false;
        state.zoomed = false;
        await tapped;
        assert.equal(state.openApp, null);
        assert.equal(state.busy, false);
    });

    // with no navigation installed a tap opens the app itself, and an open that throws (here, with no screen built to
    // find the icon on) fails the scene instead of being dropped
    const failuresOf = () => {
        const failures = [];
        setFail((reason) => failures.push(reason));
        return failures;
    };

    test("a tap on an icon hands an open that rejects to the failure", async () => {
        reset("open", 0);
        const failures = failuresOf();
        tapApp({ name: "About", glyph: "A", color: "#3d405b", path: "/about" });
        await settle();
        assert.equal(failures.length, 1);
        assert.ok(failures[0] instanceof TypeError);
    });

    test("a tap on the cover hands an open that rejects to the failure", async () => {
        reset("closed", 1);
        const failures = failuresOf();
        tapFromCover({ name: "About", glyph: "A", color: "#3d405b", path: "/about" });
        await settle();
        runTweens(performance.now() + 5000);
        await settle();
        assert.equal(failures.length, 1);
        assert.ok(failures[0] instanceof TypeError);
    });
}
