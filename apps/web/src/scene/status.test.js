import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { nextCheck, createStatus } from "./status.js";

test("a draining battery is checked each second while its phase has more than that left", () => {
    assert.equal(nextCheck({ charging: false, phaseLeft: 5000 }, 1), 1000);
    assert.equal(nextCheck({ charging: false, phaseLeft: 1001 }, 1), 1000);
});

test("a charging battery is checked every 300 ms", () => {
    assert.equal(nextCheck({ charging: true, phaseLeft: 90000 }, 1), 300);
});

test("a phase that ends before the next check is checked 20 ms after it ends", () => {
    assert.equal(nextCheck({ charging: false, phaseLeft: 1000 }, 1), 1020);
    assert.equal(nextCheck({ charging: false, phaseLeft: 992 }, 1), 1012);
    assert.equal(nextCheck({ charging: false, phaseLeft: 8 }, 1), 28);
    assert.equal(nextCheck({ charging: true, phaseLeft: 290 }, 1), 310);
});

test("the checks follow the battery's clock speed", () => {
    assert.equal(nextCheck({ charging: false, phaseLeft: 5000 }, 10), 100);
    assert.equal(nextCheck({ charging: false, phaseLeft: 5000 }, 1000), 1);
});

// the bar's online and offline listeners go on the window, which node doesn't have
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};

// each tick arms the next one before it calls onChange, so a callback that throws once doesn't stop the timer for good.
// node's mock timers run a timer that threw again on the next tick, which a browser doesn't, so the timers here are
// taken off before they run, the way a browser's are, with only the date mocked
const ticksAfterThrow = (kind, start, span) => {
    const real = { setTimeout, clearTimeout, setInterval, clearInterval };
    mock.timers.enable({ apis: ["Date"], now: new Date(2026, 0, 1, 12, 0, 30) });
    const queue = new Map();
    let nextId = 0;
    globalThis.setTimeout = (fn, ms = 0) => {
        queue.set(++nextId, { fn, at: Date.now() + ms });
        return nextId;
    };
    globalThis.clearTimeout = (id) => queue.delete(id);
    // the ping's interval never comes due here
    globalThis.setInterval = () => ++nextId;
    globalThis.clearInterval = () => {};
    const errors = [];
    const runUntil = (end) => {
        for (;;) {
            const due = [...queue].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!due) {
                break;
            }
            queue.delete(due[0]);
            mock.timers.setTime(due[1].at);
            try {
                due[1].fn();
            } catch (error) {
                errors.push(error);
            }
        }
        mock.timers.setTime(end);
    };
    let calls = 0;
    let throwing = false;
    const bar = createStatus((s, changed) => {
        if (changed !== kind) {
            return;
        }
        calls++;
        if (throwing) {
            throwing = false;
            throw new Error("broken");
        }
    });
    try {
        start(bar);
        const before = calls;
        throwing = true;
        runUntil(Date.now() + span);
        assert.deepEqual(errors.map((e) => e.message), ["broken"]);
        return calls - before - 1;
    } finally {
        bar.stop();
        Object.assign(globalThis, real);
        mock.timers.reset();
    }
};

test("the clock keeps ticking after a callback that threw", () => {
    assert.ok(ticksAfterThrow("time", () => {}, 200000) >= 2);
});

test("the battery keeps ticking after a callback that threw", () => {
    assert.ok(ticksAfterThrow("battery", (bar) => bar.setBatterySpeed(1000), 200) >= 2);
});

test("the ping skips a hidden tab, and pings again once the tab is shown", async () => {
    const saved = {
        navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
        document: globalThis.document,
        fetch: globalThis.fetch,
        addEventListener: globalThis.addEventListener,
        removeEventListener: globalThis.removeEventListener
    };
    const listeners = {};
    let pings = 0;
    Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true, writable: true });
    globalThis.document = { hidden: true };
    globalThis.fetch = async () => {
        pings++;
    };
    globalThis.addEventListener = (type, fn) => {
        listeners[type] = fn;
    };
    globalThis.removeEventListener = (type) => {
        delete listeners[type];
    };
    const bar = createStatus(() => {});
    try {
        await bar.pingNow();
        assert.equal(pings, 0);
        assert.equal(typeof listeners.visibilitychange, "function");
        globalThis.document.hidden = false;
        await listeners.visibilitychange();
        assert.equal(pings, 1);
    } finally {
        bar.stop();
        Object.defineProperty(globalThis, "navigator", saved.navigator);
        Object.assign(globalThis, { document: saved.document, fetch: saved.fetch, addEventListener: saved.addEventListener, removeEventListener: saved.removeEventListener });
    }
    assert.equal(listeners.visibilitychange, undefined, "stop takes the listener off");
});

test("the status has no online flag, which nothing read and nothing kept current", () => {
    const bar = createStatus(() => {});
    try {
        assert.equal("online" in bar.status, false);
    } finally {
        bar.stop();
    }
});
