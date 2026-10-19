import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// the home screen reaches the status bar, the screens, and the app window, which need a browser, so those are stood in
// for, and jsdom gives it a document. node:test's module mocks need a flag, so without it this file runs itself again
// with the flag
if (typeof mock.module !== "function") {
    test("the home screen's status bar, with module mocks", () => {
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const run = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--test", fileURLToPath(import.meta.url)], { encoding: "utf8", env });
        assert.equal(run.status, 0, run.stdout + run.stderr);
    });
} else {
    const broken = new Error("broken");
    const pingBroken = new Error("ping broken");
    let onStatus = null;
    mock.module("./status.js", { namedExports: { createStatus: (fn) => {
        onStatus = fn;
        return { status: {}, pingNow: () => Promise.reject(pingBroken), stop: () => {} };
    } } });
    mock.module("./screens.js", { namedExports: { drawHome: () => {}, redrawStatus: () => {}, elementRect: () => ({}) } });
    mock.module("./appWindow.js", { namedExports: { tapApp: () => {} } });

    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!doctype html><body></body>");
    globalThis.document = dom.window.document;

    const { setFail, endScene } = await import("./lifetime.js");
    const { initHome, buildHomeContent } = await import("./home.js");

    const music = { waitWhile: () => {}, subscribe: () => () => {}, position: () => ({ time: 0, duration: 0, at: 0 }), state: () => ({}) };
    initHome({ apps: [] }, music, () => {
        throw broken;
    });
    // the music bar's interval ends with the scene's signal
    after(endScene);

    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const failuresOf = () => {
        const failures = [];
        setFail((reason) => failures.push(reason));
        return failures;
    };

    test("a throw in the status bar's callback goes to the failure instead of out of the bar's timer", () => {
        const failures = failuresOf();
        assert.doesNotThrow(() => onStatus({}, "battery"));
        assert.deepEqual(failures, [broken]);
    });

    test("a tap on the indicators hands a ping that rejects to the failure", async () => {
        const failures = failuresOf();
        const content = buildHomeContent(() => {});
        content.querySelector(".indicators").click();
        await settle();
        assert.deepEqual(failures, [pingBroken]);
    });
}
