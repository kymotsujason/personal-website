// runs inline in the head before anything paints, so it can't import. it picks how the intro plays, adds has-3d
// when the scene can run (or has-flat-scene when the 2d scene can), and starts the watchdog that shows the flat
// page if the scene never does. a client side navigation keeps the window, so the flag makes it run once per page
// load
(function () {
  if (window.__headDone) {
    return;
  }
  window.__headDone = true;
  var root = document.documentElement;

  // what the scene fetches first, started here instead of once its code has loaded. as and crossorigin match the
  // loaders' own requests, or the browser fetches each file twice
  var PRELOADS = [
    "/models/phone.packed.glb",
    "/models/hands.packed.glb",
    "/models/hands-rig.json",
    "/keys/landscape-baked.json",
    "/keys/support.json",
    "/keys/pinch.json",
    "/keys/portrait-grips.json",
    "/desk-small.jpg",
    "/desk-wall-mask-small.png",
  ];

  // the same guard as storage.js, since a browser that refuses storage throws on access too
  function read(kind, key) {
    try {
      var store =
        kind === "session" ? window.sessionStorage : window.localStorage;
      return store ? store.getItem(key) : null;
    } catch (error) {
      return null;
    }
  }

  function write(kind, key, value) {
    try {
      var store =
        kind === "session" ? window.sessionStorage : window.localStorage;
      if (store) {
        store.setItem(key, value);
      }
    } catch (error) {
      // a refused write is dropped, as in storage.js
    }
  }

  function remove(kind, key) {
    try {
      var store =
        kind === "session" ? window.sessionStorage : window.localStorage;
      if (store) {
        store.removeItem(key);
      }
    } catch (error) {
      // a refused removal is dropped, as in storage.js
    }
  }

  // a shared link can carry ?2d or ?3d, which saves the same choice the version links save. the query comes off the
  // address bar, so a visitor who copies the url doesn't pass the choice on
  function versionFromQuery() {
    try {
      var params = new window.URLSearchParams(window.location.search);
      var choice = params.has("2d") ? "2d" : params.has("3d") ? "3d" : "";
      if (!choice) {
        return "";
      }
      params.delete("2d");
      params.delete("3d");
      var rest = params.toString();
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname +
          (rest ? "?" + rest : "") +
          window.location.hash,
      );
      return choice;
    } catch (error) {
      return "";
    }
  }

  // a reload, or back or forward into an app page, shows the page at once. otherwise a first visit plays the full
  // intro and a returning one the fast intro
  function arrivalFor(options) {
    var reloaded =
      options.navType === "reload" ||
      options.navType === "back_forward" ||
      options.recovery;
    if (reloaded && options.isApp) {
      return "page";
    }
    if (!options.introSeen) {
      return "full";
    }
    return "fast";
  }

  function navType() {
    try {
      var entry = window.performance.getEntriesByType("navigation")[0];
      return entry ? entry.type : "navigate";
    } catch (error) {
      return "navigate";
    }
  }

  // webgl drawn on the cpu runs the scene at a few frames a second. chrome on swiftshader still answers
  // failIfMajorPerformanceCaveat with a context, so the renderer's name is checked too
  var SOFTWARE =
    /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render driver/i;

  // firefox gives the real name as RENDERER and warns about the debug extension, while chrome and safari give a
  // generic name there and the real one only through it
  function softwareRenderer(gl) {
    var name = String(gl.getParameter(gl.RENDERER) || "");
    if (/^webkit webgl$/i.test(name)) {
      var info = gl.getExtension("WEBGL_debug_renderer_info");
      if (info) {
        name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || "");
      }
    }
    return SOFTWARE.test(name);
  }

  // strict also turns away a gpu the browser falls back from and webgl drawn in software, for a visitor who hasn't
  // asked for 3d
  function hasWebgl2(strict) {
    try {
      var gl = document
        .createElement("canvas")
        .getContext(
          "webgl2",
          strict ? { failIfMajorPerformanceCaveat: true } : undefined,
        );
      if (!gl) {
        return false;
      }
      var fast = !strict || !softwareRenderer(gl);
      var lose = gl.getExtension("WEBGL_lose_context");
      if (lose) {
        lose.loseContext();
      }
      return fast;
    } catch (error) {
      return false;
    }
  }

  // the scene saves the time it switched a slow device to the flat site (see scene/quality.js), and the 2d scene the
  // time it switched to the plain flat page under the key flatAuto. each holds for 30 days, so a browser update or a
  // new phone gets another try
  var AUTO_DAYS = 30;
  function autoRecent(key) {
    var saved = Number(read("local", key));
    if (!saved) {
      return false;
    }
    var age = new Date().getTime() - saved;
    return age >= 0 && age < AUTO_DAYS * 24 * 60 * 60 * 1000;
  }

  // the 2d scene needs inert, constructable stylesheets, and css sin(), so a browser without one gets the plain
  // flat page
  function meetsFlatFloor() {
    try {
      return (
        "inert" in window.HTMLElement.prototype &&
        "adoptedStyleSheets" in document &&
        window.CSS.supports("width: calc(sin(1rad) * 1px)")
      );
    } catch (error) {
      return false;
    }
  }

  var path = window.location.pathname.replace(/(.)\/+$/, "$1");
  var meta = document.querySelector('meta[name="build-id"]');
  var buildId = meta ? meta.content : "";
  // the page's app from the server (home on the home screen, not-found on the not found page), or from the path
  // without it
  var appMeta = document.querySelector('meta[name="page-app"]');
  var pageApp = appMeta ? appMeta.content : path === "/" ? "home" : "";
  // the scene has no app for the not found page, so it shows as the flat site
  var notFound = pageApp === "not-found";
  var isApp = pageApp !== "home" && !notFound;
  // the layout's recovery reload sets "1" just before it loads this page. it counts as a reload this once, and the
  // key stays as "used", so the layout never reloads for this path and build again and a later visit is a visit
  var recoveryKey = "recovery:" + path + ":" + buildId;
  var recovery = read("session", recoveryKey) === "1";
  if (recovery) {
    write("session", recoveryKey, "used");
  }
  var arrival = arrivalFor({
    navType: navType(),
    isApp: isApp,
    introSeen: read("local", "introSeen") === "1",
    recovery: recovery,
  });
  window.__arrival = arrival;

  window.__uaTransition = false;
  window.addEventListener("popstate", function (event) {
    window.__uaTransition = Boolean(event.hasUAVisualTransition);
  });

  // a scene gets 10 s of the page being visible to show its first frame. a tab opened in the background runs no
  // frames, so hidden time doesn't count. when it gives up it tells the layout, which stops a scene still loading.
  // shownFlag is the window flag that scene sets on its first frame, and classes are the root classes it drops
  function startWatchdog(shownFlag, classes) {
    var left = 10000;
    var since = 0;
    var timer = null;
    var over = false;
    function giveUp() {
      timer = null;
      over = true;
      if (window[shownFlag]) {
        return;
      }
      // a handoff from 3d to 2d takes has-3d away, and the 2d scene it hands to has a watchdog of its own
      if (!root.classList.contains(classes[0])) {
        return;
      }
      root.classList.add("scene-failed");
      for (var i = 0; i < classes.length; i++) {
        root.classList.remove(classes[i]);
      }
      try {
        window.dispatchEvent(new window.Event("scene-failed"));
      } catch (error) {
        // the class is what the page and the layout check, the event only hurries a scene that's still loading
      }
    }
    function run() {
      if (over || timer !== null || document.hidden) {
        return;
      }
      since = window.performance.now();
      timer = window.setTimeout(giveUp, left);
    }
    function pause() {
      if (timer === null) {
        return;
      }
      window.clearTimeout(timer);
      timer = null;
      left -= window.performance.now() - since;
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        pause();
      } else {
        run();
      }
    });
    run();
  }

  function preload() {
    for (var i = 0; i < PRELOADS.length; i++) {
      var link = document.createElement("link");
      link.rel = "preload";
      link.href = PRELOADS[i];
      link.as = "fetch";
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    }
  }

  // a first sky from the clock, before anything paints, so a page that waits on the scene or on the layout script
  // doesn't flash the night colors. it's the clear sky without the sun or the dusk, and lib/sky.js (the layout
  // script, then the scene) replaces it with the real one
  function paintSky() {
    var now = new Date();
    var hour = now.getHours() + now.getMinutes() / 60;
    var t = Math.min(Math.max(Math.min(hour - 6, 20 - hour) / 2, 0), 1);
    var day = t * t * (3 - 2 * t);
    function mix(night, noon) {
      return Math.round((night + (noon - night) * day) * 255);
    }
    root.style.setProperty(
      "--sky-top",
      "rgb(" +
        [mix(0.05, 0.17), mix(0.07, 0.42), mix(0.2, 0.8)].join(", ") +
        ")",
    );
    root.style.setProperty(
      "--sky-low",
      "rgb(" +
        [mix(0.24, 0.47), mix(0.18, 0.7), mix(0.42, 0.94)].join(", ") +
        ")",
    );
    root.style.setProperty("--stars", String(1 - day));
    root.style.setProperty("--dim-top", String(0.15 + 0.2 * day));
    root.style.setProperty("--dim-low", String(0.35 + 0.25 * day));
  }
  paintSky();

  // the query wins for this load even when storage refuses to save it. "2d" is "1" for the 2d choice and "0" for the
  // 3d one, and with neither the site decides from the device
  var version = versionFromQuery();
  if (version === "2d") {
    write("local", "2d", "1");
    remove("local", "flatAuto");
  } else if (version === "3d") {
    write("local", "2d", "0");
    remove("local", "2dAuto");
    remove("local", "flatAuto");
  }
  var saved = read("local", "2d");
  var choice = version || (saved === "1" ? "2d" : saved === "0" ? "3d" : "");
  // the scene only switches a slow device to the flat site when the visitor hasn't chosen 3d
  window.__chose3d = choice === "3d";
  var show3d =
    !notFound &&
    (choice === "3d"
      ? hasWebgl2(false)
      : choice === "" && !autoRecent("2dAuto") && hasWebgl2(true));

  var flatSlow = autoRecent("flatAuto");
  if (flatSlow) {
    root.classList.add("flat-slow");
  }
  if (show3d) {
    root.classList.add("has-3d");
    preload();
    startWatchdog("__sceneShown", ["has-3d", "page-first"]);
  } else if (!notFound && !flatSlow && meetsFlatFloor()) {
    root.classList.add("has-flat-scene");
    // the 2d scene's watchdog starts here and not in the layout script, so a layout script that never runs (a chunk
    // a deploy removed, or offline) can't leave #page hidden under has-flat-scene
    startWatchdog("__flatShown", [
      "has-flat-scene",
      "flat-ready",
      "page-first",
    ]);
  }
  if (arrival === "page") {
    root.classList.add("page-first");
  }
})();
