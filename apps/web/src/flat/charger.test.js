import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { chargeMove, swapSchedule } from "../scene/shared/charging.js";
import { FOLD_TIME, PLAN } from "../scene/shared/motion.js";
import { place } from "../scene/shared/placement.js";
import { chargerSetFor, createCharger, foldSetsFor, runAt } from "./charger.js";
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

// the sets as the stage would make them, without images: a charger set gets its real manifest, so its frames are
// picked by time as the page picks them, and a decode settles when the test lets it
const fakeSets = ({ fail = () => false, held = () => false } = {}) => {
  const made = [];
  const released = new Set();
  const waiting = [];
  const open = async (name) => {
    if (fail(name)) {
      throw new Error(`no ${name}`);
    }
    const manifest = chargerManifests[name] ?? { set: name, frames: [] };
    const index = createFrameIndex(manifest);
    const entry = {
      manifest,
      layer: {
        name,
        decode: () =>
          held(name)
            ? new Promise((resolve) => waiting.push(resolve))
            : Promise.resolve(),
        indexAt: index.indexAt,
        frameFor: index.frameFor,
      },
    };
    made.push(entry);
    return entry;
  };
  return {
    sets: { open, release: (entry) => released.add(entry.layer.name) },
    made: () => made.map((entry) => entry.layer.name),
    released,
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

// a scene with its folds and a charger that has loaded its sets, on a loop the test steps
const charging = async ({ portrait = false, sets = fakeSets() } = {}) => {
  const scene = fakeScene(portrait);
  const { loop, at, now } = handLoop();
  const folds = createFolds({ scene, loop });
  const warn = vi.fn();
  const charger = createCharger({ scene, loop, sets: sets.sets, warn });
  scene.charger = charger;
  charger.battery({ level: 3, charging: false });
  await at(0);
  return { scene, loop, at, now, folds, charger, sets, warn };
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

test("the unplug is the plug reversed", async () => {
  for (const set of ["charger-landscape-open", "charger-landscape-closed"]) {
    const manifest = chargerManifests[set];
    const { indexAt } = createFrameIndex(manifest);
    const { total } = manifest.charger;
    // swap time: the closed landscape phone has no one handed grip, so its run is only the left hand's part
    expect(total).toBe(set.endsWith("closed") ? 2000 : 2700);
    expect(runAt({ plugIn: true, elapsed: 0, total }).plugT).toBe(0);
    expect(indexAt(runAt({ plugIn: true, elapsed: total, total }).plugT)).toBe(
      manifest.frames.length - 1,
    );
    for (let e = 0; e <= total; e += 25) {
      const plug = runAt({ plugIn: true, elapsed: total - e, total });
      const unplug = runAt({ plugIn: false, elapsed: e, total });
      expect(unplug.plugT).toBeCloseTo(plug.plugT, 9);
      expect(indexAt(unplug.plugT)).toBe(indexAt(plug.plugT));
      expect(unplug.left).toBeCloseTo(plug.left, 9);
      // the left hand's part is the 3d scene's swap schedule over the run
      const swap = set.endsWith("closed") ? 0 : PLAN.swap;
      expect(plug.left).toBeCloseTo(
        swapSchedule(plug.plugT / 1000, swap, 2).left,
        9,
      );
      const move = (left) =>
        chargeMove({
          pose: { x: 0, y: 0, z: -24, rx: 0, ry: 0, rz: 0 },
          left,
          fit: { x: 0.2, y: 1, z: -1.5 },
          seconds: 3,
          portrait: false,
          fold: 0,
        });
      expect(move(unplug.left)).toEqual(move(plug.left));
    }
  }

  // and the scene plays it so: the frames an unplug shows are the plug's, last to first
  const { at, charger } = await charging();
  charger.battery({ level: 1, charging: true });
  const plugged = await play(at, charger, 1000, 4000);
  expect(charger.state().plugged).toBe(true);
  charger.battery({ level: 100, charging: false });
  const unplugged = await play(at, charger, 5000, 8000);
  expect(charger.state().plugged).toBe(false);
  // the frame a run ends on is the fold set's rest frame, which shows the same as the charger set's end
  const indexes = (seen, end) => [
    ...seen.filter((s) => s !== null).map((s) => s.index),
    end,
  ];
  const plugIndexes = indexes(plugged, 162);
  const unplugIndexes = indexes(unplugged, 0);
  expect(plugIndexes[0]).toBe(0);
  expect(unplugIndexes[0]).toBe(162);
  expect(new Set(plugIndexes).size).toBeGreaterThan(100);
  expect(unplugIndexes).toEqual([...plugIndexes].reverse());
  expect(plugged.find((s) => s !== null).manifest.set).toBe(
    "charger-landscape-open",
  );
});

test("folds wait for a run", async () => {
  const { scene, at, folds, charger, sets } = await charging();
  expect(sets.made()).toEqual([
    "charger-landscape-open",
    "charger-landscape-closed",
  ]);
  charger.battery({ level: 1, charging: true });
  await at(1000);
  expect(charger.busy()).toBe(true);
  // the cable free sets go as the run starts, and the cable ones decode while it plays
  expect(sets.released.has("landscape")).toBe(true);
  expect(sets.made()).toContain("cable-landscape");
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
    await at(1017);
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
    await at(1017);
    expect(charger.state().plugged).toBe(true);
  }
  // a run asked for during a fold waits for the fold, then plays on the closed phone's set
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
    await at(FOLD_TIME.close + 20);
    expect(await closing).toBe("done");
    await at(FOLD_TIME.close + 40);
    expect(charger.busy()).toBe(true);
    expect(charger.shown().manifest.set).toBe("charger-landscape-closed");
    expect(charger.state().running).toBe(true);
  }
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
  expect(sets.released.has("portrait-open")).toBe(true);
  expect(sets.released.has("portrait-close")).toBe(true);
  sets.finishDecodes();
  await at(4100);
  await at(4120);
  expect(charger.busy()).toBe(false);
  expect(scene.openFrames.manifest.set).toBe("cable-portrait-open");
  expect(scene.closeFrames.manifest.set).toBe("cable-portrait-close");
});

test("a charger that doesn't load leaves the battery with no cable", async () => {
  const sets = fakeSets({ fail: (name) => name.startsWith("charger") });
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

test("a cable set that doesn't load ends the plug unplugged", async () => {
  const sets = fakeSets({
    fail: (name) => name.startsWith("cable"),
    held: (name) => name === "landscape",
  });
  const { scene, at, charger } = await charging({ sets });
  charger.battery({ level: 1, charging: true });
  await play(at, charger, 1000, 1100);
  expect(charger.state().failed).toBe(true);
  // the cable free sets come back, while the run shows its unplugged end
  expect(charger.shown().index).toBe(0);
  sets.finishDecodes();
  await at(1200);
  await at(1220);
  expect(charger.busy()).toBe(false);
  expect(charger.state().plugged).toBe(false);
  expect(scene.openFrames.manifest.set).toBe("landscape");
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
