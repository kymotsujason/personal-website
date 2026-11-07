import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, test } from "vitest";

const source = readFileSync(new URL("./head.js", import.meta.url), "utf8");

const memory = (items = {}) => ({
  getItem: (key) => (key in items ? items[key] : null),
  setItem: (key, value) => {
    items[key] = String(value);
  },
  removeItem: (key) => {
    delete items[key];
  },
});

const refusing = () => ({
  getItem: () => {
    throw new Error("storage refused");
  },
  setItem: () => {
    throw new Error("storage refused");
  },
  removeItem: () => {
    throw new Error("storage refused");
  },
});

// a page as the head script sees it: the root's classes, the build id meta, a canvas that may or may not give
// webgl2, the navigation entry, both storages, and the timers and listeners it registers
const makePage = ({
  path = "/",
  search = "",
  hash = "",
  app = undefined,
  navType = "navigate",
  local = {},
  session = {},
  buildId = "abc123",
  webgl2 = true,
  // what RENDERER names, and the name behind chrome's and safari's generic one
  renderer = "WebKit WebGL",
  unmasked = "ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3080/PCIe/SSE2, OpenGL ES 3.2)",
  // the browser would draw this context slowly, so it turns away failIfMajorPerformanceCaveat
  caveat = false,
  storage = null,
  storageAccessThrows = false,
  hidden = false,
  hour = null,
  // what the 2d scene needs: inert, adoptedStyleSheets, and css sin()
  features = {},
} = {}) => {
  const { inert = true, adopted = true, sin = true } = features;
  const classes = new Set();
  const styles = {};
  const root = {
    style: { setProperty: (name, value) => (styles[name] = value) },
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
  };
  const timers = [];
  const listeners = {};
  const documentListeners = {};
  const events = [];
  const contexts = [];
  const links = [];
  const clock = { now: 0 };
  const replaced = [];
  const document = {
    hidden,
    addEventListener: (type, fn) => {
      (documentListeners[type] ??= []).push(fn);
    },
    documentElement: root,
    ...(adopted ? { adoptedStyleSheets: [] } : {}),
    head: {
      appendChild: (el) => {
        links.push(el);
      },
    },
    querySelector: (selector) => {
      if (selector === 'meta[name="build-id"]') {
        return { content: buildId };
      }
      if (selector === 'meta[name="page-app"]' && app !== undefined) {
        return { content: app };
      }
      return null;
    },
    createElement: (tag) => {
      if (tag === "link") {
        return {};
      }
      return {
        getContext: (kind, attributes) => {
          if (kind !== "webgl2" || !webgl2) {
            return null;
          }
          const strict = Boolean(attributes?.failIfMajorPerformanceCaveat);
          if (strict && caveat) {
            return null;
          }
          const gl = {
            lost: false,
            strict,
            asked: [],
            RENDERER: 7937,
            getParameter: (name) =>
              name === 7937 ? renderer : name === 37446 ? unmasked : null,
            getExtension: (name) => {
              gl.asked.push(name);
              if (name === "WEBGL_debug_renderer_info") {
                return { UNMASKED_RENDERER_WEBGL: 37446 };
              }
              return name === "WEBGL_lose_context"
                ? {
                    loseContext: () => {
                      gl.lost = true;
                    },
                  }
                : null;
            },
          };
          contexts.push(gl);
          return gl;
        },
      };
    },
  };
  const window = {
    document,
    location: { pathname: path, search, hash },
    HTMLElement: { prototype: inert ? { inert: false } : {} },
    CSS: { supports: (rule) => sin || !/sin\(/.test(rule) },
    URLSearchParams,
    history: {
      state: { index: 0 },
      replaceState: (...args) => {
        replaced.push({ state: args[0], url: args[2] });
      },
    },
    performance: {
      now: () => clock.now,
      getEntriesByType: (type) =>
        type === "navigation" ? [{ type: navType }] : [],
    },
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms, cleared: false });
      return timers.length;
    },
    clearTimeout: (id) => {
      if (timers[id - 1]) {
        timers[id - 1].cleared = true;
      }
    },
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    dispatchEvent: (event) => {
      events.push(event.type);
      return true;
    },
    addEventListener: (type, fn) => {
      (listeners[type] ??= []).push(fn);
    },
  };
  const localStore = storage ?? memory(local);
  const sessionStore = storage ?? memory(session);
  Object.defineProperty(window, "localStorage", {
    get: () => {
      if (storageAccessThrows) {
        throw new Error("access denied");
      }
      return localStore;
    },
  });
  Object.defineProperty(window, "sessionStorage", {
    get: () => {
      if (storageAccessThrows) {
        throw new Error("access denied");
      }
      return sessionStore;
    },
  });
  window.window = window;
  if (hour !== null) {
    window.Date = class {
      getHours() {
        return Math.floor(hour);
      }
      getMinutes() {
        return Math.round((hour % 1) * 60);
      }
    };
  }
  const context = vm.createContext(window);
  // the document's visibility changing, as the browser reports it
  const setHidden = (value) => {
    document.hidden = value;
    (documentListeners.visibilitychange ?? []).forEach((fn) => fn({}));
  };
  const live = () => timers.filter((timer) => !timer.cleared);
  return {
    window,
    classes,
    styles,
    timers,
    live,
    listeners,
    events,
    contexts,
    links,
    clock,
    replaced,
    localStore,
    setHidden,
    run: () => vm.runInContext(source, context),
  };
};

