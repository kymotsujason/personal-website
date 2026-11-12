// the 2d scene, shown under html.has-flat-scene: captured frames of the hands and phone, the live home and cover
// screens warped onto them, and the desk behind, played from the address the way the 3d scene arrives (intro.js).
// the intro runs as web animations, and every motion after it (the folds, the apps) from one animation frame loop
// (loop.js) that draws the frame, the wrappers, the screens, #page, and the switcher's cards together. from is "3d" when
// the 3d scene handed a slow device over during the visit, and the scene then starts from the page the address names
import { read, write } from "../lib/storage.js";
import { screenLayout } from "../scene/shared/placement.js";
import { chargingNow } from "../scene/status.js";
import {
  createAppFocus,
  createApps,
  homeLook,
  pageClip,
  pageOpacity,
  smoothstep,
  windowCutout,
  windowLook,
} from "./apps.js";
import { createCards, createKept } from "./cards.js";
import { createCover } from "./cover.js";
import { createCharger } from "./charger.js";
import { createDesk, prefetchDesk } from "./desk.js";
import { createDrift } from "./drift.js";
import { createFolds, pathAfter } from "./fold.js";
import { chooseLighting, phoneHeightPx, sizeFor } from "./frames.js";
import { arrivalKind, playIntro } from "./intro.js";
import { createLoop } from "./loop.js";
import { createHome } from "./home.js";
import { createLook, motionPose } from "./look.js";
import { createVolume, volumeSetFor } from "./volume.js";
import { loadManifest } from "./manifest.js";
import { autoRecent, createSlowMeter } from "./meter.js";
import { createNavigation } from "./navigation.js";
import { createRain } from "./rain.js";
import {
  createFoldMeter,
  createMeter,
  staysCalm,
  watchFrames,
} from "./rest.js";
import {
  TURN_DEADLINE_MS,
  portraitFor,
  resizeKind,
  turnSetFor,
  visibleDeadline,
  watchResize,
} from "./resize.js";
import { createScreens, faceInput } from "./screens.js";
import { createStage } from "./stage.js";
import { createFlatStatus } from "./status.js";
import { homography, mapPoint, quadToQuad } from "./warp.js";

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));

// the set, lighting, and size, chosen once per page load: the orientation's opening set (the intro and an arrival
// both end on the open phone), the lighting for the visitor's hour, and the size for how many device px the open
// phone covers
export const chooseSet = ({ width, height, dpr, hour }) => {
  const portrait = portraitFor({ width, height });
  return {
    set: turnSetFor({ portrait, charging: false }),
    lighting: chooseLighting(hour),
    size: sizeFor({
      phonePx: phoneHeightPx({ width, height, portrait }) * dpr,
    }),
  };
};

// portrait's opening set and its closing one go together, the cable versions too
export const closingSetFor = (set) =>
  set.endsWith("portrait-open") ? set.replace(/open$/, "close") : null;

// the slow path opens apps with the crossfade and shows the screens' canvas picture while the phone moves (rulings R9
// and R9b): a device the 2d scene found slow (flat-slow) or one the 3d scene sent here for being slow in the last 30
// days (2dAuto, read as the head script reads it). half size frames follow the screen's pixels, which most phones get,
// so they don't count
export const slowPathFor = ({ flatSlow = false, auto = null } = {}) =>
  Boolean(flatSlow) || autoRecent(auto);

// a set's atlas images, its frames' own and the shared pieces'
const atlasesOf = (manifest) => {
  const atlases = new Set();
  manifest.frames.forEach((frame) => {
    if (frame.atlas) {
      atlases.add(frame.atlas);
    }
  });
  manifest.shared.forEach(({ atlas }) => atlases.add(atlas));
  return [...atlases];
};

// the handoff from 3d fetches the sets the scene would start with (and the desk) once the 3d ladder reaches its last
// step, so they're in the cache, not decoded, if the device turns out too slow. one at a time, at low priority
export const prefetchFlatScene = async () => {
  const {
    set: plain,
    lighting,
    size,
  } = chooseSet({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    hour: new Date().getHours(),
  });
  // start adds the cable when the battery is charging, so a charging device fetches the cable sets
  const set = chargingNow() ? `cable-${plain}` : plain;
  const names = [set, closingSetFor(set)].filter(Boolean);
  const manifests = [];
  for (const name of names) {
    manifests.push(await loadManifest(name, lighting, size));
  }
  await prefetchDesk(manifests[0].desk);
  for (const manifest of manifests) {
    for (const atlas of atlasesOf(manifest)) {
      const response = await fetch(`${manifest.base}${atlas}`, {
        priority: "low",
      });
      await response.blob();
    }
  }
};

// where the phone is now: the state the loop draws, or while the intro's animations still play (between its unlock
// and its end, say), where they have it
export const phoneAt = ({ drawing, pose, fold, lead, intro, placed }) => {
  if (drawing || !intro?.plan) {
    return { pose, fold, lead };
  }
  const ms = Math.min(intro.elapsed(), intro.plan.total);
  return {
    pose: intro.plan.poseAt(ms, placed),
    fold: intro.plan.foldAt(ms),
    lead: intro.plan.lead ? 1 : 0,
  };
};

// the app window's px across its whole width, as the 3d scene's window is laid out (scene/appWindow.js)
const SPLASH_PX = 26;

