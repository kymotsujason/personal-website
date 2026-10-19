import { afterEach, describe, expect, test, vi } from "vitest";
import { read, remove, storageAdapter, write } from "./storage.js";

const memory = () => {
  const items = {};
  return {
    getItem: (key) => (key in items ? items[key] : null),
    setItem: (key, value) => {
      items[key] = String(value);
    },
    removeItem: (key) => {
      delete items[key];
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
  removeItem: () => {
    throw new Error("storage refused");
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storage", () => {
  test("reads back what it wrote, in each kind", () => {
    vi.stubGlobal("localStorage", memory());
    vi.stubGlobal("sessionStorage", memory());
    expect(write("local", "a", "1")).toBe(true);
    expect(write("session", "b", "2")).toBe(true);
    expect(read("local", "a")).toBe("1");
    expect(read("session", "b")).toBe("2");
    expect(read("local", "b")).toBeNull();
  });

  test("refused storage reads as nothing and drops writes", () => {
    vi.stubGlobal("localStorage", refusing());
    vi.stubGlobal("sessionStorage", refusing());
    expect(read("local", "a")).toBeNull();
    expect(read("session", "a")).toBeNull();
    expect(write("local", "a", "1")).toBe(false);
    expect(write("session", "a", "1")).toBe(false);
  });

  test("storage that throws on access reads as nothing", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("access denied");
      },
    });
    try {
      expect(read("local", "a")).toBeNull();
      expect(write("local", "a", "1")).toBe(false);
    } finally {
      delete globalThis.localStorage;
    }
  });

  test("removes a key, and a refused removal is dropped", () => {
    vi.stubGlobal("localStorage", memory());
    write("local", "2d", "1");
    expect(remove("local", "2d")).toBe(true);
    expect(read("local", "2d")).toBeNull();
    vi.stubGlobal("localStorage", refusing());
    expect(remove("local", "2d")).toBe(false);
  });

  test("the adapter wraps the same guard", () => {
    vi.stubGlobal("localStorage", refusing());
    const adapter = storageAdapter("local");
    expect(adapter.getItem("a")).toBeNull();
    expect(() => adapter.setItem("a", "1")).not.toThrow();
    vi.stubGlobal("localStorage", memory());
    adapter.setItem("a", "1");
    expect(adapter.getItem("a")).toBe("1");
  });
});