describe("arrival", () => {
  test("a reload on an app page shows the page", () => {
    const page = makePage({
      path: "/about",
      navType: "reload",
      local: { introSeen: "1" },
    });
    page.run();
    expect(page.window.__arrival).toBe("page");
    expect(page.classes.has("page-first")).toBe(true);
  });

  test("a reload on / with no introSeen plays the full intro", () => {
    const page = makePage({ path: "/", navType: "reload" });
    page.run();
    expect(page.window.__arrival).toBe("full");
    expect(page.classes.has("page-first")).toBe(false);
  });

  test("a reload on / with introSeen plays the fast intro", () => {
    const page = makePage({
      path: "/",
      navType: "reload",
      local: { introSeen: "1" },
    });
    page.run();
    expect(page.window.__arrival).toBe("fast");
  });

  test("a navigation to an app page with introSeen plays the fast intro", () => {
    const page = makePage({
      path: "/blog/x",
      navType: "navigate",
      local: { introSeen: "1" },
    });
    page.run();
    expect(page.window.__arrival).toBe("fast");
    expect(page.classes.has("page-first")).toBe(false);
  });

  test("a navigation to / with no introSeen plays the full intro", () => {
    const page = makePage({ path: "/", navType: "navigate" });
    page.run();
    expect(page.window.__arrival).toBe("full");
  });

  test("a first visit to an app page plays the full intro", () => {
    const page = makePage({ path: "/about", navType: "navigate" });
    page.run();
    expect(page.window.__arrival).toBe("full");
  });

  test("back or forward into an app page shows the page", () => {
    const page = makePage({ path: "/music", navType: "back_forward" });
    page.run();
    expect(page.window.__arrival).toBe("page");
    expect(page.classes.has("page-first")).toBe(true);
  });

  test("a recovery flag for this path and build counts as a reload", () => {
    const page = makePage({
      path: "/about",
      navType: "navigate",
      local: { introSeen: "1" },
      session: { "recovery:/about:abc123": "1" },
    });
    page.run();
    expect(page.window.__arrival).toBe("page");
  });

  test("a recovery flag is used once, and stays as the record of the reload", () => {
    const session = { "recovery:/about:abc123": "1" };
    const first = makePage({
      path: "/about",
      navType: "navigate",
      local: { introSeen: "1" },
      session,
    });
    first.run();
    expect(first.window.__arrival).toBe("page");
    expect(session["recovery:/about:abc123"]).toBe("used");
    const later = makePage({
      path: "/about",
      navType: "navigate",
      local: { introSeen: "1" },
      session,
    });
    later.run();
    expect(later.window.__arrival).toBe("fast");
    expect(later.classes.has("page-first")).toBe(false);
  });

  test("a recovery flag with storage refusing the write still counts once", () => {
    const page = makePage({
      path: "/about",
      navType: "navigate",
      storage: {
        getItem: (key) => (key === "recovery:/about:abc123" ? "1" : null),
        setItem: () => {
          throw new Error("storage refused");
        },
      },
    });
    expect(() => page.run()).not.toThrow();
    expect(page.window.__arrival).toBe("page");
  });

  test("a reload of the not found page under an app's path isn't an app page", () => {
    const page = makePage({
      path: "/about/whatever",
      app: "not-found",
      navType: "reload",
      local: { introSeen: "1" },
    });
    page.run();
    expect(page.window.__arrival).toBe("fast");
    expect(page.classes.has("page-first")).toBe(false);
  });

  test("a reload of an app page the server names shows the page", () => {
    const page = makePage({
      path: "/projects/jasonyue-ca",
      app: "Projects",
      navType: "reload",
    });
    page.run();
    expect(page.window.__arrival).toBe("page");
    expect(page.classes.has("page-first")).toBe(true);
  });

  test("a recovery flag for another build doesn't", () => {
    const page = makePage({
      path: "/about",
      navType: "navigate",
      local: { introSeen: "1" },
      session: { "recovery:/about:old": "1", "recovery:/blog:abc123": "1" },
    });
    page.run();
    expect(page.window.__arrival).toBe("fast");
  });

  test("a trailing slash names the same page", () => {
    const page = makePage({
      path: "/about/",
      navType: "navigate",
      session: { "recovery:/about:abc123": "1" },
    });
    page.run();
    expect(page.window.__arrival).toBe("page");
  });

  test("storage that throws gives the full intro and nothing throws", () => {
    const page = makePage({ path: "/", storage: refusing() });
    expect(() => page.run()).not.toThrow();
    expect(page.window.__arrival).toBe("full");
  });

  test("storage that throws on access gives the full intro and nothing throws", () => {
    const page = makePage({ path: "/", storageAccessThrows: true });
    expect(() => page.run()).not.toThrow();
    expect(page.window.__arrival).toBe("full");
    expect(page.classes.has("has-3d")).toBe(true);
  });

  test("running the script twice doesn't add page-first again", () => {
    const page = makePage({ path: "/about", navType: "reload" });
    page.run();
    expect(page.classes.has("page-first")).toBe(true);
    page.classes.delete("page-first");
    page.classes.delete("has-3d");
    page.run();
    expect(page.classes.has("page-first")).toBe(false);
    expect(page.classes.has("has-3d")).toBe(false);
    expect(page.timers).toHaveLength(1);
  });
});

