import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { FOLD_TIME } from "../scene/shared/motion.js";
import { place } from "../scene/shared/placement.js";
import {
  FALLBACK_CAP,
  SWAP_CAP,
  UNPLUG_SOON,
  chargerSetFor,
  createCharger,
  foldSetsFor,
} from "./charger.js";
import { createFolds } from "./fold.js";
import { createFrameIndex } from "./frames.js";
import { handLoop } from "./handLoop.js";

const realManifest = (folder) =>
  JSON.parse(
    readFileSync(
      new URL(`../../public/flat/${folder}/manifest.json`, import.meta.url),
      "utf8",
    ),
  );

const chargerManifests = {
  "charger-landscape-open": realManifest("charger-landscape-open-day-full"),
  "charger-landscape-closed": realManifest("charger-landscape-closed-day-full"),
  "charger-portrait-open": realManifest("charger-portrait-open-day-full"),
  "charger-portrait-closed": realManifest("charger-portrait-closed-day-full"),
};

// the sets as index.js would fetch and make them, without network or images: a charger set gets its real manifest, so
// its frames are picked by time as the page picks them. a fetch can fail or never answer, an open from the network can
// fail, and a decode can wait until the test lets it
const fakeSets = ({
  failFetch = () => false,
  stallFetch = () => false,
  failOpen = () => false,
  held = () => false,
} = {}) => {
  const opened = [];
  const released = [];
  const forgotten = [];
  const waiting = [];
  const signals = [];
  const fetch = async (name, signal) => {
    signals.push(signal);
    if (stallFetch(name)) {
      return new Promise(() => {});
    }
    if (failFetch(name)) {
      throw new Error(`no ${name}`);
    }
    return { name };
  };
  const open = async (name, bytes) => {
    opened.push({ name, ahead: bytes?.name === name });
    const manifest = chargerManifests[name] ?? { set: name, frames: [] };
    const index = createFrameIndex(manifest);
    return {
      manifest,
      layer: {
        name,
        decode: () => {
          if (failOpen(name)) {
            return Promise.reject(new Error(`${name} didn't decode`));
          }
          return held(name)
            ? new Promise((resolve) => waiting.push(resolve))
            : Promise.resolve();
        },
        indexAt: index.indexAt,
        frameFor: index.frameFor,
      },
    };
  };
  return {
    sets: {
      fetch,
      forget: (bytes) => forgotten.push(bytes.name),
      open,
      release: (entry) => released.push(entry.layer.name),
    },
    opened: () => opened.map((o) => o.name),
    openedAhead: (name) =>
      opened.filter((o) => o.name === name).every((o) => o.ahead),
    released,
    forgotten,
    signals,
    finishDecodes: () => waiting.splice(0).forEach((resolve) => resolve()),
  };
};

const fakeScene = (portrait = false) => {
  const placed = place({
    width: portrait ? 600 : 1280,
    height: portrait ? 900 : 800,
    portrait,
  });
  const set = portrait ? "portrait-open" : "landscape";
  return {
    pose: { ...placed.rest },
    fold: 0,
    lead: 0,
    path: "open",
    phone: "open",
    busy: false,
    zoomed: false,
    unlocked: true,
    drawing: true,
    appVisible: false,
    portrait,
    placed,
    stage: { geometry: { width: 1280, height: 800 } },
    openFrames: { manifest: { set }, layer: { name: set } },
    closeFrames: portrait
      ? {
          manifest: { set: "portrait-close" },
          layer: { name: "portrait-close" },
        }
      : null,
    edges: () => ({
      outer: { left: 159, right: 1121, top: 56, bottom: 744 },
      inner: { left: 173, right: 1106, top: 72, bottom: 728 },
    }),
    reduced: () => false,
    takeOver: () => {},
    wake: () => {},
  };
};

