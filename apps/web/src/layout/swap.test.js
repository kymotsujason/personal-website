// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { customSwap } from "./swap.js";

const OLD_BODY = `
  <div id="stage">
    <div id="css-layer"><div class="screen">phone</div></div>
    <main id="page" data-app="About" class="about" style="transform: matrix(1, 0, 0, 1, 4, 5); visibility: hidden">
      <div class="body"><h1>About</h1></div>
    </main>
    <canvas id="gl-layer"></canvas>
  </div>
  <div id="player-host"><iframe src="https://www.youtube-nocookie.com/embed/x"></iframe></div>
  <div id="panel">dev</div>`;

const NEW_PAGE = `<!doctype html>
<html lang="en">
  <head><title>Music | Jason Yue</title><meta name="build-id" content="abc" /></head>
  <body>
    <div id="stage">
      <div id="css-layer"></div>
      <main id="page" data-app="Music" class="music-page" aria-label="Music" style="opacity: 0.5">
        <div class="body"><h1>Music</h1><div class="player-slot"></div></div>
      </main>
      <canvas id="gl-layer"></canvas>
    </div>
    <div id="player-host"></div>
  </body>
</html>`;

// Astro's swapFunctions, standing in: each records its call, and the root swap removes every root attribute the way
// Astro's does, so the root state has to be put back afterwards
const standIns = (calls) => ({
  deselectScripts: () => calls.push("deselectScripts"),
  swapRootAttributes: (doc) => {
    calls.push("swapRootAttributes");
    const root = document.documentElement;
    [...root.attributes].forEach(({ name }) => root.removeAttribute(name));
    [...doc.documentElement.attributes].forEach(({ name, value }) =>
      root.setAttribute(name, value),
    );
  },
  swapHeadElements: () => calls.push("swapHeadElements"),
  swapBodyElement: () => calls.push("swapBodyElement"),
  saveFocus: () => {
    calls.push(
      `saveFocus with ${document.getElementById("page")?.dataset.app}`,
    );
    return () => {
      const page = document.getElementById("page");
      calls.push(`restore with ${page?.dataset.app}`);
    };
  },
});

const parse = (html) => new DOMParser().parseFromString(html, "text/html");

describe("customSwap", () => {
  let calls;
  let outside;

  beforeEach(() => {
    calls = [];
    const root = document.documentElement;
    root.className = "has-3d page-first";
    root.style.setProperty("--rim-angle", "42deg");
    root.style.setProperty("--glass-fill", "rgba(1, 2, 3, 0.4)");
    document.body.innerHTML = OLD_BODY;
    outside = {
      stage: document.getElementById("stage"),
      layer: document.getElementById("css-layer"),
      layerHtml: document.getElementById("css-layer").outerHTML,
      canvas: document.getElementById("gl-layer"),
      host: document.getElementById("player-host"),
      frame: document.querySelector("#player-host iframe"),
      hostHtml: document.getElementById("player-host").outerHTML,
      panel: document.getElementById("panel"),
      page: document.getElementById("page"),
    };
    customSwap(
      parse(NEW_PAGE),
      {
        classes: ["has-3d", "page-first"],
        props: { "--rim-angle": "42deg", "--glass-fill": "rgba(1, 2, 3, 0.4)" },
      },
      standIns(calls),
    );
  });

  test("#page takes the new page's children and data-app", () => {
    const page = document.getElementById("page");
    expect(page.dataset.app).toBe("Music");
    expect(page.querySelector("h1").textContent).toBe("Music");
    expect(page.querySelector(".player-slot")).not.toBeNull();
    expect(page.getAttribute("aria-label")).toBe("Music");
    expect(page.classList.contains("music-page")).toBe(true);
    expect(page.classList.contains("about")).toBe(false);
  });

  test("#page keeps the scene's inline style", () => {
    const page = document.getElementById("page");
    expect(page.getAttribute("style")).toBe(
      "transform: matrix(1, 0, 0, 1, 4, 5); visibility: hidden",
    );
  });

  test("#page keeps the scene's inline style when the new page has none", () => {
    customSwap(
      parse(NEW_PAGE.replace(' style="opacity: 0.5"', "")),
      { classes: [], props: {} },
      standIns([]),
    );
    expect(document.getElementById("page").getAttribute("style")).toBe(
      "transform: matrix(1, 0, 0, 1, 4, 5); visibility: hidden",
    );
  });

  test("the root gets its classes and custom properties back", () => {
    const root = document.documentElement;
    expect(root.getAttribute("lang")).toBe("en");
    expect(root.classList.contains("has-3d")).toBe(true);
    expect(root.classList.contains("page-first")).toBe(true);
    expect(root.style.getPropertyValue("--rim-angle")).toBe("42deg");
    expect(root.style.getPropertyValue("--glass-fill")).toBe(
      "rgba(1, 2, 3, 0.4)",
    );
  });

  test("the body outside #page is the same nodes as before", () => {
    expect(document.getElementById("page")).toBe(outside.page);
    expect(document.getElementById("stage")).toBe(outside.stage);
    expect(document.getElementById("css-layer")).toBe(outside.layer);
    expect(document.getElementById("css-layer").outerHTML).toBe(
      outside.layerHtml,
    );
    expect(document.getElementById("gl-layer")).toBe(outside.canvas);
    expect(document.getElementById("player-host")).toBe(outside.host);
    expect(document.querySelector("#player-host iframe")).toBe(outside.frame);
    expect(document.getElementById("player-host").outerHTML).toBe(
      outside.hostHtml,
    );
    expect(document.getElementById("panel")).toBe(outside.panel);
    expect([...document.body.children].map((el) => el.id)).toEqual([
      "stage",
      "player-host",
      "panel",
    ]);
  });

  test("Astro's swap functions run in order, with #page swapped before focus comes back", () => {
    expect(calls).toEqual([
      "deselectScripts",
      "swapRootAttributes",
      "swapHeadElements",
      "saveFocus with About",
      "restore with Music",
    ]);
  });
});
