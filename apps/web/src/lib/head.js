// runs inline in the head before anything paints, so it can't import. it picks how the intro plays, adds has-3d
// when the scene can run, and starts the watchdog that shows the flat page if the scene never does. a client side
// navigation keeps the window, so the flag makes it run once per page load
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

  function hasWebgl2() {
    try {
      var gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) {
        return false;
      }
      var lose = gl.getExtension("WEBGL_lose_context");
      if (lose) {
        lose.loseContext();
      }
      return true;
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

  // the scene gets 10 s of the page being visible to show its first frame. a tab opened in the background runs no
  // frames, so hidden time doesn't count. when it gives up it tells the layout, which stops a scene still loading
  function startWatchdog() {
    var left = 10000;
    var since = 0;
    var timer = null;
    var over = false;
    function giveUp() {
      timer = null;
      over = true;
      if (window.__sceneShown) {
        return;
      }
      root.classList.add("scene-failed");
      root.classList.remove("has-3d", "page-first");
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

  if (!notFound && read("local", "2d") !== "1" && hasWebgl2()) {
    root.classList.add("has-3d");
    preload();
    startWatchdog();
  }
  if (arrival === "page") {
    root.classList.add("page-first");
  }
})();
