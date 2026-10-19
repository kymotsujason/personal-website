import { loadHands } from "./handsModel.js";
import { loadPhone } from "./phoneModel.js";
import { createWeatherFeed, loadHome, readWeather } from "./weather.js";
import { readContributions } from "./github.js";
import { state, pose } from "./state.js";
import { cancelAll } from "./tween.js";
import { initRenderer, renderer, backdrop, MATERIALS, setWeather, applyWeather, applyDaylight } from "./renderer.js";
import { installQuality, resize } from "./quality.js";
import { initDevice, loadKeys, handsRig, buildDevice, loadCharger, watchCharger, chargerWanted } from "./device.js";
import { initHome, stopHome, showContributions, statusBar } from "./home.js";
import { initAppWindow, installHomeSwipe, openApp, openFromCover, closeApp, fadeTo, setPageFlatListener } from "./appWindow.js";
import { arrive, holdIntro, showFromAddress, showHome } from "./intro.js";
import { installGestures, installKeys } from "./fold.js";
import { installLook } from "./look.js";
import { startLoop, stopLoop } from "./loop.js";
import { testSwitches } from "./switches.js";
import { signal, endScene, endFetches, sceneFetch, sceneSignal, setFail, guard, every } from "./lifetime.js";

export { sceneNavigation } from "./navigation.js";

// resolves once startScene has set the scene up, before the models arrive, for the dev tools that reach into it
let markStarted = null;
export const sceneStarted = new Promise((resolve) => {
    markStarted = resolve;
});

// a resize or a rotation builds the phone again, in the state the page asks for (the page a navigation in flight is
// going to, or else #page's). while the page is still black that's the intro's start, and the intro opens the page's
// app once it has played. #page and its scroll are left alone
const rebuild = () => {
    resize();
    state.pageFlat = false;
    cancelAll();
    state.busy = false;
    state.zoomed = false;
    Object.assign(pose, { blur: 0, idle: 1, fold: 0 });
    buildDevice();
    Object.assign(pose, state.poses.rest);
    if (holdIntro()) {
        return;
    }
    if (!showFromAddress()) {
        showHome();
    }
};

let resizeTimer = null;
// registered once the phone is first built, since a rebuild before then would build it without the keys
const installRebuild = () => {
    addEventListener("resize", guard(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(guard(() => {
            resizeTimer = null;
            rebuild();
        }), 150);
    }), { signal });
    signal.addEventListener("abort", () => {
        clearTimeout(resizeTimer);
        resizeTimer = null;
    });
};

