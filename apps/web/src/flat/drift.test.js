import { expect, test } from "vitest";
import { idleDrift } from "../scene/shared/motion.js";
import { createDrift, RESUME_MS } from "./drift.js";
import { handLoop } from "./handLoop.js";

// frames every 16 ms from a start time until an end time
const frames = async (hand, from, to) => {
  for (let t = from; t <= to; t += 16) {
    await hand.at(t);
  }
};

const setup = (over = {}) => {
  const hand = handLoop();
  const scene = {
    calm: false,
    drawing: true,
    unlocked: true,
    busy: false,
    zoomed: false,
    pose: { x: 1, y: 2, z: -40, rx: 0, ry: 0, rz: 0 },
    reduced: () => false,
    ...over,
  };
  const drift = createDrift({ scene, loop: hand.loop, clock: hand.now });
  return { hand, scene, drift };
};

test("the drift eases in once the phone is at rest, and a motion holds it where it was", async () => {
  const { hand, scene, drift } = setup();
  hand.loop.wake();
  await frames(hand, 1000, 1000 + RESUME_MS / 2);
  expect(drift.idle()).toBeGreaterThan(0);
  expect(drift.idle()).toBeLessThan(1);
  await frames(hand, 1500, 1000 + RESUME_MS + 100);
  expect(drift.idle()).toBe(1);
  const before = drift.at(hand.now());
  const shownBefore = scene.pose.x + before.x;
  drift.settle();
  expect(drift.idle()).toBe(0);
  expect(scene.pose.x + drift.at(hand.now()).x).toBeCloseTo(shownBefore, 12);
  expect(scene.pose.z).toBeCloseTo(-40 + idleDrift(hand.now() / 1000, 1).z, 12);
});

test("calm, reduced motion, and a zoomed app keep the drift off and the loop asleep", async () => {
  for (const over of [
    { calm: true },
    { reduced: () => true },
    { zoomed: true },
    { busy: true },
  ]) {
    const { hand, drift } = setup(over);
    hand.loop.wake();
    await hand.at(1000);
    await hand.at(2000);
    expect(drift.idle()).toBe(0);
    // the last frame asked for no other
    expect(hand.queued()).toBe(0);
  }
});

test("turning calm off starts it once a frame runs", async () => {
  const { hand, scene, drift } = setup({ calm: true });
  hand.loop.wake();
  await hand.at(1000);
  scene.calm = false;
  hand.loop.wake();
  await frames(hand, 1100, 1200 + RESUME_MS + 100);
  expect(drift.idle()).toBe(1);
});
