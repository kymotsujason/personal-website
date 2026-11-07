import { expect, test } from "vitest";
import {
  APP_BACKGROUND,
  CLOSE_DELAY_MS,
  CLOSE_MS,
  CROSSFADE_MS,
  OPEN_WINDOW_MS,
  REST_RETURN_MS,
  ZOOM_MS,
  ease,
  springOut,
} from "../scene/shared/motion.js";
import { place, screenLayout } from "../scene/shared/placement.js";
import {
  createAppFocus,
  createApps,
  lerpPose,
  mixColor,
  pageClip,
  windowCutout,
  windowLook,
} from "./apps.js";
import { handLoop } from "./handLoop.js";

const ABOUT = { name: "About", path: "/about", glyph: "A", color: "#3d405b" };

const fakeScene = ({ reduced = false } = {}) => {
  const placed = place({ width: 1280, height: 800, portrait: false });
  const l = screenLayout(false);
  const scene = {
    pose: { ...placed.rest },
    fold: 0,
    lead: 0,
    phone: "open",
    busy: false,
    zoomed: false,
    appVisible: false,
    pageFlat: false,
    pageFade: null,
    win: null,
    placed,
    full: { fullW: l.fullW, fullH: l.fullH, radius: l.radius },
    reduced: () => reduced,
    slowPath: () => false,
    iconRect: () => ({ x0: 100, y0: 200, x1: 160, y1: 260, radius: 14 }),
    takeOver: () => {},
    loadPlayer: () => {},
    wake: () => {},
    setPageFlat: (flat) => {
      scene.pageFlat = flat;
    },
  };
  return scene;
};

const pageEl = { classList: { add: () => {}, remove: () => {} } };
const nav = { requestApp: () => false, requestHome: () => false };

test("an open grows the window on springOut while the phone zooms on outCubic", async () => {
  const scene = fakeScene();
  const { loop, at } = handLoop();
  const apps = createApps({ scene, loop, folds: {}, nav, pageEl });
  const { rest, zoom } = scene.placed;
  const opening = apps.openApp(ABOUT);
  expect(scene.appVisible).toBe(true);
  expect(scene.win.look).toBe(0);
  await at(260);
  expect(scene.win.look).toBeCloseTo(springOut(260 / OPEN_WINDOW_MS), 12);
  const z = lerpPose(rest, zoom, ease.outCubic(260 / ZOOM_MS));
  expect(scene.pose.z).toBeCloseTo(z.z, 9);
  await at(ZOOM_MS);
  expect(await opening).toBeUndefined();
  expect(scene.zoomed).toBe(true);
  expect(scene.busy).toBe(false);
  expect(scene.pageFlat).toBe(true);
  expect(scene.pose).toEqual(zoom);

  // closing waits CLOSE_DELAY_MS, shrinks into the icon, and the phone goes back to rest
  await at(1000);
  const closing = apps.closeApp();
  expect(scene.pageFlat).toBe(false);
  await at(1000 + CLOSE_DELAY_MS + CLOSE_MS / 2);
  expect(scene.win.look).toBeCloseTo(1 - ease.inOutCubic(0.5), 12);
  await at(1000 + REST_RETURN_MS);
  await closing;
  expect(scene.win).toBe(null);
  expect(scene.zoomed).toBe(false);
  expect(scene.pose).toEqual(rest);
});

test("reduced motion crossfades the page in and out", async () => {
  const scene = fakeScene({ reduced: true });
  const { loop, at } = handLoop();
  const apps = createApps({ scene, loop, folds: {}, nav, pageEl });
  const opening = apps.openApp(ABOUT);
  expect(scene.pageFade).toBe(0);
  expect(scene.appVisible).toBe(false);
  await at(CROSSFADE_MS / 2);
  expect(scene.pageFade).toBeCloseTo(0.5, 12);
  await at(CROSSFADE_MS);
  await opening;
  expect(scene.pageFade).toBe(null);
  expect(scene.zoomed).toBe(true);
  expect(scene.pose).toEqual(scene.placed.zoom);
});

test("the window's look and #page's clip follow the 3d window", () => {
  expect(windowLook(0, ABOUT, false)).toEqual({
    background: "#3d405b",
    opacity: 1,
  });
  expect(windowLook(1, ABOUT, false).background).toBe(APP_BACKGROUND);
  // three mixes in linear light, so halfway is brighter than the plain average
  expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#bcbcbc");
  expect(windowLook(0, ABOUT, true).opacity).toBe(0);
  expect(
    pageClip({
      appW: 1400,
      appH: 800,
      width: 1280,
      height: 800,
      radius: 20,
      rectW: 700,
    }),
  ).toBe("inset(0px -60px 0px -60px round 40px)");
});

test("a window carried as a card closes its cutout in on #page", () => {
  const sizes = { appW: 1200, appH: 900, width: 1280, height: 720 };
  // closed in all the way, #page's own box clips #page, and the window shows only that box, centered as #page is
  expect(pageClip({ ...sizes, radius: 20, rectW: 600, crop: 1 })).toBe(
    "inset(0px 0px 0px 0px round 40px)",
  );
  const rect = { x0: 100, y0: 50, x1: 700, y1: 500 };
  expect(windowCutout({ rect, ...sizes, crop: 0 })).toEqual({
    hole: rect,
    w: 1200,
    h: 900,
  });
  const card = windowCutout({ rect, ...sizes, crop: 1 });
  expect(card.w).toBe(1280);
  expect(card.h).toBe(720);
  // #page (1280 by 720) centered in the window (1200 by 900) drawn at half size
  expect(card.hole).toEqual({ x0: 80, y0: 95, x1: 720, y1: 455 });
});

test("focus goes to the page at full zoom and back to the icon on close", () => {
  const body = { name: "body" };
  const doc = { body, activeElement: body };
  const focusable = (name) => ({
    name,
    tabIndex: 0,
    attrs: {},
    hasAttribute(key) {
      return key in this.attrs;
    },
    focus() {
      doc.activeElement = this;
    },
  });
  const h1 = focusable("h1");
  const icon = focusable("icon");
  const pageEl = {
    querySelector: () => h1,
    contains: (el) => el === h1,
  };
  const sync = createAppFocus({ pageEl, iconOf: () => icon, doc });
  // the tapped icon lost its focus when the home screen went inert under the opening window
  sync({ covered: true, pageFlat: false, app: ABOUT });
  expect(doc.activeElement).toBe(body);
  sync({ covered: true, pageFlat: true, app: ABOUT });
  expect(doc.activeElement).toBe(h1);
  expect(h1.tabIndex).toBe(-1);
  // closing: the window still covers the home screen, then it's uncovered
  sync({ covered: true, pageFlat: false, app: ABOUT });
  expect(doc.activeElement).toBe(h1);
  sync({ covered: false, pageFlat: false, app: ABOUT });
  expect(doc.activeElement).toBe(icon);
});
