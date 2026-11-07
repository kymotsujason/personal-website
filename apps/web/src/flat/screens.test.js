import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, expect, test } from "vitest";
import FlatScreens from "../components/FlatScreens.astro";
import { APPS } from "../data/apps.js";
import { facing } from "../scene/pin.js";
import { createScreens, faceInput, faceQuads } from "./screens.js";

const latestProject = { title: "A project", path: "/projects/a-project" };
const siteData = { apps: APPS, latestProject };
const music = {
  state: () => ({ current: null, playing: false }),
  position: () => ({ time: 0, duration: 0, at: 0 }),
  subscribe: () => () => {},
  toggle: () => {},
  previous: () => {},
  next: () => {},
  seek: () => {},
};

const manifestOf = (folder) =>
  JSON.parse(
    // vitest runs from apps/web
    readFileSync(
      path.join(process.cwd(), "public/flat", folder, "manifest.json"),
      "utf8",
    ),
  );

const frameAt = (manifest, fold) =>
  manifest.frames.reduce((best, frame) =>
    Math.abs(frame.fold - fold) < Math.abs(best.fold - fold) ? frame : best,
  );

// the template is rendered by astro and read into a jsdom document. a jsdom environment would have vitest compile the
// component for the browser, where the container can't render it
let host = null;
beforeEach(async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(FlatScreens, {
    props: { apps: APPS, latestProject },
  });
  const { window } = new JSDOM(`<!doctype html><body>${html}</body>`);
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLTemplateElement: window.HTMLTemplateElement,
    getComputedStyle: window.getComputedStyle,
  });
  host = document.createElement("div");
  document.body.appendChild(host);
});

test("input rules follow the 3D conditions", () => {
  const rows = [
    // fold, phone, busy, appVisible, home, cover
    [0, "open", false, false, true, false],
    [0.11, "open", false, false, true, false],
    [0.12, "open", false, false, false, false],
    [0, "open", false, true, false, false],
    [0, "open", true, false, true, false],
    [0.5, "folding", true, false, false, false],
    [1, "closed", false, false, false, true],
    [1, "closed", true, false, false, false],
  ];
  rows.forEach(([fold, phone, busy, appVisible, home, cover]) => {
    expect(
      faceInput({ fold, phone, busy, appVisible }),
      JSON.stringify({ fold, phone, busy, appVisible }),
    ).toEqual({ home, cover });
  });
  // the flat page at full zoom and the reduced motion crossfade cover the home screen too, as in loop.js
  expect(
    faceInput({
      fold: 0,
      phone: "open",
      busy: false,
      appVisible: false,
      pageFlat: true,
    }),
  ).toEqual({ home: false, cover: false });
  expect(
    faceInput({
      fold: 0,
      phone: "open",
      busy: false,
      appVisible: false,
      fading: true,
    }),
  ).toEqual({ home: false, cover: false });
});

test("one region per pair", () => {
  const screens = createScreens({ host, siteData, music });
  const regions = [...host.querySelectorAll('[role="region"]')];
  expect(regions.map((r) => r.getAttribute("aria-label"))).toEqual([
    "Home screen",
    "Cover screen",
  ]);
  const [home, cover] = regions;
  expect(home.contains(screens.flap)).toBe(true);
  expect(home.contains(screens.body)).toBe(true);
  expect(home.contains(screens.cover)).toBe(false);
  expect(cover).toBe(screens.cover);
  regions.forEach((region) => {
    const headings = region.querySelectorAll("h1");
    expect(headings.length).toBe(1);
    expect(headings[0].textContent).toBe("Jason Yue");
  });
  // the widgets on the flap's half, and the icons and credits on the body's half and the cover
  expect(screens.flap.querySelectorAll(".widget").length).toBe(4);
  expect(screens.body.querySelectorAll(".app-icon").length).toBe(APPS.length);
  expect(screens.cover.querySelectorAll(".app-icon").length).toBe(APPS.length);
  expect(screens.body.querySelector(".status")).not.toBeNull();
  expect(screens.cover.querySelector(".status")).not.toBeNull();
  screens.destroy();
  expect(host.children.length).toBe(0);
});

