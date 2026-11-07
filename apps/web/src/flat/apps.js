// the 2d app window, as scene/appWindow.js opens and closes it: the window grows out of the tapped icon (or widget)
// while the phone comes in to the zoom pose, the home screen behind zooms in a little around the icon and dims, and
// #page rides the window clipped to its rounded cutout until it's the flat page at full zoom. closing plays it back
// into the icon. with reduced motion, and on the slow path, #page crossfades over the phone instead
import { read, write } from "../lib/storage.js";
import { noteOpened } from "../scene/recents.js";
import {
  APP_BACKGROUND,
  CLOSE_DELAY_MS,
  CLOSE_MS,
  CLOSE_SWIPE_MS,
  CROSSFADE_MS,
  FADE_IN_MS,
  FOLD_FINISH_MS,
  HOME_HINT_KEY,
  HOME_HINT_MS,
  OPEN_WINDOW_MS,
  REST_RETURN_MS,
  ZOOM_MS,
  ease,
  springOut,
} from "../scene/shared/motion.js";

export const smoothstep = (x, min, max) => {
  if (x <= min) {
    return 0;
  }
  if (x >= max) {
    return 1;
  }
  const u = (x - min) / (max - min);
  return u * u * (3 - 2 * u);
};

export const lerpRect = (a, b, t) => ({
  x0: a.x0 + (b.x0 - a.x0) * t,
  y0: a.y0 + (b.y0 - a.y0) * t,
  x1: a.x1 + (b.x1 - a.x1) * t,
  y1: a.y1 + (b.y1 - a.y1) * t,
});

export const lerpPose = (a, b, t) =>
  Object.fromEntries(
    ["x", "y", "z", "rx", "ry", "rz"].map((k) => [k, a[k] + (b[k] - a[k]) * t]),
  );

