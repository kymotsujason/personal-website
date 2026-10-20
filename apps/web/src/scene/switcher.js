import * as THREE from "three";
import { state, settings } from "./state.js";
import { tween, ease } from "./tween.js";
import { guard, signal, failScene } from "./lifetime.js";
import { reducedMotion } from "./quality.js";
import { siteData } from "./home.js";
import { glyphRect } from "./screens.js";
import { blockNextClick } from "./fold.js";
import { noteOpened, openedSoFar, recentOrder } from "./recents.js";
import { prepareSnapshots, showSnapshots, keptPath, keptScroll } from "./snapshotCards.js";
import { requestApp, requestHome } from "./navigation.js";
import { pageEl, placeAppWindow, pageBox, toScreenPx, showCards, hideCards, pageSky, setAppWindow, hideOpenIcon, showFlat, closeApp, lerpRect, rubberBand, screenCorners } from "./appWindow.js";

// the app switcher, the way ios shows it after a swipe up from the home bar that rests a moment: every app as a card
// in a row that scrolls sideways, the open app on the right and the ones opened before it to its left (see recents.js). the open app's card is its live window and the others
// stand in with their icon, since only one page is ever loaded. a tap on a card opens that app, and a tap anywhere
// else or a swipe up from outside the cards goes home. apps can't be closed, so a card pushed up stretches a little
// and springs back

// the cards' size and the gap between them, as shares of the page, and how far above the page's center they sit,
// which leaves room for the labels
const CARD_SCALE = 0.62;
const CARD_GAP = 0.06;
const CARD_RISE = 0.04;
// a label's height against its card's, and its gap above the card
const LABEL_SHARE = 0.085;
const LABEL_GAP = 0.03;
// how far the home screen behind the cards zooms in and dims, in placeAppWindow's home (1 is an open app's, which
// dims it to 0.7). this one dims it to 0.45
const BACKDROP_HOME = (1 - 0.45) / 0.3;
// how much the darkened sky behind the cards hides the home screen, the way ios blurs the wallpaper there
const BACKDROP = 0.92;
const ENTER_MS = 320;
const SNAP_MS = 320;
const OPEN_MS = 340;
const HOME_FADE_MS = 200;
const LIFT_MS = 500;
// how far a card can be pushed up, against its height, before it stops giving
const LIFT_LIMIT = 0.12;
// a press that moves less than this (in the window's px) is a tap
const TAP_SLOP = 8;
// a swipe up from outside the cards this far (in the window's px), or this fast (px per ms), goes home
const HOME_PULL = 40;
const HOME_FLICK = 0.5;
// how far ahead a flick carries the row, in ms of its speed
const FLICK_AHEAD = 150;
// a release this long after the last move was a finger at rest, so it carries no speed (no move fires while it rests)
const REST_MS = 50;
const speedAt = (lastT, speed) => (performance.now() - lastT > REST_MS ? 0 : speed);
// a swap that never lands leaves the opened card as a stand in for at most this long
const SWAP_WAIT_MS = 4000;

// each app's last page, so a card opens the app where it was left, the way ios keeps an app's place
const lastPath = new Map();

// an ios style spring with a little bounce (bounce 0.2, about half a second), as a 0 to 1 curve over the tween
const spring = (t) => {
    const seconds = t * 0.5;
    const zeta = 0.8;
    const omega = (2 * Math.PI) / 0.5;
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * omega * seconds) * (Math.cos(damped * seconds) + ((zeta * omega) / damped) * Math.sin(damped * seconds));
};

// the row's geometry in the screen's px, from the part #page covers
const layoutOf = () => {
    const { fullW, fullH } = state.screen;
    const page = pageBox({ x0: 0, y0: 0, x1: fullW, y1: fullH });
    const pw = page.x1 - page.x0;
    const ph = page.y1 - page.y0;
    const cw = pw * CARD_SCALE;
    const ch = ph * CARD_SCALE;
    return { page, pw, ph, cw, ch, cx: (page.x0 + page.x1) / 2, cy: (page.y0 + page.y1) / 2 - ph * CARD_RISE, pitch: cw * (1 + CARD_GAP / CARD_SCALE) };
};

