// the charging cable in the 2d scene, as scene/charger.js has it in 3d: at 1% the left hand fetches the cable and plugs
// it into the flap's bottom edge, and at 100% it unplugs it. the hands and the cable are captured frame sets played by
// time (charger-<orientation>-<open|closed>), with the unplug the plug played backwards, and the phone's own move is
// worked out at run time with the 3d math (shared/charging.js chargeMove) and added to the pose the stage draws. while
// the cable is in, the fold sets are the cable versions (cable-*), and only one version is decoded at a time, with one
// charger set. folds wait for a run (fold.js), a run waits for a fold, and a run while an app is zoomed or with reduced
// motion ends at once. nothing the charger loads can drop the scene: a set that doesn't come leaves it with no cable
import {
  CHARGE_TOTAL,
  PLUG_HOME,
  chargeMove,
  chargerWanted,
  swapSchedule,
} from "../scene/shared/charging.js";
import { fitInView } from "../scene/shared/placement.js";

// how long a run's fold set swap may take to decode before the run gives the cable up (ms from the run's start), so a
// stalled decode can't hold the folds for long
export const SWAP_CAP = 3500;
// the battery level from which a charging phone has its charger set decoded for the unplug at 100%. it charges a level
// about every 1.2 s, so that's about 12 s ahead
export const UNPLUG_SOON = 90;

export const chargerSetFor = ({ portrait, open }) =>
  `charger-${portrait ? "portrait" : "landscape"}-${open ? "open" : "closed"}`;

// the fold sets with the cable in or out: portrait has its opening set (with the lead) and its closing one
export const foldSetsFor = ({ portrait, cable }) => {
  const prefix = cable ? "cable-" : "";
  return portrait
    ? { open: `${prefix}portrait-open`, close: `${prefix}portrait-close` }
    : { open: `${prefix}landscape`, close: null };
};

// where a run of total ms is, elapsed ms in: the plug's own time (ms, which picks the frame), and how far along its own
// part the left hand is (s). a run is longer than the hand's part by the right hand's grip swap at each end, which the
// closed landscape phone doesn't have (its right hand already holds it alone)
export const runAt = ({ plugIn, elapsed, total }) => {
  const e = Math.min(Math.max(elapsed, 0), total);
  const plugT = plugIn ? e : total - e;
  const swap = Math.max(0, (total / 1000 - CHARGE_TOTAL) / 2);
  return { plugT, left: swapSchedule(plugT / 1000, swap, CHARGE_TOTAL).left };
};

