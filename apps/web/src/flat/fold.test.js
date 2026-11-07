import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { FOLD_TIME, LEAD, ease, foldPoseAt } from "../scene/shared/motion.js";
import { place } from "../scene/shared/placement.js";
import { createFolds, dragAt, pathAfter, progressAt } from "./fold.js";
import { handLoop } from "./handLoop.js";

const realManifest = (folder) =>
  JSON.parse(
    readFileSync(
      new URL(`../../public/flat/${folder}/manifest.json`, import.meta.url),
      "utf8",
    ),
  );

const fakeScene = (portrait = false) => {
  const placed = place({
    width: portrait ? 600 : 1280,
    height: portrait ? 900 : 800,
    portrait,
  });
  return {
    pose: { ...placed.rest },
    fold: 0,
    lead: 0,
    path: "open",
    phone: "open",
    busy: false,
    zoomed: false,
    unlocked: true,
    portrait,
    placed,
    reduced: () => false,
    takeOver: () => {},
    wake: () => {},
  };
};

const expectPose = (scene, want) => {
  expect(scene.fold).toBeCloseTo(want.fold, 9);
  for (const k of ["x", "y", "z", "rx", "ry", "rz"]) {
    expect(scene.pose[k]).toBeCloseTo(want[k], 9);
  }
};

test("foldPoseAt drives close and open as in 3D", async () => {
  const scene = fakeScene();
  const { loop, at } = handLoop();
  const folds = createFolds({ scene, loop });
  const { rest, stage } = scene.placed;

  const closing = folds.closePhone();
  expect(scene.busy).toBe(true);
  for (const ms of [0, 225, 450, 700]) {
    await at(ms);
    const p = ease.inOutSine(ms / FOLD_TIME.close);
    expectPose(scene, foldPoseAt(rest, stage, 0, 1, p, "close"));
  }
  await at(FOLD_TIME.close);
  expect(await closing).toBe("done");
  expect(scene.phone).toBe("closed");
  expect(scene.busy).toBe(false);
  expectPose(scene, { ...stage, fold: 1 });

  const start = 2000;
  await at(start);
  const opening = folds.openPhone();
  // in landscape there's no lead, so the fold starts on the next frame
  for (const ms of [0, 250, 500, 900]) {
    await at(start + ms);
    const p = ease.inOutSine(ms / FOLD_TIME.open);
    expectPose(scene, foldPoseAt(stage, rest, 1, 0, p, "open"));
  }
  await at(start + FOLD_TIME.open);
  expect(await opening).toBe("done");
  expect(scene.phone).toBe("open");
  expectPose(scene, { ...rest, fold: 0 });
});

test("a portrait open sends the thumbs ahead before the fold moves", async () => {
  const scene = fakeScene(true);
  Object.assign(scene, {
    phone: "closed",
    fold: 1,
    path: "close",
    pose: { ...scene.placed.stage },
  });
  const { loop, at } = handLoop();
  const folds = createFolds({ scene, loop });
  const opening = folds.openPhone();
  expect(scene.path).toBe("open");
  await at(LEAD.time / 2);
  expect(scene.lead).toBeCloseTo(ease.inOutSine(0.5), 9);
  expect(scene.fold).toBe(1);
  await at(LEAD.time);
  expect(scene.lead).toBe(1);
  await at(LEAD.time + FOLD_TIME.open / 2);
  expect(scene.fold).toBeLessThan(1);
  await at(LEAD.time + FOLD_TIME.open);
  expect(await opening).toBe("done");
  expect(scene.fold).toBe(0);
});

test("the drag lookup scales pointer travel", () => {
  const drag = { table: [0, 0.1, 0.3, 0.6, 1], span: 4 };
  // 4 window px at 2 window px per frame px is 2 px of the table
  expect(dragAt({ drag, along: 4, scale: 2 })).toEqual({
    progress: 0.3,
    travel: 0.5,
  });
  expect(dragAt({ drag, along: 4, scale: 1 })).toEqual({
    progress: 1,
    travel: 1,
  });
  // the real table, in the half set's px, read at twice its scale
  const { close } = realManifest("landscape-day-half").dragTable;
  for (const along of [3, 40, 101, 250]) {
    const { progress, travel } = dragAt({ drag: close, along, scale: 2 });
    expect(progress).toBeCloseTo(progressAt(close.table, along / 2), 12);
    expect(travel).toBeCloseTo(Math.min(along / 2 / close.span, 1), 12);
  }
  // the few px moved before the swipe took hold are made up over the next stretch, not in one jump
  const held = dragAt({ drag, along: 12, lead: 10, scale: 4 });
  expect(held.progress).toBeCloseTo(
    progressAt(drag.table, (12 - 10 * (1 - 2 / 80)) / 4),
    12,
  );
});

test("the portrait path keeps its path when turned back partway", () => {
  const run = (path, folds) => {
    const seen = [];
    let last = folds[0];
    for (const fold of folds.slice(1)) {
      path = pathAfter({ path, lastFold: last, fold });
      seen.push(path);
      last = fold;
    }
    return seen;
  };
  // leaving open picks the closing path, which a turn back partway keeps
  expect(run("open", [0, 0.1, 0.5, 0.3, 0.05, 0])).toEqual([
    "close",
    "close",
    "close",
    "close",
    "close",
  ]);
  // leaving closed picks the opening path, which a turn back partway keeps too
  expect(run("close", [1, 0.9, 0.6, 0.8, 0.999])).toEqual([
    "open",
    "open",
    "open",
    "open",
  ]);
  // only leaving an end picks again
  expect(run("close", [0.5, 0.4])).toEqual(["close"]);
  expect(run("open", [1, 1])).toEqual(["open"]);
});
