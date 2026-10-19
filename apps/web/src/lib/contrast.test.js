import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { composite, contrastRatio } from "./contrast";
import { daylight } from "../scene/daylight.js";
import { sunPlace } from "../scene/skyPath.js";
import { skyVars } from "./sky";

const flat = readFileSync(
  new URL("../styles/flat.css", import.meta.url),
  "utf8",
);

const accents = [
  ...flat.matchAll(
    /#page\[data-app="(\w+)"\]\s*\{[^}]*--accent:\s*(#[0-9a-f]{6})/gi,
  ),
].map(([, app, color]) => ({ app, color }));
const number = (name) => {
  const found = flat.match(new RegExp(`${name}:\\s*([0-9.]+)\\s*;`));
  if (!found) {
    throw new Error(`flat.css has no ${name}`);
  }
  return Number(found[1]);
};
const accentFill = number("--accent-fill");
const pillBase = number("--pill-base");
const RIM = [255, 255, 255, 0.6];
const SHEET = [12, 12, 20, 0.72];
const GLASS = [255, 255, 255, 0.14];
// the highlight is the pane's top background layer, so its peak sits right under the label
const HIGHLIGHT = [255, 255, 255, 0.14];

const hex = (c) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// the sky as the page draws it for a scene at an hour: the gradient, the sun glow where the sun sits, and the dim sky.js
// asks for, sampled down the page. the glow is taken at its strongest anywhere within reach of the sun
const SCENES = [
  "clear",
  "partly cloudy",
  "cloudy",
  "fog",
  "drizzle",
  "rain",
  "snow",
  "thunder",
];
const HOURS = { noon: 12, dawn: 7, dusk: 19, night: 23 };
const SAMPLES = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];
const GLOW_REACH = 0.2;

const numbers = (text) => text.match(/[0-9.]+/g).map(Number);

const skies = () => {
  const found = [];
  for (const scene of SCENES) {
    for (const [name, hour] of Object.entries(HOURS)) {
      const sun = sunPlace(hour, { sunrise: 7, sunset: 19 });
      const { day, warm } = daylight(hour);
      const vars = skyVars({
        day,
        warm,
        scene,
        intensity: "moderate",
        sun: [sun.x, sun.y],
        sunUp: sun.up,
        moon: null,
        moonUp: 0,
      });
      const top = numbers(vars["--sky-top"]);
      const low = numbers(vars["--sky-low"]);
      const glow =
        vars["--sun-glow"] === "transparent"
          ? null
          : numbers(vars["--sun-glow"]);
      const sunAt = Number.parseFloat(vars["--sun-y"]) / 100;
      const dimTop = Number(vars["--dim-top"]);
      const dimLow = Number(vars["--dim-low"]);
      const backs = SAMPLES.map((t) => {
        let color = top.map((v, i) => v + (low[i] - v) * t);
        if (glow && Math.abs(t - sunAt) <= GLOW_REACH) {
          color = composite(glow, color);
        }
        return {
          t,
          color: composite([0, 0, 0, dimTop + (dimLow - dimTop) * t], color),
        };
      });
      found.push({ label: `${scene} at ${name}`, backs, day });
    }
  }
  return found;
};

const allSkies = skies();
// the daytime skies are the ones that can be bright, but every scene and hour is checked
const eachBack = (check) => {
  for (const sky of allSkies) {
    for (const { t, color } of sky.backs) {
      check(color, `${sky.label} at ${t}`);
    }
  }
};

test("white on black is 21 to 1", () => {
  expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
});

test("the accents come from flat.css", () => {
  expect(accents.map((a) => a.app).sort()).toEqual([
    "About",
    "Blog",
    "Music",
    "Projects",
  ]);
});

test("a large white title reads on the bare sky in every scene", () => {
  eachBack((bg, label) => {
    expect(contrastRatio("#ffffff", hex(bg)), label).toBeGreaterThanOrEqual(3);
  });
});