export const startFlatScene = ({
  stageEl,
  pageEl,
  siteData,
  music,
  links,
  onShown,
  onFailed,
  onPageFlat,
  arrival,
  from,
}) => {
  const root = document.documentElement;
  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const controller = new AbortController();
  const { signal } = controller;
  let failed = false;
  let shown = false;
  let busyNow = false;
  let settleIdle = () => {};
  let flatStatus = null;
  let stopEffects = () => flatStatus?.stop();
  // the frame meter's animation frame chain, which a failure ends too
  let stopMeter = () => {};
  // a turn of the window in progress, { portrait }, while the old orientation has gone and the new one decodes under
  // the black cover, and the deadline it has to be ready by
  let turn = null;
  let stopDeadline = () => {};
  // the black cover a turn decodes under (cover.js)
  const turnCover = createCover(stageEl);
  // the resize listener, from the first mount on (resize.js watchResize)
  let resizing = null;
  // what's mounted and where the phone is. the folds and the apps drive the phone's state, and the loop draws it
  const scene = {
    manifest: null,
    stage: null,
    screens: null,
    desk: null,
    intro: null,
    // the frames for each portrait path, { manifest, layer }, the closing one once it has loaded
    openFrames: null,
    closeFrames: null,
    // the intro's web animations are playing, and the loop draws nothing until it's over or taken over
    moving: true,
    drawing: false,
    unlocked: false,
    phone: "closed",
    // a motion starting holds the drift where it was, so the phone doesn't jump (drift.js)
    get busy() {
      return busyNow;
    },
    set busy(value) {
      if (value && !busyNow) {
        settleIdle();
      }
      busyNow = value;
    },
    zoomed: false,
    pageFlat: false,
    appVisible: false,
    pageFade: null,
    win: null,
    // the home swipe's and the switcher's cards (switcher.js), drawn by cardsView (cards.js), and the switcher, a link's
    // switch, and whether the navigation may swap #page during one
    cards: null,
    cardsView: null,
    switcher: null,
    switching: null,
    swapOpen: false,
    openApp: null,
    openIcon: null,
    openFromWidget: false,
    pose: null,
    fold: 1,
    lead: 0,
    path: "open",
    lastFold: 1,
    portrait: false,
    full: null,
    frosted: false,
    // the rest rule (rest.js): plain glass, still rain, and no drift until a device that starts calm measures fast
    calm: true,
    rain: null,
    // the volume frames for this orientation, { manifest, layer }, or null when they didn't load
    volumeSet: null,
    // the charging cable (charger.js), which holds the folds while it runs
    charger: null,
    // the pose as last drawn, with the drift, the dodge, and the trail on it
    shownPose: null,
    // the slow path (slowPathFor), read once at start
    slow: false,
  };

  const fail = (reason) => {
    if (failed) {
      return;
    }
    failed = true;
    controller.abort();
    loop.stop();
    stopEffects();
    stopDeadline();
    turn = null;
    unmount();
    dropBlack();
    turnCover.remove();
    document.body.classList.remove(
      "closed",
      "looking",
      "over-phone",
      "over-volume",
    );
    root.classList.remove("has-flat-scene", "flat-ready");
    pageEl.getAnimations?.().forEach((animation) => animation.cancel());
    pageEl.classList.remove("hint-home");
    pageEl.removeAttribute("style");
    console.warn("the 2d scene stopped", reason);
    onFailed(reason);
  };

  // every entry point from an event or a navigation fails the scene if it throws, and does nothing once it has
  const guard =
    (fn) =>
    (...args) => {
      if (failed) {
        return undefined;
      }
      try {
        const result = fn(...args);
        if (result && typeof result.then === "function") {
          return result.catch((error) => fail(error));
        }
        return result;
      } catch (error) {
        fail(error);
        return undefined;
      }
    };

  // the visitor's input, the navigation's moves, and the battery reach the scene only while it's mounted, so none of
  // them lands while a turn has the old orientation gone and the new one decoding. the turn shows the address once
  // it's done, and the navigation waits for it (rebuildPending)
  const live = (fn) => guard((...args) => (turn ? undefined : fn(...args)));

  const loop = createLoop({ onError: (error) => fail(error) });
  const drift = createDrift({ scene, loop });
  settleIdle = drift.settle;

  // the black the scene fades in from, over everything in the stage until the first frame shows
  const black = document.createElement("div");
  black.className = "flat-black";
  stageEl.append(black);
  const dropBlack = () => black.remove();
  black.addEventListener("transitionend", dropBlack);

  const appNamed = (name) =>
    siteData.apps.find((app) => app.name === name) || null;

  const setPageFlat = (flat) => {
    if (scene.pageFlat !== flat) {
      scene.pageFlat = flat;
      onPageFlat(flat);
    }
  };

  // the music app shows the player, so it loads once the app opens, but only once the address names the music page,
  // since the player's chunk recovery reloads the address
  const loadPlayer = (app) => {
    if (app.name !== "Music") {
      return;
    }
    const load = () => {
      if (!failed && pageEl.dataset.app === "Music") {
        music.loadPlayer();
      }
    };
    if (location.pathname.startsWith(app.path)) {
      load();
      return;
    }
    document.addEventListener("astro:after-swap", load, {
      once: true,
      signal,
    });
  };

  // the frames now showing: the closing path's in portrait once it has loaded and the fold is on it
  const activeFrames = () =>
    scene.path === "close" && scene.closeFrames
      ? scene.closeFrames
      : scene.openFrames;

  // the phone's outer bounds and its screen's in window px, from the frame showing (scene/fold.js phoneEdges). while
  // the intro still plays, that's where its animations have the phone, not the state the loop last drew
  const edges = () => {
    const now = phoneAt(scene);
    const { manifest, layer } = activeFrames();
    const frame = manifest.frames[layer.frameFor(now.fold, now.lead)];
    const { x, top } = manifest.margin;
    // once the loop draws, that's the pose as drawn, with the dodge's move on it
    const pose = scene.drawing && scene.shownPose ? scene.shownPose : now.pose;
    const bounds = (points) => {
      const shownAt = points.map(([px, py]) =>
        scene.stage.toWindow([px + x, py + top], pose, now.fold),
      );
      const xs = shownAt.map((p) => p[0]);
      const ys = shownAt.map((p) => p[1]);
      return {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
      };
    };
    const { screens, body, flap } = frame.corners;
    if (scene.phone === "open") {
      return {
        outer: bounds([...flap, ...body]),
        inner: bounds([...screens[1], ...screens[2]]),
      };
    }
    return { outer: bounds(body), inner: bounds(screens[0]) };
  };

  // the app window over the open screen, behind #page: its color, rounding, and the icon's letter while it's small.
  // it's laid out at the zoomed window's px (appW by appH) and warped onto its rect through the open screen's corners
  const windowEl = document.createElement("div");
  windowEl.className = "flat-window";
  windowEl.setAttribute("aria-hidden", "true");
  const splashEl = document.createElement("span");
  splashEl.className = "flat-splash";
  windowEl.append(splashEl);
  let windowShown = false;

  const drawWindow = () => {
    const { win, stage, screens } = scene;
    if (!win) {
      if (windowShown) {
        windowShown = false;
        windowEl.style.visibility = "hidden";
      }
      screens.setHomeLook(null);
      return;
    }
    const { fullW, fullH } = scene.full;
    const { appW, appH } = stage.placed;
    const { rect } = win;
    // a window carried as a card shows only the part #page covers, as the 3d cutout closes in on it
    const { hole, w, h } = windowCutout({
      rect,
      appW,
      appH,
      width: stage.geometry.width,
      height: stage.geometry.height,
      crop: win.crop,
    });
    const quad = [
      [hole.x0, hole.y0],
      [hole.x1, hole.y0],
      [hole.x1, hole.y1],
      [hole.x0, hole.y1],
    ].map(([px, py]) => stage.screenPoint([px / fullW, py / fullH]));
    const perScreenPx = appW / Math.max(rect.x1 - rect.x0, 1e-6);
    const look = windowLook(win.look, win.app, scene.openFromWidget);
    Object.assign(windowEl.style, {
      width: `${w}px`,
      height: `${h}px`,
      transform: quadToQuad(
        [
          [0, 0],
          [w, 0],
          [w, h],
          [0, h],
        ],
        quad,
      ),
      borderRadius: `${win.radius * perScreenPx}px`,
      background: look.background,
      opacity: String(look.opacity),
    });
    splashEl.textContent = win.app.glyph;
    splashEl.style.fontSize = `${SPLASH_PX * perScreenPx}px`;
    splashEl.style.opacity = scene.openFromWidget
      ? "0"
      : String(1 - smoothstep(win.look, 0.08, 0.35));
    if (!windowShown) {
      windowShown = true;
      windowEl.style.visibility = "visible";
    }
    screens.setHomeLook(homeLook(win.home, win.icon));
  };

  let shownClip = "";
  const setClip = (clip) => {
    if (clip !== shownClip) {
      shownClip = clip;
      pageEl.style.clipPath = clip;
    }
  };

  // #page as scene/loop.js placePage has it: fading over the phone on the apps' background, the flat page at full
  // zoom, pinned onto the window while it opens or closes (clipped to its rounded cutout), or hidden. it takes pointer
  // input only while an app is open and still
  const drawPage = () => {
    const { stage, win } = scene;
    const live = scene.zoomed && !scene.busy;
    if (scene.pageFade !== null) {
      stage.placePage("fading", { opacity: scene.pageFade, live });
      setClip("");
      return;
    }
    if (scene.pageFlat) {
      stage.placePage("flat", { live });
      setClip("");
      return;
    }
    if (scene.appVisible && win) {
      const { fullW, fullH } = scene.full;
      const box = {
        x0: win.rect.x0 / fullW,
        y0: win.rect.y0 / fullH,
        x1: win.rect.x1 / fullW,
        y1: win.rect.y1 / fullH,
      };
      stage.placePage("pinned", {
        box,
        opacity: pageOpacity(win.look),
        live,
      });
      const { appW, appH } = stage.placed;
      setClip(
        scene.slow
          ? ""
          : pageClip({
              appW,
              appH,
              width: stage.geometry.width,
              height: stage.geometry.height,
              radius: win.radius,
              rectW: win.rect.x1 - win.rect.x0,
              crop: win.crop,
            }),
      );
      return;
    }
    stage.placePage("hidden", { live: false });
    setClip("");
  };

  let placedFace = { layer: null, index: -1 };
  let shownBlur = -1;

  // one frame of the phone: the portrait path, the frame and the wrappers, the screens on that frame, the desk's blur,
  // the window, #page, and which faces take input, all in the same frame
  const draw = (now = performance.now()) => {
    if (!scene.drawing || !scene.stage || failed) {
      return;
    }
    const { stage, screens, desk } = scene;
    if (scene.portrait) {
      const path = pathAfter({
        path: scene.path,
        lastFold: scene.lastFold,
        fold: scene.fold,
      });
      if (path !== scene.path) {
        scene.path = path;
        if (path === "close") {
          scene.lead = 0;
        }
      }
    }
    scene.lastFold = scene.fold;
    // a charger run shows its own set's frames, picked by time, with the phone's move for it on the pose
    const run = charger.shown();
    const frames = run ?? activeFrames();
    stage.useFrames(frames.layer);
    scene.shownPose = charger.move(
      motionPose({
        pose: scene.pose,
        drift: drift.at(now),
        avoid: look.avoid,
        trail: look.trail(),
        focal: stage.geometry.focal,
      }),
      now,
    );
    stage.setPose(scene.shownPose);
    const index = run
      ? run.index
      : frames.layer.frameFor(scene.fold, scene.lead);
    stage.setFold(scene.fold, scene.lead, index);
    if (placedFace.layer !== frames.layer || placedFace.index !== index) {
      placedFace = { layer: frames.layer, index };
      screens.place(frames.manifest.frames[index], frames.manifest);
    }
    // the 3d desk blurs with the open share eased by smoothstep (scene/loop.js)
    const blur = smoothstep(1 - scene.fold, 0, 1);
    if (blur !== shownBlur) {
      shownBlur = blur;
      desk.setBlur(blur);
    }
    desk.setView(look.view.yaw, look.view.pitch);
    // the desk can be dragged while the phone is closed and still (site.css has the cursor)
    const closedNow = scene.phone === "closed" && !scene.busy;
    if (closedNow !== document.body.classList.contains("closed")) {
      document.body.classList.toggle("closed", closedNow);
    }
    drawWindow();
    scene.cardsView.draw(scene.cards);
    drawPage();
    // the open app's icon, which stays the same while the switcher's window carries another app's page
    screens.setHiddenIcon(
      scene.win && !scene.openFromWidget && scene.openApp
        ? scene.openApp.name
        : null,
    );
    const fading = scene.pageFade !== null;
    screens.setInput(
      faceInput({
        fold: scene.fold,
        phone: scene.phone,
        busy: scene.busy,
        appVisible: scene.appVisible,
        pageFlat: scene.pageFlat,
        fading,
      }),
    );
    syncAppFocus({
      covered: scene.appVisible || scene.pageFlat || fading,
      pageFlat: scene.pageFlat,
      app: scene.openApp,
    });
    // on the slow path the screens show their canvas picture while the phone or an app moves (a charger run moves the
    // phone too), drawn from the live screens as the motion starts, and the live html again once it's at rest
    const moving = scene.busy || charger.moving();
    const pictured = scene.slow && moving;
    if (pictured !== shownPicture) {
      shownPicture = pictured;
      if (pictured) {
        screens.picture();
      }
      screens.showPicture(pictured);
    }
    // frosted glass only at rest, and the plain glass while anything moves
    const frosted = scene.frosted && !moving;
    if (frosted !== shownFrosted) {
      shownFrosted = frosted;
      screens.setFrosted(frosted);
    }
  };
  let shownFrosted = false;
  let shownPicture = false;
  // what the draw last wrote, which a new mount's parts don't have yet
  const forgetDrawn = () => {
    placedFace = { layer: null, index: -1 };
    shownBlur = -1;
    shownFrosted = false;
    shownPicture = false;
    shownClip = "";
    windowShown = false;
    windowEl.style.visibility = "hidden";
  };
  const syncAppFocus = createAppFocus({
    pageEl,
    iconOf: (name) => scene.screens.iconButton(name),
  });
  loop.onDraw(draw);

  // the intro still playing its last stretch stops where it is, and the loop draws from there, in the same task so no
  // frame shows between them
  const takeOver = () => {
    const { intro } = scene;
    if (!intro || scene.drawing) {
      return;
    }
    Object.assign(scene, phoneAt(scene));
    scene.lastFold = scene.fold;
    intro.cancel();
    afterIntro();
  };

  const applyInput = () => {
    if (!scene.screens) {
      return;
    }
    scene.screens.setInput(
      faceInput({
        fold: scene.unlocked ? 0 : 1,
        phone: scene.phone,
        busy: scene.moving,
        appVisible: false,
        pageFlat: scene.pageFlat,
      }),
    );
  };

  // the rest rule's state: frosted glass at rest, rain moving, and the drift (which reads scene.calm itself) all follow
  // scene.calm and reduced motion. a change wakes the loop, so the drift starts or stops on the next frame. a fast
  // verdict can land before the unfold ends, so the rain also waits for the loop to draw, as the frosted glass does
  const applyRest = () => {
    scene.frosted = !scene.calm;
    scene.rain?.setStill(scene.calm || reducedQuery.matches || !scene.drawing);
    loop.wake();
  };

  // the intro is over (ended, or taken over by a motion), so the loop draws from here on
  const afterIntro = () => {
    if (scene.drawing) {
      return;
    }
    scene.drawing = true;
    scene.moving = false;
    applyRest();
    prefetchLater();
    // the charger's sets load once the intro is over, so their decode can't stall the unfold
    if (flatStatus) {
      charger.battery(flatStatus.status);
    }
    draw();
  };

  // the phone reads as not there yet while a turn mounts it again, as before the intro's unlock
  const status = () => ({
    phone: scene.unlocked && !turn ? scene.phone : null,
    turning: turn !== null,
    busy: scene.busy,
    zoomed: scene.zoomed,
    app: scene.zoomed && scene.openApp ? scene.openApp.name : null,
    shown: scene.appVisible || scene.pageFlat || scene.pageFade !== null,
    ...switcher.status(),
    fold: scene.fold,
  });

  const navScene = {
    status,
    hasApp: (name) => Boolean(appNamed(name)),
    // with the phone closed, an app opens the phone first
    openApp: live((name, opts) => {
      const app = appNamed(name);
      if (!app) {
        return Promise.resolve();
      }
      return scene.phone === "closed"
        ? apps.openFromCover(app, opts)
        : apps.openApp(app, opts);
    }),
    closeApp: live(() => apps.closeApp()),
    fadeTo: live((name) => {
      const app = appNamed(name);
      return app ? apps.fadeTo(app) : Promise.resolve();
    }),
    // another app's page on its way while one is open. swapped settles once the page has swapped in (null if the
    // navigation was dropped)
    switchTo: live((name, opts) => {
      const app = appNamed(name);
      return app ? switcher.switchTo(app, opts) : Promise.resolve();
    }),
    // a navigation the switcher didn't start puts the open app back at once, so it isn't held up
    leaveSwitcher: live(() => switcher.leave()),
    showUrl: live(() => {
      switcher.dropHomeSwipe();
      return apps.showUrl(appForPage());
    }),
    // a resize waiting to rebuild, or a turn mounting, sets the phone itself, so a navigation meanwhile jumps
    rebuildPending: () => Boolean(resizing?.pending()) || turn !== null,
    fail: (error) => fail(error),
    failed: () => failed || root.classList.contains("scene-failed"),
  };
  const nav = createNavigation(navScene, links ?? null);

  // the app for the page: the one a navigation in flight is going to once its page is known, or else the one #page's
  // data-app names. null on the home screen
  const appForPage = () => appNamed(nav.pendingPage() ?? pageEl.dataset.app);

  // a point in the window to the open screen's px, through the screen's corners as the loop last drew them
  // (scene/appWindow.js toScreenPx)
  const toScreenPx = (clientX, clientY) => {
    const { stage, full } = scene;
    const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].map((p) => stage.toWindow(stage.screenPoint(p)));
    const m = homography(corners, [
      [0, 0],
      [full.fullW, 0],
      [full.fullW, full.fullH],
      [0, full.fullH],
    ]);
    const [x, y] = mapPoint(m, [clientX, clientY]);
    return { x, y };
  };

  Object.assign(scene, {
    toScreenPx,
    reduced: () => reducedQuery.matches,
    slowPath: () => scene.slow,
    takeOver,
    edges,
    dragScale: () => scene.stage.scaleAt(scene.stage.placed.rest, 0),
    iconRect: (name) => scene.screens.iconRect(name),
    setPageFlat,
    loadPlayer,
    wake: () => loop.wake(),
  });
  // read when a motion starts, from the set and the window of the moment
  Object.defineProperties(scene, {
    placed: { get: () => scene.stage.placed },
    // #page's layout size, which is the window's at mount
    pageSize: {
      get: () => ({
        w: scene.stage.geometry.width,
        h: scene.stage.geometry.height,
      }),
    },
    drag: { get: () => activeFrames().manifest.dragTable },
  });
  const folds = createFolds({ scene, loop });
  const look = createLook({ scene, loop, folds });
  scene.lookAhead = look.lookAhead;
  const volume = createVolume({ scene, loop, music });
  scene.volume = volume;
  // the charger's sets and the cable's fold sets, in the lighting and size mounted. they're fetched ahead as blobs once
  // the battery wants the cable, so a swap during a run only decodes, and their layers join and leave the stage
  const charger = createCharger({
    scene,
    loop,
    sets: {
      // the mount's signal, so a remount (a turn) stops the old orientation's downloads, and so does a failure
      fetch: async (name, mountSignal) => {
        const { lighting, size } = scene.manifest;
        const manifest = await loadManifest(name, lighting, size, {
          signal: mountSignal,
        });
        const atlasUrls = {};
        const forget = () =>
          Object.values(atlasUrls).forEach((url) => URL.revokeObjectURL(url));
        // every image settles before a failure is given, so none makes a url after the rest were let go
        const results = await Promise.allSettled(
          atlasesOf(manifest).map(async (atlas) => {
            const response = await fetch(`${manifest.base}${atlas}`, {
              signal: mountSignal,
            });
            if (!response.ok) {
              throw new Error(
                `the ${name} image ${atlas} didn't load (${response.status})`,
              );
            }
            atlasUrls[atlas] = URL.createObjectURL(await response.blob());
          }),
        );
        const failure = results.find((r) => r.status === "rejected");
        if (failure) {
          forget();
          throw failure.reason;
        }
        return { manifest: { ...manifest, atlasUrls }, forget };
      },
      forget: (bytes) => bytes.forget(),
      open: async (name, bytes) => {
        const { lighting, size } = scene.manifest;
        const manifest = bytes
          ? bytes.manifest
          : await loadManifest(name, lighting, size);
        return { manifest, layer: scene.stage.addFrames(manifest) };
      },
      release: (entry) => scene.stage?.dropFrames(entry.layer),
    },
    onCable: guard(() => flatStatus?.render()),
    // the phone left with no fold sets drops the visit to the plain flat page
    onStuck: (error) => fail(error),
  });
  scene.charger = charger;
  scene.effects = { look, drift };
  const apps = createApps({ scene, loop, folds, nav, pageEl });
  const kept = createKept();
  // the switcher's code (switcher.js) loads after the first frame, since nothing reaches it until an app is open, which
  // keeps it out of the first download. until it's there, the scene's own state answers for it, a switch waits for it,
  // and there's no swipe or switcher to drop. a load that fails is tried again by the next switch
  let switcherReal = null;
  let switcherInstall = null;
  let switcherLoad = null;
  const loadSwitcher = () => {
    switcherLoad ??= import("./switcher.js").then(
      ({ createSwitcher }) => {
        switcherReal = createSwitcher({
          scene,
          loop,
          apps,
          nav,
          pageEl,
          kept,
          siteApps: siteData.apps,
        });
        if (switcherInstall) {
          switcherReal.install(switcherInstall);
        }
        return switcherReal;
      },
      (error) => {
        switcherLoad = null;
        throw error;
      },
    );
    return switcherLoad;
  };
  const switcher = {
    status: () => ({
      switchingTo: scene.switching ? scene.switching.to : null,
      switcher: Boolean(scene.switcher),
      swapOpen: scene.swapOpen,
    }),
    switchTo: (app, opts) =>
      loadSwitcher().then((real) => real.switchTo(app, opts)),
    leave: () => switcherReal?.leave(),
    dropHomeSwipe: () => switcherReal?.dropHomeSwipe(),
    install: (options) => {
      switcherInstall = options;
      switcherReal?.install(options);
    },
  };

  // a tap on an icon or a widget, or on the cover's icons
  const onOpen = live(({ app, face, el, path }) => {
    if (!app) {
      return undefined;
    }
    if (face === "cover") {
      return apps.tapFromCover(app);
    }
    const widget = el.classList.contains("widget");
    return apps.tapApp(app, {
      from: widget ? scene.screens.rectOf(el) : null,
      path,
    });
  });

  const unmount = () => {
    scene.intro?.cancel();
    // the stage lets the charger's sets go with the rest, so a run or a swap in flight ends here
    scene.charger?.mounted({ plugged: false });
    scene.volume?.reset();
    scene.cardsView?.destroy();
    scene.rain?.destroy();
    scene.screens?.destroy();
    scene.desk?.destroy();
    scene.stage?.destroy();
    windowEl.remove();
    Object.assign(scene, {
      manifest: null,
      stage: null,
      screens: null,
      desk: null,
      intro: null,
      openFrames: null,
      closeFrames: null,
      volumeSet: null,
      cardsView: null,
      cards: null,
      rain: null,
    });
    forgetDrawn();
  };

  // a mount started after another owns the scene, so the earlier one stops wherever it is (a turn and then another)
  let mountRun = 0;

  // the set's frames and the desk decode before any of it joins the page. portrait's opening set comes with its
  // closing one, since the hands take the closing path for every close, and both load up front so a close never plays
  // on the opening grip and no set lands partway through a fold
  const mount = async ({ set, lighting, size }) => {
    const run = ++mountRun;
    unmount();
    const closingSet = closingSetFor(set);
    const [manifest, closing, volumeManifest] = await Promise.all([
      loadManifest(set, lighting, size, { signal }),
      closingSet ? loadManifest(closingSet, lighting, size, { signal }) : null,
      // the buttons are a few KB and can be left out, as 3d leaves them out when their chunk won't load
      loadManifest(volumeSetFor(!set.endsWith("landscape")), lighting, size, {
        signal,
      }).catch((error) => {
        console.warn("the volume buttons didn't load", error);
        return null;
      }),
    ]);
    if (failed) {
      throw new Error("the 2d scene stopped while loading");
    }
    if (run !== mountRun) {
      throw new Error("another mount took over");
    }
    const portrait = manifest.orientation === "portrait";
    const stage = createStage({ stageEl, pageEl, manifest });
    const closeLayer = closing ? stage.addFrames(closing) : null;
    const screens = createScreens({
      host: stage.layers.screens,
      siteData,
      music,
      portrait,
      onOpen,
      onPing: live(() => flatStatus?.showPing()),
    });
    const rain = createRain({ skies: screens.skies });
    rain.setStill(scene.calm || reducedQuery.matches);
    stage.layers.screens.append(windowEl);
    const desk = createDesk({ host: stageEl, manifest });
    const l = screenLayout(portrait);
    const full = { fullW: l.fullW, fullH: l.fullH, radius: l.radius };
    const cardsView = createCards({
      stage,
      full,
      screensHost: stage.layers.screens,
      cardsHost: stage.layers.cards,
      kept,
      slow: () => scene.slow,
    });
    Object.assign(scene, {
      manifest,
      stage,
      screens,
      desk,
      rain,
      portrait,
      openFrames: { manifest, layer: stage.frameLayer },
      closeFrames: closing ? { manifest: closing, layer: closeLayer } : null,
      full,
      cardsView,
      pose: { ...stage.placed.rest },
    });
    charger.mounted({ plugged: set.startsWith("cable-") });
    const volumeLayer = volumeManifest ? stage.addFrames(volumeManifest) : null;
    await Promise.all([
      stage.frameLayer.decode(),
      closeLayer?.decode(),
      desk.decode(),
      volumeLayer?.decode().then(
        () => {
          scene.volumeSet = { manifest: volumeManifest, layer: volumeLayer };
        },
        (error) => console.warn("the volume buttons didn't decode", error),
      ),
    ]);
    return manifest;
  };

  // the music player waits while the phone moves (or turns) before it loads under has-flat-scene
  music.waitWhile(() => scene.moving || scene.busy || turn !== null);

  // the lighting and size chosen at the start, which hold for the page load (a turn keeps them)
  let chosen = null;

  // the other orientation's frames are fetched once the page has settled, so a turn finds them in the browser's cache.
  // they're only fetched, not decoded, and one that fails never touches the working scene (the turn fails instead)
  const PREFETCH_AFTER_MS = 3000;
  let prefetching = false;
  const prefetchOther = async () => {
    if (failed || turn || !scene.manifest) {
      return;
    }
    const portrait = !scene.portrait;
    const open = turnSetFor({
      portrait,
      charging: Boolean(flatStatus?.status.charging),
    });
    const names = [open, closingSetFor(open), volumeSetFor(portrait)].filter(
      Boolean,
    );
    const { lighting, size } = chosen;
    try {
      for (const name of names) {
        const manifest = await loadManifest(name, lighting, size, { signal });
        for (const atlas of atlasesOf(manifest)) {
          const response = await fetch(`${manifest.base}${atlas}`, {
            signal,
            priority: "low",
          });
          await response.blob();
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        console.warn("the other orientation's frames didn't load ahead", error);
      }
    }
  };
  const prefetchLater = () => {
    if (prefetching) {
      return;
    }
    prefetching = true;
    setTimeout(guard(prefetchOther), PREFETCH_AFTER_MS);
  };

  const showFirstFrame = () => {
    shown = true;
    root.classList.add("flat-ready");
    Object.assign(window, { __flatShown: true });
    onShown();
    // a failed load here is left for the next switch to try again
    loadSwitcher().catch(() => {});
    // in case the fade never ran (a hidden tab), the sheet goes once it would have ended
    setTimeout(dropBlack, 700);
  };

  const start = async () => {
    // the status bar first, since a visit that starts while the battery charges mounts the sets with the cable in
    flatStatus = createFlatStatus({
      screens: () => scene.screens,
      onChange: live((status) => charger.battery(status)),
      bolt: (status) => charger.bolt(status),
    });
    const choice = chooseSet({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      hour: new Date().getHours(),
    });
    if (flatStatus.status.charging) {
      choice.set = `cable-${choice.set}`;
    }
    chosen = { lighting: choice.lighting, size: choice.size };
    await mount(choice);
    flatStatus.render();
    // a scene that finished loading after its watchdog fired stops, and lets its images go
    if (failed || root.classList.contains("scene-failed")) {
      fail("watchdog");
      return;
    }
    scene.slow = slowPathFor({
      flatSlow: root.classList.contains("flat-slow"),
      auto: read("local", "2dAuto"),
    });
    // the rest rule. every device starts calm (scene.calm is true). one through 2dAuto stays that way,
    // and any other turns things on once the frame meter has seen the intro's unfold mostly under 20 ms per frame, or
    // with no intro, the first unfold of the phone
    const meter = createMeter();
    const foldMeter = createFoldMeter();
    // whether the meter has judged, and what it said (null for a device that stays calm), for the probe hook
    const rest = {
      judged: staysCalm({ auto: read("local", "2dAuto") }),
      verdict: null,
    };
    scene.rest = rest;
    const judge = (verdict) => {
      if (rest.judged || verdict === null) {
        return;
      }
      rest.judged = true;
      rest.verdict = verdict;
      if (verdict === "fast") {
        scene.calm = false;
        applyRest();
      }
    };
    // with no intro unfold to measure (a page arrival, or an intro too short to give frames), the first animated
    // opening fold is measured, and reduced motion never gives one
    loop.onDraw((now, dt) => {
      if (!rest.judged && scene.drawing) {
        judge(foldMeter.frame({ fold: scene.fold, dt }));
      }
    });
    reducedQuery.addEventListener("change", guard(applyRest), { signal });
    const home = createHome({
      screens: () => scene.screens,
      rain: () => scene.rain,
      signal,
      guard,
    });
    stopEffects = () => {
      look.stop();
      flatStatus?.stop();
      stopMeter();
    };
    home.start();
    loop.onDraw(guard(volume.draw));
    // before the folds' and the look's, so a press on a button reaches neither
    volume.install({ signal, guard: live });
    folds.install({
      signal,
      guard: live,
      onEscapeApp: () => apps.goHome(),
    });
    apps.install({ signal, guard: live });
    switcher.install({ signal, guard: live });
    look.install({ signal, guard: live });

    // the last step for a device still too slow (meter.js): frames are measured while anything moves, the intro's from
    // its own animation frames and every later motion's from the loop's, and a slow verdict drops the visit to the
    // plain flat page once the phone is at rest, saving flatAuto. the capture build's tests that throttle the cpu on
    // purpose can keep it off
    const slowMeter = createSlowMeter();
    const keepOnSlow =
      __CAPTURE__ && Boolean(Reflect.get(window, "__flatNoSlowStep"));
    let tooSlow = false;
    const atRest = () =>
      scene.drawing &&
      scene.unlocked &&
      !turn &&
      !scene.busy &&
      !charger.busy() &&
      !charger.moving() &&
      !scene.switcher &&
      !scene.switching &&
      scene.pageFade === null &&
      !folds.gesture() &&
      !look.dragging();
    const dropWhenStill = () => {
      const remove = loop.add(() => {
        if (!atRest()) {
          return;
        }
        remove();
        write("local", "flatAuto", String(Date.now()));
        // the plain flat page's footer shows the 2d link at once, as the head script shows it from the next load
        root.classList.add("flat-slow");
        fail("too slow for the 2d scene");
      }, 10);
    };
    const noteFrame = (now, moving, fresh = false) => {
      if (tooSlow || failed) {
        return;
      }
      if (slowMeter.frame({ now, moving, fresh }) === "slow" && !keepOnSlow) {
        tooSlow = true;
        dropWhenStill();
      }
    };
    if (__CAPTURE__) {
      scene.slowStep = () => ({
        measured: slowMeter.measured(),
        ...slowMeter.counted(),
        verdict: slowMeter.verdict(),
        atRest: atRest(),
      });
    }
    // the loop's first frame after it slept has no gap, so a motion's clock starts on it
    loop.onDraw((now, dt) => {
      if (scene.drawing) {
        noteFrame(now, !turn && (scene.busy || charger.moving()), dt === 0);
      }
    });
    // a hidden tab runs no frames, so the gap across it isn't one
    document.addEventListener("visibilitychange", () => slowMeter.pause(), {
      signal,
    });
    const watchIntro = () => {
      const tick = (now) => {
        if (failed || scene.drawing) {
          return;
        }
        noteFrame(now, true);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    // a resize or a turn shows the page the address names in the new size or orientation, as 3d's rebuild does: that
    // app zoomed, or the home screen with the phone open, with any drag dropped. an intro still playing ends there
    const dropHeld = () => {
      folds.dropGesture();
      switcher.dropHomeSwipe();
      look.dropDrag();
    };
    const showFromAddress = () => {
      dropHeld();
      takeOver();
      if (!scene.unlocked) {
        scene.unlocked = true;
        applyInput();
      }
      scene.lookAhead();
      const shownNow = apps.showUrl(appForPage());
      nav.kick();
      return shownNow;
    };
    // the old orientation's images go before the new one's decode, so only one orientation is ever decoded. the black
    // cover hides the phone meanwhile, and a turn that isn't ready in TURN_DEADLINE_MS of visible time drops the visit
    const turnTo = async (portrait) => {
      const run = { portrait };
      turn = run;
      turnCover.up();
      dropHeld();
      takeOver();
      scene.unlocked = true;
      loop.cancelAll();
      stopDeadline();
      stopDeadline = visibleDeadline(TURN_DEADLINE_MS, () =>
        fail(new Error("the turned window's frames weren't ready in time")),
      );
      try {
        await mount({
          set: turnSetFor({ portrait, charging: flatStatus.status.charging }),
          ...chosen,
        });
      } catch (error) {
        // a later turn took over, and its mount let this one's images go
        if (turn !== run || failed) {
          return;
        }
        throw error;
      }
      if (turn !== run || failed) {
        return;
      }
      stopDeadline();
      stopDeadline = () => {};
      turn = null;
      // the window may have changed size again while the frames decoded
      scene.stage.fit();
      scene.desk.fit();
      flatStatus.render();
      home.restore();
      applyRest();
      charger.battery(flatStatus.status);
      await showFromAddress();
      await nextFrame();
      if (failed || turn) {
        return;
      }
      await nextFrame();
      if (!failed && !turn) {
        turnCover.lift();
      }
    };
    const rebuild = () => {
      // the first frame comes a few frames after the mount, and a resize before it waits for it
      if (!shown) {
        resizing.again();
        return undefined;
      }
      const portrait = portraitFor({ width: innerWidth, height: innerHeight });
      if (turn) {
        return portrait === turn.portrait ? undefined : turnTo(portrait);
      }
      if (
        resizeKind({
          portrait: scene.portrait,
          width: innerWidth,
          height: innerHeight,
        }) === "turn"
      ) {
        return turnTo(portrait);
      }
      scene.stage.fit();
      scene.desk.fit();
      return showFromAddress();
    };
    resizing = watchResize(guard(rebuild), { signal });
    // a window resized or turned while the first sets loaded wasn't heard, so the stage fitted at the mount is checked
    // against it now
    const { width, height } = scene.stage.geometry;
    if (width !== innerWidth || height !== innerHeight) {
      resizing.again();
    }
    const seen = read("local", "introSeen") === "1";
    const kind = arrivalKind({
      arrival,
      from,
      reduced: reducedQuery.matches,
      hasApp: Boolean(appForPage()),
      seen,
    });
    const intro = playIntro(kind, scene);
    scene.intro = intro;
    if (!intro.plan) {
      // a page arrival, or reduced motion: the phone open at once, on the address's app or the home screen
      scene.unlocked = true;
      scene.fold = 0;
      scene.lastFold = 0;
      afterIntro();
      await apps.showUrl(appForPage());
      if (scene.pageFlat) {
        dropBlack();
      }
    } else {
      scene.stage.placePage("hidden");
      applyInput();
    }
    // the first frame is painted once under black, so laying out every frame doesn't eat into the intro's time
    await nextFrame();
    await nextFrame();
    await nextFrame();
    if (failed) {
      return;
    }
    // the fade and the intro start on the same frame
    showFirstFrame();
    if (!intro.plan) {
      return;
    }
    intro.start();
    watchIntro();
    if (!rest.judged) {
      // only the frames while the phone unfolds count, and the verdict comes when the unfold ends
      const foldNow = () =>
        intro.plan.foldAt(Math.min(intro.elapsed(), intro.plan.total));
      let sawUnfold = false;
      stopMeter = watchFrames(meter, {
        take: () => {
          const fold = foldNow();
          sawUnfold ||= fold > 0 && fold < 1;
          return fold > 0 && fold < 1;
        },
        done: () => sawUnfold && foldNow() <= 0,
        onDone: guard(() => judge(meter.verdict())),
      });
      // an intro cut short has no more to measure, so what it gave is judged, and with too few frames the first opening fold after it is measured
      intro.finished.then(
        guard(() => {
          stopMeter();
          judge(meter.verdict());
        }),
      );
    }
    intro.unlocked.then(
      guard(() => {
        if (scene.intro !== intro || scene.unlocked) {
          return;
        }
        // written once the unfold reads as open, so a first visit cut off partway still gets the full intro next time
        write("local", "introSeen", "1");
        scene.phone = "open";
        scene.unlocked = true;
        applyInput();
        // the address's app opens now, taking over the last of the unfold, as the 3d intro does at its unlock
        nav.kick();
      }),
    );
    const result = await intro.finished;
    if (failed || scene.intro !== intro || result === "cancelled") {
      return;
    }
    scene.pose = { ...scene.stage.placed.rest };
    scene.fold = 0;
    scene.lastFold = 0;
    afterIntro();
    nav.kick();
  };

  const started = start();
  started.catch((error) => fail(error));

  // the speed probes' hook (probeHook.js), which the build that ships leaves out. it reads this scene's own parts, and
  // mounts another set only when a probe asks for one
  if (__CAPTURE__) {
    const probe = {
      scene,
      status,
      // the battery's test control (scene/status.js setBattery), ms into its cycle
      battery: (at, speed) => flatStatus?.bar.setBattery(at, speed),
      rebuildPending: () => Boolean(resizing?.pending()) || turn !== null,
      mount: async ({ set, lighting, size } = {}) => {
        await started;
        scene.intro?.finish();
        const now = scene.manifest;
        const want = {
          set: set ?? now.set,
          lighting: lighting ?? now.lighting,
          size: size ?? now.size,
        };
        if (
          want.set !== now.set ||
          want.lighting !== now.lighting ||
          want.size !== now.size
        ) {
          await mount(want);
        }
        const { stage, screens, manifest } = scene;
        stage.setFold(0);
        stage.setPose(stage.placed.rest);
        screens.place(manifest.frames[stage.frameLayer.frameFor(0)], manifest);
        scene.desk.setBlur(1);
        return manifest;
      },
      unmount,
    };
    import("./probeHook.js").then(({ installFlatHook }) =>
      installFlatHook(probe),
    );
  }

  return { fail, status, navigation: nav.handler };
};
