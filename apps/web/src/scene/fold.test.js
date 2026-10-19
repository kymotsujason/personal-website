import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// the fold reaches the renderer, the device, the loop, and the app window, which need a browser, so those are stood in
// for. node:test's module mocks need a flag, so without it this file runs itself again with the flag
if (typeof mock.module !== "function") {
    test("the fold's keys, with module mocks", () => {
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const run = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--test", fileURLToPath(import.meta.url)], { encoding: "utf8", env });
        assert.equal(run.status, 0, run.stdout + run.stderr);
    });
} else {
    const broken = new Error("broken");
    mock.module("./renderer.js", { namedExports: { camera: {}, backdrop: { lookAhead: () => {} } } });
    mock.module("./device.js", { namedExports: { centerComp: () => 0, setFold: () => {}, leadOpen: () => Promise.resolve(), leadTo: () => Promise.resolve() } });
    mock.module("./loop.js", { namedExports: { idleDrift: () => {
        throw broken;
    } } });
    mock.module("./appWindow.js", { namedExports: { closeApp: () => Promise.reject(broken) } });

    const { state } = await import("./state.js");
    const { setFail } = await import("./lifetime.js");
    const { installKeys } = await import("./fold.js");

    const handlers = {};
    globalThis.addEventListener = (type, fn) => {
        handlers[type] = fn;
    };
    installKeys();
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const press = async (key, phone, zoomed) => {
        const failures = [];
        setFail((reason) => failures.push(reason));
        Object.assign(state, { phone, busy: false, zoomed });
        handlers.keydown({ key, target: {} });
        await settle();
        return failures;
    };

    test("Escape hands a close that rejects to the failure", async () => {
        assert.deepEqual(await press("Escape", "open", false), [broken]);
    });

    test("Escape hands an app close that rejects to the failure", async () => {
        assert.deepEqual(await press("Escape", "open", true), [broken]);
    });

    test("Enter hands an open that rejects to the failure", async () => {
        assert.deepEqual(await press("Enter", "closed", false), [broken]);
    });
}