// the same row lined up on a card at box (the #page part of a window a swipe is carrying), its size and gaps scaled
// with it, so the swipe's neighbours and a quick switch start right where that card is
const layoutAround = (box) => {
    const base = layoutOf();
    const cw = box.x1 - box.x0;
    const ch = box.y1 - box.y0;
    return { ...base, cw, ch, cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, pitch: cw * (1 + CARD_GAP / CARD_SCALE) };
};

// the row in the switcher's order (see recents.js), where the open app is in it, and each app's column in the icons'
// atlas, which is in the home screen's order
export const switcherRow = () => {
    const apps = recentOrder(siteData.apps, [...openedSoFar().filter((n) => n !== state.openApp.name), state.openApp.name]);
    prepareSnapshots(apps);
    return { apps, live: apps.findIndex((a) => a.name === state.openApp.name), slots: apps.map((a) => siteData.apps.indexOf(a)), sky: pageSky() };
};

// the cards (from showCards' list) whose app has a kept page show it in place of a stand in, each at its own opacity.
// the open app's card is its live window and isn't among them
const withSnapshots = (cards, apps, radius, opacityOf) => {
    const shown = showSnapshots(
        cards.map((c, i) => (c && c.kind === 2 ? { app: apps[i].name, box: c.body, corners: screenCorners(c.body), opacity: opacityOf(i) } : null)).filter(Boolean),
        radius
    );
    return cards.map((c, i) => (c && c.kind === 2 && shown.has(apps[i].name) ? { ...c, kind: 1 } : c));
};

// card i's box at the row's scroll (a card index, so the scroll's card sits in the middle), pushed up by lift px
export const cardBox = (layout, i, scroll, lift = 0) => {
    const x = layout.cx + (i - scroll) * layout.pitch;
    return { x0: x - layout.cw / 2, y0: layout.cy - layout.ch / 2 - lift, x1: x + layout.cw / 2, y1: layout.cy + layout.ch / 2 - lift };
};

const labelBox = (layout, box) => {
    const h = layout.ch * LABEL_SHARE;
    const y1 = box.y0 - layout.ch * LABEL_GAP;
    return { x0: box.x0, y0: y1 - h, x1: box.x0 + h * 4, y1 };
};

// the whole window rect whose #page part is box, for placeAppWindow
const windowFor = (layout, box) => {
    const { fullW, fullH } = state.screen;
    const kx = (box.x1 - box.x0) / layout.pw;
    const ky = (box.y1 - box.y0) / layout.ph;
    const x0 = box.x0 - layout.page.x0 * kx;
    const y0 = box.y0 - layout.page.y0 * ky;
    return { x0, y0, x1: x0 + fullW * kx, y1: y0 + fullH * ky };
};

const offset = (box, dx, dy = 0) => ({ x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy });

// the row at the switcher's current state. enter (0 to 1) brings the live card from where it was (from) to its place
// and the other cards in from beside it, and fade takes the stand ins and labels in or out
const draw = () => {
    const sw = state.switcher;
    const layout = sw.layout;
    const { radiusPx } = state.screen;
    const radius = radiusPx * CARD_SCALE;
    const cards = sw.apps.map((_, i) => {
        const lift = sw.lift && sw.lift.i === i ? sw.lift.dy : 0;
        let body = cardBox(layout, i, sw.scroll, lift);
        if (i !== sw.live) {
            // the stand ins come in from a little further out
            body = offset(body, (1 - sw.enter) * Math.sign(i - sw.live) * layout.pitch * 0.5);
        }
        return { body, label: sw.labels ? labelBox(layout, body) : null, kind: i === sw.holder ? 1 : 2, slot: sw.slots[i] };
    });
    // a card being opened grows with no label, solid, as #page's card once it holds that app's page and its kept page
    // or a stand in before
    if (sw.grow) {
        cards[sw.grow.i].body = sw.grow.box;
        cards[sw.grow.i].label = null;
        cards[sw.grow.i].alpha = 1;
    }
    const holderBox = sw.grow && sw.holder === sw.grow.i ? sw.grow.box : sw.grow ? cards[sw.holder].body : lerpRect(sw.from, cards[sw.holder].body, sw.enter);
    // the home screen behind darkens as the switcher comes in and lightens back as a card fills the screen
    const home = sw.grow ? THREE.MathUtils.lerp(1, sw.homeAt, sw.fade) : THREE.MathUtils.lerp(sw.homeFrom, sw.homeAt, sw.enter);
    placeAppWindow(windowFor(layout, holderBox), radius, 1, home, state.openIcon, sw.apps[sw.holder], 1);
    const faced = withSnapshots(cards, sw.apps, radius, (i) => (sw.grow && sw.grow.i === i ? 1 : sw.fade));
    showCards(faced, radius, sw.sky, sw.fade, sw.backdrop);
};

