// the layout's navigation, on every page, 3d or flat. it puts the site's own swap in place of Astro's, lets the
// scene hold a navigation until its close has played, reloads once when a deploy has landed, and places the player
// host over the music page's slot
import { navigate, swapFunctions } from "astro:transitions/client";
import { customSwap } from "./swap.js";
import { read, write } from "../lib/storage.js";
import { captureSnapshot } from "../lib/snapshots.js";

const HANDLER_CAP_MS = 4000;

const root = document.documentElement;

const buildIdOf = (doc) =>
  doc.querySelector('meta[name="build-id"]')?.getAttribute("content") ?? "";

// the build of the code that's running, which a swapped in head doesn't change
const RUNNING_BUILD = buildIdOf(document);

// the same path the head script builds the recovery key from
const normalPath = (pathname) => pathname.replace(/(.)\/+$/, "$1");

let handler = null;

// the scene's handler, given { from, to, direction, uaTransition, page, swapped, signal } for each navigation, where
// page settles to the fetched page's data-app (null when there's none) and swapped to { viewTransition } once the
// swap has run (null when the navigation was dropped). the swap waits for what it gives back, for at most 4 s
export const onNavigate = (fn) => {
  handler = fn;
};

// the flat page from here on, for this page load. the layout stops a scene still running when it hears the event
const failFlat = (reason) => {
  root.classList.add("scene-failed");
  root.classList.remove("has-3d", "page-first");
  dispatchEvent(new CustomEvent("scene-failed", { detail: reason }));
};

// a reload for a page of another build is allowed once per path and build in a tab. the head script turns "1" into
// "used" when it reads it, so the key stays as the record that the reload happened. without storage there's no
// reload at all, so nothing can loop
const mayRecover = (path, buildId) => {
  const key = `recovery:${path}:${buildId}`;
  if (read("session", key) !== null) {
    return false;
  }
  return write("session", key, "1");
};

// a chunk (the scene's, or the music player's) didn't load, likely since a deploy removed it, so the page loads again once
export const recoverFromChunk = () => {
  if (!mayRecover(normalPath(location.pathname), RUNNING_BUILD)) {
    return false;
  }
  location.reload();
  return true;
};

const withCap = (promise) =>
  Promise.race([
    promise.catch((error) => {
      console.warn("the navigation's scene handler failed", error);
    }),
    new Promise((resolve) => setTimeout(resolve, HANDLER_CAP_MS)),
  ]);

const pageAppOf = (doc) => doc.getElementById("page")?.dataset.app ?? null;

// the scene has no app for the not found page and would hide it under the home screen, so in 3d it's a full page load,
// which the head script shows as the flat site
const leavesScene = (doc) =>
  root.classList.contains("has-3d") &&
  doc.querySelector('meta[name="page-app"]')?.getAttribute("content") ===
    "not-found";

// #page scrolls in its .body, while Astro keeps only the window's scroll in each history entry, so the page's own
// goes in beside it. it's saved once a scroll settles, since by the time the router hears of a Back or a Forward the
// next entry is already the current one, and nothing is saved until that navigation's page has swapped in
const SCROLL_KEY = "pageScroll";
const SCROLL_SAVE_MS = 150;
let scrollTimer = null;
let traversing = false;

const pageBody = () => document.querySelector("#page > .body");

const saveScroll = () => {
  clearTimeout(scrollTimer);
  scrollTimer = null;
  const body = pageBody();
  if (
    traversing ||
    !body ||
    !history.state ||
    history.state[SCROLL_KEY] === body.scrollTop
  ) {
    return;
  }
  history.replaceState({ ...history.state, [SCROLL_KEY]: body.scrollTop }, "");
};

const restoreScroll = () => {
  const body = pageBody();
  const top = history.state?.[SCROLL_KEY];
  if (body && typeof top === "number") {
    body.scrollTop = top;
  }
};

document.addEventListener(
  "scroll",
  (event) => {
    if (event.target !== pageBody()) {
      return;
    }
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(saveScroll, SCROLL_SAVE_MS);
  },
  { capture: true, passive: true },
);

