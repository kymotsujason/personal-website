// window.__capture, only in a build made with CAPTURE=1 (see astro.config.mjs and index.js). pose() reads the phone's
// state and its parts' and hands' matrices the way tests/compare/compare.spec.ts records them, throwNextFrame() and
// throwInIntro() make the next frame or the intro throw for the failure tests, and act() and setDevice() start what the
// comparison steps through, the same calls the dev panel and window.spike make
import { state, pose, settings } from "./state.js";
import { camera } from "./renderer.js";
import { setFrameHook } from "./loop.js";
import { buildDevice } from "./device.js";
import { playIntro, showFromAddress, setIntroHook } from "./intro.js";
import { openPhone, closePhone } from "./fold.js";
import { openApp, closeApp } from "./appWindow.js";
import { siteData } from "./home.js";

const PARTS = ["flap", "body", "hinged", "pivot", "hingeTurn"];

const readPose = () => {
    const out = {
        phone: state.phone,
        busy: state.busy,
        zoomed: state.zoomed,
        app: state.zoomed && state.openApp ? state.openApp.name : null,
        fold: pose.fold,
        root: null,
        parts: {},
        bones: {}
    };
    if (!state.root || !camera) {
        return out;
    }
    const inverse = camera.matrixWorldInverse;
    const relative = (object) => inverse.clone().multiply(object.matrixWorld).toArray();
    out.root = relative(state.root);
    PARTS.forEach((name) => {
        if (state[name]) {
            out.parts[name] = relative(state[name]);
        }
    });
    if (state.handModel) {
        Object.keys(state.handModel.bones)
            .sort()
            .forEach((name) => {
                out.bones[name] = relative(state.handModel.bones[name]);
            });
    }
    return out;
};

const actions = {
    "replay-full": () => playIntro(false),
    "replay-fast": () => playIntro(true),
    open: () => openPhone(),
    close: () => closePhone(),
    about: () => openApp(siteData.apps.find((a) => a.name === "About")),
    escape: () => closeApp()
};

window.__capture = {
    pose: readPose,
    throwNextFrame: () => {
        setFrameHook(() => {
            setFrameHook(null);
            // marked expected, so the failure logs it as the fallback working (see fail in index.js)
            throw Object.assign(new Error("a frame thrown by __capture"), { expected: true });
        });
    },
    // the same for the intro, once the page has faded in and it starts to play
    throwInIntro: () => {
        setIntroHook(() => {
            setIntroHook(null);
            throw Object.assign(new Error("an intro thrown by __capture"), { expected: true });
        });
    },
    act: (name) => actions[name](),
    // the dev panel's device choice: the phone built again for it, and the fast intro
    setDevice: (value) => {
        settings.device = value;
        buildDevice();
        if (!showFromAddress()) {
            playIntro(true);
        }
    },
    // the two screens' materials, for the comparison's checkerboard
    screens: () => [state.screen.material, state.cover.material]
};
