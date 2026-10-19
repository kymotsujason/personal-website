import { stepSkyLevel, stepLater, glassFor, LATER } from "./skyLevel.js";
import { setGlassSimple } from "./screens.js";
import { renderer, camera, backdrop } from "./renderer.js";
import { state } from "./state.js";
import { signal, guard } from "./lifetime.js";

// with reduced motion the sky holds still on one frame of its weather, and it follows the setting if it changes.
// skyMotion is how far a slow device has turned the sky down (see skyLevel.js)
export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
export let skyMotion = { level: 0, slow: 0, fast: 0, retried: false };
export const setSkyMotion = (value) => {
    skyMotion = value;
};
export const applyWallpaperMotion = () => {
    if (!state.wallpaper) {
        return;
    }
    state.wallpaper.setStill(reducedMotion.matches || skyMotion.level >= 2);
    state.wallpaper.setRate(skyMotion.level >= 1 ? 15 : 30);
    // the glass steps down with the sky. frosted glass needs the blurred sky current before it shows again
    state.glassLevel = glassFor(skyMotion.level);
    if (state.glassLevel.frosted) {
        state.frost.render();
    }
    state.screen.composite.setFrosted(state.glassLevel.frosted);
    state.cover.composite.setFrosted(state.glassLevel.frosted);
    applyLater();
};

// the site's steps past a still sky (see skyLevel.js stepLater). the glass is set on each build of the device, since
// a rebuild makes new materials, and the loop reads the level for the focus blur
export let laterLevel = 0;
let laterSlow = 0;
const applyLater = () => {
    document.documentElement.classList.toggle("glass-simple", laterLevel >= LATER.simpleGlass);
    if (state.screen) {
        setGlassSimple(state.screen.material, laterLevel >= LATER.simpleGlass);
        setGlassSimple(state.cover.material, laterLevel >= LATER.simpleGlass);
    }
    if (laterLevel >= LATER.smallDesk) {
        backdrop.keepSmall();
    }
};

export const installQuality = () => {
    reducedMotion.addEventListener("change", guard(applyWallpaperMotion), { signal });
};

// a device that can't keep up renders the 3d at a lower resolution, a step at a time (the html layers stay sharp). the
// cap drops after 3 s in a row with more than a quarter of the frames over 22 ms, and never below 1.25. it counted the
// slowest twentieth before, and an iphone stepped down to 1.25 over back to back app opens whose frames were mostly on
// time, from a few a second that were 23 to 30 ms, which a lower resolution didn't remove
let pixelCap = 2;
let slowSeconds = 0;

export const resize = () => {
    renderer.setPixelRatio(Math.min(devicePixelRatio, pixelCap));
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
};

// each frame's gap, and the last second's frame rate and slowest twentieth for the dev panel
export const frameTimes = [];
export const frameStats = { fps: 0, p95: 0 };
let lastStats = performance.now();

export const stepQuality = (now) => {
    if (now - lastStats > 1000) {
        const sorted = [...frameTimes].sort((a, b) => a - b);
        const fps = (frameTimes.length * 1000) / (now - lastStats);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
        const slow = (sorted[Math.floor(sorted.length * 0.75)] || 0) > 22;
        slowSeconds = slow ? slowSeconds + 1 : 0;
        const capCanDrop = pixelCap > 1.25 && devicePixelRatio > 1.25;
        if (slowSeconds >= 3 && capCanDrop) {
            pixelCap = Math.max(1.25, Math.min(pixelCap, devicePixelRatio) - 0.25);
            slowSeconds = 0;
            resize();
        } else if (!capCanDrop && !state.zoomed) {
            // the 3d already renders as small as it goes, so the sky slows to 15 fps, then holds still. it only counts
            // seconds while it's on screen, since an open app stops it
            const next = stepSkyLevel({ ...skyMotion, slow: slow ? skyMotion.slow + 1 : 0, fast: slow ? 0 : skyMotion.fast + 1 });
            const changed = next.level !== skyMotion.level;
            skyMotion = next;
            if (changed) {
                applyWallpaperMotion();
            } else if (skyMotion.level >= 2) {
                const later = stepLater({ level: laterLevel, slow: slow ? laterSlow + 1 : 0 });
                laterSlow = later.slow;
                if (later.level !== laterLevel) {
                    laterLevel = later.level;
                    applyLater();
                }
            }
        }
        frameStats.fps = fps;
        frameStats.p95 = p95;
        frameTimes.length = 0;
        lastStats = now;
    }
};
