// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { createCards, createKept, standInIcon } from "./cards.js";

const BLOG = { name: "Blog", path: "/blog", glyph: "B", color: "#81b29a" };
const MUSIC = { name: "Music", path: "/music", glyph: "M", color: "#f67280" };
const ABOUT = { name: "About", path: "/about", glyph: "A", color: "#3d405b" };
const SKY = { top: [0.2, 0.3, 0.5], low: [0.1, 0.1, 0.2] };

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

const mount = ({ slow = false } = {}) => {
  const page = document.createElement("main");
  page.id = "page";
  const screensHost = document.createElement("div");
  const cardsHost = document.createElement("div");
  document.body.append(screensHost, page, cardsHost);
  // the open screen is 500 by 300 of its own px, drawn over 1000 by 600 frame px
  const stage = {
    screenPoint: ([u, v]) => [u * 1000, v * 600],
    placed: { appW: 1000, appH: 600 },
    geometry: { width: 1280, height: 800 },
  };
  const kept = createKept();
  const cards = createCards({
    stage,
    full: { fullW: 500, fullH: 300, radius: 20 },
    screensHost,
    cardsHost,
    kept,
    slow: () => slow,
  });
  return { cards, kept, screensHost, cardsHost };
};

const row = (fade) => ({
  cards: [
    {
      app: BLOG,
      body: { x0: 10, y0: 40, x1: 110, y1: 240 },
      label: { x0: 10, y0: 20, x1: 74, y1: 36 },
      kind: 2,
    },
    {
      app: MUSIC,
      body: { x0: 140, y0: 40, x1: 240, y1: 240 },
      label: { x0: 140, y0: 20, x1: 204, y1: 36 },
      kind: 2,
    },
    {
      app: ABOUT,
      body: { x0: 270, y0: 40, x1: 370, y1: 240 },
      label: { x0: 270, y0: 20, x1: 334, y1: 36 },
      kind: 1,
    },
  ],
  radius: 12,
  sky: SKY,
  fade,
  backdrop: 0.92,
  span: [20, 280],
});

test("a kept page shows on its card, the rest stand in, and teardown removes every host", () => {
  localStorage.setItem(
    "appSnapshots",
    JSON.stringify({
      Blog: {
        build: "",
        path: "/blog/a-post",
        page: "blog",
        html: '<div class="body"><h1>A post</h1></div>',
        scroll: 0,
      },
    }),
  );
  const { cards, kept, screensHost, cardsHost } = mount();
  kept.prepare([BLOG, MUSIC, ABOUT]);
  expect(kept.path("Blog")).toBe("/blog/a-post");
  cards.draw(row(0.5));
  expect(cardsHost.hidden).toBe(false);
  const shown = (selector) =>
    [...cardsHost.querySelectorAll(selector)].filter((el) => !el.hidden);
  // Blog's card is its kept page, Music's a stand in with its icon, and About's (the live window) only a label
  const hosts = shown(".flat-snapshot");
  expect(hosts).toHaveLength(1);
  expect(hosts[0].style.opacity).toBe("0.5");
  expect(hosts[0].style.clipPath).toMatch(/^inset\(0(px)? round /);
  const standIns = shown(".flat-card");
  expect(standIns).toHaveLength(1);
  expect(standIns[0].textContent).toBe("M");
  expect(shown(".flat-card-label")).toHaveLength(3);
  const backdrop = screensHost.querySelector(".flat-backdrop");
  expect(Number(backdrop.style.opacity)).toBeCloseTo(0.92 * 0.5, 9);

  cards.draw(null);
  expect(cardsHost.hidden).toBe(true);
  expect(backdrop.style.visibility).toBe("hidden");

  cards.draw(row(1));
  cards.destroy();
  expect(cardsHost.children).toHaveLength(0);
  expect(screensHost.querySelector(".flat-backdrop")).toBe(null);
});

test("on the slow path a kept page's card isn't clipped", () => {
  localStorage.setItem(
    "appSnapshots",
    JSON.stringify({
      Blog: { build: "", path: "/blog", page: "blog", html: "<p>x</p>" },
    }),
  );
  const { cards, kept, cardsHost } = mount({ slow: true });
  kept.prepare([BLOG]);
  cards.draw(row(1));
  const host = cardsHost.querySelector(".flat-snapshot");
  expect(host.hidden).toBe(false);
  expect(host.style.clipPath).toBe("");
});

test("a stand in's icon is the card shader's, 160 of 192 across a third of the card's short side", () => {
  const icon = standInIcon(200, 400);
  expect(icon.size).toBeCloseTo(60 * (160 / 192), 9);
  expect(icon.radius).toBeCloseTo(60 * (38 / 192), 9);
  expect(icon.font).toBeCloseTo(60 * (88 / 192), 9);
});
