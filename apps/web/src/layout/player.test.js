// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const root = document.documentElement;

const fakeCore = () => ({
  load: vi.fn(),
  resume: vi.fn(),
  toggle: vi.fn(),
  playAt: vi.fn(),
  state: () => ({
    ready: true,
    index: 0,
    playing: false,
    current: null,
    unavailable: false,
    failed: false,
  }),
});

// a fresh copy of the layout's player on a page of the given app, with the player's chunk missing, broken (its code
// throws), or there. each copy gets its own recovery spy and core, since an earlier copy's listeners stay on the page
const startPlayer = async ({ chunk = "missing", app = "Blog" } = {}) => {
  vi.resetModules();
  const recoverFromChunk = vi.fn(() => true);
  const core = fakeCore();
  vi.doMock("./navigation.js", () => ({ recoverFromChunk }));
  vi.doMock("../scene/youtube.js", () => ({ youtubePlayer: () => () => {} }));
  vi.doMock("../scene/music.js", () => {
    if (chunk === "missing") {
      throw new TypeError("Failed to fetch dynamically imported module");
    }
    return {
      createMusic: () => {
        if (chunk === "broken") {
          throw new Error("a bug in the player's code");
        }
        return core;
      },
    };
  });
  document.body.innerHTML = `
    <main id="page" data-app="${app}">
      <div class="body">
        <p id="text">words</p>
        <ul class="tracks"><li data-track="3"><button id="track">a track</button></li></ul>
      </div>
    </main>
    <div id="player-host"></div>`;
  const { music } = await import("./player.js");
  return { music, recoverFromChunk, core };
};

const unavailable = (music) =>
  vi.waitFor(() => expect(music.state().unavailable).toBe(true));

const press = (el, type = "pointerup") =>
  el.dispatchEvent(
    type === "keydown"
      ? new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
      : new Event(type, { bubbles: true }),
  );

// a later wait, so a reload the catch would start has had its turn
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  window.matchMedia = () => ({ matches: false });
  root.className = "";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  // a copy that never heard a gesture would load the next test's chunk on that test's first one
  press(window);
  await settle();
  vi.restoreAllMocks();
});

test("a first click or key on a page being read doesn't load the page again for a missing player chunk", async () => {
  for (const type of ["pointerup", "keydown"]) {
    const { music, recoverFromChunk } = await startPlayer();
    press(document.getElementById("text"), type);
    await unavailable(music);
    await settle();
    expect(recoverFromChunk, type).not.toHaveBeenCalled();
  }
});

test("a music press after the chunk failed loads the page again", async () => {
  const { music, recoverFromChunk } = await startPlayer();
  press(document.getElementById("text"));
  await unavailable(music);
  await settle();
  music.toggle();
  expect(recoverFromChunk).toHaveBeenCalledTimes(1);
});

test("a music press while the chunk is still loading loads the page again once it fails", async () => {
  const { music, recoverFromChunk } = await startPlayer();
  music.next();
  await unavailable(music);
  expect(recoverFromChunk).toHaveBeenCalledTimes(1);
});

test("the music page's own load asks for the music", async () => {
  const { music, recoverFromChunk } = await startPlayer({ app: "Music" });
  await unavailable(music);
  expect(recoverFromChunk).toHaveBeenCalledTimes(1);
});

test("a music press on a page shown first, a flat page after a failed scene, or offline doesn't load the page again", async () => {
  for (const reading of ["page-first", "scene-failed", "offline"]) {
    root.className = reading === "offline" ? "" : reading;
    const offline = vi
      .spyOn(Object.getPrototypeOf(navigator), "onLine", "get")
      .mockReturnValue(reading !== "offline");
    const { music, recoverFromChunk } = await startPlayer();
    music.toggle();
    await unavailable(music);
    await settle();
    expect(recoverFromChunk, reading).not.toHaveBeenCalled();
    offline.mockRestore();
  }
});

test("player code that throws says the music is unavailable without counting as a missing chunk", async () => {
  const { music, recoverFromChunk } = await startPlayer({ chunk: "broken" });
  music.toggle();
  await unavailable(music);
  await settle();
  expect(recoverFromChunk).not.toHaveBeenCalled();
});

test("a first press on a music page track row plays that track without resuming", async () => {
  const { core } = await startPlayer({ chunk: "there", app: "Music" });
  await vi.waitFor(() => expect(core.load).toHaveBeenCalled());
  const track = document.getElementById("track");
  press(track);
  press(track, "click");
  await vi.waitFor(() => expect(core.playAt).toHaveBeenCalledWith(3));
  expect(core.resume).not.toHaveBeenCalled();
});