test("the credits row has the weather credit and the 3D version link", () => {
  const screens = createScreens({ host, siteData, music });
  const links = [...screens.credits.querySelectorAll("a")];
  expect(links.map((a) => a.getAttribute("href"))).toEqual([
    "https://open-meteo.com/",
    "/",
  ]);
  const version = links[1];
  // the layout's click listener saves the choice for any a[data-version] before the full load
  expect(version.dataset.version).toBe("3d");
  expect(version.hasAttribute("data-astro-reload")).toBe(true);
  expect(version.textContent.trim()).toBe("3D version");
  screens.destroy();
});

test("setInput makes the faces inert and gives focus to the face that shows", () => {
  const manifest = manifestOf("landscape-day-full");
  const screens = createScreens({ host, siteData, music });
  const home = host.querySelector('[aria-label="Home screen"]');
  screens.place(frameAt(manifest, 0), manifest);
  screens.setInput({ home: true, cover: false });
  expect(home.hasAttribute("inert")).toBe(false);
  expect(screens.cover.hasAttribute("inert")).toBe(true);
  screens.body.querySelector(".app-icon").focus();
  expect(home.contains(document.activeElement)).toBe(true);
  // closing makes the home screen inert, which drops its focus in a browser, and the cover takes it once it shows
  screens.place(frameAt(manifest, 1), manifest);
  screens.setInput({ home: false, cover: true });
  expect(home.hasAttribute("inert")).toBe(true);
  expect(screens.cover.hasAttribute("inert")).toBe(false);
  document.activeElement.blur();
  screens.setInput({ home: false, cover: true });
  expect(document.activeElement).toBe(screens.cover);
  screens.destroy();
});

test("the face quads stand upright at each face's own fold", () => {
  [
    "landscape-day-full",
    "portrait-open-day-full",
    "landscape-day-half",
  ].forEach((folder) => {
    const manifest = manifestOf(folder);
    const open = faceQuads(frameAt(manifest, 0), manifest);
    const closed = faceQuads(frameAt(manifest, 1), manifest);
    [open.flap, open.body, closed.cover].forEach((face) => {
      const [tl, tr, br, bl] = face.quad;
      expect(tl[0], folder).toBeLessThan(tr[0]);
      expect(bl[0], folder).toBeLessThan(br[0]);
      expect(tl[1], folder).toBeLessThan(bl[1]);
      expect(tr[1], folder).toBeLessThan(br[1]);
      expect(facing([tl, tr, bl]), folder).toBeGreaterThan(4);
      expect(face.facing, folder).toBe(true);
    });
    // and each shows only while its side faces the camera
    expect(open.cover.facing, folder).toBe(false);
    expect(closed.flap.facing, folder).toBe(false);
  });
});

test("the face quads are in the frames' own px", () => {
  const manifest = manifestOf("landscape-day-full");
  const frame = frameAt(manifest, 0);
  const { body } = faceQuads(frame, manifest);
  const [bodyTl] = frame.corners.screens[2];
  expect(body.quad[0]).toEqual([
    bodyTl[0] + manifest.margin.x,
    bodyTl[1] + manifest.margin.top,
  ]);
});

test("the open app's icon hides while its window shows", () => {
  const screens = createScreens({ host, siteData, music });
  const glyph = (name) =>
    screens.body.querySelector(`.app-icon[data-app="${name}"] .glyph`);
  screens.setHiddenIcon("About");
  expect(glyph("About").style.visibility).toBe("hidden");
  expect(glyph("Music").style.visibility).toBe("");
  screens.setHiddenIcon("Music");
  expect(glyph("About").style.visibility).toBe("");
  expect(glyph("Music").style.visibility).toBe("hidden");
  screens.setHiddenIcon(null);
  expect(glyph("Music").style.visibility).toBe("");
  // the cover's icons are the cover's own, and stay
  expect(
    screens.cover.querySelector('.app-icon[data-app="Music"] .glyph').style
      .visibility,
  ).toBe("");
  screens.destroy();
});
