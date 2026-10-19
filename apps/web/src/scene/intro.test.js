import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// the intro reaches the renderer, the device, the loop, the home screen, and the app window, which need a browser, so
// those are stood in for. node:test's module mocks need a flag, so without it this file runs itself again with the flag
if (typeof mock.module !== "function") {
    test("the intro's arrivals, with module mocks", () => {
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const run = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--test", fileURLToPath(import.meta.url)], { encoding: "utf8", env });
        assert.equal(run.status, 0, run.stdout + run.stderr);
    });
} else {
    const broken = new Error("broken");
    const volumeBroken = new Error("volume broken");
    mock.module("./renderer.js", { namedExports: { camera: {}, backdrop: { lookAhead: () => {}, loadRest: () => {} } } });
    mock.module("./device.js", { namedExports: { centerComp: () => 0, setFold: () => {}, leadOpen: () => Promise.resolve(), leadTo: () => Promise.resolve(), LEAD: { fold: 0.01, time: 300 }, loadVolume: () => Promise.reject(volumeBroken) } });
    mock.module("./loop.js", { namedExports: { idleDrift: () => ({ x: 0, y: 0, z: 0 }), shown: Promise.resolve() } });
    mock.module("./home.js", { namedExports: { siteData: { apps: [{ name: "About" }] }, dropScrub: () => {} } });
    mock.module("./appWindow.js", { namedExports: { pageEl: null, openApp: () => Promise.reject(broken), hideFlat: () => {}, resetAppWindow: () => {}, setAppVisible: () => {}, closeApp: () => Promise.resolve(), dropHomeSwipe: () => {} } });
    mock.module("./quality.js", { namedExports: { reducedMotion: { matches: true } } });

    const { state } = await import("./state.js");
    const { setFail } = await import("./lifetime.js");
    const { showFromAddress, arrive } = await import("./intro.js");

    const REST = { x: 0, y: 0, z: -40, rx: 0, ry: 0, rz: 0 };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const failuresOf = () => {
        const failures = [];
        setFail((reason) => failures.push(reason));
        Object.assign(state, { phone: null, busy: false, zoomed: false, pendingPage: null, poses: { rest: REST } });
        return failures;
    };

    test("an app shown at once hands an open that rejects to the failure", async () => {
        const failures = failuresOf();
        assert.equal(showFromAddress({ name: "About" }), true);
        await settle();
        assert.deepEqual(failures, [broken]);
    });

    test("an arrival with reduced motion hands a volume load that rejects to the failure", async () => {
        const failures = failuresOf();
        arrive();
        await settle();
        assert.deepEqual(failures, [volumeBroken]);
    });
}
