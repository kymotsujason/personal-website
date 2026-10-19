// the site's music and youtube's player, run by the layout so they work with or without the scene. the player's code
// (music.js and youtube.js) is a later chunk, loaded on a visitor's first gesture or at once on the music page
import {
  LEVEL_STEPS,
  artFor,
  cleanTitle,
  savedLevel,
} from "../scene/musicInfo.js";
import { storageAdapter } from "../lib/storage.js";
import TRACKS from "../data/tracks.json";

const STILL_WAIT_MS = 250;

const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const host = document.getElementById("player-host");
const frame = document.createElement("div");
host?.appendChild(frame);

const storage = storageAdapter("local");
const listeners = new Set();
let phoneMoving = null;
let core = null;
let loading = null;

// youtube loading while the phone moved made 100 to 300 ms frames on an iphone, and a failed scene drops has-3d
const whenStill = (fn) => {
  if (
    root.classList.contains("has-3d") &&
    (phoneMoving === null || phoneMoving())
  ) {
    setTimeout(() => whenStill(fn), STILL_WAIT_MS);
    return;
  }
  fn();
};

const markCurrent = () => {
  const { index } = music.state();
  document
    .querySelectorAll("#page .music .tracks li[data-track]")
    .forEach((item) => {
      if (item instanceof HTMLElement) {
        item.classList.toggle("current", Number(item.dataset.track) === index);
      }
    });
};

const setText = (el, text) => {
  if (el && el.textContent !== text) {
    el.textContent = text;
  }
};

// an art img in the music page's backdrop has loaded or failed. the front img is the one showing, and a new track's
// art loads in the other one (marked wait), which takes the front once it's in. art that fails hides the backdrop,
// so the sky shows, since the art left behind would be the wrong track's
const settleArt = (img) => {
  const backdrop = img.parentElement;
  if (!backdrop?.matches("#page > .backdrop")) {
    return;
  }
  const ok = img.naturalWidth > 0;
  if (img.classList.contains("front")) {
    if (!backdrop.querySelector("img.wait")) {
      backdrop.classList.toggle("ready", ok);
      backdrop.classList.toggle("failed", !ok);
    }
    return;
  }
  if (!img.classList.contains("wait")) {
    return;
  }
  img.classList.remove("wait");
  backdrop.classList.toggle("ready", ok);
  backdrop.classList.toggle("failed", !ok);
  if (!ok) {
    return;
  }
  const old = backdrop.querySelector("img.front");
  img.classList.add("front");
  if (!old) {
    return;
  }
  old.classList.remove("front", "fade");
  if (reduced.matches) {
    old.classList.add("spent");
    return;
  }
  img.classList.add("fade");
  img.addEventListener(
    "animationend",
    () => {
      img.classList.remove("fade");
      if (!old.classList.contains("front") && !old.classList.contains("wait")) {
        old.classList.add("spent");
      }
    },
    { once: true },
  );
};

const showArt = (backdrop, art) => {
  const front = backdrop.querySelector("img.front");
  if (!(front instanceof HTMLImageElement)) {
    return;
  }
  let back = backdrop.querySelector("img:not(.front)");
  const waiting = back?.classList.contains("wait");
  if (front.getAttribute("src") === art && !waiting) {
    // back to the track showing, after another track's art failed and hid the backdrop
    if (front.complete) {
      backdrop.classList.toggle("ready", front.naturalWidth > 0);
      backdrop.classList.toggle("failed", front.naturalWidth === 0);
    }
    return;
  }
  if (!(back instanceof HTMLImageElement)) {
    back = document.createElement("img");
    back.alt = "";
    backdrop.append(back);
  }
  back.classList.remove("spent", "fade");
  back.classList.add("wait");
  if (back.getAttribute("src") !== art) {
    back.src = art;
  } else if (back.complete) {
    settleArt(back);
  }
};

// the music page's now playing area, its backdrop, and its play pill follow the music. the server's html shows the
// first track, which is also what the music reports before its code has loaded
const showNow = () => {
  const page = document.querySelector('#page[data-page="music"]');
  if (!page) {
    return;
  }
  const { current, playing } = music.state();
  setText(
    page.querySelector('[data-music="toggle"]'),
    playing ? "Pause" : "Play",
  );
  if (!current) {
    return;
  }
  setText(page.querySelector(".now-title"), cleanTitle(current.title));
  setText(page.querySelector(".now-channel"), current.channel);
  const backdrop = page.querySelector(":scope > .backdrop");
  if (backdrop) {
    showArt(backdrop, current.art);
  }
};

// art that finished before this script ran, or before a swap's listeners could see it
const checkArt = () => {
  document.querySelectorAll("#page > .backdrop img").forEach((img) => {
    if (img instanceof HTMLImageElement && img.complete) {
      settleArt(img);
    }
  });
};

