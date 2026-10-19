import * as THREE from "three";
import { unpin } from "./pin.js";
import { drawHome, redrawStatus, elementRect } from "./screens.js";
import { cleanTitle } from "./musicInfo.js";
import { GITHUB_URL, fillGraph } from "./github.js";
import { createStatus } from "./status.js";
import { state } from "./state.js";
import { tapApp } from "./appWindow.js";
import { signal, every, guard, failScene } from "./lifetime.js";

// { apps, latestProject } from the page's site-data
export let siteData = null;

// the layout's music (see layout/player.js), which plays on without the scene
export let music = null;
let stopListening = () => {};
export let statusBar = null;

export const initHome = (data, layoutMusic, onBattery = () => {}) => {
    siteData = data;
    music = layoutMusic;
    music.waitWhile(() => state.busy);
    stopListening = music.subscribe(guard(showMusic));
    every(showPosition, 500);
    // guarded, since the bar calls it from its own timers and listeners
    statusBar = createStatus(guard((s, kind) => {
        // a ping that was in flight when the scene failed still answers, into screens that have gone
        if (signal.aborted) {
            return;
        }
        refreshStatus();
        onBattery(s);
        if (!state.charger) {
            return;
        }
        if (kind === "plugged") {
            state.charger.plugIn();
        } else if (kind === "unplugged") {
            state.charger.unplug();
        }
    }));
};

// the status bar's own timers and listeners, which outlive the scene's signal
export const stopHome = () => {
    stopListening();
    if (statusBar) {
        statusBar.stop();
    }
};

// the status bar values go into the html, and the screen texture is drawn from that html
let showPing = 0;
export const applyStatus = (rootEl) => {
    const s = statusBar.status;
    const pingText = s.ping === null ? "offline" : `${Math.round(s.ping)} ms`;
    rootEl.querySelector(".status .time").textContent = performance.now() < showPing ? pingText : s.time;
    rootEl.querySelector(".status .wifi").dataset.bars = s.bars;
    const battery = rootEl.querySelector(".status .battery");
    battery.dataset.level = s.level;
    // the bolt shows once the cable is in, not while the hand is still fetching it
    battery.dataset.charging = s.charging && (!state.charger || state.charger.plugged());
};

let contributions = null;
export const showMusic = () => {
    const { current, playing, unavailable, failed } = music.state();
    const card = state.screen ? state.screen.homeEl.querySelector(".music-card") : null;
    if (!card) {
        return;
    }
    // the play button still asks again, as the music page's pill does
    const down = unavailable || failed;
    const title = (current && cleanTitle(current.title)) || "Music";
    const channel = down ? "Music unavailable" : (current && current.channel) || "Songs I grew up on";
    const shown = JSON.stringify([title, channel, playing, down, current ? current.art : ""]);
    // in the spike a redraw for each title made 60 to 110 ms frames on a 4x slowed cpu, so only what shows redraws
    if (card.dataset.shown === shown) {
        return;
    }
    card.dataset.shown = shown;
    card.querySelector(".m-title").textContent = title;
    card.querySelector(".m-channel").textContent = channel;
    const toggle = card.querySelector('[data-control="toggle"]');
    toggle.dataset.icon = playing ? "pause" : "play";
    toggle.setAttribute("aria-label", down ? "Music unavailable" : playing ? "Pause" : "Play");
    const art = card.querySelector("img.art");
    if (current && art.dataset.src !== current.art) {
        art.dataset.src = current.art;
        art.src = current.art;
    }
    state.screensChanged = true;
};

// a div or span acting as a button answers Enter and Space with the click it would get from a tap. like a button, Enter
// clicks on keydown and Space on keyup, and a held key doesn't repeat the click
const pressOnKey = (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || (event.key === " ") !== (event.type === "keyup")) {
        return;
    }
    event.currentTarget.click();
};

const listenForPress = (el, accept = () => true) => {
    const press = (event) => accept(event) && pressOnKey(event);
    el.addEventListener("keydown", press);
    el.addEventListener("keyup", press);
};

