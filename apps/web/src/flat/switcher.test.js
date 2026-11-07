import { expect, test } from "vitest";
import {
  HOME_SPRING_BACK_MS,
  SWITCHER,
  SWITCH_MS,
} from "../scene/shared/motion.js";
import { place, screenLayout } from "../scene/shared/placement.js";
import { createApps } from "./apps.js";
import { handLoop } from "./handLoop.js";
import { createSwitcher, switchCards } from "./switcher.js";

const APPS = [
  { name: "About", path: "/about", glyph: "A", color: "#3d405b" },
  { name: "Projects", path: "/projects", glyph: "P", color: "#e07a5f" },
  { name: "Blog", path: "/blog", glyph: "B", color: "#81b29a" },
  { name: "Music", path: "/music", glyph: "M", color: "#f67280" },
];
const SKY = { top: [0.2, 0.3, 0.5], low: [0.1, 0.1, 0.2] };

// a scene zoomed into About, with the screen spread over a 1280 by 800 window, so a client px is a share of the screen
const setup = async () => {
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
    switcher: null,
    switching: null,
    swapOpen: false,
    cards: null,
    openApp: null,
    openIcon: null,
    openFromWidget: false,
    placed,
    full: { fullW: l.fullW, fullH: l.fullH, radius: l.radius },
    pageSize: { w: 1280, h: 800 },
    toScreenPx: (x, y) => ({ x: (x * l.fullW) / 1280, y: (y * l.fullH) / 800 }),
    reduced: () => false,
    slowPath: () => false,
    iconRect: () => ({ x0: 100, y0: 200, x1: 160, y1: 260, radius: 14 }),
    takeOver: () => {},
    loadPlayer: () => {},
    wake: () => {},
    setPageFlat: (flat) => {
      scene.pageFlat = flat;
    },
  };
  const requested = [];
  let homes = 0;
  const nav = {
    requestApp: (app, { path } = {}) => {
      requested.push({ app: app.name, path });
      return true;
    },
    requestHome: () => {
      homes += 1;
      return true;
    },
  };
  const pageEl = {
    dataset: { app: "About" },
    classList: { add: () => {}, remove: () => {} },
    querySelector: () => null,
  };
  const { loop, at, now } = handLoop();
  const apps = createApps({ scene, loop, folds: {}, nav, pageEl });
  await apps.openApp(APPS[0], { instant: true });
  let t = 1000;
  const switcher = createSwitcher({
    scene,
    loop,
    apps,
    nav,
    pageEl,
    siteApps: APPS,
    sky: () => SKY,
    clock: () => t,
    blockClick: () => {},
  });
  const event = (type, x, y) => ({
    type,
    pointerId: 1,
    isPrimary: true,
    clientX: x,
    clientY: y,
    preventDefault: () => {},
    stopPropagation: () => {},
  });
  // a press on the home bar carried through points, one every 40 ms, and let go at the last. the release isn't
  // awaited, since a close or a switch it starts settles only as the test steps the loop
  const drag = (points) => {
    const [x0, y0] = points[0];
    switcher.startHomeSwipe(event("pointerdown", x0, y0));
    let last = points[0];
    for (const [x, y] of points.slice(1)) {
      t += 40;
      switcher.moveHomeSwipe(event("pointermove", x, y));
      last = [x, y];
    }
    return () => {
      switcher.endHomeSwipe(event("pointerup", ...last));
    };
  };
  // a straight line from a to b in steps of 10 px
  const line = ([ax, ay], [bx, by]) => {
    const n = Math.max(Math.round(Math.hypot(bx - ax, by - ay) / 10), 1);
    return Array.from({ length: n + 1 }, (_, i) => [
      ax + ((bx - ax) * i) / n,
      ay + ((by - ay) * i) / n,
    ]);
  };
  return {
    scene,
    switcher,
    apps,
    pageEl,
    requested,
    homes: () => homes,
    at,
    now,
    drag,
    line,
  };
};