// three mixes colors in its linear working space (scene/appWindow.js mixColor), so this does too
const toLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toSrgb = (c) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
const channels = (hex) =>
  [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
export const mixColor = (a, b, t) => {
  const ca = channels(a);
  const cb = channels(b);
  return (
    "#" +
    ca
      .map((c, i) =>
        Math.round(toSrgb(c + (cb[i] - c) * t) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
};

// how far grown a window out of a widget is when it's fully over the widget (scene/appWindow.js WIDGET_FADE)
const WIDGET_FADE = 0.12;

// the window's color and how much of it shows over the home screen at look k, as scene/appWindow.js windowLook has it
export const windowLook = (k, app, fromWidget, glass = null) => {
  const tone = smoothstep(k, 0.15, 0.6);
  if (fromWidget) {
    return {
      background: mixColor(glass || APP_BACKGROUND, APP_BACKGROUND, tone),
      opacity: smoothstep(k, 0, WIDGET_FADE),
    };
  }
  return { background: mixColor(app.color, APP_BACKGROUND, tone), opacity: 1 };
};

// #page's share of the window, which fades in as the window gets big
export const pageOpacity = (k) => Math.min(Math.max((k - 0.35) / 0.4, 0), 1);

// the window's rounded cutout as a clip on #page, in #page's own px, since the clip moves with its transform. #page is
// laid out at the browser window's size and centered in the app window (appW by appH), which covers rect on the
// screen, so the cutout is the same box around #page at any rect, and only its rounding changes with the rect's size
export const pageClip = ({ appW, appH, width, height, radius, rectW }) => {
  const x = -(appW - width) / 2;
  const y = -(appH - height) / 2;
  const r = rectW > 0 ? (radius * appW) / rectW : 0;
  return `inset(${y}px ${x}px ${y}px ${x}px round ${r}px)`;
};

// the home screen behind the window zooms in around the icon and dims, all the way at home 1
export const homeLook = (home, icon) => ({
  zoom: 1 + 0.08 * home,
  cx: (icon.x0 + icon.x1) / 2,
  cy: (icon.y0 + icon.y1) / 2,
  dim: 0.3 * home,
});

// the home screen sits under #page in the tab order, so while an app covers it its faces are inert and the focus
// they had is gone. focus goes to the page's heading once the app is up as the flat page, and back to the app's icon
// once the home screen is uncovered again (scene/appWindow.js syncAppFocus). the draw calls it each frame
export const createAppFocus = ({ pageEl, iconOf, doc = document }) => {
  let wasFlat = false;
  let wasCovered = false;
  return ({ covered, pageFlat, app }) => {
    const active = doc.activeElement;
    const lost = !active || active === doc.body;
    if (pageFlat && !wasFlat && lost) {
      const target = pageEl.querySelector("h1") || pageEl;
      if (!target.hasAttribute("tabindex")) {
        target.tabIndex = -1;
      }
      target.focus({ preventScroll: true });
    }
    if (!covered && wasCovered && app && (lost || pageEl.contains(active))) {
      iconOf(app.name)?.focus({ preventScroll: true });
    }
    wasFlat = pageFlat;
    wasCovered = covered;
  };
};

// scene holds the phone's state the loop draws (pose, fold, busy, zoomed, phone, appVisible, pageFade, win, openApp,
// openIcon, openFromWidget) with placed, full ({ fullW, fullH, radius } of the open screen), reduced(), slowPath(),
// iconRect(name), takeOver(), setPageFlat(flat), loadPlayer(app), and wake(). folds gives openPhone, and nav
// requestApp and requestHome
export const createApps = ({ scene, loop, folds, nav, pageEl }) => {
  const fullRect = () => ({
    x0: 0,
    y0: 0,
    x1: scene.full.fullW,
    y1: scene.full.fullH,
  });

  // the window at k (0 = the icon, 1 = the whole screen), with its look and the home screen's zoom moving together
  const setAppWindow = (k, icon, app) => {
    scene.win = {
      rect: lerpRect(icon, fullRect(), k),
      radius: icon.radius + (scene.full.radius - icon.radius) * k,
      look: k,
      home: k,
      crop: 0,
      app,
      icon,
    };
  };

  const resetAppWindow = () => {
    scene.pageFade = null;
    scene.win = null;
  };

  const showFlat = () => {
    scene.setPageFlat(true);
    scene.appVisible = false;
  };

  const hideFlat = () => {
    if (!scene.pageFlat) {
      return;
    }
    scene.setPageFlat(false);
    scene.appVisible = true;
  };

  // the first app opened nudges the home bar up with a line saying what it does, once per browser
  const showHomeHint = () => {
    if (read("local", HOME_HINT_KEY) === "1") {
      return;
    }
    write("local", HOME_HINT_KEY, "1");
    pageEl.classList.add("hint-home");
    setTimeout(() => pageEl.classList.remove("hint-home"), HOME_HINT_MS);
  };

  // #page's fade for an open or a close with reduced motion
  const crossfade = (from, to) =>
    loop.tween({
      duration: CROSSFADE_MS,
      group: "app",
      onUpdate: (_, t) => {
        scene.pageFade = from + (to - from) * ease.inOutSine(t);
      },
    });

  const movePose = (to, duration, easing) => {
    const from = { ...scene.pose };
    return loop.tween({
      duration,
      easing,
      group: "app",
      onUpdate: (k) => {
        scene.pose = lerpPose(from, to, k);
      },
    });
  };

  // from is the box the window grows out of (a widget's), else the app's icon. instant opens it at once (an app named
  // in the address on load)
  const openApp = async (app, { from = null, instant = false } = {}) => {
    if (scene.busy || scene.zoomed) {
      return;
    }
    scene.busy = true;
    scene.takeOver();
    loop.cancelGroup("intro");
    if (scene.fold > 0) {
      const foldFrom = scene.fold;
      loop.tween({
        duration: FOLD_FINISH_MS,
        easing: ease.outCubic,
        group: "fold",
        onUpdate: (k) => {
          scene.fold = foldFrom * (1 - k);
        },
      });
    }
    scene.openApp = app;
    noteOpened(app.name);
    scene.loadPlayer(app);
    scene.openIcon = from || scene.iconRect(app.name);
    scene.openFromWidget = Boolean(from);
    const fading = !instant && (scene.reduced() || scene.slowPath());
    if (!fading) {
      setAppWindow(instant ? 1 : 0, scene.openIcon, app);
      scene.appVisible = true;
    }
    if (instant) {
      scene.pose = { ...scene.placed.zoom };
      scene.fold = 0;
      loop.cancelGroup("fold");
    } else if (fading) {
      // #page fades in over the home screen on the apps' background, with no zoom, and the phone takes the zoomed pose
      // under it once it covers everything
      scene.pageFade = 0;
      if ((await crossfade(0, 1)) === "cancelled") {
        return;
      }
      scene.pageFade = null;
      setAppWindow(1, scene.openIcon, app);
      scene.appVisible = true;
      scene.pose = { ...scene.placed.zoom };
      scene.fold = 0;
    } else {
      // the approach starts on the tap and moves fastest at first, like the hand reacting
      const icon = scene.openIcon;
      const ends = await Promise.all([
        loop.tween({
          duration: OPEN_WINDOW_MS,
          group: "app",
          onUpdate: (_, t) => setAppWindow(springOut(t), icon, app),
        }),
        movePose({ ...scene.placed.zoom }, ZOOM_MS, ease.outCubic),
      ]);
      if (ends.includes("cancelled")) {
        return;
      }
    }
    scene.zoomed = true;
    scene.busy = false;
    scene.wake();
    showFlat();
    scene.wake();
    showHomeHint();
  };

  const openFromCover = async (app, opts) => {
    if (scene.busy || scene.phone !== "closed") {
      return;
    }
    // something took over while it opened, so the tap is dropped
    if ((await folds.openPhone()) !== "done" || scene.phone !== "open") {
      return;
    }
    return openApp(app, opts);
  };

  // another page on the window that's already open, in the new app's color, with #page's new content fading in. with
  // no app open it opens the app
  const fadeTo = async (app) => {
    if (!scene.zoomed) {
      return openApp(app);
    }
    if (scene.busy) {
      return;
    }
    scene.openApp = app;
    noteOpened(app.name);
    scene.loadPlayer(app);
    scene.openIcon = scene.iconRect(app.name);
    scene.openFromWidget = false;
    setAppWindow(1, scene.openIcon, app);
    scene.wake();
    pageEl.animate?.([{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_IN_MS,
      easing: "ease-out",
    });
  };

  // from is where the window is when the close starts: the whole screen, or wherever a swipe up left it
  const closeApp = async (from = null) => {
    if (scene.busy || !scene.zoomed) {
      return;
    }
    scene.busy = true;
    // with reduced motion the phone goes back to rest on the home screen under #page, which then fades out
    if (scene.reduced() || scene.slowPath()) {
      scene.zoomed = false;
      scene.setPageFlat(false);
      resetAppWindow();
      scene.appVisible = false;
      scene.pageFade = 1;
      scene.pose = { ...scene.placed.rest };
      if ((await crossfade(1, 0)) === "cancelled") {
        return;
      }
      scene.pageFade = null;
      scene.busy = false;
      scene.wake();
      return;
    }
    const app = scene.openApp;
    const icon = scene.openIcon;
    const start = from || {
      rect: fullRect(),
      radius: scene.full.radius,
      home: 1,
      crop: 0,
    };
    const step = (e) => {
      scene.win = {
        rect: lerpRect(start.rect, icon, e),
        radius: start.radius + (icon.radius - start.radius) * e,
        look: 1 - e,
        home: start.home * (1 - e),
        crop: (start.crop ?? 0) * (1 - e),
        app,
        icon,
      };
    };
    step(0);
    hideFlat();
    scene.zoomed = false;
    // the window shrinks back into its icon as the phone moves back to its resting distance, and the real icon takes
    // over the moment the shrink ends. let go mid swipe, it's already moving, so it flies off at once and eases in
    const shrink = loop
      .tween({
        duration: from ? CLOSE_SWIPE_MS : CLOSE_MS,
        delay: from ? 0 : CLOSE_DELAY_MS,
        group: "app",
        onUpdate: (_, t) => step(from ? ease.outCubic(t) : ease.inOutCubic(t)),
      })
      .then((end) => {
        if (end !== "cancelled") {
          resetAppWindow();
          scene.appVisible = false;
        }
        return end;
      });
    const ends = await Promise.all([
      shrink,
      movePose({ ...scene.placed.rest }, REST_RETURN_MS, ease.inOutCubic),
    ]);
    if (ends.includes("cancelled")) {
      return;
    }
    scene.busy = false;
    scene.wake();
  };

  // a tap on an icon or a widget goes to the app's page, and the open follows its navigation
  const tapApp = (app, { from = null, path = app.path } = {}) => {
    if (scene.zoomed || scene.busy || scene.phone !== "open") {
      return;
    }
    if (!nav.requestApp(app, { from, path })) {
      return openApp(app, { from });
    }
  };

  const tapFromCover = (app) => {
    if (scene.busy || scene.phone !== "closed") {
      return;
    }
    if (!nav.requestApp(app)) {
      return openFromCover(app);
    }
  };

  // escape and the home bar go home, Back when that leads home, or close the app with no navigation
  const goHome = () => {
    if (!nav.requestHome()) {
      return closeApp();
    }
  };

  // the end state for the page at once, with no animation: the address's app open at full zoom, or the home screen
  const showUrl = (app) => {
    loop.cancelAll();
    scene.takeOver();
    scene.setPageFlat(false);
    resetAppWindow();
    scene.zoomed = false;
    scene.appVisible = false;
    scene.pose = { ...scene.placed.rest };
    scene.fold = 0;
    scene.lead = 0;
    scene.busy = false;
    scene.wake();
    scene.phone = "open";
    scene.wake();
    if (app) {
      return openApp(app, { instant: true });
    }
  };

  // the page's home bar and the header's home buttons are links to / for the flat site, so in the scene their click
  // is taken over, going Back when that leads home. #page's content is swapped under them, so this listens on #page
  const install = ({ signal, guard }) => {
    pageEl.addEventListener(
      "click",
      guard((event) => {
        const home = event.target.closest?.(".home-bar, .home-link");
        if (!home || !scene.zoomed) {
          return;
        }
        event.preventDefault();
        return goHome();
      }),
      { signal },
    );
  };

  return {
    openApp,
    openFromCover,
    closeApp,
    fadeTo,
    tapApp,
    tapFromCover,
    goHome,
    showUrl,
    install,
  };
};