export const switcherOpen = () => Boolean(state.switcher);

// from a home bar swipe that rested, with the window at rect (the whole window, as the swipe placed it)
// the swipe's neighbours on either side of the card it carries (the window at rect), fading in as the swipe pulls up
// the way ios lets the app before peek in, so the switcher and a quick switch are already in view
const PEEK_FROM = 0.03;
const PEEK_TO = 0.14;
export const peekShare = (pulled) => THREE.MathUtils.smoothstep(pulled, PEEK_FROM, PEEK_TO);
export const drawPeek = (rect, pulled, row) => {
    const layout = layoutAround(pageBox(rect));
    const share = peekShare(pulled);
    const sides = [row.live - 1, row.live + 1].filter((i) => i >= 0 && i < row.apps.length);
    const cards = withSnapshots(
        sides.map((i) => ({ body: cardBox(layout, i, row.live), label: null, kind: 2, slot: row.slots[i] })),
        sides.map((i) => row.apps[i]),
        state.screen.radiusPx,
        () => share
    );
    showCards(cards, state.screen.radiusPx, row.sky, share);
};

// the way ios orders them: the open app on the right and the ones before it to its left, newest to oldest
export const enterSwitcher = (rect, home, clientX, row = switcherRow()) => {
    const { apps, live, slots } = row;
    if (live < 0) {
        return false;
    }
    lastPath.set(state.openApp.name, location.pathname);
    const layout = layoutOf();
    state.switcher = {
        apps,
        slots,
        live,
        holder: live,
        layout,
        scroll: live,
        enter: 0,
        fade: 0,
        from: pageBox(rect),
        homeFrom: home,
        homeAt: BACKDROP_HOME,
        backdrop: BACKDROP,
        labels: true,
        sky: row.sky,
        lift: null,
        grow: null,
        anim: true,
        press: null,
        // the press that opened the switcher carries on as a scroll
        drag: { x0: clientX, scroll0: live, lastX: clientX, lastT: performance.now(), speed: 0 }
    };
    const sw = state.switcher;
    if (reducedMotion.matches) {
        sw.enter = 1;
        sw.fade = 1;
        sw.anim = false;
        draw();
        return true;
    }
    tween({ to: {}, duration: ENTER_MS, easing: ease.outCubic, onUpdate: (t) => {
        if (state.switcher !== sw) {
            return;
        }
        sw.enter = t;
        sw.fade = t;
        draw();
    } }).then(() => {
        if (state.switcher === sw) {
            sw.anim = false;
        }
    });
    return true;
};

// the row's scroll for a drag dx px (in the screen's px) from where it started, held past the ends by a rubber band
const scrolled = (sw, scroll0, dx) => {
    const raw = scroll0 - dx / sw.layout.pitch;
    const last = sw.apps.length - 1;
    if (raw < 0) {
        return -rubberBand(-raw, 0.4);
    }
    if (raw > last) {
        return last + rubberBand(raw - last, 0.4);
    }
    return raw;
};

