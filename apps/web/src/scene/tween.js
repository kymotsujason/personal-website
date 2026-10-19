import { pose } from "./state.js";
import { testSwitches } from "./switches.js";

const TIME_SCALE = (testSwitches && Number(new URLSearchParams(globalThis.location?.search).get("slow"))) || 1;

let tweens = [];

export const ease = {
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    outQuart: (t) => 1 - Math.pow(1 - t, 4),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    outSine: (t) => Math.sin((t * Math.PI) / 2)
};

// resolves "done" when it finishes, or "cancelled" when cancelGroup or cancelAll stops it first
export const tween = ({ to, duration, easing, delay = 0, onUpdate, group = null }) => {
    return new Promise((resolve) => {
        tweens.push({ to, duration: duration * TIME_SCALE, easing, start: performance.now() + delay * TIME_SCALE, from: null, onUpdate, resolve, group });
    });
};

// stops a group's tweens where they are, so a new motion can take over from the current pose
export const cancelGroup = (group) => {
    tweens = tweens.filter((tw) => {
        if (tw.group !== group) {
            return true;
        }
        tw.resolve("cancelled");
        return false;
    });
};

// stops every tween where it is, and settles each one, so nothing waiting on a tween is left hanging
export const cancelAll = () => {
    const stopped = tweens;
    tweens = [];
    stopped.forEach((tw) => tw.resolve("cancelled"));
};

export const runTweens = (now) => {
    tweens = tweens.filter((tw) => {
        if (now < tw.start) {
            return true;
        }
        if (!tw.from) {
            tw.from = {};
            Object.keys(tw.to).forEach((key) => {
                tw.from[key] = pose[key];
            });
        }
        const t = Math.min((now - tw.start) / tw.duration, 1);
        const k = tw.easing(t);
        Object.keys(tw.to).forEach((key) => {
            pose[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * k;
        });
        if (tw.onUpdate) {
            tw.onUpdate(t);
        }
        if (t >= 1) {
            tw.resolve("done");
            return false;
        }
        return true;
    });
};