// a reload or a Back into the site loads the page again, and the browser restores only the window's scroll
const arrivedBy = performance.getEntriesByType?.("navigation")[0]?.type;
if (arrivedBy === "reload" || arrivedBy === "back_forward") {
  restoreScroll();
}

// each navigation's way to tell its handler that its swap ran, found again from the swap event by the signal both
// events share
const swaps = new WeakMap();

document.addEventListener("astro:before-preparation", (event) => {
  const original = event.loader;
  const { from, direction, signal } = event;
  // the entry being left is still the current one, except on Back and Forward, where a save would land on the next
  if (event.navigationType === "traverse") {
    clearTimeout(scrollTimer);
    scrollTimer = null;
    traversing = true;
    signal.addEventListener(
      "abort",
      () => {
        traversing = false;
      },
      { once: true },
    );
  } else {
    traversing = false;
    saveScroll();
  }
  const uaTransition =
    event.navigationType === "traverse" && Boolean(window.__uaTransition);
  event.loader = async () => {
    let settleSwap = () => {};
    const swapped = new Promise((resolve) => {
      settleSwap = resolve;
    });
    swaps.set(signal, settleSwap);
    signal.addEventListener("abort", () => settleSwap(null), { once: true });
    // the page loads while the scene plays its close, so neither waits on the other
    const loading = original();
    // a page that leaves the scene is never told to it, so the scene doesn't start a close the full load cuts off
    const page = loading.then(
      () => {
        if (event.newDocument === document) {
          return null;
        }
        if (leavesScene(event.newDocument)) {
          return new Promise(() => {});
        }
        return pageAppOf(event.newDocument);
      },
      () => null,
    );
    // another page of the app already showing slides in (see .page-slide in flat.css). the class goes on before Astro
    // starts the view transition, which takes its picture of the old page then, and the browser's own back animation
    // already played one
    page.then((app) => {
      const now = pageAppOf(document);
      if (
        app &&
        app === now &&
        app !== "home" &&
        app !== "not-found" &&
        !uaTransition
      ) {
        root.classList.add("page-slide");
      }
    });
    // called at once, so a newer navigation's handler runs before the one it dropped hears that it was dropped
    const handled = handler
      ? withCap(
          new Promise((resolve) => {
            resolve(
              handler({
                from,
                to: event.to,
                direction,
                uaTransition,
                page,
                swapped,
                signal,
              }),
            );
          }),
        )
      : Promise.resolve();
    try {
      await loading;
    } catch (error) {
      settleSwap(null);
      throw error;
    }
    if (signal.aborted) {
      return;
    }
    // Astro couldn't load it and goes to it with a full page load
    if (event.defaultPrevented) {
      settleSwap(null);
      return;
    }
    // Astro answers a prevented preparation with a full page load of the target
    if (leavesScene(event.newDocument)) {
      event.preventDefault();
      settleSwap(null);
      return;
    }
    const nextBuild = buildIdOf(event.newDocument);
    if (nextBuild !== RUNNING_BUILD) {
      if (mayRecover(normalPath(event.to.pathname), nextBuild)) {
        event.preventDefault();
        settleSwap(null);
        return;
      }
      failFlat("build");
      // the other build's scripts would run beside this one's, with a second player and a second loader override
      for (const script of event.newDocument.scripts) {
        script.dataset.astroExec = "";
      }
    }
    await handled;
  };
});

const rootState = () => {
  const props = {};
  for (const name of [...root.style]) {
    if (name.startsWith("--")) {
      props[name] = root.style.getPropertyValue(name);
    }
  }
  return { classes: [...root.classList], props };
};

let lastSwap = null;

// the app switcher shows each app where it was left, so the page an app is on is kept just before a swap replaces it
// or the tab goes (see lib/snapshots.js). the flat site has no switcher
const keepPage = () => {
  if (root.classList.contains("has-3d")) {
    captureSnapshot(document.getElementById("page"));
  }
};
addEventListener("pagehide", keepPage);

