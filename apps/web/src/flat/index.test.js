import { expect, test } from "vitest";
import { place } from "../scene/shared/placement.js";
import {
  chooseSet,
  closingSetFor,
  lowEndFor,
  phoneAt,
  slowPathFor,
} from "./index.js";

test("the slow path is a device found slow, not half size frames", () => {
  expect(slowPathFor({})).toBe(false);
  expect(slowPathFor({ flatSlow: true })).toBe(true);
  expect(slowPathFor({ auto: String(Date.now()) })).toBe(true);
  // a 2dAuto past its 30 days isn't how this device got here, as the head script only honors a recent one
  const day = 24 * 60 * 60 * 1000;
  expect(slowPathFor({ auto: String(Date.now() - 31 * day) })).toBe(false);
  expect(slowPathFor({ auto: "junk" })).toBe(false);
  // half size follows the screen's pixels, so a phone with half size frames isn't slow by that alone
  expect(slowPathFor({ flatSlow: false, auto: null, size: "half" })).toBe(
    false,
  );
});

test("a device known to be slow is low end, and an unknown one isn't", () => {
  const plain = { deviceMemory: 8, connection: { saveData: false } };
  expect(lowEndFor({ nav: plain })).toBe(false);
  // safari reports neither memory nor a data saver
  expect(lowEndFor({ nav: {} })).toBe(false);
  expect(lowEndFor({ flatSlow: true, nav: plain })).toBe(true);
  expect(lowEndFor({ auto: String(Date.now()), nav: plain })).toBe(true);
  const day = 24 * 60 * 60 * 1000;
  expect(lowEndFor({ auto: String(Date.now() - 31 * day), nav: plain })).toBe(
    false,
  );
  expect(lowEndFor({ handoff: true, nav: plain })).toBe(true);
  expect(lowEndFor({ nav: { deviceMemory: 4 } })).toBe(true);
  expect(lowEndFor({ nav: { deviceMemory: 2 } })).toBe(true);
  expect(lowEndFor({ nav: { connection: { saveData: true } } })).toBe(true);
});

test("a low end device takes the half size frames whatever its screen", () => {
  const big = { width: 1440, height: 900, dpr: 2, hour: 12 };
  expect(chooseSet(big).size).toBe("full");
  expect(chooseSet({ ...big, lowEnd: true }).size).toBe("half");
  expect(chooseSet({ ...big, lowEnd: true }).set).toBe(chooseSet(big).set);
});

test("portrait's opening set brings its closing one", () => {
  expect(closingSetFor("portrait-open")).toBe("portrait-close");
  expect(closingSetFor("cable-portrait-open")).toBe("cable-portrait-close");
  expect(closingSetFor("landscape")).toBe(null);
  expect(closingSetFor("cable-landscape")).toBe(null);
});

test("while the intro plays, the phone is where its animations have it", () => {
  const placed = place({ width: 600, height: 900, portrait: true });
  const plan = {
    total: 2000,
    lead: { start: 400, duration: 300 },
    poseAt: (ms) => ({ ...placed.rest, z: -40 + ms / 100 }),
    foldAt: (ms) => 1 - ms / 2000,
  };
  const intro = { plan, elapsed: () => 1900 };
  const drawn = { pose: placed.stage, fold: 1, lead: 0, intro, placed };
  // the loop hasn't drawn since the unlock, so its own state still has the phone closed
  expect(phoneAt({ ...drawn, drawing: false })).toEqual({
    pose: { ...placed.rest, z: -21 },
    fold: 0.050000000000000044,
    lead: 1,
  });
  expect(phoneAt({ ...drawn, drawing: true })).toEqual({
    pose: placed.stage,
    fold: 1,
    lead: 0,
  });
  // past its end it holds the end
  intro.elapsed = () => 5000;
  expect(phoneAt({ ...drawn, drawing: false }).fold).toBe(0);
});