const screenDx = (fromClientX, toClientX, clientY) => toScreenPx(toClientX, clientY).x - toScreenPx(fromClientX, clientY).x;

// the press that opened the switcher, still down
export const switcherDrag = (event) => {
    const sw = state.switcher;
    if (!sw || !sw.drag) {
        return;
    }
    const d = sw.drag;
    const now = performance.now();
    const step = screenDx(d.lastX, event.clientX, event.clientY);
    d.speed = step / sw.layout.pitch / Math.max(now - d.lastT, 1);
    d.lastX = event.clientX;
    d.lastT = now;
    sw.scroll = scrolled(sw, d.scroll0, screenDx(d.x0, event.clientX, event.clientY));
    draw();
};

const snap = (sw, speed) => {
    const target = THREE.MathUtils.clamp(Math.round(sw.scroll - speed * FLICK_AHEAD), 0, sw.apps.length - 1);
    const from = sw.scroll;
    if (reducedMotion.matches) {
        sw.scroll = target;
        draw();
        return;
    }
    tween({ to: {}, duration: SNAP_MS, easing: ease.outCubic, onUpdate: (t) => {
        if (state.switcher !== sw || sw.press || sw.drag) {
            return;
        }
        sw.scroll = from + (target - from) * t;
        draw();
    } });
};

export const switcherDragEnd = () => {
    const sw = state.switcher;
    if (!sw || !sw.drag) {
        return;
    }
    const speed = speedAt(sw.drag.lastT, sw.drag.speed);
    sw.drag = null;
    blockNextClick();
    snap(sw, speed);
};

const hitCard = (sw, at) => {
    for (let i = 0; i < sw.apps.length; i++) {
        const b = cardBox(sw.layout, i, sw.scroll);
        if (at.x >= b.x0 && at.x <= b.x1 && at.y >= b.y0 && at.y <= b.y1) {
            return i;
        }
    }
    return -1;
};

// the open app's card back to fill the screen, the others sliding out, and the switcher gone
const backToLive = async (sw) => {
    const layout = sw.layout;
    const start = cardBox(layout, sw.live, sw.scroll);
    const scroll0 = sw.scroll;
    sw.anim = true;
    sw.grow = { i: sw.live, box: start };
    const end = reducedMotion.matches ? "done" : await tween({ to: {}, duration: OPEN_MS, easing: ease.outCubic, onUpdate: (t) => {
        if (state.switcher !== sw) {
            return;
        }
        sw.grow.box = lerpRect(start, layout.page, t);
        sw.scroll = scroll0 + (sw.live - scroll0) * t;
        sw.fade = 1 - t;
        draw();
    } });
    if (end === "cancelled" || state.switcher !== sw) {
        return;
    }
    finish(state.openApp);
};

// done with the switcher on app, which #page holds: the window fills the screen and the page is live again
const finish = (app) => {
    state.switcher = null;
    state.switching = null;
    state.swapOpen = false;
    hideCards();
    state.openApp = app;
    noteOpened(app.name);
    state.openIcon = glyphRect(state.screen.homeEl, app.name);
    state.openFromWidget = false;
    hideOpenIcon();
    setAppWindow(1, state.openIcon, app);
    state.busy = false;
    if (settings.flatAtFullZoom) {
        showFlat();
    }
};