// a scene with its folds and a charger whose battery is at 3%, so it has fetched ahead and decoded its set, on a loop
// the test steps
const charging = async ({
  portrait = false,
  sets = fakeSets(),
  plugged = false,
} = {}) => {
  const scene = fakeScene(portrait);
  if (plugged) {
    scene.openFrames = {
      manifest: { set: "cable-landscape" },
      layer: { name: "cable-landscape" },
    };
  }
  const { loop, at, now } = handLoop();
  scene.wake = () => loop.wake();
  const folds = createFolds({ scene, loop });
  const warn = vi.fn();
  const onStuck = vi.fn();
  const charger = createCharger({
    scene,
    loop,
    sets: sets.sets,
    warn,
    onStuck,
  });
  scene.charger = charger;
  charger.mounted({ plugged });
  if (!plugged) {
    charger.battery({ level: 3, charging: false });
  }
  for (let ms = 0; ms < 5; ms++) {
    await at(ms);
  }
  return { scene, loop, at, now, folds, charger, sets, warn, onStuck };
};

// steps the loop each 20 ms from `from` to `to`, giving what the charger showed on each frame
const play = async (at, charger, from, to) => {
  const seen = [];
  for (let ms = from; ms <= to; ms += 20) {
    await at(ms);
    seen.push(charger.shown());
  }
  return seen;
};

const indexes = (seen) => seen.filter((s) => s !== null).map((s) => s.index);

test("the unplug is the plug reversed", async () => {
  for (const closed of [false, true]) {
    const { scene, at, folds, charger } = await charging();
    if (closed) {
      folds.closePhone();
      await play(at, charger, 20, FOLD_TIME.close + 100);
      expect(scene.phone).toBe("closed");
    }
    const set = closed ? "charger-landscape-closed" : "charger-landscape-open";
    const last = chargerManifests[set].frames.length - 1;
    charger.battery({ level: 1, charging: true });
    const plugged = await play(at, charger, 1000, 4000);
    expect(charger.state().plugged).toBe(true);
    expect(plugged.find((s) => s !== null).manifest.set).toBe(set);
    // the charge starts far from 100%, then nears it, and the cable comes out
    charger.battery({ level: 100, charging: false });
    const unplugged = await play(at, charger, 5000, 8000);
    expect(charger.state().plugged).toBe(false);
    // the frame a run ends on is the fold set's rest frame, which shows the same as the charger set's end
    const plugIndexes = [...indexes(plugged), last];
    const unplugIndexes = [...indexes(unplugged), 0];
    expect(plugIndexes[0]).toBe(0);
    expect(unplugIndexes[0]).toBe(last);
    expect(new Set(plugIndexes).size).toBeGreaterThan(90);
    expect(unplugIndexes).toEqual([...plugIndexes].reverse());
  }
});

test("folds wait for a run", async () => {
  const { scene, at, folds, charger, sets } = await charging();
  charger.battery({ level: 1, charging: true });
  await at(1000);
  expect(charger.busy()).toBe(true);
  // the cable free set goes as the run starts, and the cable one decodes from the bytes fetched ahead
  expect(sets.released).toContain("landscape");
  expect(sets.opened()).toContain("cable-landscape");
  expect(sets.openedAhead("cable-landscape")).toBe(true);
  const closing = folds.closePhone();
  for (let ms = 1020; ms < 1000 + 2700; ms += 20) {
    await at(ms);
    expect(scene.phone).toBe("open");
    expect(scene.fold).toBe(0);
    expect(scene.busy).toBe(false);
  }
  await at(3700);
  expect(charger.busy()).toBe(false);
  expect(scene.openFrames.manifest.set).toBe("cable-landscape");
  // the run over, the held close plays
  expect(scene.busy).toBe(true);
  await at(3720);
  expect(scene.fold).toBeGreaterThan(0);
  await at(3700 + FOLD_TIME.close + 20);
  expect(await closing).toBe("done");
  expect(scene.phone).toBe("closed");
});

