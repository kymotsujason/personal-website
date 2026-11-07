// the home bar swipe, the quick switch, the app switcher, and the app to app switch, as scene/appWindow.js and
// scene/switcher.js have them, with their numbers. none of these move the hands, so they change only the app window
// (scene.win), the cards (scene.cards, drawn by cards.js), and the home screen's look, which the loop draws. the swipe
// shrinks the window as it's pulled up, and on release it flies into its icon if pulled far enough or flicked,
// switches to the app beside it if let go mostly sideways, or springs back. one that rests a moment opens the
// switcher, every app as a card in a row, the open one on the right and the ones opened before it to its left
import { noteOpened, openedSoFar, recentOrder } from "../scene/recents.js";
import {
  HOME_DISTANCE,
  HOME_EDGE,
  HOME_FIT,
  HOME_FLICK,
  HOME_LIFT,
  HOME_SHRINK,
  HOME_SPRING_BACK_MS,
  QUICK_SHARE,
  SPEED_FADE_MS,
  SWITCHER,
  SWITCHER_PULL,
  SWITCHER_REST_MS,
  SWITCHER_SLOW,
  SWITCH_GAP,
  SWITCH_MS,
  SWITCH_SHRINK_X,
  SWITCH_SHRINK_Y,
  SWITCH_SWAP_AT,
  SWITCH_SWAP_WAIT_MS,
  ease,
  liftSpring,
} from "../scene/shared/motion.js";
import { lerpRect, smoothstep } from "./apps.js";
import { blockNextClick } from "./fold.js";

const {
  CARD_SCALE,
  CARD_GAP,
  CARD_RISE,
  LABEL_SHARE,
  LABEL_GAP,
  BACKDROP_HOME,
  BACKDROP,
  ENTER_MS,
  SNAP_MS,
  OPEN_MS,
  HOME_FADE_MS,
  LIFT_MS,
  LIFT_LIMIT,
  TAP_SLOP,
  HOME_PULL,
  FLICK_AHEAD,
  REST_MS,
  SWAP_WAIT_MS,
  PEEK_FROM,
  PEEK_TO,
} = SWITCHER;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const rubberBand = (distance, limit) =>
  limit * (1 - 1 / (distance / limit + 1));

// a card edge's start along one axis, kept between a and b. inside the last zone px before either end it slows the
// way the rise does, so it never reaches the end and never stops dead
export const softBetween = (v, a, b, zone) => {
  if (b <= a) {
    return (a + b) / 2;
  }
  const k = Math.min(zone, (b - a) / 2);
  if (v < a + k) {
    return a + k - rubberBand(a + k - v, k);
  }
  if (v > b - k) {
    return b - k + rubberBand(v - (b - k), k);
  }
  return v;
};

// the two cards of a link's switch at t (0 to 1) as whole window rects in the screen's px, the leaving one (from) and
// the arriving one (to), and how round their corners are (0 square, 1 the screen's own radius). they shrink about the
// page's center, most at halfway, while the row moves one card over: left for a link, right for Back
export const switchCards = (t, { page, fullW, fullH, back }) => {
  const p = ease.inOutCubic(t);
  const hump = Math.sin(Math.PI * t);
  const sx = 1 - SWITCH_SHRINK_X * hump;
  const sy = 1 - SWITCH_SHRINK_Y * hump;
  const cx = (page.x0 + page.x1) / 2;
  const cy = (page.y0 + page.y1) / 2;
  const card = {
    x0: cx - cx * sx,
    y0: cy - cy * sy,
    x1: cx + (fullW - cx) * sx,
    y1: cy + (fullH - cy) * sy,
  };
  const pitch =
    ((page.x1 - page.x0) * sx + SWITCH_GAP * fullW) * (back ? -1 : 1);
  const shifted = (i) => {
    const dx = (i - p) * pitch;
    return { x0: card.x0 + dx, y0: card.y0, x1: card.x1 + dx, y1: card.y1 };
  };
  return {
    from: shifted(0),
    to: shifted(1),
    round: smoothstep(hump, 0, 0.35),
  };
};

// card i's box at the row's scroll (a card index, so the scroll's card sits in the middle), pushed up by lift px
export const cardBox = (layout, i, scroll, lift = 0) => {
  const x = layout.cx + (i - scroll) * layout.pitch;
  return {
    x0: x - layout.cw / 2,
    y0: layout.cy - layout.ch / 2 - lift,
    x1: x + layout.cw / 2,
    y1: layout.cy + layout.ch / 2 - lift,
  };
};

// the swipe's neighbours fade in as it pulls up
export const peekShare = (pulled) => smoothstep(pulled, PEEK_FROM, PEEK_TO);

const offset = (box, dx, dy = 0) => ({
  x0: box.x0 + dx,
  y0: box.y0 + dy,
  x1: box.x1 + dx,
  y1: box.y1 + dy,
});

