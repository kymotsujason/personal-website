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
    // the reduced motion setting each test wants, and how many times the hands were led ahead of an open
    const reduced = { matches: false };
    let leads = 0;
    mock.module("./renderer.js", { namedExports: { camera: {}, backdrop: { lookAhead: () => {} } } });
    mock.module("./device.js", { namedExports: { centerComp: () => 0, setFold: () => {}, leadOpen: () => {
        leads++;
        return Promise.resolve();
    }, leadTo: () => Promise.resolve() } });
    mock.module("./loop.js", { namedExports: { idleDrift: () => ({ x: 0, y: 0, z: 0 }) } });
    mock.module("./home.js", { namedExports: { music: { loadPlayer: () => {} }, siteData: { apps: [] } } });
    mock.module("./quality.js", { namedExports: { reducedMotion: reduced } });
    mock.module("./screens.js", { namedExports: { glyphRect: () => ({ x0: 0, y0: 0, x1: 10, y1: 10, radius: 2 }), CARD_SLOTS: 4, EXTRA_HOLES: 3 } });

    const { state, pose } = await import("./state.js");
    const { cancelAll, runTweens } = await import("./tween.js");
    const { openPhone, closePhone } = await import("./fold.js");
    const { openFromCover, tapApp, tapFromCover, windowLook, switchCards, APP_BACKGROUND } = await import("./appWindow.js");
    const { setFail } = await import("./lifetime.js");

    const REST = { x: 0, y: 0, z: -40, rx: 0, ry: 0, rz: 0 };
    const STAGE = { x: 0, y: -0.5, z: -44, rx: 0.05, ry: 0, rz: 0 };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const reset = (phone, fold) => {
        cancelAll();
        Object.assign(state, { phone, busy: false, zoomed: false, openApp: null, screen: null, pageFade: null, poses: { rest: REST, stage: STAGE } });
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

    // with reduced motion the keys and a cover tap land on the end pose at once. the tweens here only move when the test
    // runs them, so a fold that still plays loses the race to the next macrotask
    const atOnce = (promise) => Promise.race([promise, settle().then(() => "still moving")]);
    const withReducedMotion = async (fn) => {
        reduced.matches = true;
        leads = 0;
        try {
            await fn();
        } finally {
            reduced.matches = false;
            cancelAll();
        }
    };
    const poseNow = () => ({ z: pose.z, fold: pose.fold });

    test("with reduced motion openPhone lands open at once, with no lead for the hands", () => withReducedMotion(async () => {
        reset("closed", 1);
        assert.equal(await atOnce(openPhone()), "done");
        assert.deepEqual({ phone: state.phone, busy: state.busy, leads, ...poseNow() }, { phone: "open", busy: false, leads: 0, z: REST.z, fold: 0 });
    }));

    test("with reduced motion closePhone lands closed at once", () => withReducedMotion(async () => {
        reset("open", 0);
        assert.equal(await atOnce(closePhone()), "done");
        assert.deepEqual({ phone: state.phone, busy: state.busy, ...poseNow() }, { phone: "closed", busy: false, z: STAGE.z, fold: 1 });
    }));

    test("with reduced motion a tap on the cover opens the phone at once and goes on to the app's crossfade", () => withReducedMotion(async () => {
        reset("closed", 1);
        state.screen = { homeEl: {} };
        const app = { name: "About", glyph: "A", color: "#3d405b" };
        openFromCover(app);
        await settle();
        assert.deepEqual({ phone: state.phone, app: state.openApp, fade: state.pageFade, leads, ...poseNow() }, { phone: "open", app, fade: 0, leads: 0, z: REST.z, fold: 0 });
    }));

    // with no navigation installed a tap opens the app itself, and an open that rejects (here, with a screen whose icon
    // lookup throws the sentinel) fails the scene instead of being dropped
    const sentinel = new Error("sentinel");
    const failuresOf = () => {
        const failures = [];
        setFail((reason) => failures.push(reason));
        state.screen = { get homeEl() {
            throw sentinel;
        } };
        return failures;
    };

    test("a tap on an icon hands an open that rejects to the failure", async () => {
        reset("open", 0);
        const failures = failuresOf();
        tapApp({ name: "About", glyph: "A", color: "#3d405b", path: "/about" });
        await settle();
        assert.deepEqual(failures, [sentinel]);
    });

    test("a tap on the cover hands an open that rejects to the failure", async () => {
        reset("closed", 1);
        const failures = failuresOf();
        tapFromCover({ name: "About", glyph: "A", color: "#3d405b", path: "/about" });
        await settle();
        runTweens(performance.now() + 5000);
        await settle();
        assert.deepEqual(failures, [sentinel]);
    });

    // the window grown out of a widget showed the app's icon color as it shrank and faded, an orange flash for
    // Projects, and it was gone while still a few times the widget's size
    const PROJECTS = { name: "Projects", color: "#e07a5f" };
    const GLASS = "#4a5a70";

    test("a window out of an icon starts in the icon's color and covers it the whole way", () => {
        assert.deepEqual(windowLook(0, PROJECTS, false, GLASS), { background: PROJECTS.color, opacity: 1 });
        assert.deepEqual(windowLook(1, PROJECTS, false, GLASS), { background: APP_BACKGROUND, opacity: 1 });
    });

    test("a window out of a widget never takes the icon's color, and turns the widget's glass color as it shrinks", () => {
        for (let k = 0; k <= 1; k += 0.05) {
            assert.notEqual(windowLook(k, PROJECTS, true, GLASS).background, PROJECTS.color, `at ${k}`);
        }
        assert.equal(windowLook(0, PROJECTS, true, GLASS).background, GLASS);
        assert.equal(windowLook(1, PROJECTS, true, GLASS).background, APP_BACKGROUND);
        assert.equal(windowLook(0, PROJECTS, true, null).background, APP_BACKGROUND);
    });

    test("a window out of a widget stays solid until it's about the widget's size, then fades into it", () => {
        assert.equal(windowLook(0.3, PROJECTS, true, GLASS).opacity, 1);
        assert.equal(windowLook(0.12, PROJECTS, true, GLASS).opacity, 1);
        assert.equal(windowLook(0, PROJECTS, true, GLASS).opacity, 0);
        const mid = windowLook(0.06, PROJECTS, true, GLASS).opacity;
        assert.ok(mid > 0 && mid < 1, `got ${mid}`);
    });

    // an app switch's two cards: the leaving one starts as the whole screen and the arriving one waits just past the
    // page's edge, both shrink most at halfway, mostly in height, and the arriving one ends as the whole screen
    const SCREEN = { fullW: 1000, fullH: 600, page: { x0: 100, y0: 50, x1: 900, y1: 550 } };
    const near = (got, want, what) => assert.ok(Math.abs(got - want) < 1e-6, `${what}: got ${got}, want ${want}`);
    const width = (r) => r.x1 - r.x0;
    const height = (r) => r.y1 - r.y0;

    test("a switch starts on the whole screen with the next card just past the page, and ends on it", () => {
        const start = switchCards(0, { ...SCREEN, back: false });
        assert.deepEqual(start.from, { x0: 0, y0: 0, x1: 1000, y1: 600 });
        near(start.to.x0 + SCREEN.page.x0, SCREEN.page.x1 + 0.04 * SCREEN.fullW, "the next page's left edge");
        near(start.round, 0, "the corners");
        const end = switchCards(1, { ...SCREEN, back: false });
        for (const key of ["x0", "y0", "x1", "y1"]) {
            near(end.to[key], { x0: 0, y0: 0, x1: 1000, y1: 600 }[key], `the arriving card's ${key}`);
        }
        assert.ok(end.from.x0 + SCREEN.page.x1 < SCREEN.page.x0, "the leaving page is off to the left");
        near(end.round, 0, "the corners");
    });

    test("halfway, both cards are smallest, shrunk more in height than width, either side of the page's center", () => {
        const mid = switchCards(0.5, { ...SCREEN, back: false });
        near(height(mid.from) / SCREEN.fullH, 0.86, "height");
        near(width(mid.from) / SCREEN.fullW, 0.94, "width");
        near(mid.round, 1, "the corners");
        const center = (SCREEN.page.x0 + SCREEN.page.x1) / 2;
        const middle = (r) => r.x0 + ((r.x1 - r.x0) * center) / SCREEN.fullW;
        near(center - middle(mid.from), middle(mid.to) - center, "the two cards' distance from the center");
        assert.ok(middle(mid.from) < center && middle(mid.to) > center);
    });

    test("Back runs the row the other way", () => {
        const ahead = switchCards(0.3, { ...SCREEN, back: false });
        const back = switchCards(0.3, { ...SCREEN, back: true });
        assert.ok(back.to.x1 < ahead.to.x0, "the next card comes from the left");
        near(height(back.to), height(ahead.to), "the same shrink");
    });
}