export const startScene = ({ stageEl, pageEl, siteData, music, onShown = () => {}, onFailed = () => {}, onPageFlat = () => {} }) => {
    const appNamed = (name) => siteData.apps.find((a) => a.name === name) || null;
    let failed = false;
    const root = document.documentElement;
    const onContextLost = () => fail("context");
    // each step runs even if one before it threw, since the scene may have failed part way through starting
    const quietly = (step) => {
        try {
            step();
        } catch (error) {
            console.warn("the scene's teardown hit an error", error);
        }
    };
    // final for this page load: the flat page as the server sent it, with its content and scroll, and a scene that
    // does nothing more. a reason that's a string (the watchdog, a lost context) or an error marked expected (a model
    // that didn't load) is the fallback working, so only an error nobody expected is logged as one
    const fail = (reason, { expected = typeof reason === "string" || Boolean(reason && reason.expected) } = {}) => {
        if (failed) {
            return;
        }
        failed = true;
        stopLoop();
        root.classList.add("scene-failed");
        root.classList.remove("has-3d", "page-first");
        pageEl.removeAttribute("style");
        // the desk's cursors, which would otherwise stay over the flat page
        document.body.classList.remove("closed", "looking", "over-volume");
        quietly(cancelAll);
        quietly(endFetches);
        quietly(endScene);
        quietly(stopHome);
        quietly(() => backdrop && backdrop.stop());
        quietly(() => {
            if (!renderer) {
                return;
            }
            renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
            const lost = renderer.getContext().isContextLost();
            renderer.dispose();
            if (!lost) {
                renderer.forceContextLoss();
            }
        });
        if (expected) {
            console.warn("the scene failed, so the page shows flat", reason);
        } else {
            console.error("the scene failed, so the page shows flat", reason);
        }
        onFailed(reason);
    };
    setFail(fail);

    const start = async () => {
        // the frame log wraps webgl before three makes its renderer, so it loads first. only the dev server and a build
        // made with PERF=1 have it
        if ((import.meta.env.DEV || __PERF__) && new URLSearchParams(location.search).has("perf")) {
            await import("../dev/perf.js");
        }
        initAppWindow(pageEl);
        setPageFlatListener(onPageFlat);
        initHome(siteData, music, watchCharger);
        // the capture build's readout for the tests (see capture.js). the build that ships leaves it out
        if (__CAPTURE__) {
            await import("./capture.js");
        }
        initRenderer(stageEl.querySelector("#gl-layer"));
        // rare, and rebuilding every texture the scene uploads isn't worth the risk, so the page shows flat
        renderer.domElement.addEventListener("webglcontextlost", onContextLost);
        installQuality();
        initDevice(stageEl.querySelector("#css-layer"));
        installHomeSwipe();
        // the time of day sets the room's light, checked each minute
        applyDaylight();
        every(applyDaylight, 60000);
        installGestures();
        installLook();
        installKeys();
        markStarted();

        resize();
        // the home route's answer carries the weather and the github graph, asked while the hands load and the intro
        // plays. until it answers the sky is clear and follows the clock. after that it's asked again once the weather
        // is half an hour old, checked each minute and when a hidden tab is shown again, and a later answer's graph
        // replaces the shown one. ?noweather asks once for the graph and leaves the sky on that fallback, for checking it
        const askHome = async () => {
            const home = await loadHome({ fetchImpl: sceneFetch });
            // guarded, so a throw fails the scene instead of leaving the feed stuck on a rejected ask
            guard(showContributions)(readContributions(home ? home.github : null));
            return home;
        };
        if (testSwitches && new URLSearchParams(location.search).has("noweather")) {
            askHome();
        } else {
            const feed = createWeatherFeed({
                load: () => askHome().then(readWeather),
                onWeather: (data) => {
                    setWeather(data);
                    applyWeather();
                    applyDaylight();
                }
            });
            feed.refresh();
            every(feed.refresh, 60000);
            document.addEventListener("visibilitychange", guard(() => {
                if (!document.hidden) {
                    feed.refresh();
                }
            }), { signal });
        }
        // the two models load at the same time, the hands once their rig has arrived with the keys. neither has a
        // stand in, so the page shows flat without them
        const keys = loadKeys();
        // the cable's code comes with them when the battery is already low or charging, and later otherwise
        const charger = statusBar && chargerWanted(statusBar.status) ? loadCharger() : null;
        let models = null;
        try {
            models = await Promise.all([
                loadPhone("/models/phone.packed.glb", MATERIALS.phone, { signal: sceneSignal() }),
                keys.then(() => loadHands("/models/hands.packed.glb", handsRig, { signal: sceneSignal() })),
                charger
            ]);
        } catch (error) {
            fail(error, { expected: true });
            return;
        }
        const [phoneModel, handModel] = models;
        // the head script's watchdog may have given up while the models loaded, and a scene that arrives late stays
        // stopped
        if (failed || root.classList.contains("scene-failed")) {
            fail("arrived after the watchdog");
            return;
        }
        state.phoneModel = phoneModel;
        state.handModel = handModel;
        buildDevice();
        installRebuild();
        arrive();
        startLoop(onShown);
    };
    start().catch(fail);

    // the navigation's entry points into the scene, each failing the scene if it throws, and doing nothing once it has
    // failed, since a navigation still reaches them on the flat page
    const entry = (fn) => guard((...args) => (failed ? Promise.resolve() : fn(...args)));

    return {
        // with the phone closed, an app opens the phone first
        openApp: entry((appName, opts) => {
            const app = appNamed(appName);
            if (!app) {
                return Promise.resolve();
            }
            return state.phone === "closed" ? openFromCover(app, opts) : openApp(app, opts);
        }),
        closeApp: entry((opts = {}) => closeApp(opts.from ?? null)),
        fadeTo: entry((appName) => {
            const app = appNamed(appName);
            return app ? fadeTo(app) : Promise.resolve();
        }),
        // the end state for the page at once, with no animation
        showUrl: entry(() => {
            if (!showFromAddress()) {
                showHome();
            }
        }),
        rebuild: entry(rebuild),
        rebuildPending: () => resizeTimer !== null,
        fail,
        isBusy: () => state.busy,
        hasApp: (name) => Boolean(appNamed(name)),
        // what the navigation needs to know: null for phone before the first intro unlocks it, and shown when the app
        // window shows #page, growing, shrinking, flat at full zoom, or fading with reduced motion
        status: () => ({
            phone: state.phone,
            busy: state.busy,
            zoomed: state.zoomed,
            app: state.openApp ? state.openApp.name : null,
            shown: state.appVisible || state.pageFlat || state.pageFade !== null
        })
    };
};