// the page's sky at the top and the bottom, darkened by its dim layer, as the stand in cards' colors (0 to 1)
export const pageSky = (doc = document) => {
  const css = getComputedStyle(doc.documentElement);
  const color = (name, dimName) => {
    const parts = css.getPropertyValue(name).match(/[\d.]+/g);
    const dim = parseFloat(css.getPropertyValue(dimName)) || 0;
    const rgb =
      parts && parts.length >= 3
        ? parts.slice(0, 3).map((v) => Number(v) / 255)
        : [0, 0, 0];
    return rgb.map((v) => v * (1 - dim));
  };
  return {
    top: color("--sky-top", "--dim-top"),
    low: color("--sky-low", "--dim-low"),
  };
};

const here = () => globalThis.location?.pathname ?? "";

// scene holds the phone's state (busy, zoomed, win, cards, switcher, switching, swapOpen, openApp, openIcon,
// openFromWidget) with full, placed, pageSize ({ w, h }, #page's layout and the window's), toScreenPx(x, y),
// reduced(), iconRect(name), loadPlayer(app), and wake(). apps gives closeApp, setAppWindow, showFlat, and hideFlat,
// nav requestApp and requestHome, and kept the apps' kept pages (cards.js createKept)
export const createSwitcher = ({
  scene,
  loop,
  apps,
  nav,
  pageEl,
  kept = null,
  siteApps,
  sky = pageSky,
  clock = () => performance.now(),
  blockClick = blockNextClick,
}) => {
  const speedAt = (lastT, speed) => (clock() - lastT > REST_MS ? 0 : speed);
  // each app's last page, so a card opens the app where it was left
  const lastPath = new Map();
  const prepare = (list) => kept?.prepare(list);
  const keptPath = (name) => kept?.path(name) ?? null;
  const keptScroll = (name) => kept?.scroll(name) ?? 0;

  const fullRect = () => ({
    x0: 0,
    y0: 0,
    x1: scene.full.fullW,
    y1: scene.full.fullH,
  });

  // the part of a window at rect that #page covers, in the screen's px. #page is laid out at the browser window's size
  // and centered in the app window, which is laid out at appW by appH
  const pageBox = (rect) => {
    const { appW, appH } = scene.placed;
    const { w, h } = scene.pageSize;
    const toX = (u) => rect.x0 + (u * (rect.x1 - rect.x0)) / appW;
    const toY = (v) => rect.y0 + (v * (rect.y1 - rect.y0)) / appH;
    const offsetX = (appW - w) / 2;
    const offsetY = (appH - h) / 2;
    return {
      x0: toX(offsetX),
      y0: toY(offsetY),
      x1: toX(offsetX + w),
      y1: toY(offsetY + h),
    };
  };

  // the app window at rect, as scene/appWindow.js placeAppWindow takes it
  const placeWindow = (rect, radius, look, home, app, crop = 0) => {
    scene.win = { rect, radius, look, home, crop, app, icon: scene.openIcon };
    scene.wake();
  };

  // the cards drawn over the screen, as scene/appWindow.js showCards takes them, with the page's top and bottom for
  // the backdrop's sky
  const showCards = (cards, radius, skyNow, fade = 1, backdrop = 0) => {
    const page = pageBox(fullRect());
    scene.cards = {
      cards,
      radius,
      sky: skyNow,
      fade,
      backdrop,
      span: [page.y0, page.y1],
    };
    scene.wake();
  };
  const hideCards = () => {
    scene.cards = null;
    scene.wake();
  };

  // the row's geometry in the screen's px, from the part #page covers
  const layoutOf = () => {
    const page = pageBox(fullRect());
    const pw = page.x1 - page.x0;
    const ph = page.y1 - page.y0;
    const cw = pw * CARD_SCALE;
    const ch = ph * CARD_SCALE;
    return {
      page,
      pw,
      ph,
      cw,
      ch,
      cx: (page.x0 + page.x1) / 2,
      cy: (page.y0 + page.y1) / 2 - ph * CARD_RISE,
      pitch: cw * (1 + CARD_GAP / CARD_SCALE),
    };
  };

  // the same row lined up on a card at box (the #page part of a window a swipe is carrying), its size and gaps scaled
  // with it, so the swipe's neighbours and a quick switch start right where that card is
  const layoutAround = (box) => {
    const base = layoutOf();
    const cw = box.x1 - box.x0;
    const ch = box.y1 - box.y0;
    return {
      ...base,
      cw,
      ch,
      cx: (box.x0 + box.x1) / 2,
      cy: (box.y0 + box.y1) / 2,
      pitch: cw * (1 + CARD_GAP / CARD_SCALE),
    };
  };

  // the row in the switcher's order (see scene/recents.js), and where the open app is in it
  const switcherRow = () => {
    const open = scene.openApp.name;
    const list = recentOrder(siteApps, [
      ...openedSoFar().filter((n) => n !== open),
      open,
    ]);
    prepare(list);
    return {
      apps: list,
      live: list.findIndex((a) => a.name === open),
      sky: sky(),
    };
  };

  const labelBox = (layout, box) => {
    const h = layout.ch * LABEL_SHARE;
    const y1 = box.y0 - layout.ch * LABEL_GAP;
    return { x0: box.x0, y0: y1 - h, x1: box.x0 + h * 4, y1 };
  };

  // the whole window rect whose #page part is box
  const windowFor = (layout, box) => {
    const { fullW, fullH } = scene.full;
    const kx = (box.x1 - box.x0) / layout.pw;
    const ky = (box.y1 - box.y0) / layout.ph;
    const x0 = box.x0 - layout.page.x0 * kx;
    const y0 = box.y0 - layout.page.y0 * ky;
    return { x0, y0, x1: x0 + fullW * kx, y1: y0 + fullH * ky };
  };

  const cardRadius = () => scene.full.radius * CARD_SCALE;

  // the row at the switcher's current state. enter (0 to 1) brings the live card from where it was (from) to its place
  // and the other cards in from beside it, and fade takes the stand ins and labels in or out
  const draw = () => {
    const sw = scene.switcher;
    const layout = sw.layout;
    const radius = cardRadius();
    const cards = sw.apps.map((app, i) => {
      const lift = sw.lift && sw.lift.i === i ? sw.lift.dy : 0;
      let body = cardBox(layout, i, sw.scroll, lift);
      if (i !== sw.live) {
        // the stand ins come in from a little further out
        body = offset(
          body,
          (1 - sw.enter) * Math.sign(i - sw.live) * layout.pitch * 0.5,
        );
      }
      return {
        app,
        body,
        label: sw.labels ? labelBox(layout, body) : null,
        kind: i === sw.holder ? 1 : 2,
      };
    });
    // a card being opened grows with no label, solid
    if (sw.grow) {
      cards[sw.grow.i].body = sw.grow.box;
      cards[sw.grow.i].label = null;
      cards[sw.grow.i].alpha = 1;
    }
    const holderBox =
      sw.grow && sw.holder === sw.grow.i
        ? sw.grow.box
        : sw.grow
          ? cards[sw.holder].body
          : lerpRect(sw.from, cards[sw.holder].body, sw.enter);
    // the home screen behind darkens as the switcher comes in and lightens back as a card fills the screen
    const home = sw.grow
      ? lerp(1, sw.homeAt, sw.fade)
      : lerp(sw.homeFrom, sw.homeAt, sw.enter);
    placeWindow(
      windowFor(layout, holderBox),
      radius,
      1,
      home,
      sw.apps[sw.holder],
      1,
    );
    showCards(cards, radius, sw.sky, sw.fade, sw.backdrop);
  };

  // the swipe's neighbours on either side of the card it carries (the window at rect), fading in as it pulls up
  const drawPeek = (rect, pulled, row) => {
    const layout = layoutAround(pageBox(rect));
    const share = peekShare(pulled);
    const sides = [row.live - 1, row.live + 1].filter(
      (i) => i >= 0 && i < row.apps.length,
    );
    showCards(
      sides.map((i) => ({
        app: row.apps[i],
        body: cardBox(layout, i, row.live),
        label: null,
        kind: 2,
      })),
      scene.full.radius,
      row.sky,
      share,
    );
  };

  // from a home bar swipe that rested, with the window at rect (the whole window, as the swipe placed it)
  const enterSwitcher = (rect, home, clientX, row) => {
    const { apps: list, live } = row;
    if (live < 0) {
      return false;
    }
    lastPath.set(scene.openApp.name, here());
    const sw = {
      apps: list,
      live,
      holder: live,
      layout: layoutOf(),
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
      drag: {
        x0: clientX,
        scroll0: live,
        lastX: clientX,
        lastT: clock(),
        speed: 0,
      },
    };
    scene.switcher = sw;
    if (scene.reduced()) {
      sw.enter = 1;
      sw.fade = 1;
      sw.anim = false;
      draw();
      return true;
    }
    loop
      .tween({
        duration: ENTER_MS,
        easing: ease.outCubic,
        group: "switcher",
        onUpdate: (t) => {
          if (scene.switcher !== sw) {
            return;
          }
          sw.enter = t;
          sw.fade = t;
          draw();
        },
      })
      .then(() => {
        if (scene.switcher === sw) {
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

  const screenDx = (fromX, toX, y) =>
    scene.toScreenPx(toX, y).x - scene.toScreenPx(fromX, y).x;

  // the press that opened the switcher, still down
  const switcherDrag = (event) => {
    const sw = scene.switcher;
    if (!sw || !sw.drag) {
      return;
    }
    const d = sw.drag;
    const now = clock();
    const step = screenDx(d.lastX, event.clientX, event.clientY);
    d.speed = step / sw.layout.pitch / Math.max(now - d.lastT, 1);
    d.lastX = event.clientX;
    d.lastT = now;
    sw.scroll = scrolled(
      sw,
      d.scroll0,
      screenDx(d.x0, event.clientX, event.clientY),
    );
    draw();
  };

  const snap = (sw, speed) => {
    const target = clamp(
      Math.round(sw.scroll - speed * FLICK_AHEAD),
      0,
      sw.apps.length - 1,
    );
    const from = sw.scroll;
    if (scene.reduced()) {
      sw.scroll = target;
      draw();
      return;
    }
    loop.tween({
      duration: SNAP_MS,
      easing: ease.outCubic,
      group: "switcher",
      onUpdate: (t) => {
        if (scene.switcher !== sw || sw.press || sw.drag) {
          return;
        }
        sw.scroll = from + (target - from) * t;
        draw();
      },
    });
  };

  const switcherDragEnd = () => {
    const sw = scene.switcher;
    if (!sw || !sw.drag) {
      return;
    }
    const speed = speedAt(sw.drag.lastT, sw.drag.speed);
    sw.drag = null;
    blockClick();
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

  // done with the switcher on app, which #page holds: the window fills the screen and the page is live again
  const finish = (app) => {
    scene.switcher = null;
    scene.switching = null;
    scene.swapOpen = false;
    scene.cards = null;
    scene.openApp = app;
    noteOpened(app.name);
    scene.loadPlayer(app);
    scene.openIcon = scene.iconRect(app.name);
    scene.openFromWidget = false;
    apps.setAppWindow(1, scene.openIcon, app);
    scene.busy = false;
    apps.showFlat();
    scene.wake();
  };

  // the open app's card back to fill the screen, the others sliding out, and the switcher gone
  const backToLive = async (sw) => {
    const layout = sw.layout;
    const start = cardBox(layout, sw.live, sw.scroll);
    const scroll0 = sw.scroll;
    sw.anim = true;
    sw.grow = { i: sw.live, box: start };
    const end = scene.reduced()
      ? "done"
      : await loop.tween({
          duration: OPEN_MS,
          easing: ease.outCubic,
          group: "switcher",
          onUpdate: (t) => {
            if (scene.switcher !== sw) {
              return;
            }
            sw.grow.box = lerpRect(start, layout.page, t);
            sw.scroll = scroll0 + (sw.live - scroll0) * t;
            sw.fade = 1 - t;
            draw();
          },
        });
    if (end === "cancelled" || scene.switcher !== sw) {
      return;
    }
    finish(scene.openApp);
  };

  // until landed or ms have gone by, a frame at a time
  const waitFor = (done, ms) =>
    new Promise((resolve) => {
      const start = clock();
      const remove = loop.add(() => {
        if (done() || clock() - start >= ms) {
          remove();
          resolve();
        }
      });
    });

  // another app's card grows to fill the screen while its page loads. the scene lets the swap through at once (see
  // swapOpen), and #page moves onto the growing card once it holds the new page
  const openOther = async (sw, i) => {
    const app = sw.apps[i];
    const layout = sw.layout;
    const start = cardBox(layout, i, sw.scroll);
    const scroll0 = sw.scroll;
    sw.anim = true;
    sw.grow = { i, box: start };
    scene.switching = { to: app.name, back: false };
    scene.swapOpen = true;
    const path = keptPath(app.name) || lastPath.get(app.name) || app.path;
    nav.requestApp(app, { path });
    const landed = () => pageEl.dataset.app === app.name;
    // the app's page comes back scrolled to where it was left, as soon as it's in #page
    let restored = false;
    const restoreScroll = () => {
      if (restored || !landed()) {
        return;
      }
      restored = true;
      const body = pageEl.querySelector(":scope > .body");
      if (body && here() === keptPath(app.name)) {
        body.scrollTop = keptScroll(app.name);
      }
    };
    const step = (t) => {
      if (scene.switcher !== sw) {
        return;
      }
      sw.grow.box = lerpRect(start, layout.page, t);
      sw.scroll = scroll0 + (i - scroll0) * t;
      sw.fade = 1 - t;
      // #page rides the growing card once it holds the app's page, and the card it left, just kept, shows that
      if (landed() && sw.holder !== i) {
        sw.holder = i;
        prepare(sw.apps);
      }
      restoreScroll();
      draw();
    };
    const end = scene.reduced()
      ? "done"
      : await loop.tween({
          duration: OPEN_MS,
          easing: ease.outCubic,
          group: "switcher",
          onUpdate: step,
        });
    if (end === "cancelled" || scene.switcher !== sw) {
      return;
    }
    if (!landed()) {
      await waitFor(() => landed() || scene.switcher !== sw, SWAP_WAIT_MS);
      if (scene.switcher !== sw) {
        return;
      }
    }
    restoreScroll();
    finish(landed() ? app : scene.openApp);
  };

  // home from the switcher: the open app's card flies into its icon the way a swipe home does, and the other cards fade
  const goHome = (sw) => {
    const layout = sw.layout;
    const box = cardBox(layout, sw.live, sw.scroll);
    const radius = cardRadius();
    scene.switcher = null;
    if (!scene.reduced()) {
      const fadeFrom = sw.fade;
      loop
        .tween({
          duration: HOME_FADE_MS,
          easing: ease.outCubic,
          group: "switcher",
          onUpdate: (t) => {
            const f = fadeFrom * (1 - t);
            const cards = sw.apps
              .map((app, i) =>
                i === sw.live
                  ? null
                  : {
                      app,
                      body: cardBox(layout, i, sw.scroll),
                      label: null,
                      kind: 2,
                    },
              )
              .filter(Boolean);
            showCards(cards, radius, sw.sky, f, BACKDROP);
          },
        })
        .then((end) => {
          if (end !== "cancelled") {
            hideCards();
          }
        });
    } else {
      hideCards();
    }
    scene.busy = false;
    // the close starts from the switcher's darker, closer home screen and brings it back as the card flies home
    const closing = apps.closeApp({
      rect: windowFor(layout, box),
      radius,
      home: BACKDROP_HOME,
      crop: 1,
    });
    nav.requestHome();
    return closing;
  };

  // a card pushed up gives a little and springs back, since apps can't be closed here
  const settleLift = (sw) => {
    const lift = sw.lift;
    if (!lift) {
      return;
    }
    const from = lift.dy;
    if (scene.reduced()) {
      sw.lift = null;
      draw();
      return;
    }
    loop
      .tween({
        duration: LIFT_MS,
        group: "switcher",
        onUpdate: (t) => {
          if (scene.switcher !== sw || sw.lift !== lift) {
            return;
          }
          lift.dy = from * (1 - liftSpring(t));
          draw();
        },
      })
      .then(() => {
        if (scene.switcher === sw && sw.lift === lift) {
          sw.lift = null;
          draw();
        }
      });
  };

  // a swipe let go mostly sideways opens the app on that side (i in the row): its card, peeking beside the one the
  // swipe carries, grows to fill the screen while that one slides out. it starts from the swipe's own look, with no
  // backdrop, since the switcher never showed
  const quickSwitch = (rect, home, i, row, pulled) => {
    lastPath.set(scene.openApp.name, here());
    const box = pageBox(rect);
    scene.switcher = {
      apps: row.apps,
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
      drag: null,
    };
    return openOther(scene.switcher, i);
  };

  // a browser navigation (Back, Forward) while the switcher shows puts the open app back at once, so it can go ahead
  const leave = () => {
    if (!scene.switcher || scene.switching) {
      return;
    }
    finish(scene.openApp);
  };

  // a link in one app to another, the way ios switches apps: the window shrinks into a card, mostly in height, slides
  // sideways to the next app's card, and grows to fill the screen again. there's one window, so the card that doesn't
  // hold #page is drawn in the page's sky with nothing on it. the swap is held until the cards are near halfway, so the
  // old page rides the leaving card and the new one the arriving card
  const switchTo = async (app, { back = false, swapped }) => {
    if (scene.busy || !scene.zoomed || scene.reduced()) {
      return;
    }
    scene.busy = true;
    scene.swapOpen = false;
    const from = scene.openApp;
    const run = { to: app.name, back, landed: false, dropped: false };
    scene.switching = run;
    swapped.then((done) => {
      run.landed = Boolean(done);
      run.dropped = !done;
    });
    apps.hideFlat();
    const skyNow = sky();
    const { fullW, fullH, radius: screenRadius } = scene.full;
    const page = pageBox(fullRect());
    const place = (t) => {
      if (t >= SWITCH_SWAP_AT) {
        scene.swapOpen = true;
      }
      const cards = switchCards(t, { page, fullW, fullH, back });
      const radius = screenRadius * cards.round;
      // #page rides the card of the app it holds, and the other card stands in for the other app
      const landed = run.landed || pageEl.dataset.app === app.name;
      placeWindow(
        landed ? cards.to : cards.from,
        radius,
        1,
        1,
        landed ? app : from,
        1,
      );
      showCards(
        [
          {
            app: landed ? from : app,
            body: pageBox(landed ? cards.from : cards.to),
            label: null,
            kind: 3,
          },
        ],
        radius,
        skyNow,
      );
    };
    place(0);
    const end = await loop.tween({
      duration: SWITCH_MS,
      group: "switcher",
      onUpdate: place,
    });
    // a swap that hasn't landed yet would put the old page back on the screen, so the arriving card waits for it
    if (
      end !== "cancelled" &&
      !run.landed &&
      !run.dropped &&
      pageEl.dataset.app !== app.name
    ) {
      scene.swapOpen = true;
      await Promise.race([
        swapped,
        new Promise((resolve) => setTimeout(resolve, SWITCH_SWAP_WAIT_MS)),
      ]);
    }
    scene.switching = null;
    scene.swapOpen = false;
    hideCards();
    if (end === "cancelled") {
      return;
    }
    const shown = run.landed || pageEl.dataset.app === app.name ? app : from;
    scene.openApp = shown;
    noteOpened(shown.name);
    scene.loadPlayer(shown);
    scene.openIcon = scene.iconRect(shown.name);
    scene.openFromWidget = false;
    apps.setAppWindow(1, scene.openIcon, shown);
    scene.busy = false;
    apps.showFlat();
    scene.wake();
  };

  // the swipe up from the home bar, the way ios does it: the window shrinks as it's pulled up, with the point that was
  // grabbed staying under the pointer, so it can be carried anywhere while the home screen comes back behind it
  let homeSwipe = null;

  // the part of the screen the window shows, in the screen's px
  const shownScreenRect = () => {
    const { fullW, fullH } = scene.full;
    const { w, h } = scene.pageSize;
    const tl = scene.toScreenPx(0, 0);
    const tr = scene.toScreenPx(w, 0);
    const bl = scene.toScreenPx(0, h);
    const br = scene.toScreenPx(w, h);
    return {
      x0: Math.max(0, tl.x, bl.x),
      y0: Math.max(0, tl.y, tr.y),
      x1: Math.min(fullW, tr.x, br.x),
      y1: Math.min(fullH, bl.y, br.y),
    };
  };

  // the largest screen shaped frame that fits inside the shown part less the gap, centered, as its corner and its size
  // against the whole screen
  const homeFrame = (shown) => {
    const { fullW, fullH } = scene.full;
    const edge = HOME_EDGE * fullH;
    const f = Math.min(
      1,
      (shown.x1 - shown.x0 - edge * 2) / fullW,
      (shown.y1 - shown.y0 - edge * 2) / fullH,
    );
    return {
      x0: (shown.x0 + shown.x1 - fullW * f) / 2,
      y0: (shown.y0 + shown.y1 - fullH * f) / 2,
      f,
    };
  };

  // a resize drops a swipe in progress, since its grab and its frame were measured on the screen it replaced. the
  // release still eats its click
  const dropHomeSwipe = () => {
    if (homeSwipe) {
      homeSwipe.dropped = true;
    }
  };

  const startHomeSwipe = (event) => {
    if (scene.busy || !scene.zoomed || homeSwipe) {
      return;
    }
    homeSwipe = {
      id: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      armed: false,
      lastX: event.clientX,
      lastY: event.clientY,
      lastT: clock(),
      speed: 0,
      smooth: 0,
      slowSince: null,
      inSwitcher: false,
    };
  };

  // each frame of an armed swipe, whether it has rested long enough for the switcher
  const watchRest = (swipe) => {
    const remove = loop.add(() => {
      if (homeSwipe !== swipe || swipe.dropped || swipe.inSwitcher) {
        remove();
        return;
      }
      const now = clock();
      const speed =
        swipe.smooth * Math.exp(-(now - swipe.lastT) / SPEED_FADE_MS);
      if (
        swipe.rect &&
        swipe.pulled >= SWITCHER_PULL &&
        speed < SWITCHER_SLOW
      ) {
        swipe.slowSince ??= now;
        if (now - swipe.slowSince >= SWITCHER_REST_MS) {
          swipe.inSwitcher = enterSwitcher(
            swipe.rect,
            swipe.home,
            swipe.lastX,
            swipe.row,
          );
          if (swipe.inSwitcher) {
            remove();
          }
        }
      } else {
        swipe.slowSince = null;
      }
    });
  };

  const moveHomeSwipe = (event) => {
    if (!homeSwipe || event.pointerId !== homeSwipe.id || homeSwipe.dropped) {
      return;
    }
    // the switcher opened mid swipe, and the same press now scrolls its cards
    if (homeSwipe.inSwitcher) {
      switcherDrag(event);
      event.preventDefault();
      return;
    }
    if (!homeSwipe.armed) {
      if (homeSwipe.y0 - event.clientY < 8) {
        return;
      }
      // a key or a navigation started the close since the press, and the swipe would fight it. an armed swipe has set
      // busy itself, so its release only ever clears its own
      if (scene.busy || !scene.zoomed) {
        homeSwipe = null;
        return;
      }
      homeSwipe.armed = true;
      scene.busy = true;
      apps.hideFlat();
      homeSwipe.grab = scene.toScreenPx(homeSwipe.x0, homeSwipe.y0);
      homeSwipe.shown = shownScreenRect();
      homeSwipe.frame = homeFrame(homeSwipe.shown);
      homeSwipe.row = switcherRow();
      homeSwipe.startBox = pageBox(fullRect());
      watchRest(homeSwipe);
    }
    const swipe = homeSwipe;
    const now = clock();
    const dt = Math.max(now - swipe.lastT, 1);
    swipe.speed = (swipe.lastY - event.clientY) / dt;
    swipe.smooth =
      swipe.smooth * 0.6 +
      (Math.hypot(event.clientX - swipe.lastX, event.clientY - swipe.lastY) /
        dt) *
        0.4;
    swipe.lastX = event.clientX;
    swipe.lastY = event.clientY;
    swipe.lastT = now;
    const { fullW, fullH, radius } = scene.full;
    const { grab, shown, frame } = swipe;
    const { w, h } = scene.pageSize;
    // past the window's edge the screen's perspective maps the pointer to the wrong side, so it's held to the window
    const at = scene.toScreenPx(
      clamp(event.clientX, 0, w),
      clamp(event.clientY, 0, h),
    );
    const raw = Math.max(grab.y - at.y, 0);
    const pulled = clamp(raw / fullH, 0, 1);
    swipe.pulled = pulled;
    // the card shrinks about the grabbed spot, which moves sideways with the finger and rises by the rubber banded drag,
    // all inside the frame, and its edges slow as they near the shown part's edges
    const scale =
      frame.f * (1 - HOME_SHRINK * Math.min(raw / (fullH * frame.f), 1));
    const cardW = fullW * scale;
    const cardH = fullH * scale;
    const spotX = frame.x0 + grab.x * frame.f + (at.x - grab.x);
    const spotY =
      frame.y0 +
      grab.y * frame.f -
      rubberBand(raw, fullH * frame.f * HOME_LIFT);
    const edge = HOME_EDGE * fullH;
    // sideways the card can go half off either side, toward the app beside it, and up and down it stays on the screen
    const x0 = softBetween(
      spotX - grab.x * scale,
      shown.x0 - cardW / 2,
      shown.x1 - cardW / 2,
      edge,
    );
    swipe.across = at.x - grab.x;
    const y0 = softBetween(
      spotY - grab.y * scale,
      shown.y0,
      shown.y1 - cardH,
      edge,
    );
    // it starts as the whole screen, which may run past the window, and blends into that motion over the first part of
    // the pull, a little faster at first so it answers the finger at once
    const fitPull = Math.max(HOME_FIT * (1 - frame.f), 0.02);
    const blend = Math.sin((Math.min(pulled / fitPull, 1) * Math.PI) / 2);
    swipe.rect = lerpRect(
      fullRect(),
      { x0, y0, x1: x0 + cardW, y1: y0 + cardH },
      blend,
    );
    swipe.home = 1 - pulled;
    placeWindow(swipe.rect, radius, 1, swipe.home, scene.openApp, 1);
    drawPeek(swipe.rect, pulled, swipe.row);
    event.preventDefault();
  };

  const endHomeSwipe = async (event) => {
    if (!homeSwipe || event.pointerId !== homeSwipe.id) {
      return;
    }
    const swipe = homeSwipe;
    homeSwipe = null;
    if (!swipe.armed) {
      return;
    }
    blockClick();
    if (swipe.dropped) {
      return;
    }
    // let go in the switcher, which stays up with its cards settling on the nearest one
    if (swipe.inSwitcher) {
      switcherDragEnd();
      return;
    }
    // let go mostly sideways, which switches straight to the app on that side if there is one
    if (swipe.rect && event.type === "pointerup") {
      const box = pageBox(swipe.rect);
      const start = swipe.startBox;
      // the finger's own travel across, since the card slows near the sides while the finger doesn't
      const dx = swipe.across;
      const lift = (start.y0 + start.y1) / 2 - (box.y0 + box.y1) / 2;
      const target = swipe.row.live + (dx > 0 ? -1 : 1);
      if (
        Math.abs(dx) > QUICK_SHARE * (start.x1 - start.x0) &&
        Math.abs(dx) > lift &&
        target >= 0 &&
        target < swipe.row.apps.length
      ) {
        return quickSwitch(
          swipe.rect,
          swipe.home,
          target,
          swipe.row,
          swipe.pulled,
        );
      }
    }
    scene.busy = false;
    const { radius } = scene.full;
    if (
      swipe.rect &&
      event.type === "pointerup" &&
      (swipe.pulled > HOME_DISTANCE || swipe.speed > HOME_FLICK)
    ) {
      // the close carries on from where the window was let go, and the navigation home waits for it
      hideCards();
      const closing = apps.closeApp({
        rect: swipe.rect,
        radius,
        home: swipe.home,
        crop: 1,
      });
      nav.requestHome();
      return closing;
    }
    scene.busy = true;
    // with reduced motion only the drag moves the window, so a release that doesn't go home fills the screen at once
    if (swipe.rect && scene.reduced()) {
      hideCards();
      placeWindow(fullRect(), radius, 1, 1, scene.openApp, 0);
    } else if (swipe.rect) {
      const full = fullRect();
      // the neighbours that peeked in fade back out with it
      const end = await loop.tween({
        duration: HOME_SPRING_BACK_MS,
        easing: ease.outCubic,
        group: "switcher",
        onUpdate: (t) => {
          const rect = lerpRect(swipe.rect, full, t);
          placeWindow(
            rect,
            radius,
            1,
            swipe.home + (1 - swipe.home) * t,
            scene.openApp,
            1 - t,
          );
          drawPeek(rect, swipe.pulled * (1 - t), swipe.row);
        },
      });
      hideCards();
      if (end === "cancelled") {
        return;
      }
    }
    scene.busy = false;
    apps.showFlat();
    scene.wake();
  };

  // a press while the switcher shows: a tap on a card opens it, on the open app's card puts it back, and anywhere else
  // goes home. a drag sideways scrolls the row, up on a card lifts it, and up from outside the cards goes home
  const switcherDown = (event) => {
    const sw = scene.switcher;
    if (!sw || sw.drag) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (sw.anim || sw.press || !event.isPrimary) {
      return;
    }
    const at = scene.toScreenPx(event.clientX, event.clientY);
    sw.press = {
      id: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastT: clock(),
      speed: 0,
      upSpeed: 0,
      mode: null,
      card: hitCard(sw, at),
      scroll0: sw.scroll,
    };
  };

  const switcherMove = (event) => {
    const sw = scene.switcher;
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
      press.mode =
        Math.abs(dx) > Math.abs(dy)
          ? "scroll"
          : dy < 0 && press.card >= 0
            ? "lift"
            : "up";
    }
    const now = clock();
    const dt = Math.max(now - press.lastT, 1);
    press.speed =
      screenDx(press.lastX, event.clientX, event.clientY) /
      sw.layout.pitch /
      dt;
    press.upSpeed = (press.lastY - event.clientY) / dt;
    press.lastX = event.clientX;
    press.lastY = event.clientY;
    press.lastT = now;
    if (press.mode === "scroll") {
      sw.scroll = scrolled(
        sw,
        press.scroll0,
        screenDx(press.x0, event.clientX, event.clientY),
      );
      draw();
    } else if (press.mode === "lift") {
      const up =
        scene.toScreenPx(press.x0, press.y0).y -
        scene.toScreenPx(press.x0, event.clientY).y;
      sw.lift = {
        i: press.card,
        dy: rubberBand(Math.max(up, 0), sw.layout.ch * LIFT_LIMIT),
      };
      draw();
    }
  };

  const switcherEnd = (event) => {
    const sw = scene.switcher;
    const press = sw && sw.press;
    if (!press || event.pointerId !== press.id) {
      return undefined;
    }
    sw.press = null;
    event.preventDefault();
    blockClick();
    if (event.type === "pointercancel") {
      settleLift(sw);
      snap(sw, 0);
      return undefined;
    }
    if (!press.mode) {
      if (press.card < 0) {
        return goHome(sw);
      }
      if (press.card === sw.live) {
        return backToLive(sw);
      }
      return openOther(sw, press.card);
    }
    if (press.mode === "scroll") {
      snap(sw, speedAt(press.lastT, press.speed));
    } else if (press.mode === "lift") {
      settleLift(sw);
    } else if (
      press.y0 - press.lastY > HOME_PULL ||
      speedAt(press.lastT, press.upSpeed) > SWITCHER.HOME_FLICK
    ) {
      return goHome(sw);
    }
    return undefined;
  };

  // Escape puts the open app back, the way a tap on its card does
  const switcherKey = (event) => {
    const sw = scene.switcher;
    if (!sw || event.key !== "Escape" || sw.anim || sw.press || sw.drag) {
      return undefined;
    }
    event.preventDefault();
    event.stopPropagation();
    return backToLive(sw);
  };

  // the listeners, all removed with signal, and each wrapped by guard so a throw fails the scene. the swipe starts on
  // #page's home bar, whose content is swapped under it, so that one listens on #page
  const install = ({ signal, guard }) => {
    pageEl.addEventListener(
      "pointerdown",
      guard((event) => {
        if (event.target.closest?.(".home-bar")) {
          startHomeSwipe(event);
        }
      }),
      { signal },
    );
    const end = guard((event) => endHomeSwipe(event));
    addEventListener("pointermove", guard(moveHomeSwipe), {
      capture: true,
      passive: false,
      signal,
    });
    addEventListener("pointerup", end, { capture: true, signal });
    addEventListener("pointercancel", end, { capture: true, signal });
    addEventListener("pointerdown", guard(switcherDown), {
      capture: true,
      signal,
    });
    addEventListener("pointermove", guard(switcherMove), {
      capture: true,
      passive: false,
      signal,
    });
    const up = guard(switcherEnd);
    addEventListener("pointerup", up, { capture: true, signal });
    addEventListener("pointercancel", up, { capture: true, signal });
    addEventListener("keydown", guard(switcherKey), { capture: true, signal });
  };

  const status = () => ({
    switchingTo: scene.switching ? scene.switching.to : null,
    switcher: Boolean(scene.switcher),
    swapOpen: scene.swapOpen,
  });

  return {
    install,
    status,
    switchTo,
    leave,
    dropHomeSwipe,
    startHomeSwipe,
    moveHomeSwipe,
    endHomeSwipe,
  };
};