// the time as the slider reads it aloud, as 1:05 of 3:20
const clock = (seconds) => {
    const s = Math.max(Math.floor(seconds), 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// the widgets on the flap's half of the open screen. each one does something when tapped: the profile opens About,
// the graph opens github, and the latest project opens straight to it. the music card has its own controls
export const buildWidgets = (homeEl) => {
    const latest = siteData.latestProject;
    const widgets = document.createElement("div");
    widgets.className = state.portrait ? "widgets across" : "widgets";
    widgets.innerHTML = `
        <div class="widget small tappable about-card" data-action="about" role="button" tabindex="0"><img class="avatar" src="/ice.png" alt=""><span class="wt w-big">Jason</span><span class="wt w-line fit">Just another developer =P</span></div>
        <div class="widget small tappable" data-action="project" role="button" tabindex="0"><span class="wt w-title">LATEST PROJECT</span><span class="wt w-big wrap"></span></div>
        <div class="widget wide tappable" data-action="github" role="button" tabindex="0"><div class="w-head"><span class="wt w-title">GITHUB</span><span class="wt w-title gh-total"></span></div><div class="graph"></div></div>
        <div class="widget wide tappable music-card" data-action="music"><img class="art" crossorigin="anonymous" alt=""><div class="m-side"><span class="wt w-line wrap m-title" data-lines="1">Music</span><span class="wt w-line wrap m-channel" data-lines="1">Songs I grew up on</span><span class="m-progress" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-at="0" data-time="0" data-duration="0"></span><div class="m-controls"><span class="ctl" data-control="previous" data-icon="previous" role="button" tabindex="0" aria-label="Previous"></span><span class="ctl" data-control="toggle" data-icon="play" role="button" tabindex="0" aria-label="Play"></span><span class="ctl" data-control="next" data-icon="next" role="button" tabindex="0" aria-label="Next"></span></div></div></div>`;
    widgets.querySelector('[data-action="project"] .w-big').textContent = latest.title;
    widgets.querySelector("img.avatar").addEventListener("load", guard(() => {
        state.screensChanged = true;
    }));
    widgets.querySelector("img.art").addEventListener("load", guard(() => {
        state.screensChanged = true;
    }));
    const actions = {
        about: (el) => tapApp(siteData.apps.find((a) => a.name === "About"), { from: elementRect(homeEl, el) }),
        github: () => window.open(GITHUB_URL, "_blank", "noopener"),
        // the latest project's own page, which the flat home's card links to as well
        project: (el) => tapApp(siteData.apps.find((a) => a.name === "Projects"), { from: elementRect(homeEl, el), path: latest.path }),
        music: (el) => tapApp(siteData.apps.find((a) => a.name === "Music"), { from: elementRect(homeEl, el) })
    };
    widgets.querySelectorAll("[data-action]").forEach((el) => {
        el.addEventListener("click", guard(() => actions[el.dataset.action](el)));
        // the card holds the controls, so only a key pressed on the widget itself opens its app
        listenForPress(el, (event) => event.target === el);
    });
    // the card's buttons act on their own, without opening the music app under them
    widgets.querySelectorAll("[data-control]").forEach((el) => {
        listenForPress(el);
        el.addEventListener("click", guard((event) => {
            event.stopPropagation();
            if (el.dataset.control === "toggle") {
                music.toggle();
            } else if (el.dataset.control === "previous") {
                music.previous();
            } else if (el.dataset.control === "next") {
                music.next();
            }
        }));
    });
    const bar = widgets.querySelector(".m-progress");
    // the new bar starts blank, so the next read draws it even when the music hasn't moved
    shownPosition = "";
    // the bar seeks by dragging along it, and a tap on it seeks too without opening the music app under it. the
    // pointer is mapped back through the screen's perspective to the spot on the bar it's over
    const atPointer = (event) => {
        const home = state.surfaces.home;
        const [x] = unpin(home.w, home.h, home.pinned, [event.clientX, event.clientY]);
        const box = elementRect(homeEl, bar);
        return THREE.MathUtils.clamp((x - box.x0) / (box.x1 - box.x0), 0, 1);
    };
    bar.addEventListener("pointerdown", guard((event) => {
        if (!state.surfaces.home.pinned || !music.position().duration) {
            return;
        }
        bar.setPointerCapture(event.pointerId);
        scrub = { id: event.pointerId, at: atPointer(event), until: Infinity };
        showPosition();
    }));
    bar.addEventListener("pointermove", guard((event) => {
        if (!scrub || scrub.id !== event.pointerId || scrub.until !== Infinity) {
            return;
        }
        scrub.at = atPointer(event);
        showPosition();
    }));
    const endScrub = guard((event) => {
        if (!scrub || scrub.id !== event.pointerId || scrub.until !== Infinity) {
            return;
        }
        music.seek(scrub.at);
        // youtube takes a moment to report the new time, so the bar holds where it was let go until then
        scrub.until = performance.now() + 800;
        showPosition();
    });
    bar.addEventListener("pointerup", endScrub);
    bar.addEventListener("pointercancel", endScrub);
    bar.addEventListener("click", (event) => event.stopPropagation());
    bar.addEventListener("keydown", guard((event) => {
        const { duration, at } = music.position();
        if (!duration) {
            return;
        }
        // a share of the track for each key, or null for a key the bar doesn't answer
        const to = {
            ArrowRight: at + 5 / duration,
            ArrowLeft: at - 5 / duration,
            PageUp: at + 0.1,
            PageDown: at - 0.1,
            Home: 0,
            End: 1
        }[event.key];
        if (to === undefined) {
            return;
        }
        event.preventDefault();
        music.seek(THREE.MathUtils.clamp(to, 0, 1));
    }));
    return widgets;
};

// the music card's bar and times, from the player each half second, or from the pointer while it's dragged. the bar
// is drawn on the screen's live layer with the status bar, so it only repaints when it moves a pixel or a second
let scrub = null;
let shownPosition = "";
// a rebuild drops a scrub in progress, since the bar it drags is gone and its release never reaches it
export const dropScrub = () => {
    scrub = null;
};
const showPosition = () => {
    const bar = state.screen ? state.screen.homeEl.querySelector(".m-progress") : null;
    if (!bar) {
        return;
    }
    if (scrub && scrub.until <= performance.now()) {
        scrub = null;
    }
    const { time, duration, at } = music.position();
    const shown = scrub ? scrub.at : at;
    const key = `${Math.round(shown * bar.offsetWidth * 2)} ${Math.floor(scrub ? shown * duration : time)} ${Math.round(duration)} ${scrub ? 1 : 0}`;
    if (key === shownPosition) {
        return;
    }
    shownPosition = key;
    bar.setAttribute("aria-valuenow", String(Math.round(shown * 100)));
    bar.setAttribute("aria-valuetext", `${clock(scrub ? shown * duration : time)} of ${clock(duration)}`);
    Object.assign(bar.dataset, { at: shown, time: scrub ? shown * duration : time, duration, dragging: scrub && scrub.until === Infinity ? "true" : "false" });
    refreshStatus();
};

// a line marked .fit shrinks until it's one line in its box, down to 10px, since the card's width follows the screen's
// size and the font differs between systems. it's measured with the canvas font the screen is drawn with
const FIT_MIN = 10;
export const fitLines = (homeEl) => {
    const ctx = document.createElement("canvas").getContext("2d");
    homeEl.querySelectorAll(".wt.fit").forEach((el) => {
        el.style.fontSize = "";
        const cs = getComputedStyle(el);
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const width = ctx.measureText(el.textContent).width;
        if (width > el.clientWidth) {
            const size = Math.floor(((parseFloat(cs.fontSize) * el.clientWidth) / width) * 2) / 2;
            el.style.fontSize = `${Math.max(size, FIT_MIN)}px`;
        }
    });
};

// the graph's data, from the home route's answer. an answer without it keeps what's shown, so a later failed ask never
// blanks a graph that has data
export const showContributions = (data) => {
    if (!data) {
        return;
    }
    contributions = data;
    if (state.screen) {
        fillGithub(state.screen.homeEl);
        state.screensChanged = true;
    }
};

// the graph fits as many weeks as the widget is wide, so it's filled once the panel is laid out, and again when the
// data arrives
export const fillGithub = (homeEl) => {
    const graph = homeEl.querySelector(".widget .graph");
    if (!graph) {
        return;
    }
    fillGraph(graph, contributions);
    homeEl.querySelector(".gh-total").textContent = contributions ? `${contributions.total.toLocaleString("en-US")} in the last year` : "";
};

// each screen is kept drawn without its status bar, so a clock or battery tick only repaints the bar (the whole inner
// screen took about 10 ms to draw on a 4x slowed cpu, every 6 s while the battery drains). `full` is for when the
// screen's content changed, like the avatar or the github graph arriving
export const homeCache = new WeakMap();
// the widget cards' boxes, for the composite to frost (see composite.js), with the radius the css gives them
const placeCards = () => {
    const { homeEl, composite } = state.screen;
    const widgets = [...homeEl.querySelectorAll(".widget")];
    const radius = widgets.length ? parseFloat(getComputedStyle(widgets[0]).borderTopLeftRadius) : 0;
    composite.setCards(widgets.map((widget) => elementRect(homeEl, widget)), radius);
};

let screenVersion = 0;
export const refreshStatus = (full = false) => {
    if (!state.screen) {
        return;
    }
    // a status tick (the clock, the battery, the music's place) waits while the phone or an app is moving, like a full
    // redraw does (see loop), since its layers were uploading a few times during each intro on an iphone
    if (!full && state.busy && homeCache.has(state.screen.homeEl)) {
        state.statusChanged = true;
        return;
    }
    if (full) {
        screenVersion++;
        placeCards();
    }
    [[state.screen.homeEl, state.screen.icons, state.screen.ink, state.screen.composite, null], [state.cover.el, state.cover.icons, state.cover.ink, state.cover.composite, state.cover.frame]].forEach(([el, texture, inkTexture, composite, frame]) => {
        applyStatus(el);
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const cached = homeCache.get(el);
        // the live parts are all on the ink layer, so a tick only redraws that
        if (cached && cached.version === screenVersion && cached.w === w && cached.h === h && inkTexture.image === cached.canvas) {
            redrawStatus(cached.canvas, cached.base, el, 2);
        } else {
            const layers = drawHome(el, 2, frame, false, false);
            const canvas = document.createElement("canvas");
            canvas.width = layers.ink.width;
            canvas.height = layers.ink.height;
            canvas.getContext("2d").drawImage(layers.ink, 0, 0);
            redrawStatus(canvas, layers.ink, el, 2);
            homeCache.set(el, { base: layers.ink, canvas, w, h, version: screenVersion });
            texture.image = layers.base;
            texture.needsUpdate = true;
            inkTexture.image = canvas;
        }
        inkTexture.needsUpdate = true;
        composite.invalidate();
    });
};

export const buildHomeContent = (onTap) => {
    const frag = document.createDocumentFragment();
    const status = document.createElement("div");
    status.className = "status";
    status.innerHTML = '<span class="time"></span><span class="indicators"><span class="wifi"></span><span class="battery"></span></span>';
    // tapping the indicators shows the measured ping in place of the clock for a moment
    const indicators = status.querySelector(".indicators");
    indicators.setAttribute("role", "button");
    indicators.tabIndex = 0;
    indicators.setAttribute("aria-label", "Show ping");
    listenForPress(indicators);
    indicators.addEventListener("click", guard(() => {
        statusBar.pingNow().then(guard(() => {
            showPing = performance.now() + 2500;
            refreshStatus();
            setTimeout(guard(refreshStatus), 2600);
        })).catch(failScene);
    }));
    frag.appendChild(status);
    const home = document.createElement("div");
    home.className = "home";
    siteData.apps.forEach((app) => {
        const button = document.createElement("button");
        button.className = "app-icon";
        button.innerHTML = `<span class="glyph" aria-hidden="true" style="background:${app.color}">${app.glyph}</span><span>${app.name}</span>`;
        button.addEventListener("click", guard(() => onTap(app)));
        home.appendChild(button);
    });
    frag.appendChild(home);
    // open-meteo's data is cc by 4.0, and its licence wants this link next to where the weather shows. the 2d version
    // link sits beside it, a full page load (data-astro-reload) that the layout saves the choice for
    const credits = document.createElement("div");
    credits.className = "credits";
    const credit = document.createElement("a");
    credit.className = "credit";
    credit.href = "https://open-meteo.com/";
    credit.target = "_blank";
    credit.rel = "noopener";
    credit.textContent = "Weather data by Open-Meteo.com";
    const flat = document.createElement("a");
    flat.className = "credit";
    flat.href = "/";
    flat.dataset.version = "2d";
    flat.dataset.astroReload = "";
    flat.textContent = "2D version";
    credits.append(credit, flat);
    frag.appendChild(credits);
    return frag;
};