test("charger while zoomed or folding", async () => {
  // a run started while an app is zoomed ends at once, on the plugged frame
  {
    const { scene, at, charger } = await charging();
    scene.zoomed = true;
    charger.battery({ level: 1, charging: true });
    await at(1000);
    expect(charger.shown().index).toBe(162);
    expect(charger.state().running).toBe(false);
    await at(1020);
    expect(charger.state().plugged).toBe(true);
    expect(charger.busy()).toBe(false);
  }
  // reduced motion snaps the cable in, the same way
  {
    const { scene, at, charger } = await charging();
    scene.reduced = () => true;
    charger.battery({ level: 1, charging: true });
    await at(1000);
    expect(charger.shown().index).toBe(162);
    await at(1020);
    expect(charger.state().plugged).toBe(true);
  }
  // a run asked for during a fold waits for the fold and the closed phone's set, then plays on it
  {
    const { scene, at, folds, charger } = await charging();
    const closing = folds.closePhone();
    await at(16);
    expect(scene.busy).toBe(true);
    charger.battery({ level: 1, charging: true });
    for (let ms = 20; ms < FOLD_TIME.close; ms += 20) {
      await at(ms);
      expect(charger.busy()).toBe(false);
      expect(charger.shown()).toBe(null);
    }
    await play(at, charger, FOLD_TIME.close + 20, FOLD_TIME.close + 100);
    expect(await closing).toBe("done");
    expect(charger.busy()).toBe(true);
    expect(charger.shown().manifest.set).toBe("charger-landscape-closed");
    expect(charger.state().running).toBe(true);
  }
});

test("a fold half that changes mid run ends the run on its own set", async () => {
  const sets = fakeSets({ held: (name) => name === "cable-landscape" });
  const { scene, at, charger } = await charging({ sets });
  charger.battery({ level: 1, charging: true });
  await play(at, charger, 1000, 1500);
  expect(charger.state().running).toBe(true);
  // a navigation can show the phone another way at once, as showUrl does
  scene.fold = 1;
  await at(1520);
  expect(charger.state().running).toBe(false);
  expect(charger.shown()).toMatchObject({
    index: 162,
    manifest: { set: "charger-landscape-open" },
  });
  sets.finishDecodes();
  await at(1540);
  await at(1560);
  expect(charger.state().plugged).toBe(true);
});

test("the battery turned around mid plug runs the frames back from where they were", async () => {
  const { scene, at, charger, sets } = await charging();
  charger.battery({ level: 1, charging: true });
  const going = indexes(await play(at, charger, 1000, 2200));
  const turnedAt = going.at(-1);
  expect(turnedAt).toBeGreaterThan(60);
  charger.battery({ level: 1, charging: false });
  const back = indexes(await play(at, charger, 2220, 4000));
  // the next frame is one step back from the last, and they run down to the start
  expect(back[0]).toBeLessThanOrEqual(turnedAt);
  expect(back[0]).toBeGreaterThan(turnedAt - 3);
  back
    .slice(1)
    .forEach((index, i) => expect(index).toBeLessThanOrEqual(back[i]));
  expect(back.at(-1)).toBeLessThan(3);
  // the swap went the other way: the cable set it was decoding went, and the cable free one came back
  expect(sets.released).toContain("cable-landscape");
  expect(sets.opened().at(-1)).toBe("landscape");
  expect(charger.state()).toMatchObject({ plugged: false, busy: false });
  expect(scene.openFrames.manifest.set).toBe("landscape");
});

test("one charger set is decoded, for the phone's half, and only near a plug or an unplug", async () => {
  const { at, folds, charger, sets } = await charging();
  expect(sets.opened()).toEqual(["charger-landscape-open"]);
  expect(sets.openedAhead("charger-landscape-open")).toBe(true);
  expect(charger.state().chargerSet).toBe("open");
  // a fold swaps it once it has ended
  folds.closePhone();
  await play(at, charger, 20, FOLD_TIME.close - 20);
  expect(sets.released).not.toContain("charger-landscape-open");
  await play(at, charger, FOLD_TIME.close, FOLD_TIME.close + 100);
  expect(sets.released).toContain("charger-landscape-open");
  expect(sets.opened().at(-1)).toBe("charger-landscape-closed");
  expect(charger.state().chargerSet).toBe("closed");
  // after the plug, most of the charge holds no charger set
  charger.battery({ level: 1, charging: true });
  await play(at, charger, 1000, 3200);
  expect(charger.state().plugged).toBe(true);
  charger.battery({ level: 40, charging: true });
  await at(3300);
  expect(charger.state().chargerSet).toBe(null);
  expect(sets.released).toContain("charger-landscape-closed");
  // and it's decoded again as the unplug nears
  charger.battery({ level: UNPLUG_SOON, charging: true });
  await at(3400);
  expect(charger.state()).toMatchObject({ chargerSet: "closed", ready: true });
});

