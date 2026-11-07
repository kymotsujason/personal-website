import { expect, test } from "vitest";
import { place } from "../scene/shared/placement.js";
import { closingSetFor, phoneAt, slowPathFor } from "./index.js";

test("the slow path is a device found slow, not half size frames", () => {
  expect(slowPathFor({})).toBe(false);
  expect(slowPathFor({ flatSlow: true })).toBe(true);
  expect(slowPathFor({ auto: String(Date.now()) })).toBe(true);
  // half size follows the screen's pixels, so a phone with half size frames isn't slow by that alone
  expect(slowPathFor({ flatSlow: false, auto: null, size: "half" })).toBe(
    false,
  );
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
