import { state } from "./state.js";
import { snapshotOf, snapshotNodes } from "../lib/snapshots.js";
import { EXTRA_HOLES } from "./screens.js";

// up to three of the app switcher's cards show the page their app was left on (lib/snapshots.js), the way ios shows
// each app's last screen. each is a copy of #page in a closed shadow root, pinned onto its card the way #page is pinned
// onto the window (the loop pins them, see loop.js) and seen through a hole of its own in the canvas. the site's css is
// read once and its rules on html and :root rewritten to work on the copy's host, which takes the root's classes

// the copies the loop pins each frame, as surfaces like state.surfaces.page
export const snapshotSurfaces = [];

// css for a shadow root: html and :root become :host, keeping whatever classes or :not() they test
export const forHost = (css) =>
    css
        .replace(/:root(?![\w-])/g, ":host")
        .replace(/(^|[\s,>+~(}])html((?:\.[\w-]+|:not\([^()]*\)|\[[^\]]*\])*)(?![\w-])/g, (_, before, tests) => `${before}:host${tests ? `(${tests})` : ""}`);

let sheet = null;
const hostSheet = () => {
    if (sheet) {
        return sheet;
    }
    let css = "";
    for (const s of document.styleSheets) {
        try {
            for (const rule of s.cssRules) {
                css += `${rule.cssText}\n`;
            }
        } catch {
            // a sheet from another origin can't be read, and the site has none
        }
    }
    sheet = new CSSStyleSheet();
    sheet.replaceSync(forHost(css));
    return sheet;
};

const makeHost = () => {
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    el.inert = true;
    Object.assign(el.style, { position: "fixed", left: "0", top: "0", transformOrigin: "0 0", pointerEvents: "none", visibility: "hidden", contain: "strict" });
    const shadow = el.attachShadow({ mode: "closed" });
    shadow.adoptedStyleSheets = [hostSheet()];
    const page = document.createElement("main");
    page.id = "page";
    shadow.append(page);
    const real = document.getElementById("page");
    real.parentElement.insertBefore(el, real.nextSibling);
    const surface = { el, page, w: 0, h: 0, owner: null, corners: null, show: false, shown: undefined, pinned: null, app: null };
    snapshotSurfaces.push(surface);
    return surface;
};

// the root's own custom properties (the sky's colors, the glass tint), which the scripts set inline on it. the copy's
// css gives its host the defaults the site's css gives html, and the host's inline style is what beats those
const takeRootProps = (surface) => {
    const root = document.documentElement.style;
    const names = [...root].filter((name) => name.startsWith("--"));
    const key = names.map((name) => `${name}:${root.getPropertyValue(name)}`).join(";");
    if (surface.props === key) {
        return;
    }
    surface.props = key;
    for (const name of names) {
        surface.el.style.setProperty(name, root.getPropertyValue(name));
    }
};

// the kept pages of the apps a switcher or a swipe may show, read from storage once as it starts instead of each frame
let kept = new Map();
export const prepareSnapshots = (apps) => {
    kept = new Map(apps.map((app) => [app.name, snapshotOf(app.name)]).filter(([, shot]) => shot));
};
export const hasSnapshot = (name) => kept.has(name);
export const keptPath = (name) => kept.get(name)?.path ?? null;
export const keptScroll = (name) => kept.get(name)?.scroll ?? 0;

// cards as { app (its name), box (its #page part in the screen's px), corners (box's corners on the phone), opacity },
// shown with the kept page of each that has one, up to three. gives back the names shown, so the caller draws the
// rest as stand ins
export const showSnapshots = (cards, radius) => {
    const uniforms = state.screen.appHole.material.uniforms;
    const shown = new Set();
    const used = new Set();
    for (const card of cards) {
        if (shown.size >= EXTRA_HOLES || !kept.has(card.app)) {
            continue;
        }
        const surface = snapshotSurfaces.find((s) => s.app === card.app && !used.has(s)) || snapshotSurfaces.find((s) => !used.has(s) && !cards.some((c) => c.app === s.app)) || (snapshotSurfaces.length < EXTRA_HOLES ? makeHost() : null);
        if (!surface) {
            continue;
        }
        used.add(surface);
        const shot = kept.get(card.app);
        const page = state.surfaces.page;
        if (surface.app !== card.app || surface.html !== shot.html || surface.w !== page.w || surface.h !== page.h) {
            surface.app = card.app;
            surface.html = shot.html;
            surface.w = page.w;
            surface.h = page.h;
            surface.pinned = null;
            Object.assign(surface.el.style, { width: `${page.w}px`, height: `${page.h}px` });
            surface.page.dataset.app = card.app;
            surface.page.dataset.page = shot.page;
            surface.page.replaceChildren(snapshotNodes(shot.html));
            const body = surface.page.querySelector(":scope > .body");
            if (body) {
                body.scrollTop = shot.scroll;
            }
        }
        surface.el.className = document.documentElement.className;
        takeRootProps(surface);
        surface.owner = page.owner;
        surface.corners = card.corners;
        surface.show = card.opacity > 0;
        const i = shown.size;
        uniforms.extras.value[i].set(card.box.x0, card.box.y0, card.box.x1, card.box.y1);
        uniforms.extraOpacity.value[i] = card.opacity;
        shown.add(card.app);
    }
    for (let i = shown.size; i < EXTRA_HOLES; i++) {
        uniforms.extraOpacity.value[i] = 0;
    }
    uniforms.extraRadius.value = radius;
    for (const surface of snapshotSurfaces) {
        if (!used.has(surface)) {
            surface.show = false;
        }
    }
    return shown;
};

export const hideSnapshots = () => {
    for (const surface of snapshotSurfaces) {
        surface.show = false;
    }
    if (state.screen) {
        state.screen.appHole.material.uniforms.extraOpacity.value.fill(0);
    }
};
