import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createStatus } from "../scene/status.js";

const memory = () => {
  const items = {};
  return {
    getItem: (key) => (key in items ? items[key] : null),
    setItem: (key, value) => {
      items[key] = String(value);
    },
  };
};

const refusing = () => ({
  getItem: () => {
    throw new Error("storage refused");
  },
  setItem: () => {
    throw new Error("storage refused");
  },
});

let bar = null;

beforeEach(() => {
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("location", { pathname: "/about", search: "?dev" });
  vi.stubGlobal("addEventListener", () => {});
  vi.stubGlobal("removeEventListener", () => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null)),
  );
});

afterEach(() => {
  if (bar) {
    bar.stop();
    bar = null;
  }
  vi.unstubAllGlobals();
});

test("the ping asks for /ping.txt with HEAD, no query string, and no cache", () => {
  vi.stubGlobal("localStorage", memory());
  bar = createStatus(() => {});
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe("/ping.txt");
  expect(options).toMatchObject({ method: "HEAD", cache: "no-store" });
});

test("the battery's start is saved and read back through storage", () => {
  const store = memory();
  vi.stubGlobal("localStorage", store);
  const start = Date.now() - 60 * 1000;
  store.setItem("duo-battery-start", String(start));
  bar = createStatus(() => {});
  expect(bar.batteryPosition()).toBeGreaterThanOrEqual(60 * 1000);
});

test("refused storage doesn't throw and the battery starts full", () => {
  vi.stubGlobal("localStorage", refusing());
  expect(() => {
    bar = createStatus(() => {});
  }).not.toThrow();
  expect(bar.status.level).toBe(100);
});
