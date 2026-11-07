// the charging cable in the 2d scene, as scene/charger.js has it in 3d: at 1% the left hand fetches the cable and plugs
// it into the flap's bottom edge, and at 100% it unplugs it. the hands and the cable are captured frame sets played by
// time (charger-<orientation>-<open|closed>), with the unplug the plug played backwards, and the phone's own move is
// worked out at run time with the 3d math (shared/charging.js chargeMove) and added to the pose the stage draws. while
// the cable is in, the fold sets are the cable versions (cable-*), and only one version is decoded at a time. folds
// wait for a run (fold.js), a run waits for a fold, and a run while an app is zoomed or with reduced motion ends at once
import {
  CHARGE_TOTAL,
  PLUG_HOME,
  chargeMove,
  chargerWanted,
  swapSchedule,
} from "../scene/shared/charging.js";
import { fitInView } from "../scene/shared/placement.js";

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
// closeFrames, stage, edges(), reduced()), loop the scene's loop. sets.open(name) gives { manifest, layer } with the
// layer in the stage and not yet decoded, and sets.release(entry) lets one go. onCable hears the bolt's state change,
// and onFail fails the scene when the cable free sets can't come back
export const createCharger = ({
  scene,
  loop,
  sets,
  onCable = () => {},
  onFail = (error) => {
    throw error;
  },
  warn = (...args) => console.warn(...args),
}) => {
  // what the battery wants (the cable in while charging), and what the fold sets show
  let target = false;
  let wanted = false;
  let plugged = false;
  // a set that didn't load leaves the visit with no cable, as a 3d chunk that didn't load does
  let failed = false;
  let chargerSets = null;
  let loading = null;
  // the cable asked for while the charger's sets loaded goes in at once, as 3d's buildCharger snaps it
  let snapNext = false;
  let run = null;
  let swap = null;
  let dropping = null;
  let removeStep = null;
  let waiters = [];
  let shownCable = null;

  const release = (entry) => {
    if (entry) {
      sets.release(entry);
    }
  };

  // opens and decodes the named sets together. track gets each one as it's made, so a newer swap can let it go part
  // way through its decode
  const openSets = (names, track) =>
    Promise.allSettled(
      names.map(async (name) => {
        if (!name) {
          return null;
        }
        const entry = await sets.open(name);
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

  // the bolt shows once the cable is in, not while the hand is still fetching it. with no charger sets to play it shows
  // as soon as the battery charges, as 3d's does with no cable module
  const bolt = (status) =>
    Boolean(status.charging) && (failed || chargerSets === null || cableIn());

  const reportCable = () => {
    const now = cableIn();
    if (now !== shownCable) {
      shownCable = now;
      onCable();
    }
  };

  const releaseChargerSets = () => {
    if (chargerSets) {
      release(chargerSets.open);
      release(chargerSets.closed);
      chargerSets = null;
    }
    if (loading) {
      drop(loading);
      loading = null;
    }
  };

  // the cable free sets back with no run to cover the change (the charger's sets didn't load), decoded before the cable
  // ones go, so the phone always has frames
  const dropCable = () => {
    const track = [];
    dropping = track;
    const names = foldSetsFor({ portrait: scene.portrait, cable: false });
    openSets([names.open, names.close], track).then(
      ([open, close]) => {
        if (dropping !== track) {
          return;
        }
        dropping = null;
        const old = [scene.openFrames, scene.closeFrames];
        scene.openFrames = open;
        scene.closeFrames = close;
        old.forEach(release);
        plugged = false;
        reportCable();
        loop.wake();
      },
      (error) => {
        if (dropping === track) {
          onFail(error);
        }
      },
    );
  };

  const giveUp = (error) => {
    failed = true;
    warn("the charging cable didn't load", error);
    releaseChargerSets();
    if (plugged && !run) {
      dropCable();
    }
    reportCable();
  };

  // the fold sets for the cable in or out. the ones showing at rest go first, so only one version is ever decoded,
  // and the run's frames cover the phone until the new ones are in
  const swapTo = (cable) => {
    if (swap) {
      drop(swap.track);
    }
    release(scene.openFrames);
    release(scene.closeFrames);
    const names = foldSetsFor({ portrait: scene.portrait, cable });
    const next = { cable, ready: false, track: [] };
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
        if (swap !== next) {
          return;
        }
        if (!cable) {
          onFail(error);
          return;
        }
        // with no cable sets the run ends on its unplugged end, and the cable free sets come back
        failed = true;
        warn("the cable's fold frames didn't load", error);
        if (run) {
          run.plugIn = false;
          run.elapsed = run.total;
          run.done = true;
        }
        swapTo(false);
      },
    );
  };

  const begin = () => {
    const open = scene.fold < 0.5;
    const entry = open ? chargerSets.open : chargerSets.closed;
    const { total } = entry.manifest.charger;
    // the frames are behind the page while an app is zoomed, and reduced motion plugs it in at once, as in 3d
    const skip = snapNext || scene.zoomed || scene.reduced();
    snapNext = false;
    run = {
      plugIn: target,
      open,
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
    if (failed || (!wanted && !plugged && !target)) {
      releaseChargerSets();
    }
    reportCable();
    letFoldsGo();
    loop.wake();
  };

  const stopStep = () => {
    if (removeStep) {
      removeStep();
      removeStep = null;
    }
  };

  const pending = () => chargerSets !== null && !failed && target !== plugged;

  const step = (_now, dt) => {
    if (!scene.stage) {
      return;
    }
    if (!run) {
      if (!pending()) {
        stopStep();
        return;
      }
      // a run waits for a fold or an app's move to end, and for the intro
      if (scene.busy || !scene.drawing) {
        return;
      }
      begin();
    }
    if (!run.done) {
      // reduced motion part way through finishes at once, as in 3d, and so does an app zoomed over the frames or a
      // fold the run didn't start on (a navigation can show the open phone at once)
      if (scene.reduced() || scene.zoomed || scene.fold < 0.5 !== run.open) {
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
    reportCable();
    if (run.done && swap?.ready) {
      finish();
    }
  };

  const ensureStep = () => {
    if (!removeStep) {
      removeStep = loop.add(step);
    }
  };

  // the cable turned around part way runs the same timeline back from where it is, as 3d's start does
  const turnAround = () => {
    run.plugIn = target;
    run.elapsed = run.total - run.elapsed;
    run.done = run.elapsed >= run.total;
    swapTo(target);
  };

  const loadChargerSets = () => {
    if (chargerSets || loading || failed || !scene.drawing) {
      return;
    }
    const track = [];
    loading = track;
    const names = [true, false].map((open) =>
      chargerSetFor({ portrait: scene.portrait, open }),
    );
    openSets(names, track).then(
      ([open, closed]) => {
        if (loading !== track) {
          return;
        }
        loading = null;
        chargerSets = { open, closed };
        snapNext = target !== plugged;
        if (pending()) {
          ensureStep();
        }
        reportCable();
      },
      (error) => {
        if (loading !== track) {
          return;
        }
        loading = null;
        giveUp(error);
      },
    );
  };

  // the battery's state, on each change and once the intro is over: the charger's sets load once it's low or charging,
  // go again once it's neither and the cable is out, and the cable follows charging
  const battery = (status) => {
    wanted = chargerWanted(status);
    const next = Boolean(status.charging);
    if (next !== target) {
      target = next;
      if (run && run.plugIn !== target && !failed) {
        turnAround();
      }
    }
    if (failed) {
      reportCable();
      return;
    }
    if (wanted) {
      loadChargerSets();
    } else if (!run && !plugged && !target) {
      releaseChargerSets();
    }
    if (pending()) {
      ensureStep();
    }
    reportCable();
  };

  // what the stage shows while a run plays or holds its end: the charger set for the fold, and its frame
  const shown = () => {
    if (!run) {
      return null;
    }
    const open = run.done ? scene.fold < 0.5 : run.open;
    const entry = open ? chargerSets.open : chargerSets.closed;
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

  // a new mount: its stage let every set go, and its fold sets have the cable in or not
  const mounted = ({ plugged: cable }) => {
    run = null;
    if (swap) {
      drop(swap.track);
      swap = null;
    }
    if (loading) {
      drop(loading);
      loading = null;
    }
    dropping = null;
    chargerSets = null;
    snapNext = false;
    plugged = cable;
    stopStep();
    letFoldsGo();
    shownCable = null;
  };

  const state = () => {
    const now = shown();
    return {
      ready: chargerSets !== null,
      failed,
      target,
      plugged,
      busy: busy(),
      running: Boolean(run && !run.done),
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
