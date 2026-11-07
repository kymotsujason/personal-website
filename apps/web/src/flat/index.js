// the 2d scene, shown under html.has-flat-scene: captured frames of the hands and phone, the live home and cover
// screens warped onto them, and the desk behind, played from the address the way the 3d scene arrives (intro.js).
// from (the 3d scene's handoff) isn't read yet
import { read, write } from "../lib/storage.js";
import { createDesk } from "./desk.js";
import { chooseLighting, phoneHeightPx, sizeFor } from "./frames.js";
import { arrivalKind, playIntro } from "./intro.js";
import { loadManifest } from "./manifest.js";
import { createScreens, faceInput } from "./screens.js";
import { createStage } from "./stage.js";

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));

// the set, lighting, and size, chosen once per page load: the orientation's opening set (the intro and an arrival
// both end on the open phone), the lighting for the visitor's hour, and the size for how many device px the open
// phone covers
export const chooseSet = ({ width, height, dpr, hour }) => {
  const portrait = height > width;
  return {
    set: portrait ? "portrait-open" : "landscape",
    lighting: chooseLighting(hour),
    size: sizeFor({
      phonePx: phoneHeightPx({ width, height, portrait }) * dpr,
    }),
  };
};

export const startFlatScene = ({
  stageEl,
  pageEl,
  siteData,
  music,
  onShown,
  onFailed,
  onPageFlat,
  arrival,
  from,
}) => {
  const root = document.documentElement;
  let failed = false;
  let shown = false;
  // what's mounted and where the phone is. later steps (folds, apps, the loop) read and drive these
  const scene = {
    manifest: null,
    stage: null,
    screens: null,
    desk: null,
    intro: null,
    phone: "closed",
    moving: true,
    unlocked: false,
    pageFlat: false,
  };

  // the black the scene fades in from, over everything in the stage until the first frame shows
  const black = document.createElement("div");
  black.className = "flat-black";
  stageEl.append(black);
  const dropBlack = () => black.remove();
  black.addEventListener("transitionend", dropBlack);

  const appForPage = () =>
    siteData.apps.find((app) => app.name === pageEl.dataset.app) || null;

  // the scene opens the music app's player itself, the way the 3d scene does when the app opens
  const loadMusicPage = () => {
    if (!failed && pageEl.dataset.app === "Music") {
      music.loadPlayer();
    }
  };

  const setPageFlat = (flat) => {
    if (scene.pageFlat !== flat) {
      scene.pageFlat = flat;
      onPageFlat(flat);
    }
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

  // the page the address names over the open phone: an app's page as the flat page at full zoom, or the home screen.
  // until the app window can open one (it grows from its icon in 3d), an app's page shows flat at once
  const showAddress = () => {
    const { stage } = scene;
    if (appForPage()) {
      stage.setPose(stage.placed.zoom);
      stage.placePage("flat");
      setPageFlat(true);
      loadMusicPage();
    } else {
      stage.setPose(stage.placed.rest);
      stage.placePage("hidden");
      setPageFlat(false);
    }
    applyInput();
  };

  const unmount = () => {
    scene.intro?.cancel();
    scene.screens?.destroy();
    scene.desk?.destroy();
    scene.stage?.destroy();
    Object.assign(scene, {
      manifest: null,
      stage: null,
      screens: null,
      desk: null,
      intro: null,
    });
  };

  // the set's frames and the desk decode before any of it joins the page
  const mount = async ({ set, lighting, size }) => {
    unmount();
    const manifest = await loadManifest(set, lighting, size);
    if (failed) {
      throw new Error("the 2d scene stopped while loading");
    }
    const stage = createStage({ stageEl, pageEl, manifest });
    const screens = createScreens({
      host: stage.layers.screens,
      siteData,
      music,
      portrait: manifest.orientation === "portrait",
    });
    const desk = createDesk({ host: stageEl, manifest });
    Object.assign(scene, { manifest, stage, screens, desk });
    await Promise.all([stage.frameLayer.decode(), desk.decode()]);
    return manifest;
  };

  const fail = (reason) => {
    if (failed) {
      return;
    }
    failed = true;
    unmount();
    dropBlack();
    root.classList.remove("has-flat-scene", "flat-ready");
    pageEl.removeAttribute("style");
    console.warn("the 2d scene stopped", reason);
    onFailed(reason);
  };

  // the music player waits while the phone moves before it loads under has-flat-scene
  music.waitWhile(() => scene.moving);

  const showFirstFrame = () => {
    shown = true;
    root.classList.add("flat-ready");
    Object.assign(window, { __flatShown: true });
    onShown();
    // in case the fade never ran (a hidden tab), the sheet goes once it would have ended
    setTimeout(dropBlack, 700);
  };

  const start = async () => {
    const choice = chooseSet({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      hour: new Date().getHours(),
    });
    await mount(choice);
    // a scene that finished loading after its watchdog fired stops, and lets its images go
    if (failed || root.classList.contains("scene-failed")) {
      fail("watchdog");
      return;
    }
    const seen = read("local", "introSeen") === "1";
    const kind = arrivalKind({
      arrival,
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      hasApp: Boolean(appForPage()),
      seen,
    });
    const intro = playIntro(kind, scene);
    scene.intro = intro;
    if (!intro.plan) {
      scene.phone = "open";
      scene.moving = false;
      scene.unlocked = true;
      showAddress();
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
    intro.start();
    intro.unlocked.then(() => {
      if (failed || scene.intro !== intro) {
        return;
      }
      // written once the unfold reads as open, so a first visit cut off partway still gets the full intro next time
      if (intro.plan) {
        write("local", "introSeen", "1");
      }
      scene.phone = "open";
      scene.unlocked = true;
      applyInput();
    });
    const result = await intro.finished;
    if (failed || scene.intro !== intro || result === "cancelled") {
      return;
    }
    scene.moving = false;
    scene.screens.setFrosted(scene.manifest.size === "full");
    showAddress();
  };

  const started = start();
  started.catch((error) => fail(error));

  // the speed probes' hook (probeHook.js), which the build that ships leaves out. it reads this scene's own parts, and
  // mounts another set only when a probe asks for one
  if (__CAPTURE__) {
    const probe = {
      scene,
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

  const navigation = async ({ swapped }) => {
    swapped.then((done) => {
      if (done && shown && !failed && scene.stage && !scene.moving) {
        showAddress();
      }
    });
  };

  const status = () => ({
    phone: scene.phone,
    busy: scene.moving,
    zoomed: scene.pageFlat,
    app: scene.pageFlat ? (appForPage()?.name ?? null) : null,
    shown,
    switchingTo: null,
    switcher: false,
    swapOpen: false,
  });

  return { fail, status, navigation };
};