// another app's card grows to fill the screen while its page loads. the scene lets the swap through at once (see
// swapOpen), and #page moves onto the growing card once it holds the new page, the way an app switch hands over
const openOther = async (sw, i) => {
    const app = sw.apps[i];
    const layout = sw.layout;
    const start = cardBox(layout, i, sw.scroll);
    const scroll0 = sw.scroll;
    sw.anim = true;
    sw.grow = { i, box: start };
    state.switching = { to: app.name, back: false, landed: false, dropped: false };
    state.swapOpen = true;
    const path = keptPath(app.name) || lastPath.get(app.name) || app.path;
    requestApp(app, { path });
    const landed = () => pageEl.dataset.app === app.name;
    // the app's page comes back scrolled to where it was left, as soon as it's in #page
    let scrolled = false;
    const restoreScroll = () => {
        if (scrolled || !landed()) {
            return;
        }
        scrolled = true;
        const body = pageEl.querySelector(":scope > .body");
        if (body && location.pathname === keptPath(app.name)) {
            body.scrollTop = keptScroll(app.name);
        }
    };
    const step = (t) => {
        if (state.switcher !== sw) {
            return;
        }
        sw.grow.box = lerpRect(start, layout.page, t);
        sw.scroll = scroll0 + (i - scroll0) * t;
        sw.fade = 1 - t;
        // #page rides the growing card once it holds the app's page, and the card it left stands in until it's gone
        // once the page lands, the app it replaced has just been kept (see layout/navigation.js), so its card shows that
        if (landed() && sw.holder !== i) {
            sw.holder = i;
            prepareSnapshots(sw.apps);
        }
        restoreScroll();
        draw();
    };
    const end = reducedMotion.matches ? "done" : await tween({ to: {}, duration: OPEN_MS, easing: ease.outCubic, onUpdate: step });
    if (end === "cancelled" || state.switcher !== sw) {
        return;
    }
    if (!landed()) {
        const waited = performance.now();
        while (!landed() && performance.now() - waited < SWAP_WAIT_MS && state.switcher === sw) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        if (state.switcher !== sw) {
            return;
        }
    }
    restoreScroll();
    finish(landed() ? app : state.openApp);
};

// home from the switcher: the open app's card flies into its icon the way a swipe home does, and the other cards fade
const goHome = (sw) => {
    const layout = sw.layout;
    const box = cardBox(layout, sw.live, sw.scroll);
    state.switcher = null;
    if (!reducedMotion.matches) {
        const fadeFrom = sw.fade;
        tween({ to: {}, duration: HOME_FADE_MS, easing: ease.outCubic, onUpdate: (t) => {
            const f = fadeFrom * (1 - t);
            const cards = sw.apps.map((_, i) => (i === sw.live ? null : { body: cardBox(layout, i, sw.scroll), label: null, kind: 2, slot: sw.slots[i] }));
            const faced = withSnapshots(cards, sw.apps, state.screen.radiusPx * CARD_SCALE, () => f).filter(Boolean);
            showCards(faced, state.screen.radiusPx * CARD_SCALE, sw.sky, f, BACKDROP);
        } }).then(hideCards);
    } else {
        hideCards();
    }
    state.busy = false;
    // the close starts from the switcher's darker, closer home screen and brings it back as the card flies home
    closeApp({ rect: windowFor(layout, box), radius: state.screen.radiusPx * CARD_SCALE, home: BACKDROP_HOME, crop: 1 }).catch(failScene);
    requestHome();
};

// a card pushed up gives a little and springs back, since apps can't be closed here
const settleLift = (sw) => {
    const lift = sw.lift;
    if (!lift) {
        return;
    }
    const from = lift.dy;
    if (reducedMotion.matches) {
        sw.lift = null;
        draw();
        return;
    }
    tween({ to: {}, duration: LIFT_MS, easing: (t) => t, onUpdate: (t) => {
        if (state.switcher !== sw || sw.lift !== lift) {
            return;
        }
        lift.dy = from * (1 - spring(t));
        draw();
    } }).then(() => {
        if (state.switcher === sw && sw.lift === lift) {
            sw.lift = null;
            draw();
        }
    });
};

// a swipe let go mostly sideways opens the app on that side (i in the row), the way ios switches apps along the home
// bar: its card, peeking beside the one the swipe carries (the window at rect), grows to fill the screen while that
// one slides out. it starts from the swipe's own look, with no backdrop, since the switcher never showed
export const quickSwitch = (rect, home, i, row, pulled) => {
    lastPath.set(state.openApp.name, location.pathname);
    const box = pageBox(rect);
    state.switcher = {
        apps: row.apps,
        slots: row.slots,
        live: row.live,
        holder: row.live,
        layout: layoutAround(box),
        scroll: row.live,
        enter: 1,
        fade: peekShare(pulled),
        from: box,
        homeFrom: home,
        homeAt: home,
        backdrop: 0,
        labels: false,
        sky: row.sky,
        lift: null,
        grow: null,
        anim: true,
        press: null,
        drag: null
    };
    openOther(state.switcher, i).catch(failScene);
};