const onArt = (event) => {
  if (event.target instanceof HTMLImageElement) {
    settleArt(event.target);
  }
};

const loadCore = () => {
  loading ??= Promise.all([
    import("../scene/music.js"),
    import("../scene/youtube.js"),
  ])
    .then(([{ createMusic }, { youtubePlayer }]) => {
      core = createMusic({
        tracks: TRACKS,
        loadPlayer: (events) => whenStill(() => youtubePlayer(frame)(events)),
        storage,
        onChange: (state) => {
          markCurrent();
          listeners.forEach((fn) => fn(state));
        },
      });
      return core;
    })
    .catch((error) => {
      // the next gesture asks again
      loading = null;
      console.warn("the music player didn't load", error);
      throw error;
    });
  return loading;
};

// runs now when the player's code is here, and otherwise once it has loaded, in the order the calls came
const withCore = (fn) => {
  if (core) {
    fn(core);
    return;
  }
  loadCore().then(fn, () => {});
};

// the core drops a previous or next before youtube's player is ready, so a press waits for it
const whenReady = (fn) =>
  withCore((c) => {
    if (c.state().ready) {
      fn(c);
      return;
    }
    c.load();
    const stop = music.subscribe((state) => {
      if (state.ready) {
        stop();
        fn(c);
      }
    });
  });

// what the music reports until its code has loaded: the first track, not playing, at the saved volume level
const tracks = TRACKS.map(({ id, title, channel }) => ({
  id,
  title,
  channel,
  art: artFor(id),
}));
let waitingLevel = savedLevel(storage);
const waitingState = () => ({
  ready: false,
  ids: tracks.map((track) => track.id),
  index: 0,
  playing: false,
  tracks,
  current: tracks[0] ?? null,
  volume: null,
  level: waitingLevel,
  failed: false,
});

// the scene gets this object instead of the music itself, since the music loads on demand
export const music = {
  state: () => (core ? core.state() : waitingState()),
  position: () => (core ? core.position() : { time: 0, duration: 0, at: 0 }),
  toggle: () => withCore((c) => c.toggle()),
  previous: () => core?.previous(),
  next: () => core?.next(),
  seek: (at) => core?.seek(at),
  level: () => (core ? core.level() : waitingLevel),
  stepLevel: (delta) => {
    if (core) {
      return core.stepLevel(delta);
    }
    waitingLevel = Math.min(LEVEL_STEPS, Math.max(0, waitingLevel + delta));
    withCore((c) => c.stepLevel(delta));
    return waitingLevel;
  },
  loadPlayer: () => withCore((c) => c.load()),
  subscribe: (fn) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  waitWhile: (fn) => {
    phoneMoving = fn;
  },
};

// a script added before the load event holds that event until youtube answers
const loadOnMusicPage = () => {
  if (
    root.classList.contains("has-3d") ||
    document.getElementById("page")?.dataset.app !== "Music"
  ) {
    return;
  }
  if (document.readyState === "complete") {
    music.loadPlayer();
  } else {
    addEventListener("load", () => music.loadPlayer(), { once: true });
  }
};

// a first press on the card's own buttons, or the music page's, is left to them, so one press doesn't resume and
// toggle both
const onFirstGesture = (event) => {
  removeEventListener("pointerup", onFirstGesture, true);
  removeEventListener("keydown", onFirstGesture, true);
  const target = event.target instanceof Element ? event.target : null;
  const onControl = Boolean(
    target?.closest(".music-card [data-control], #page [data-music]"),
  );
  withCore((c) => {
    c.load();
    if (!onControl) {
      c.resume();
    }
  });
};
addEventListener("pointerup", onFirstGesture, { capture: true });
addEventListener("keydown", onFirstGesture, { capture: true });

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const control = target?.closest("#page [data-music]");
  if (control instanceof HTMLElement) {
    const action = control.dataset.music;
    if (action === "toggle") {
      music.toggle();
    } else if (action === "previous") {
      whenReady((c) => c.previous());
    } else if (action === "next") {
      whenReady((c) => c.next());
    }
    return;
  }
  const item = target?.closest("#page [data-track]");
  if (item instanceof HTMLElement) {
    const index = Number(item.dataset.track);
    withCore((c) => c.playAt(index));
  }
});

// an img's load and error events don't bubble, so they're caught on the way down
document.addEventListener("load", onArt, true);
document.addEventListener("error", onArt, true);
music.subscribe(showNow);

document.addEventListener("astro:after-swap", () => {
  markCurrent();
  checkArt();
  showNow();
  loadOnMusicPage();
});
addEventListener("scene-failed", loadOnMusicPage);
markCurrent();
checkArt();
showNow();
loadOnMusicPage();