describe("3d and the watchdog", () => {
  test("webgl2 adds has-3d and lets go of the test context", () => {
    const page = makePage();
    page.run();
    expect(page.classes.has("has-3d")).toBe(true);
    expect(page.contexts).toHaveLength(1);
    expect(page.contexts[0].lost).toBe(true);
  });

  test("3d preloads the models, the keys, the rig, and the small desk images", () => {
    const page = makePage();
    page.run();
    expect(page.links.map((link) => link.href)).toEqual([
      "/models/phone.packed.glb",
      "/models/hands.packed.glb",
      "/models/hands-rig.json",
      "/keys/landscape-baked.json",
      "/keys/support.json",
      "/keys/pinch.json",
      "/keys/portrait-grips.json",
      "/desk-small.jpg",
      "/desk-wall-mask-small.png",
    ]);
    for (const link of page.links) {
      expect(link).toMatchObject({
        rel: "preload",
        as: "fetch",
        crossOrigin: "anonymous",
      });
    }
  });

  test("no webgl2 leaves the flat site", () => {
    const page = makePage({ webgl2: false });
    page.run();
    expect(page.classes.has("has-3d")).toBe(false);
    expect(page.timers).toHaveLength(0);
    expect(page.links).toHaveLength(0);
  });

  test("a saved 2d choice leaves the flat site without asking for webgl", () => {
    const page = makePage({ local: { "2d": "1" } });
    page.run();
    expect(page.classes.has("has-3d")).toBe(false);
    expect(page.contexts).toHaveLength(0);
    expect(page.links).toHaveLength(0);
  });

  test("?2d saves the choice, shows the flat site, and leaves the address bar", () => {
    const local = {};
    const page = makePage({ path: "/about", search: "?2d", local });
    page.run();
    expect(local["2d"]).toBe("1");
    expect(page.classes.has("has-3d")).toBe(false);
    expect(page.contexts).toHaveLength(0);
    expect(page.links).toHaveLength(0);
    expect(page.replaced).toEqual([{ state: { index: 0 }, url: "/about" }]);
  });

  test("?2d keeps the other params and the hash", () => {
    const page = makePage({
      path: "/blog/x",
      search: "?ref=mail&2d=1",
      hash: "#part",
    });
    page.run();
    expect(page.classes.has("has-3d")).toBe(false);
    expect(page.replaced.map((entry) => entry.url)).toEqual([
      "/blog/x?ref=mail#part",
    ]);
  });

  test("?2d shows the flat site even when storage refuses the write", () => {
    const page = makePage({ search: "?2d", storage: refusing() });
    expect(() => page.run()).not.toThrow();
    expect(page.classes.has("has-3d")).toBe(false);
  });

  test("?3d replaces a saved 2d choice with the 3d one and shows the scene", () => {
    const local = { "2d": "1", "2dAuto": String(Date.now()) };
    const page = makePage({ search: "?3d", local });
    page.run();
    expect(local["2d"]).toBe("0");
    expect("2dAuto" in local).toBe(false);
    expect(page.classes.has("has-3d")).toBe(true);
    expect(page.replaced.map((entry) => entry.url)).toEqual(["/"]);
  });

  test("?3d shows the scene even when storage refuses the write", () => {
    const page = makePage({
      search: "?3d",
      unmasked: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))",
      storage: {
        getItem: (key) => (key === "2d" ? "1" : null),
        setItem: () => {
          throw new Error("storage refused");
        },
        removeItem: () => {
          throw new Error("storage refused");
        },
      },
    });
    expect(() => page.run()).not.toThrow();
    expect(page.classes.has("has-3d")).toBe(true);
  });

  test("a url without the version params leaves the address bar alone", () => {
    const page = makePage({ search: "?ref=mail" });
    page.run();
    expect(page.classes.has("has-3d")).toBe(true);
    expect(page.replaced).toHaveLength(0);
  });

  test("a browser without URLSearchParams ignores the query", () => {
    const page = makePage({ search: "?2d" });
    delete page.window.URLSearchParams;
    expect(() => page.run()).not.toThrow();
    expect(page.classes.has("has-3d")).toBe(true);
  });

  test("the not found page shows as the flat site", () => {
    const page = makePage({ path: "/blog/tag/old", app: "not-found" });
    page.run();
    expect(page.classes.has("has-3d")).toBe(false);
    expect(page.timers).toHaveLength(0);
    expect(page.links).toHaveLength(0);
    expect(page.contexts).toHaveLength(0);
  });
  test("the watchdog fails the scene after 10 s unless it has shown", () => {
    const page = makePage({ path: "/about", navType: "reload" });
    page.run();
    expect(page.timers).toHaveLength(1);
    expect(page.timers[0].ms).toBe(10000);
    page.timers[0].fn();
    expect(page.classes.has("scene-failed")).toBe(true);
    expect(page.classes.has("has-3d")).toBe(false);
    expect(page.classes.has("page-first")).toBe(false);
    expect(page.events).toEqual(["scene-failed"]);
  });

  test("a page loaded hidden starts the watchdog only once it shows", () => {
    const page = makePage({ hidden: true });
    page.run();
    expect(page.classes.has("has-3d")).toBe(true);
    expect(page.live()).toHaveLength(0);
    page.clock.now = 60000;
    page.setHidden(false);
    expect(page.live()).toHaveLength(1);
    expect(page.live()[0].ms).toBe(10000);
    page.live()[0].fn();
    expect(page.classes.has("scene-failed")).toBe(true);
  });

  test("time spent hidden doesn't count toward the watchdog", () => {
    const page = makePage();
    page.run();
    page.clock.now = 4000;
    page.setHidden(true);
    expect(page.live()).toHaveLength(0);
    page.clock.now = 50000;
    page.setHidden(false);
    expect(page.live()).toHaveLength(1);
    expect(page.live()[0].ms).toBe(6000);
    page.live()[0].fn();
    expect(page.classes.has("scene-failed")).toBe(true);
    // once it has given up, showing the page again starts nothing
    page.setHidden(true);
    page.setHidden(false);
    expect(page.timers).toHaveLength(2);
  });

  test("the watchdog leaves a shown scene alone", () => {
    const page = makePage();
    page.run();
    page.window.__sceneShown = true;
    page.timers[0].fn();
    expect(page.classes.has("scene-failed")).toBe(false);
    expect(page.classes.has("has-3d")).toBe(true);
    expect(page.events).toEqual([]);
  });

  test("popstate records whether the browser played its own transition", () => {
    const page = makePage();
    page.run();
    expect(page.window.__uaTransition).toBe(false);
    page.listeners.popstate.forEach((fn) =>
      fn({ hasUAVisualTransition: true }),
    );
    expect(page.window.__uaTransition).toBe(true);
    page.listeners.popstate.forEach((fn) => fn({}));
    expect(page.window.__uaTransition).toBe(false);
  });
});