document.addEventListener("astro:before-swap", (event) => {
  keepPage();
  // a navigation that starts before this one's transition is ready skips it, and the browser rejects ready, which
  // Astro leaves unhandled, so it showed as an uncaught error after a quick Back
  event.viewTransition?.ready?.catch(() => {});
  const settleSwap = swaps.get(event.signal);
  lastSwap = {
    type: event.navigationType,
    from: event.from,
    prev: history.state?.prev,
  };
  event.swap = () => {
    customSwap(event.newDocument, rootState(), swapFunctions);
    settleSwap?.({ viewTransition: event.viewTransition ?? null });
  };
  // the slide's pictures are taken by now once the transition is over, and with no transition there's nothing to slide
  const slid = event.viewTransition?.finished ?? Promise.resolve();
  slid
    .catch(() => {})
    .finally(() => root.classList.remove("page-slide", "slide-back"));
});

document.addEventListener("astro:after-swap", () => {
  // Astro adds a route announcer to the body on each navigation, and its own swap replaced the body each time
  document
    .querySelectorAll(".astro-route-announcer")
    .forEach((el) => el.remove());
  // each entry this site pushes keeps the path before it, so the home bar can tell when Back leads home
  if (lastSwap && lastSwap.type !== "traverse" && history.state) {
    const prev =
      lastSwap.type === "replace"
        ? lastSwap.prev
        : normalPath(lastSwap.from.pathname);
    history.replaceState({ ...history.state, prev }, "");
  }
  if (lastSwap?.type === "traverse") {
    traversing = false;
    restoreScroll();
  }
  lastSwap = null;
  placePlayer();
});

// the home bar and escape: Back when the entry before this one is the home screen, so the history doesn't grow, and
// otherwise a new entry for it
export const goHome = () => {
  if (history.state?.prev === "/") {
    history.back();
    return;
  }
  navigate("/");
};

// an inner page's way back to its list (the edge swipe): Back when the list is the entry before, so history stays as
// the visitor made it, and otherwise the list as a new entry that still slides in the way Back does
export const goBackTo = (href) => {
  const path = new URL(href, location.href).pathname;
  if (history.state?.prev === path) {
    history.back();
    return;
  }
  root.classList.add("slide-back");
  navigate(href);
};

export { navigate };

// youtube's player sits over the music page's slot when that page shows as a flat page (the flat site, or 3d at full
// zoom), and waits off screen otherwise, still playing. it only moves when the slot does
let scenePageFlat = false;
let playerAt = "";

const placePlayer = () => {
  const host = document.getElementById("player-host");
  const page = document.getElementById("page");
  if (!host || !page) {
    return;
  }
  const flatSite = !root.classList.contains("has-3d");
  const slot =
    page.dataset.app === "Music" && (flatSite || scenePageFlat)
      ? page.querySelector(".player-slot")
      : null;
  const r = slot ? slot.getBoundingClientRect() : null;
  const at =
    r && r.width > 0
      ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`
      : "away";
  if (at === playerAt) {
    return;
  }
  playerAt = at;
  if (!r || at === "away") {
    Object.assign(host.style, { left: "-10000px", top: "0px" });
    host.inert = true;
    return;
  }
  host.inert = false;
  Object.assign(host.style, {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
};

// the scene says when #page shows as the flat page at full zoom, and when it stops
export const setScenePageFlat = (flat) => {
  scenePageFlat = flat;
  syncPagePinned();
  placePlayer();
};

// the page is pinned on the phone while 3d runs and doesn't show it as the flat page, which turns off the glass's
// backdrop blur. a page first arrival is the flat page too, until the scene shows
export const syncPagePinned = () => {
  const pinned =
    root.classList.contains("has-3d") &&
    !root.classList.contains("scene-failed") &&
    !root.classList.contains("page-first") &&
    !scenePageFlat;
  root.classList.toggle("page-pinned", pinned);
};

addEventListener("resize", placePlayer);
document.addEventListener("scroll", placePlayer, {
  capture: true,
  passive: true,
});
addEventListener("scene-failed", () => {
  syncPagePinned();
  placePlayer();
});
syncPagePinned();
placePlayer();
