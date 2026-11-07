import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// the quality ladder reaches the renderer and the screens' glass, which need a browser, so those are stood in for.
// node:test's module mocks need a flag, so without it this file runs itself again with the flag
if (typeof mock.module !== "function") {
    test("the quality ladder's handoff, with module mocks", () => {
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const run = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--test", fileURLToPath(import.meta.url)], { encoding: "utf8", env });
        assert.equal(run.status, 0, run.stdout + run.stderr);
    });
} else {
    mock.module("./renderer.js", { namedExports: { renderer: {}, camera: {}, backdrop: { keepSmall: () => {} } } });
    mock.module("./screens.js", { namedExports: { setGlassSimple: () => {} } });

    // the window the ladder listens on, a device whose pixel cap can't drop, and storage that keeps what's written
    const win = new EventTarget();
    globalThis.addEventListener = win.addEventListener.bind(win);
    globalThis.removeEventListener = win.removeEventListener.bind(win);
    globalThis.window = globalThis;
    globalThis.devicePixelRatio = 1;
    globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {} });
    globalThis.document = { documentElement: { classList: { toggle: () => {} } } };
    const stored = new Map();
    globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) };

    const { state } = await import("./state.js");
    const { tween, cancelAll } = await import("./tween.js");

    const pointer = (type, pointerId, buttons = 0) => win.dispatchEvent(Object.assign(new Event(type), { pointerId, buttons }));

    // a fresh ladder for each test, since its levels are kept for the page's life. each second of frames is all over
    // 60 ms, which no step can fix
    let fresh = 0;
    const ladder = async () => {
        fresh++;
        const quality = await import(`./quality.js?ladder=${fresh}`);
        const handoffs = [];
        const lastSteps = [];
        quality.installQuality({ onHandoff: () => handoffs.push(Date.now()), onLastStep: () => lastSteps.push(true) });
        let now = 0;
        const second = () => {
            for (let i = 0; i < 16; i++) {
                quality.frameTimes.push(62);
            }
            now += 1001;
            quality.stepQuality(now);
        };
        return { handoffs, lastSteps, second, quality };
    };
    // the phone open and still on the home screen, with nothing held
    const atRest = () => {
        Object.assign(state, { phone: "open", busy: false, switching: null, zoomed: false, pendingPage: null, charger: null });
        cancelAll();
    };

    test("the handoff waits for a pointer up", async () => {
        atRest();
        stored.clear();
        const { handoffs, lastSteps, second } = await ladder();
        pointer("pointerdown", 7, 1);
        for (let i = 0; i < 40; i++) {
            second();
        }
        assert.equal(lastSteps.length, 1, "the last step before the switch is reported once, for the prefetch");
        assert.equal(handoffs.length, 0, "a pointer is still down");
        assert.equal(stored.get("2dAuto"), undefined);
        // a move with the button still down keeps it held
        pointer("pointermove", 7, 1);
        second();
        assert.equal(handoffs.length, 0);
        pointer("pointerup", 7);
        second();
        assert.equal(handoffs.length, 1);
        assert.ok(Number(stored.get("2dAuto")) > 0, "2dAuto is saved with the handoff");

        // a move with no button down is a release the window didn't hear (outside it, say)
        const other = await ladder();
        pointer("pointerdown", 8, 1);
        for (let i = 0; i < 40; i++) {
            other.second();
        }
        assert.equal(other.handoffs.length, 0);
        pointer("pointermove", 8, 0);
        other.second();
        assert.equal(other.handoffs.length, 1);
    });

    test("the handoff waits for the charger", async () => {
        atRest();
        let busy = true;
        state.charger = { busy: () => busy };
        const { handoffs, second } = await ladder();
        for (let i = 0; i < 40; i++) {
            second();
        }
        assert.equal(handoffs.length, 0, "the cable is still moving");
        busy = false;
        second();
        assert.equal(handoffs.length, 1);
    });

    test("the handoff waits for a lead and a navigation the 3d scene is deciding", async () => {
        atRest();
        const { handoffs, second } = await ladder();
        // a lead that hasn't started yet still counts
        const lead = tween({ to: {}, duration: 300, delay: 100000, easing: (t) => t, group: "lead", onUpdate: () => {} });
        state.pendingPage = "About";
        for (let i = 0; i < 40; i++) {
            second();
        }
        assert.equal(handoffs.length, 0);
        state.pendingPage = null;
        second();
        assert.equal(handoffs.length, 0, "the lead is still going");
        cancelAll();
        assert.equal(await lead, "cancelled");
        second();
        assert.equal(handoffs.length, 1);
    });

    test("a visitor who chose 3d keeps it", async () => {
        atRest();
        window.__chose3d = true;
        try {
            const { handoffs, lastSteps, second } = await ladder();
            for (let i = 0; i < 40; i++) {
                second();
            }
            assert.equal(handoffs.length, 0);
            assert.equal(lastSteps.length, 0);
        } finally {
            window.__chose3d = false;
        }
    });
}