test("a pull past HOME_DISTANCE goes home", async () => {
  const { scene, homes, at, now, drag, line } = await setup();
  expect(scene.pageFlat).toBe(true);

  // 0.15 of the screen's height, slowly, springs back to fill the screen
  const short = drag(line([640, 790], [640, 790 - 0.15 * 800]));
  expect(scene.pageFlat).toBe(false);
  expect(scene.busy).toBe(true);
  expect(scene.win.crop).toBe(1);
  short();
  expect(homes()).toBe(0);
  expect(scene.zoomed).toBe(true);
  await at(now() + HOME_SPRING_BACK_MS + 1);
  expect(scene.busy).toBe(false);
  expect(scene.pageFlat).toBe(true);
  expect(scene.cards).toBe(null);

  // 0.25, just as slowly, goes home from where the window was let go
  const far = drag(line([640, 790], [640, 790 - 0.25 * 800]));
  const letGo = { ...scene.win.rect };
  expect(letGo.y1 - letGo.y0).toBeLessThan(scene.full.fullH);
  far();
  expect(homes()).toBe(1);
  expect(scene.zoomed).toBe(false);
  expect(scene.win.rect).toEqual(letGo);
  expect(scene.win.crop).toBe(1);
});

test("a sideways release switches app", async () => {
  const { scene, switcher, pageEl, requested, at, now, drag, line } =
    await setup();

  // a little way across springs back
  const little = drag([
    [640, 790],
    ...line([640, 770], [640 + 0.1 * 1280, 770]),
  ]);
  little();
  expect(requested).toEqual([]);
  await at(now() + HOME_SPRING_BACK_MS + 1);
  expect(scene.busy).toBe(false);

  // far across to the right opens the app to the open one's left, which in the row is Music (never opened apps come
  // first in the home screen's order, and the open app is last)
  const across = drag([[640, 790], ...line([640, 770], [1040, 770])]);
  across();
  expect(requested).toEqual([{ app: "Music", path: "/music" }]);
  expect(switcher.status()).toEqual({
    switchingTo: "Music",
    switcher: true,
    swapOpen: true,
  });
  expect(scene.busy).toBe(true);
  // the swap lands partway, and #page rides the growing card from there
  await at(now() + SWITCHER.OPEN_MS / 2);
  pageEl.dataset.app = "Music";
  await at(now() + SWITCHER.OPEN_MS);
  expect(scene.openApp.name).toBe("Music");
  expect(switcher.status()).toEqual({
    switchingTo: null,
    switcher: false,
    swapOpen: false,
  });
  expect(scene.busy).toBe(false);
  expect(scene.pageFlat).toBe(true);
  expect(scene.cards).toBe(null);
});

test("the switch's cards start and end on the whole screen, one card apart", () => {
  const page = { x0: 0, y0: 40, x1: 1000, y1: 560 };
  const full = { x0: 0, y0: 0, x1: 1000, y1: 600 };
  const at = (t, back = false) =>
    switchCards(t, { page, fullW: 1000, fullH: 600, back });
  expect(at(0).from).toEqual(full);
  expect(at(0).round).toBe(0);
  expect(at(1).to.x0).toBeCloseTo(0, 9);
  expect(at(1).to.x1).toBeCloseTo(1000, 9);
  // halfway the cards are smallest and roundest, and a link moves the row left while Back moves it right
  const half = at(0.5);
  expect(half.round).toBe(1);
  expect(half.from.y1 - half.from.y0).toBeCloseTo(600 * (1 - 0.14), 9);
  expect(half.to.x0).toBeGreaterThan(half.from.x0);
  expect(at(0.5, true).to.x0).toBeLessThan(at(0.5, true).from.x0);
});

test("a link's switch slides one card over and lets the swap through partway", async () => {
  const { scene, switcher, pageEl, at, now } = await setup();
  let land;
  const swapped = new Promise((resolve) => {
    land = resolve;
  });
  const switching = switcher.switchTo(APPS[1], { back: false, swapped });
  expect(scene.busy).toBe(true);
  expect(switcher.status().swapOpen).toBe(false);
  await at(now() + SWITCH_MS * 0.5);
  expect(switcher.status()).toEqual({
    switchingTo: "Projects",
    switcher: false,
    swapOpen: true,
  });
  // the leaving card holds #page until the new page lands, and the stand in is the arriving one
  expect(scene.win.app.name).toBe("About");
  expect(scene.cards.cards).toHaveLength(1);
  expect(scene.cards.cards[0].kind).toBe(3);
  pageEl.dataset.app = "Projects";
  land(true);
  await at(now() + SWITCH_MS);
  await switching;
  expect(scene.openApp.name).toBe("Projects");
  expect(scene.busy).toBe(false);
  expect(scene.pageFlat).toBe(true);
  expect(scene.cards).toBe(null);
});