test("every accent reads on the sheet over the sky", () => {
  eachBack((bg, label) => {
    const sheet = composite(SHEET, bg);
    for (const { app, color } of accents) {
      expect(
        contrastRatio(color, hex(sheet)),
        `${app} ${label}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// the pill sits under the sky's dim and the label under the rim at its brightest, then the glass fill, the dark base,
// the accent tint, and the highlight's peak, the way .glass layers them
test("white reads on every accent filled pill over the sky", () => {
  eachBack((bg, label) => {
    for (const { app, color } of accents) {
      let pill = composite(RIM, bg);
      pill = composite(GLASS, pill);
      pill = composite([0, 0, 0, pillBase], pill);
      pill = composite([...hexRgb(color), accentFill], pill);
      pill = composite(HIGHLIGHT, pill);
      expect(
        contrastRatio("#ffffff", hex(pill)),
        `${app} ${label}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

const rule = (selector) => {
  const found = flat.match(
    new RegExp(`${selector.replace(/[[\]".]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  if (!found) {
    throw new Error(`flat.css has no ${selector}`);
  }
  return found[1];
};
const baseOf = (text) =>
  Number(text.match(/--base:\s*rgba\(0, 0, 0, ([0-9.]+)\)/)[1]);
const secondaryOf = (text) =>
  [...text.matchAll(/color:\s*rgba\(235, 235, 245, ([0-9.]+)\)/g)].map(
    ([, a]) => Number(a),
  );

// a Today card's strip sits on the card's glass, over the accent glow, over the sky. the glow's strongest alpha
// is the worst case for white text, and the strip is layered the way .glass layers it
test("the Today card strip's text reads over the accent glow", () => {
  const base = baseOf(rule('#page[data-page="projects"] .project-card .strip'));
  const glows = [
    ...rule('#page[data-page="projects"] .project-card .pic.glow').matchAll(
      /var\(--accent\) (\d+)%/g,
    ),
  ].map(([, pct]) => Number(pct) / 100);
  const secondary = secondaryOf(
    rule('#page[data-page="projects"] .project-card .strip p'),
  );
  expect(glows.length).toBeGreaterThan(0);
  expect(secondary).toHaveLength(1);
  const glow = Math.max(...glows);
  eachBack((bg, label) => {
    for (const { app, color } of accents) {
      let card = composite(RIM, bg);
      card = composite(GLASS, card);
      card = composite([...hexRgb(color), glow], card);
      let strip = composite(RIM, card);
      strip = composite(GLASS, strip);
      strip = composite([0, 0, 0, base], strip);
      strip = composite(HIGHLIGHT, strip);
      expect(
        contrastRatio("#ffffff", hex(strip)),
        `title ${app} ${label}`,
      ).toBeGreaterThanOrEqual(4.5);
      const text = composite([235, 235, 245, secondary[0]], strip);
      expect(
        contrastRatio(hex(text), hex(strip)),
        `summary ${app} ${label}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// a blog row's date and excerpt sit on the year panel's glass over its dark base, under the highlight's peak
test("the blog rows' secondary text reads on the panel", () => {
  const panel = baseOf(rule('#page[data-page="blog"] .rows'));
  const sub = flat.match(
    /#page\[data-page="blog"\] \.post-row \.sub,[^{]*\{[^}]*color:\s*rgba\(235, 235, 245, ([0-9.]+)\)/,
  );
  expect(sub).not.toBeNull();
  eachBack((bg, label) => {
    let pane = composite(RIM, bg);
    pane = composite(GLASS, pane);
    pane = composite([0, 0, 0, panel], pane);
    pane = composite(HIGHLIGHT, pane);
    const text = composite([235, 235, 245, Number(sub[1])], pane);
    expect(contrastRatio(hex(text), hex(pane)), label).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});

// the floating toolbar has the pill's layers with a base of its own, and its white labels sit under the highlight's peak
test("white reads on the toolbar", () => {
  const base = baseOf(rule("#page .toolbar"));
  eachBack((bg, label) => {
    let bar = composite(RIM, bg);
    bar = composite(GLASS, bar);
    bar = composite([0, 0, 0, base], bar);
    bar = composite(HIGHLIGHT, bar);
    expect(contrastRatio("#ffffff", hex(bar)), label).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});

// about's panes and the flat home's widgets are glass with a dark base. the rim is at its brightest (0.6) at one end of
// the pane, so the text is put at that value, which is the worst position it can have
const aboutMuted = [
  ...secondaryOf(rule('#page[data-page="about"] .w .label')),
  ...secondaryOf(rule('#page[data-page="about"] .w .sub')),
];
const aboutPane = rule('#page[data-page="about"] .w');
const homePane = rule('#page[data-page="home"] .widget');

test("about's panes carry a dark base", () => {
  expect(aboutPane).toMatch(/--base:/);
  expect(homePane).toMatch(/--base:/);
  expect(aboutMuted).toHaveLength(2);
});

test("white and muted text read on about's panes", () => {
  const base = baseOf(aboutPane);
  eachBack((bg, label) => {
    let pane = composite(RIM, bg);
    pane = composite(GLASS, pane);
    pane = composite([0, 0, 0, base], pane);
    pane = composite(HIGHLIGHT, pane);
    expect(
      contrastRatio("#ffffff", hex(pane)),
      `white ${label}`,
    ).toBeGreaterThanOrEqual(4.5);
    for (const alpha of aboutMuted) {
      const text = composite([235, 235, 245, alpha], pane);
      expect(
        contrastRatio(hex(text), hex(pane)),
        `muted ${label}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// the fact cards keep their own colors and ink, and their 21px bold text is large text, so 3:1 applies. the card's own
// fill sits on the facts pane's glass, with the pointer highlight under it at its peak
test("the fact cards' text reads at 3 to 1 on about's pane", () => {
  const about = readFileSync(
    new URL("../pages/about.astro", import.meta.url),
    "utf8",
  );
  const cards = [
    ...about.matchAll(
      /\{ fill: "rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)"(?:, ink: "(#[0-9a-fA-F]{6})")? \}/g,
    ),
  ].map(([, r, g, b, a, ink]) => ({
    fill: [Number(r), Number(g), Number(b), Number(a)],
    ink: ink ?? "#ffffff",
  }));
  expect(cards.length).toBeGreaterThan(0);
  expect(cards.some((card) => card.ink !== "#ffffff")).toBe(true);
  const base = baseOf(aboutPane);
  eachBack((bg, label) => {
    let pane = composite(RIM, bg);
    pane = composite(GLASS, pane);
    pane = composite([0, 0, 0, base], pane);
    pane = composite(HIGHLIGHT, pane);
    for (const card of cards) {
      const fill = composite(card.fill, pane);
      expect(
        contrastRatio(card.ink, hex(fill)),
        `${card.fill.join(",")} ${card.ink} ${label}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

test("white reads on the flat home's widgets", () => {
  const base = baseOf(homePane);
  const fill = Number(homePane.match(/--fill:\s*([0-9.]+)/)[1]);
  eachBack((bg, label) => {
    let pane = composite(RIM, bg);
    pane = composite([255, 255, 255, fill], pane);
    pane = composite([0, 0, 0, base], pane);
    pane = composite(HIGHLIGHT, pane);
    // the widgets' title and line are white at 0.9
    const text = composite([255, 255, 255, 0.9], pane);
    expect(contrastRatio(hex(text), hex(pane)), label).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
