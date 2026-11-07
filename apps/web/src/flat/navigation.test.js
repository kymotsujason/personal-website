import { afterEach, beforeEach, expect, test } from "vitest";
import { createNavigation } from "./navigation.js";

let pageApp = "About";
beforeEach(() => {
  pageApp = "About";
  globalThis.document = {
    getElementById: () => ({ dataset: { app: pageApp } }),
    documentElement: { classList: { contains: () => false } },
  };
});
afterEach(() => {
  delete globalThis.document;
});

const status = (over = {}) => ({
  phone: "open",
  busy: false,
  zoomed: false,
  app: null,
  shown: false,
  switchingTo: null,
  switcher: false,
  swapOpen: false,
  ...over,
});

const fakeScene = () => {
  const scene = {
    now: status(),
    moves: [],
    status: () => scene.now,
    hasApp: (name) => ["About", "Music"].includes(name),
    openApp: (name) => {
      scene.moves.push(["open", name]);
      scene.now = status({ zoomed: true, app: name, shown: true });
      return Promise.resolve();
    },
    closeApp: () => {
      scene.moves.push(["close"]);
      return Promise.resolve();
    },
    fadeTo: (name) => {
      scene.moves.push(["fade", name]);
      scene.now = status({ zoomed: true, app: name, shown: true });
      return Promise.resolve();
    },
    leaveSwitcher: () => {},
    showUrl: () => {},
    rebuildPending: () => false,
    fail: (error) => {
      throw error;
    },
    failed: () => false,
  };
  return scene;
};

const until = async (check) => {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
};

test("safeToSwap holds during an open", async () => {
  const scene = fakeScene();
  const nav = createNavigation(scene, null, { poll: 1 });
  // the window is growing out of its icon with #page on it
  scene.now = status({ busy: true, shown: true });
  expect(nav.safeToSwap()).toBe(false);

  // a navigation to another page waits for the open to end before its swap goes ahead
  let settleSwap = () => {};
  const swapped = new Promise((resolve) => {
    settleSwap = resolve;
  });
  let released = false;
  nav
    .handler({
      to: new URL("http://site/music"),
      direction: "forward",
      uaTransition: false,
      page: Promise.resolve("Music"),
      swapped,
      signal: { aborted: false },
    })
    .then(() => {
      released = true;
    });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(released).toBe(false);
  expect(nav.pendingPage()).toBe("Music");

  // open at full zoom on About, with Music on its way: the swap may go, and the fade plays once it has
  scene.now = status({ zoomed: true, app: "About", shown: true });
  await until(() => released);
  expect(released).toBe(true);
  pageApp = "Music";
  settleSwap({ viewTransition: null });
  await until(() => scene.moves.length > 0);
  expect(scene.moves).toEqual([["fade", "Music"]]);
  expect(nav.pendingPage()).toBe(null);
});

test("a swap to the home screen holds until the close has played", async () => {
  const scene = fakeScene();
  scene.now = status({ zoomed: true, app: "About", shown: true });
  const nav = createNavigation(scene, null, { poll: 1 });
  scene.closeApp = () => {
    scene.moves.push(["close"]);
    scene.now = status({ busy: true, shown: true });
    return new Promise((resolve) => {
      scene.endClose = () => {
        scene.now = status();
        resolve();
      };
    });
  };
  let released = false;
  nav
    .handler({
      to: new URL("http://site/"),
      direction: "forward",
      uaTransition: false,
      page: Promise.resolve(null),
      swapped: new Promise(() => {}),
      signal: { aborted: false },
    })
    .then(() => {
      released = true;
    });
  await until(() => scene.moves.length > 0);
  expect(scene.moves).toEqual([["close"]]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(released).toBe(false);
  scene.endClose();
  await until(() => released);
  expect(released).toBe(true);
});

test("a tap asks the layout for the page, and the open grows from the tapped box", async () => {
  const scene = fakeScene();
  const asked = [];
  const nav = createNavigation(
    scene,
    { navigate: (path) => asked.push(path), goHome: () => {} },
    { poll: 1 },
  );
  const box = { x0: 1, y0: 2, x1: 3, y1: 4 };
  expect(nav.requestApp({ name: "About", path: "/about" }, { from: box })).toBe(
    true,
  );
  expect(asked).toEqual(["/about"]);
  scene.openApp = (name, opts) => {
    scene.moves.push(["open", name, opts]);
    scene.now = status({ zoomed: true, app: name, shown: true });
    return Promise.resolve();
  };
  nav.kick();
  await until(() => scene.moves.length > 0);
  expect(scene.moves).toEqual([["open", "About", { from: box }]]);
});
