// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const root = document.documentElement;

const pageOf = (app) => {
  const doc = document.implementation.createHTMLDocument("next");
  doc.head.innerHTML = `<meta name="page-app" content="${app}" />`;
  doc.body.innerHTML = `<main id="page" data-app="${app}"></main>`;
  return doc;
};

// a fresh copy of the layout's navigation, with Astro's router, the site's swap, and the snapshot store standing in.
// each copy adds its own listeners, so each test removes them with the abort signal
let listening = null;
const startNavigation = async () => {
  vi.resetModules();
  const captureSnapshot = vi.fn();
  const customSwap = vi.fn();
  vi.doMock("astro:transitions/client", () => ({
    navigate: vi.fn(),
    swapFunctions: {},
  }));
  vi.doMock("./swap.js", () => ({ customSwap }));
  vi.doMock("../lib/snapshots.js", () => ({ captureSnapshot }));
  listening = new AbortController();
  const { signal } = listening;
  const add = EventTarget.prototype.addEventListener;
  const spy = vi
    .spyOn(EventTarget.prototype, "addEventListener")
    .mockImplementation(function (type, fn, options) {
      const given =
        typeof options === "object" ? options : { capture: Boolean(options) };
      add.call(this, type, fn, { ...given, signal });
    });
  const navigation = await import("./navigation.js");
  spy.mockRestore();
  return { ...navigation, captureSnapshot, customSwap };
};

// Astro's before-preparation event, with a loader that fetches the given page
const prepare = (doc) => {
  const controller = new AbortController();
  const event = new Event("astro:before-preparation", { cancelable: true });
  Object.assign(event, {
    from: new URL(location.href),
    to: new URL("/about", location.href),
    direction: "forward",
    navigationType: "push",
    signal: controller.signal,
    newDocument: document,
    loader: async () => {
      event.newDocument = doc;
    },
  });
  document.dispatchEvent(event);
  return { event, controller, loaded: event.loader() };
};

// Astro's before-swap event for a prepared navigation, and the swap it runs
const swap = ({ event }) => {
  const before = new Event("astro:before-swap");
  Object.assign(before, {
    signal: event.signal,
    newDocument: event.newDocument,
    navigationType: event.navigationType,
    from: event.from,
    viewTransition: undefined,
  });
  document.dispatchEvent(before);
  before.swap();
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  root.className = "";
  document.body.innerHTML = `<main id="page" data-app="About"></main><div id="player-host"></div>`;
});

afterEach(() => {
  listening?.abort();
  vi.restoreAllMocks();
});

test("leavesScene is true under has-flat-scene for the not found page", async () => {
  await startNavigation();
  root.classList.add("has-flat-scene");
  const going = prepare(pageOf("not-found"));
  await going.loaded;
  expect(going.event.defaultPrevented).toBe(true);
});

test("the flat site swaps the not found page in", async () => {
  await startNavigation();
  const going = prepare(pageOf("not-found"));
  await going.loaded;
  expect(going.event.defaultPrevented).toBe(false);
});

test("keepPage captures snapshots under has-flat-scene", async () => {
  const { captureSnapshot } = await startNavigation();
  root.classList.add("has-flat-scene");
  dispatchEvent(new Event("pagehide"));
  expect(captureSnapshot).toHaveBeenCalledTimes(1);
});

test("the flat site keeps no snapshots", async () => {
  const { captureSnapshot } = await startNavigation();
  dispatchEvent(new Event("pagehide"));
  expect(captureSnapshot).not.toHaveBeenCalled();
});

test("inFlight resolves after the swap", async () => {
  const { inFlight, customSwap } = await startNavigation();
  expect(inFlight()).toBe(null);
  const going = prepare(pageOf("About"));
  const flight = inFlight();
  expect(flight).toBeInstanceOf(Promise);
  let landed = false;
  flight.then(() => {
    landed = true;
  });
  await going.loaded;
  await settle();
  expect(landed).toBe(false);
  swap(going);
  expect(customSwap).toHaveBeenCalledTimes(1);
  await flight;
  expect(landed).toBe(true);
  expect(inFlight()).toBe(null);
});

test("inFlight resolves when the navigation is dropped", async () => {
  const { inFlight } = await startNavigation();
  const going = prepare(pageOf("About"));
  const flight = inFlight();
  going.controller.abort();
  await flight;
  await settle();
  expect(inFlight()).toBe(null);
});

test("failFlat removes the 2d scene's classes", async () => {
  await startNavigation();
  root.classList.add("has-flat-scene", "flat-ready");
  const doc = pageOf("About");
  doc.head.innerHTML += `<meta name="build-id" content="another" />`;
  // the one reload for that build was already used
  sessionStorage.setItem("recovery:/about:another", "used");
  const going = prepare(doc);
  await going.loaded;
  expect(root.classList.contains("scene-failed")).toBe(true);
  expect(root.classList.contains("has-flat-scene")).toBe(false);
  expect(root.classList.contains("flat-ready")).toBe(false);
});

test("the page is pinned under has-flat-scene until it shows flat", async () => {
  const { syncPagePinned, setScenePageFlat } = await startNavigation();
  root.classList.add("has-flat-scene");
  syncPagePinned();
  expect(root.classList.contains("page-pinned")).toBe(true);
  setScenePageFlat(true);
  expect(root.classList.contains("page-pinned")).toBe(false);
});
