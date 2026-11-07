import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { checkManifest, loadManifest, manifestFolder } from "./manifest.js";

const realManifest = (folder) =>
  JSON.parse(
    readFileSync(
      new URL(`../../public/flat/${folder}/manifest.json`, import.meta.url),
      "utf8",
    ),
  );

const small = () => ({
  set: "landscape",
  lighting: "dusk",
  size: "half",
  window: { width: 640, height: 400 },
  margin: { x: 160, top: 80, bottom: 100 },
  overlap: 1,
  frames: [
    {
      fold: 1,
      lead: 0,
      hand: 1,
      t: null,
      atlas: "a000.webp",
      pieces: [[10, 20, 30, 40, 4, 4]],
      shared: [],
    },
  ],
  shared: [],
});

const respond = (body, ok = true) =>
  vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => body }));

afterEach(() => {
  vi.unstubAllGlobals();
});

test("manifestFolder names the set's folder", () => {
  expect(manifestFolder("portrait-open", "dusk", "half")).toBe(
    "/flat/portrait-open-dusk-half/",
  );
});

test("loadManifest fetches the set and notes its folder", async () => {
  const fetch = respond(small());
  vi.stubGlobal("fetch", fetch);
  const manifest = await loadManifest("landscape", "dusk", "half");
  expect(fetch).toHaveBeenCalledWith(
    "/flat/landscape-dusk-half/manifest.json",
    { signal: undefined },
  );
  expect(manifest.base).toBe("/flat/landscape-dusk-half/");
  expect(manifest.frames).toHaveLength(1);
  // a scene's signal goes with the request, so a scene that stops while loading ends it
  const scene = new AbortController();
  await loadManifest("landscape", "dusk", "half", { signal: scene.signal });
  expect(fetch).toHaveBeenLastCalledWith(
    "/flat/landscape-dusk-half/manifest.json",
    { signal: scene.signal },
  );
});

test("loadManifest rejects a failed fetch", async () => {
  vi.stubGlobal("fetch", respond(null, false));
  await expect(loadManifest("landscape", "dusk", "half")).rejects.toThrow(
    /404/,
  );
});

test("loadManifest rejects an unknown lighting or size without fetching", async () => {
  const fetch = respond(small());
  vi.stubGlobal("fetch", fetch);
  await expect(loadManifest("landscape", "noon", "half")).rejects.toThrow();
  await expect(loadManifest("landscape", "dusk", "large")).rejects.toThrow();
  await expect(loadManifest("../keys", "dusk", "half")).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

test("checkManifest rejects a manifest for another set or with no frames", () => {
  expect(() =>
    checkManifest(small(), "landscape", "dusk", "half"),
  ).not.toThrow();
  expect(() => checkManifest(small(), "portrait-open", "dusk", "half")).toThrow(
    /portrait-open/,
  );
  expect(() => checkManifest(small(), "landscape", "day", "half")).toThrow();
  expect(() => checkManifest(small(), "landscape", "dusk", "full")).toThrow();
  expect(() =>
    checkManifest({ ...small(), frames: [] }, "landscape", "dusk", "half"),
  ).toThrow();
  const badPiece = small();
  badPiece.frames[0].pieces = [[1, 2, 3]];
  expect(() => checkManifest(badPiece, "landscape", "dusk", "half")).toThrow();
  const badShared = small();
  badShared.frames[0].shared = [0];
  expect(() => checkManifest(badShared, "landscape", "dusk", "half")).toThrow();
  expect(() => checkManifest(null, "landscape", "dusk", "half")).toThrow();
});

test("the captured manifests pass the check", () => {
  for (const [set, lighting, size] of [
    ["landscape", "day", "half"],
    ["portrait-open", "night", "full"],
    ["charger-landscape-open", "dusk", "half"],
  ]) {
    const manifest = realManifest(`${set}-${lighting}-${size}`);
    expect(() => checkManifest(manifest, set, lighting, size)).not.toThrow();
  }
});