test("the cable sets swap in only once decoded, and the run holds its last frame till then", async () => {
  const sets = fakeSets({ held: (name) => name.startsWith("cable") });
  const { scene, at, charger } = await charging({ portrait: true, sets });
  charger.battery({ level: 1, charging: true });
  await play(at, charger, 1000, 4000);
  // the run is over, but the cable sets haven't decoded, so the plugged frame stays and the folds are still held
  expect(charger.state().running).toBe(false);
  expect(charger.busy()).toBe(true);
  expect(charger.shown().index).toBe(162);
  expect(sets.released).toContain("portrait-open");
  expect(sets.released).toContain("portrait-close");
  sets.finishDecodes();
  await at(4100);
  await at(4120);
  expect(charger.busy()).toBe(false);
  expect(scene.openFrames.manifest.set).toBe("cable-portrait-open");
  expect(scene.closeFrames.manifest.set).toBe("cable-portrait-close");
});

test("a cable decode that takes too long gives the cable up and lets the folds go", async () => {
  const sets = fakeSets({ held: (name) => name === "cable-landscape" });
  const { scene, at, folds, charger, warn } = await charging({ sets });
  charger.battery({ level: 1, charging: true });
  await play(at, charger, 1000, 1000 + SWAP_CAP - 20);
  expect(charger.busy()).toBe(true);
  await play(at, charger, 1000 + SWAP_CAP, 1000 + SWAP_CAP + 60);
  expect(charger.state()).toMatchObject({
    failed: true,
    plugged: false,
    busy: false,
  });
  expect(scene.openFrames.manifest.set).toBe("landscape");
  expect(sets.released).toContain("cable-landscape");
  expect(warn).toHaveBeenCalled();
  // the battery goes on charging with no cable, and the folds work
  charger.battery({ level: 30, charging: true });
  expect(charger.bolt({ level: 30, charging: true })).toBe(true);
  folds.closePhone();
  expect(scene.busy).toBe(true);
});

test("a fallback that's only slow brings the folds back", async () => {
  // the cable never decodes, and the cable free set it falls back to takes 5 s
  const sets = fakeSets({
    held: (name) => name === "cable-landscape" || name === "landscape",
  });
  const { scene, at, folds, charger, onStuck } = await charging({ sets });
  charger.battery({ level: 1, charging: true });
  await play(at, charger, 1000, 1000 + SWAP_CAP + 5000);
  expect(charger.busy()).toBe(true);
  expect(charger.state().failed).toBe(true);
  sets.finishDecodes();
  await play(at, charger, 1000 + SWAP_CAP + 5020, 1000 + SWAP_CAP + 5100);
  expect(onStuck).not.toHaveBeenCalled();
  expect(charger.state()).toMatchObject({ plugged: false, busy: false });
  expect(scene.openFrames.manifest.set).toBe("landscape");
  folds.closePhone();
  expect(scene.busy).toBe(true);
});

test("a fallback that doesn't come drops the visit", async () => {
  // both decodes fail
  {
    const sets = fakeSets({
      failOpen: (name) => name === "cable-landscape" || name === "landscape",
    });
    const { at, charger, onStuck } = await charging({ sets });
    charger.battery({ level: 1, charging: true });
    await play(at, charger, 1000, 1100);
    expect(onStuck).toHaveBeenCalledTimes(1);
  }
  // the fallback passes 10 s of visible time
  {
    const sets = fakeSets({
      held: (name) => name === "cable-landscape" || name === "landscape",
    });
    const { at, charger, onStuck } = await charging({ sets });
    charger.battery({ level: 1, charging: true });
    const fellBack = 1000 + SWAP_CAP;
    await play(at, charger, 1000, fellBack + FALLBACK_CAP - 100);
    expect(onStuck).not.toHaveBeenCalled();
    await play(
      at,
      charger,
      fellBack + FALLBACK_CAP - 80,
      fellBack + FALLBACK_CAP + 60,
    );
    expect(onStuck).toHaveBeenCalledTimes(1);
  }
});