describe("slow devices", () => {
  const SWIFTSHADER =
    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
  const DAY = 24 * 60 * 60 * 1000;

  test("a visitor who hasn't chosen asks for webgl2 that fails on a major performance caveat", () => {
    const page = makePage();
    page.run();
    expect(page.contexts).toHaveLength(1);
    expect(page.contexts[0].strict).toBe(true);
    expect(page.window.__chose3d).toBe(false);
  });

  test("a major performance caveat leaves the flat site", () => {
    const page = makePage({ caveat: true });
    page.run();
    expect(page.classes.has("has-3d")).toBe(false);
    expect(page.timers).toHaveLength(0);
    expect(page.links).toHaveLength(0);
  });

  test("swiftshader behind chrome's generic name leaves the flat site and lets go of the context", () => {
    const page = makePage({ unmasked: SWIFTSHADER });
    page.run();
    expect(page.classes.has("has-3d")).toBe(false);
    expect(page.links).toHaveLength(0);
    expect(page.contexts[0].lost).toBe(true);
  });

  test("firefox's llvmpipe is read from RENDERER without the debug extension", () => {
    const page = makePage({ renderer: "llvmpipe (LLVM 17.0.6, 256 bits)" });
    page.run();
    expect(page.classes.has("has-3d")).toBe(false);
    expect(page.contexts[0].asked).not.toContain("WEBGL_debug_renderer_info");
  });

  test("windows' basic render driver leaves the flat site", () => {
    const page = makePage({
      unmasked: "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)",
    });
    page.run();
    expect(page.classes.has("has-3d")).toBe(false);
  });

  test("a real gpu named by RENDERER shows the scene", () => {
    const page = makePage({ renderer: "NVIDIA GeForce GTX 980, or similar" });
    page.run();
    expect(page.classes.has("has-3d")).toBe(true);
    expect(page.contexts[0].asked).not.toContain("WEBGL_debug_renderer_info");
  });

  test("a saved 3d choice shows the scene on a software renderer and skips the strict check", () => {
    const page = makePage({ local: { "2d": "0" }, unmasked: SWIFTSHADER });
    page.run();
    expect(page.classes.has("has-3d")).toBe(true);
    expect(page.contexts[0].strict).toBe(false);
    expect(page.window.__chose3d).toBe(true);
  });

  test("a saved 3d choice without webgl2 still leaves the flat site", () => {
    const page = makePage({ local: { "2d": "0" }, webgl2: false });
    page.run();
    expect(page.classes.has("has-3d")).toBe(false);
  });

  test("a switch to the flat site in the last 30 days holds without asking for webgl", () => {
    const page = makePage({
      local: { "2dAuto": String(Date.now() - 29 * DAY) },
    });
    page.run();
    expect(page.classes.has("has-3d")).toBe(false);
    expect(page.contexts).toHaveLength(0);
    expect(page.window.__chose3d).toBe(false);
  });

  test("a switch older than 30 days tries 3d again", () => {
    const page = makePage({
      local: { "2dAuto": String(Date.now() - 31 * DAY) },
    });
    page.run();
    expect(page.classes.has("has-3d")).toBe(true);
  });

  test("a switch saved in the future or as junk doesn't hold", () => {
    for (const value of [String(Date.now() + DAY), "junk", ""]) {
      const page = makePage({ local: { "2dAuto": value } });
      page.run();
      expect(page.classes.has("has-3d"), value).toBe(true);
    }
  });

  test("a saved 3d choice wins over a recent switch", () => {
    const page = makePage({
      local: { "2d": "0", "2dAuto": String(Date.now()) },
    });
    page.run();
    expect(page.classes.has("has-3d")).toBe(true);
  });

  test("a renderer that throws on the name leaves the flat site", () => {
    const page = makePage();
    page.window.document.createElement = () => ({
      getContext: () => ({
        RENDERER: 7937,
        getParameter: () => {
          throw new Error("lost");
        },
        getExtension: () => null,
      }),
    });
    expect(() => page.run()).not.toThrow();
    expect(page.classes.has("has-3d")).toBe(false);
  });
});