// a browser navigation (Back, Forward) while the switcher shows puts the open app back at once, so it can go ahead
export const leaveSwitcher = () => {
    if (!state.switcher || state.switching) {
        return;
    }
    finish(state.openApp);
};

export const installSwitcher = () => {
    addEventListener("pointerdown", guard((event) => {
        const sw = state.switcher;
        if (!sw || sw.drag) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (sw.anim || sw.press || !event.isPrimary) {
            return;
        }
        const at = toScreenPx(event.clientX, event.clientY);
        sw.press = { id: event.pointerId, x0: event.clientX, y0: event.clientY, lastX: event.clientX, lastT: performance.now(), speed: 0, upSpeed: 0, lastY: event.clientY, mode: null, card: hitCard(sw, at), scroll0: sw.scroll };
    }), { capture: true, signal });
    addEventListener("pointermove", guard((event) => {
        const sw = state.switcher;
        const press = sw && sw.press;
        if (!press || event.pointerId !== press.id) {
            return;
        }
        event.preventDefault();
        const dx = event.clientX - press.x0;
        const dy = event.clientY - press.y0;
        if (!press.mode) {
            if (Math.hypot(dx, dy) < TAP_SLOP) {
                return;
            }
            press.mode = Math.abs(dx) > Math.abs(dy) ? "scroll" : dy < 0 && press.card >= 0 ? "lift" : "up";
        }
        const now = performance.now();
        const dt = Math.max(now - press.lastT, 1);
        press.speed = screenDx(press.lastX, event.clientX, event.clientY) / sw.layout.pitch / dt;
        press.upSpeed = (press.lastY - event.clientY) / dt;
        press.lastX = event.clientX;
        press.lastY = event.clientY;
        press.lastT = now;
        if (press.mode === "scroll") {
            sw.scroll = scrolled(sw, press.scroll0, screenDx(press.x0, event.clientX, event.clientY));
            draw();
        } else if (press.mode === "lift") {
            const up = toScreenPx(press.x0, press.y0).y - toScreenPx(press.x0, event.clientY).y;
            sw.lift = { i: press.card, dy: rubberBand(Math.max(up, 0), sw.layout.ch * LIFT_LIMIT) };
            draw();
        }
    }), { capture: true, passive: false, signal });
    const end = guard((event) => {
        const sw = state.switcher;
        const press = sw && sw.press;
        if (!press || event.pointerId !== press.id) {
            return;
        }
        sw.press = null;
        event.preventDefault();
        blockNextClick();
        if (event.type === "pointercancel") {
            settleLift(sw);
            snap(sw, 0);
            return;
        }
        if (!press.mode) {
            if (press.card < 0) {
                goHome(sw);
            } else if (press.card === sw.live) {
                backToLive(sw).catch(failScene);
            } else {
                openOther(sw, press.card).catch(failScene);
            }
            return;
        }
        if (press.mode === "scroll") {
            snap(sw, speedAt(press.lastT, press.speed));
        } else if (press.mode === "lift") {
            settleLift(sw);
        } else if (press.y0 - press.lastY > HOME_PULL || speedAt(press.lastT, press.upSpeed) > HOME_FLICK) {
            goHome(sw);
        }
    });
    addEventListener("pointerup", end, { capture: true, signal });
    addEventListener("pointercancel", end, { capture: true, signal });
    // Escape puts the open app back, the way a tap on its card does
    addEventListener("keydown", guard((event) => {
        const sw = state.switcher;
        if (!sw || event.key !== "Escape" || sw.anim || sw.press || sw.drag) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        backToLive(sw).catch(failScene);
    }), { capture: true, signal });
};