test("a new mount stops the old one's downloads", async () => {
  const sets = fakeSets({ stallFetch: (name) => name === "cable-landscape" });
  const { charger } = await charging({ sets });
  expect(sets.signals.length).toBeGreaterThan(0);
  expect(sets.signals.every((signal) => !signal.aborted)).toBe(true);
  charger.mounted({ plugged: false });
  expect(sets.signals.every((signal) => signal.aborted)).toBe(true);
});

test("a cable that's still downloading at the plug starts no run", async () => {
  const sets = fakeSets({ stallFetch: (name) => name === "cable-landscape" });
  const { scene, at, folds, charger } = await charging({ sets });
  expect(charger.state().fetched).toBe(false);
  charger.battery({ level: 1, charging: true });
  const seen = await play(at, charger, 1000, 2000);
  expect(seen.every((s) => s === null)).toBe(true);
  expect(charger.state()).toMatchObject({ busy: false, plugged: false });
  expect(charger.bolt({ level: 1, charging: true })).toBe(true);
  folds.closePhone();
  expect(scene.busy).toBe(true);
});

test("a charger that doesn't load leaves the battery with no cable", async () => {
  const sets = fakeSets({ failFetch: (name) => name.startsWith("charger") });
  const { scene, at, folds, charger, warn } = await charging({ sets });
  expect(charger.state().failed).toBe(true);
  expect(warn).toHaveBeenCalled();
  charger.battery({ level: 1, charging: true });
  await at(1000);
  expect(charger.busy()).toBe(false);
  expect(charger.state().plugged).toBe(false);
  expect(scene.openFrames.manifest.set).toBe("landscape");
  // the bolt shows as soon as it charges, as 3d's does with no cable module
  expect(charger.bolt({ level: 1, charging: true })).toBe(true);
  folds.closePhone();
  await at(1100);
  expect(scene.busy).toBe(true);
});

test("a cable set that doesn't decode ends the plug unplugged", async () => {
  const sets = fakeSets({
    failOpen: (name) => name.startsWith("cable"),
    held: (name) => name === "landscape",
  });
  const { scene, at, charger } = await charging({ sets });
  charger.battery({ level: 1, charging: true });
  await play(at, charger, 1000, 1100);
  expect(charger.state().failed).toBe(true);
  // the cable free set comes back, while the run shows its unplugged end
  expect(charger.shown().index).toBe(0);
  sets.finishDecodes();
  await at(1200);
  await at(1220);
  expect(charger.busy()).toBe(false);
  expect(charger.state().plugged).toBe(false);
  expect(scene.openFrames.manifest.set).toBe("landscape");
});

test("a charging visit whose charger doesn't load drops the cable on a frame with no fold", async () => {
  const sets = fakeSets({ failFetch: (name) => name.startsWith("charger") });
  const { scene, at, folds, charger } = await charging({ sets, plugged: true });
  const closing = folds.closePhone();
  await at(16);
  charger.battery({ level: 50, charging: true });
  for (let ms = 20; ms < FOLD_TIME.close; ms += 20) {
    await at(ms);
    expect(scene.openFrames.manifest.set).toBe("cable-landscape");
  }
  await play(at, charger, FOLD_TIME.close, FOLD_TIME.close + 100);
  expect(await closing).toBe("done");
  expect(scene.openFrames.manifest.set).toBe("landscape");
  expect(sets.released).toContain("cable-landscape");
  expect(charger.state()).toMatchObject({ plugged: false, failed: true });
});

test("set names", () => {
  expect(chargerSetFor({ portrait: false, open: false })).toBe(
    "charger-landscape-closed",
  );
  expect(chargerSetFor({ portrait: true, open: true })).toBe(
    "charger-portrait-open",
  );
  expect(foldSetsFor({ portrait: false, cable: true })).toEqual({
    open: "cable-landscape",
    close: null,
  });
  expect(foldSetsFor({ portrait: true, cable: false })).toEqual({
    open: "portrait-open",
    close: "portrait-close",
  });
});
