// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { clockText } from "../scene/status.js";
import { createFlatStatus } from "./status.js";

const fakeScreens = () => {
  const calls = [];
  return { calls, update: (arg) => calls.push(structuredClone(arg)) };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("battery without storage", () => {
  vi.setSystemTime(new Date("2026-11-07T12:00:30"));
  const denied = () => {
    throw new Error("storage denied");
  };
  vi.stubGlobal("localStorage", undefined);
  Object.defineProperty(window, "localStorage", {
    get: denied,
    configurable: true,
  });
  const screens = fakeScreens();
  let bar;
  expect(() => {
    bar = createFlatStatus({ screens: () => screens });
  }).not.toThrow();
  // a fresh start: full and not charging, then the drain
  expect(bar.status.level).toBe(100);
  expect(bar.status.charging).toBe(false);
  expect(screens.calls.at(-1).status.level).toBe(100);
  vi.setSystemTime(new Date("2026-11-07T12:05:30"));
  vi.advanceTimersByTime(1500);
  expect(bar.status.level).toBeGreaterThan(40);
  expect(bar.status.level).toBeLessThan(60);
  expect(screens.calls.at(-1).status.level).toBe(bar.status.level);
  // and the charge after ten minutes
  vi.setSystemTime(new Date("2026-11-07T12:10:40"));
  vi.advanceTimersByTime(1500);
  expect(bar.status.charging).toBe(true);
  bar.stop();
});

test("the clock moves on at the minute and the ping shows in its place for a moment", async () => {
  vi.setSystemTime(new Date("2026-11-07T12:00:30"));
  const screens = fakeScreens();
  const bar = createFlatStatus({ screens: () => screens });
  expect(screens.calls.at(-1).status.time).toBe(clockText(new Date()));
  vi.advanceTimersByTime(31000);
  expect(screens.calls.at(-1).status.time).toBe(
    clockText(new Date("2026-11-07T12:01:01")),
  );
  await bar.showPing();
  expect(screens.calls.at(-1).showPing).toBe(true);
  vi.advanceTimersByTime(2700);
  expect(screens.calls.at(-1).showPing).toBe(false);
  bar.stop();
});
