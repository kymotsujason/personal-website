// a loop for the unit tests, whose frames run only when the test steps the clock
import { createLoop } from "./loop.js";

export const handLoop = () => {
  let time = 0;
  let queue = [];
  const loop = createLoop({
    frame: (fn) => queue.push(fn),
    clock: () => time,
  });
  const at = async (ms) => {
    time = ms;
    const run = queue;
    queue = [];
    run.forEach((fn) => fn(ms));
    // the tweens' promises settle, and what awaits them runs
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  };
  return { loop, at, now: () => time };
};