describe("the first sky", () => {
  const sky = (hour, extra = {}) => {
    const page = makePage({ hour, ...extra });
    page.run();
    return page.styles;
  };

  test("noon paints the day colors and no stars", () => {
    const styles = sky(12);
    expect(styles["--sky-top"]).toBe("rgb(43, 107, 204)");
    expect(styles["--sky-low"]).toBe("rgb(120, 179, 240)");
    expect(styles["--stars"]).toBe("0");
    expect(Number(styles["--dim-low"])).toBeCloseTo(0.6, 5);
  });

  test("23:00 paints the night colors", () => {
    const styles = sky(23);
    expect(styles["--sky-top"]).toBe("rgb(13, 18, 51)");
    expect(styles["--stars"]).toBe("1");
  });

  test("it paints in the 3d site, the flat site, and a page first arrival", () => {
    for (const extra of [
      {},
      { local: { "2d": "1" } },
      { path: "/about", navType: "reload" },
    ]) {
      expect(sky(12, extra)["--sky-top"]).toBe("rgb(43, 107, 204)");
    }
  });
});

describe("the 2d scene", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const noFloor = [{ inert: false }, { adopted: false }, { sin: false }];

  test("no webgl2 and the floor met gives has-flat-scene", () => {
    const page = makePage({ webgl2: false });
    page.run();
    expect(page.classes.has("has-flat-scene")).toBe(true);
    expect(page.classes.has("has-3d")).toBe(false);
    expect(page.classes.has("flat-slow")).toBe(false);
    expect(page.window.__flatChosen).toBe(false);
  });

  test("a scene that can run in 3d doesn't get has-flat-scene", () => {
    const page = makePage();
    page.run();
    expect(page.classes.has("has-3d")).toBe(true);
    expect(page.classes.has("has-flat-scene")).toBe(false);
  });

  test("below the floor gives the plain flat page", () => {
    for (const features of noFloor) {
      const page = makePage({ webgl2: false, features });
      page.run();
      expect(page.classes.has("has-flat-scene"), JSON.stringify(features)).toBe(
        false,
      );
      expect(page.classes.has("has-3d")).toBe(false);
    }
  });

  test("a saved 2d choice gives has-flat-scene and __flatChosen", () => {
    const page = makePage({ local: { "2d": "1" } });
    page.run();
    expect(page.classes.has("has-flat-scene")).toBe(true);
    expect(page.window.__flatChosen).toBe(true);
  });

  test("a recent flatAuto gives the plain flat page and flat-slow", () => {
    const page = makePage({
      webgl2: false,
      local: { flatAuto: String(Date.now() - 29 * DAY) },
    });
    page.run();
    expect(page.classes.has("flat-slow")).toBe(true);
    expect(page.classes.has("has-flat-scene")).toBe(false);
    expect(page.classes.has("has-3d")).toBe(false);
  });

  test("a flatAuto older than 30 days, in the future, or junk doesn't hold", () => {
    for (const value of [
      String(Date.now() - 31 * DAY),
      String(Date.now() + DAY),
      "junk",
    ]) {
      const page = makePage({ webgl2: false, local: { flatAuto: value } });
      page.run();
      expect(page.classes.has("flat-slow"), value).toBe(false);
      expect(page.classes.has("has-flat-scene"), value).toBe(true);
    }
  });

  test("flatAuto wins over a saved 2d choice", () => {
    const page = makePage({
      local: { "2d": "1", flatAuto: String(Date.now()) },
    });
    page.run();
    expect(page.classes.has("flat-slow")).toBe(true);
    expect(page.classes.has("has-flat-scene")).toBe(false);
    expect(page.window.__flatChosen).toBe(true);
  });

  test("?3d clears flatAuto and 2dAuto", () => {
    const local = {
      flatAuto: String(Date.now()),
      "2dAuto": String(Date.now()),
    };
    const page = makePage({ search: "?3d", local });
    page.run();
    expect("flatAuto" in local).toBe(false);
    expect("2dAuto" in local).toBe(false);
    expect(page.classes.has("has-3d")).toBe(true);
    expect(page.classes.has("flat-slow")).toBe(false);
  });

  test("?2d clears flatAuto", () => {
    const local = { flatAuto: String(Date.now()) };
    const page = makePage({ search: "?2d", local });
    page.run();
    expect("flatAuto" in local).toBe(false);
    expect(local["2d"]).toBe("1");
    expect(page.classes.has("has-flat-scene")).toBe(true);
    expect(page.classes.has("flat-slow")).toBe(false);
    expect(page.window.__flatChosen).toBe(true);
  });

  test("the not found page never gets has-flat-scene", () => {
    const page = makePage({ path: "/nope", app: "not-found", webgl2: false });
    page.run();
    expect(page.classes.has("has-flat-scene")).toBe(false);
  });

  test("storage refused", () => {
    const page = makePage({ webgl2: false, storage: refusing() });
    expect(() => page.run()).not.toThrow();
    expect(page.classes.has("has-flat-scene")).toBe(true);
    expect(page.classes.has("flat-slow")).toBe(false);
  });
});