// scene is the phone's state (fold, busy, zoomed, drawing, portrait, appVisible, pose, shownPose, openFrames,
// closeFrames, stage, edges(), reduced()), loop the scene's loop. sets.fetch(name) downloads a set's manifest and
// images without decoding them, sets.forget(bytes) lets those go, sets.open(name, bytes) gives { manifest, layer } with
// the layer in the stage and not yet decoded (from the bytes fetched, or from the network with none), and
// sets.release(entry) lets a layer go. onCable hears the bolt's state change
export const createCharger = ({
  scene,
  loop,
  sets,
  onCable = () => {},
  warn = (...args) => console.warn(...args),
  swapCap = SWAP_CAP,
}) => {
  // what the battery wants (the cable in while charging), and what the fold sets show
  let target = false;
  let wanted = false;
  let level = 100;
  let plugged = false;
  // a set that didn't come leaves the visit with no cable, as a 3d chunk that didn't load does
  let failed = false;
  // the sets fetched ahead for this mount, by name: { value, failed }, value once the bytes are in
  let fetched = new Map();
  // the one charger set decoded, for the open or the closed phone
  let chargerSet = null;
  // the cable asked for before the charger's bytes were in goes in at once when they are, as 3d's buildCharger snaps it
  let snapNext = false;
  let run = null;
  let swap = null;
  let dropping = null;
  let removeStep = null;
  let waiters = [];
  let shownCable = null;
  let lastNow = 0;

  const release = (entry) => {
    if (entry) {
      sets.release(entry);
    }
  };

  const chargerNames = () =>
    [true, false].map((open) =>
      chargerSetFor({ portrait: scene.portrait, open }),
    );
  const foldNames = (cable) => {
    const names = foldSetsFor({ portrait: scene.portrait, cable });
    return [names.open, names.close].filter(Boolean);
  };
  const isFetched = (names) =>
    names.every((name) => fetched.get(name)?.value != null);

  // opens and decodes the named sets together, from their fetched bytes where there are some. track gets each one as
  // it's made, so a newer swap can let it go part way through its decode
  const openSets = (names, track) =>
    Promise.allSettled(
      names.map(async (name) => {
        if (!name) {
          return null;
        }
        const entry = await sets.open(name, fetched.get(name)?.value ?? null);
        track.push(entry);
        if (track.dropped) {
          release(entry);
          throw new Error(`the ${name} frames were dropped`);
        }
        await entry.layer.decode();
        return entry;
      }),
    ).then((results) => {
      const failure = results.find((r) => r.status === "rejected");
      if (failure) {
        track.forEach(release);
        throw failure.reason;
      }
      return results.map((r) => r.value);
    });

  const drop = (track) => {
    track.dropped = true;
    track.forEach(release);
  };

  const busy = () => run !== null;

  const idle = () =>
    busy()
      ? new Promise((resolve) => {
          waiters.push(resolve);
        })
      : Promise.resolve();

  const letFoldsGo = () => {
    if (busy()) {
      return;
    }
    const waiting = waiters;
    waiters = [];
    waiting.forEach((resolve) => resolve());
  };

  const runNow = () => runAt(run);

  // whether the cable is in the port as the frames show it: from the push onward in a plug, and up to it in an unplug
  const cableIn = () => {
    if (!run) {
      return plugged;
    }
    return run.done ? run.plugIn : runNow().left >= PLUG_HOME;
  };

  // the bolt shows once the cable is in, not while the hand is still fetching it. with no charger or cable to play (not
  // loaded, or not fetched yet) it shows as soon as the battery charges, as 3d's does with no cable module
  const bolt = (status) =>
    Boolean(status.charging) &&
    (failed ||
      cableIn() ||
      !isFetched(chargerNames()) ||
      !isFetched(foldNames(true)));

  const reportCable = () => {
    const now = cableIn();
    if (now !== shownCable) {
      shownCable = now;
      onCable();
    }
  };

  const releaseChargerSet = () => {
    if (chargerSet) {
      drop(chargerSet.track);
      chargerSet = null;
    }
  };

  const stopStep = () => {
    if (removeStep) {
      removeStep();
      removeStep = null;
    }
  };

  const ensureStep = () => {
    if (!removeStep) {
      removeStep = loop.add(step);
    }
  };

  // the cable free sets back with no run to cover the change (the charger's sets didn't come on a visit that started
  // with the cable in). they decode beside the cable ones, and go in on a frame with no fold moving
  const dropCable = () => {
    const track = [];
    const next = { track, ready: false, open: null, close: null };
    dropping = next;
    openSets(foldNames(false), track).then(
      ([open, close]) => {
        if (dropping !== next) {
          return;
        }
        Object.assign(next, { ready: true, open, close: close ?? null });
        ensureStep();
        loop.wake();
      },
      (error) => {
        if (dropping === next) {
          dropping = null;
          warn(
            "the cable free frames didn't come back, so the cable stays",
            error,
          );
        }
      },
    );
  };

  const applyDrop = () => {
    if (!dropping?.ready || scene.busy) {
      return;
    }
    const old = [scene.openFrames, scene.closeFrames];
    scene.openFrames = dropping.open;
    scene.closeFrames = dropping.close;
    old.forEach(release);
    dropping = null;
    plugged = false;
    reportCable();
    loop.wake();
  };

  const giveUp = (error) => {
    if (failed) {
      return;
    }
    failed = true;
    snapNext = false;
    warn("the charging cable didn't load", error);
    if (!run) {
      releaseChargerSet();
      if (plugged) {
        dropCable();
      }
    }
    reportCable();
  };

  // the fold sets for the cable in or out. the ones showing at rest go first, so only one version is ever decoded,
  // and the run's frames cover the phone until the new ones are in. their bytes were fetched ahead, so this only decodes
  const swapTo = (cable, fallback = false) => {
    if (swap) {
      drop(swap.track);
    }
    release(scene.openFrames);
    release(scene.closeFrames);
    const names = foldSetsFor({ portrait: scene.portrait, cable });
    const next = {
      cable,
      ready: false,
      stuck: false,
      track: [],
      started: lastNow,
      fallback,
    };
    swap = next;
    openSets([names.open, names.close], next.track).then(
      ([open, close]) => {
        if (swap !== next) {
          return;
        }
        scene.openFrames = open;
        scene.closeFrames = close;
        next.ready = true;
        loop.wake();
      },
      (error) => {
        if (swap === next && !next.stuck) {
          swapFailed(next, error);
        }
      },
    );
  };

  // a swap that failed or took too long ends the run on the side it came from, with those sets back and no more cable
  // this visit. if they don't come back either, the run holds its end frame and the folds stay held, and the rest of the
  // scene runs on
  const swapFailed = (failing, error) => {
    drop(failing.track);
    if (failing.fallback) {
      failing.stuck = true;
      warn(
        "the phone's fold frames didn't come back, so the folds stay held",
        error,
      );
      return;
    }
    failed = true;
    snapNext = false;
    warn("the cable's fold frames didn't load", error);
    run.plugIn = !failing.cable;
    run.elapsed = run.total;
    run.done = true;
    swapTo(!failing.cable, true);
  };

  const half = () => scene.fold < 0.5;

  const ready = () =>
    chargerSet !== null &&
    chargerSet.ready &&
    chargerSet.open === half() &&
    isFetched(foldNames(target));

  const pending = () => !failed && target !== plugged;

  const begin = () => {
    const { entry, open } = chargerSet;
    const { total } = entry.manifest.charger;
    // the frames are behind the page while an app is zoomed, and reduced motion plugs it in at once, as in 3d
    const skip = snapNext || scene.zoomed || scene.reduced();
    snapNext = false;
    run = {
      plugIn: target,
      open,
      entry,
      total,
      elapsed: skip ? total : 0,
      done: skip,
      fit: null,
    };
    swapTo(target);
  };

  const finish = () => {
    plugged = run.plugIn;
    run = null;
    swap = null;
    if (failed) {
      releaseChargerSet();
    }
    reportCable();
    letFoldsGo();
    manage();
    loop.wake();
  };

  // the cable turned around part way runs the same timeline back from where it is, as 3d's start does
  const turnAround = () => {
    run.plugIn = target;
    run.elapsed = run.total - run.elapsed;
    run.done = run.elapsed >= run.total;
    swapTo(target);
  };

  const step = (now, dt) => {
    lastNow = now;
    if (!scene.stage) {
      return;
    }
    if (dropping) {
      applyDrop();
    }
    if (!run) {
      if (!pending() || !ready()) {
        if (!dropping) {
          stopStep();
        }
        return;
      }
      // a run waits for a fold or an app's move to end, and for the intro
      if (scene.busy || !scene.drawing) {
        return;
      }
      begin();
    }
    if (swap?.stuck) {
      stopStep();
      return;
    }
    if (!run.done) {
      // reduced motion part way through finishes at once, as in 3d, and so does an app zoomed over the frames or a
      // fold the run didn't start on (a navigation can show the open phone at once)
      if (scene.reduced() || scene.zoomed || half() !== run.open) {
        run.elapsed = run.total;
      } else {
        run.elapsed = Math.min(run.elapsed + dt, run.total);
      }
      // the rise is worked out once per run, from where the phone is as the run starts (scene/loop.js chargeFit)
      if (!run.fit) {
        const pose = scene.shownPose ?? scene.pose;
        const { width, height } = scene.stage.geometry;
        run.fit = fitInView({
          outer: scene.edges().outer,
          z: pose.z,
          width,
          height,
        });
      }
      run.done = run.elapsed >= run.total;
    }
    if (swap && !swap.ready && now - swap.started >= swapCap) {
      swapFailed(swap, new Error("the fold frames took too long to decode"));
    }
    reportCable();
    if (run.done && swap?.ready) {
      finish();
    }
  };

  const fetchAhead = (name) => {
    if (fetched.has(name)) {
      return;
    }
    const record = { value: null, failed: false };
    const mine = fetched;
    mine.set(name, record);
    sets.fetch(name).then(
      (value) => {
        if (fetched !== mine) {
          sets.forget(value);
          return;
        }
        record.value = value;
        manage();
        loop.wake();
      },
      (error) => {
        if (fetched === mine) {
          record.failed = true;
          giveUp(error);
        }
      },
    );
  };

  // the charger set is decoded while a plug is near (5% and below), from 90% while charging for the unplug, and while
  // a run is asked for. most of the charge holds none
  const chargerNeeded = () =>
    target !== plugged ||
    (!plugged && wanted) ||
    (plugged && target && level >= UNPLUG_SOON);

  const decodeChargerSet = (open) => {
    const track = [];
    const next = { open, entry: null, ready: false, track };
    chargerSet = next;
    openSets([chargerSetFor({ portrait: scene.portrait, open })], track).then(
      ([entry]) => {
        if (chargerSet !== next) {
          return;
        }
        next.entry = entry;
        next.ready = true;
        if (pending()) {
          ensureStep();
        }
        loop.wake();
      },
      (error) => {
        if (chargerSet === next) {
          chargerSet = null;
          giveUp(error);
        }
      },
    );
  };

  // on each drawn frame, a battery change, and each fetch or decode that lands: fetch ahead while the cable is wanted,
  // keep the charger set for the phone's half decoded only while it's needed (swapping it once a fold has ended), and
  // start the step once a run can begin
  const manage = () => {
    if (failed || !scene.stage || !scene.drawing) {
      return;
    }
    if (wanted) {
      chargerNames().forEach(fetchAhead);
      foldNames(!plugged).forEach(fetchAhead);
    }
    if (!run) {
      if (!chargerNeeded()) {
        releaseChargerSet();
      } else if (
        isFetched(chargerNames()) &&
        !scene.busy &&
        chargerSet?.open !== half()
      ) {
        releaseChargerSet();
        decodeChargerSet(half());
      }
    }
    if ((pending() && ready()) || dropping) {
      ensureStep();
    }
  };
  loop.onDraw(() => manage());

  // the battery's state, on each change and once the intro is over
  const battery = (status) => {
    wanted = chargerWanted(status);
    level = status.level;
    const next = Boolean(status.charging);
    if (next !== target) {
      target = next;
      if (!failed) {
        if (run && run.plugIn !== target) {
          turnAround();
        } else if (!run) {
          snapNext = target !== plugged && !isFetched(chargerNames());
        }
      }
    }
    manage();
    reportCable();
  };

  // what the stage shows while a run plays or holds its end: the run's own charger set, and its frame
  const shown = () => {
    if (!run) {
      return null;
    }
    const { entry } = run;
    const plugT = run.done
      ? run.plugIn
        ? entry.manifest.charger.total
        : 0
      : runNow().plugT;
    return {
      manifest: entry.manifest,
      layer: entry.layer,
      index: entry.layer.indexAt(plugT),
    };
  };

  // the pose with the phone's move for the run on it, the shake, the sag, the tilt, the rise, and the bump
  const move = (pose, now) => {
    if (!run || run.done) {
      return pose;
    }
    return chargeMove({
      pose,
      left: runNow().left,
      fit: run.fit,
      seconds: now / 1000,
      portrait: scene.portrait,
      fold: scene.fold,
      appVisible: scene.appVisible,
    });
  };

  // a new mount: its stage let every layer go, the bytes fetched for the old one go too, and its fold sets have the
  // cable in or not
  const mounted = ({ plugged: cable }) => {
    run = null;
    if (swap) {
      drop(swap.track);
      swap = null;
    }
    if (dropping) {
      drop(dropping.track);
      dropping = null;
    }
    releaseChargerSet();
    fetched.forEach((record) => {
      if (record.value != null) {
        sets.forget(record.value);
      }
    });
    fetched = new Map();
    snapNext = false;
    plugged = cable;
    stopStep();
    letFoldsGo();
    shownCable = null;
  };

  const state = () => {
    const now = shown();
    return {
      ready: chargerSet?.ready ?? false,
      fetched: isFetched(chargerNames()) && isFetched(foldNames(!plugged)),
      chargerSet: chargerSet ? (chargerSet.open ? "open" : "closed") : null,
      failed,
      target,
      plugged,
      busy: busy(),
      running: Boolean(run && !run.done),
      stuck: Boolean(swap?.stuck),
      plugIn: run ? run.plugIn : null,
      elapsed: run ? run.elapsed : null,
      total: run ? run.total : null,
      set: now ? now.manifest.set : null,
      index: now ? now.index : null,
      folds: scene.openFrames?.manifest.set ?? null,
    };
  };

  return {
    battery,
    mounted,
    busy,
    idle,
    moving: () => Boolean(run && !run.done),
    shown,
    move,
    bolt,
    state,
  };
};
