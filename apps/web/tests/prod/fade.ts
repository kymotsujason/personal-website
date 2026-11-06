import type { Page } from "@playwright/test";
import { composite, contrastRatio } from "../../src/lib/contrast.js";

type Stop = { rgb: number[]; alpha: number; at: number };

export type Painted = {
  gradient: string;
  stops: Stop[];
  // how far the words' top sits above the pseudo-element's foot, and how tall the pseudo-element is
  distance: number;
  height: number;
  // the pseudo-element's own opacity, whether it is painted at all, and whether it spans the words sideways
  opacity: number;
  hidden: boolean;
  covers: boolean;
  // each text's own box, as its bottom and top edges' distances above the pseudo-element's foot
  texts: { selector: string; color: number[]; from: number; to: number }[];
};

// reads what the browser painted for a dark fade, so a missing background or a changed stop fails here. the fade is the
// owner's pseudo-element, the words are measured against its foot, and each text selector's own computed color is read
export type FadeSpec = {
  owner: string;
  index?: number;
  pseudo: "::before" | "::after";
  words: string;
  texts: string[];
};

// the dark fade each page paints under its words. a story's follows its words block, a card's is the card's own pseudo-element
export const STORY_FADE: FadeSpec = {
  owner: "#page .story-hero .words",
  pseudo: "::before",
  words: ".words",
  texts: [".kicker", ".sub", "h1"],
};
export const CARD_FADE: FadeSpec = {
  owner: "#page a.project-card.featured",
  pseudo: "::after",
  words: ".words",
  texts: [".kicker", ".sub", "h2"],
};

export const paintedFade = (page: Page, spec: FadeSpec): Promise<Painted> =>
  page
    .evaluate(({ owner, index = 0, pseudo, words, texts }) => {
      const ownerEl = document.querySelectorAll(owner)[index]!;
      const wordsEl = ownerEl.matches(words)
        ? ownerEl
        : ownerEl.querySelector(words)!;
      const style = getComputedStyle(ownerEl, pseudo);
      const box = ownerEl.getBoundingClientRect();
      const foot = box.top + parseFloat(style.top) + parseFloat(style.height);
      const left = box.left + parseFloat(style.left);
      const right = left + parseFloat(style.width);
      const wordsBox = wordsEl.getBoundingClientRect();
      const color = (value: string) =>
        (value.match(/[0-9.]+/g) ?? []).map(Number);
      return {
        gradient: style.backgroundImage,
        stops: [],
        distance: foot - wordsEl.getBoundingClientRect().top,
        height: parseFloat(style.height),
        opacity: parseFloat(style.opacity),
        hidden:
          style.display === "none" ||
          style.visibility !== "visible" ||
          style.content === "none" ||
          style.content === "normal",
        covers: left <= wordsBox.left + 0.5 && right >= wordsBox.right - 0.5,
        texts: texts.map((selector) => {
          const el = wordsEl.querySelector(selector)!;
          const rect = el.getBoundingClientRect();
          return {
            selector,
            color: color(getComputedStyle(el).color),
            from: foot - rect.bottom,
            to: foot - rect.top,
          };
        }),
      };
    }, spec)
    .then((painted) => ({
      ...painted,
      stops: parseStops(painted.gradient, painted.height),
    }));

// a stop's place is in px, as a percentage of the pseudo-element's height, or as calc(100% - Npx) from its top
const parseStops = (gradient: string, height: number): Stop[] =>
  [
    ...gradient.matchAll(
      /rgba?\((\d+), (\d+), (\d+)(?:, ([0-9.]+))?\) (calc\(100% - ([0-9.]+)px\)|-?[0-9.]+px|-?[0-9.]+%)/g,
    ),
  ].map((m) => ({
    rgb: [Number(m[1]), Number(m[2]), Number(m[3])],
    alpha: m[4] === undefined ? 1 : Number(m[4]),
    at: m[6]
      ? height - Number(m[6])
      : m[5]!.endsWith("%")
        ? (height * parseFloat(m[5]!)) / 100
        : parseFloat(m[5]!),
  }));

// the fade's color and alpha at a distance above its foot, between the stops it was painted with. the colors blend
// premultiplied by their alpha, the way css blends a gradient
const fadeAt = (painted: Painted, distance: number) => {
  const { stops, height } = painted;
  if (distance < 0 || distance > height) {
    return { rgb: [255, 255, 255], alpha: 0 };
  }
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1]!;
    const to = stops[i]!;
    if (distance <= to.at) {
      const t = (distance - from.at) / (to.at - from.at);
      const alpha = from.alpha + (to.alpha - from.alpha) * t;
      if (alpha === 0) {
        return { rgb: from.rgb, alpha: 0 };
      }
      const rgb = from.rgb.map(
        (c, k) =>
          (c * from.alpha + (to.rgb[k]! * to.alpha - c * from.alpha) * t) /
          alpha,
      );
      return { rgb, alpha };
    }
  }
  return { rgb: [255, 255, 255], alpha: 0 };
};

export const alphaAt = (painted: Painted, distance: number): number =>
  fadeAt(painted, distance).alpha;

// each text's worst contrast against the fade over a picture that is pure white behind it, taken at every pixel of the
// gradient behind the text's own box, with the text's own alpha laid on top. a fade that is hidden, transparent, or
// doesn't span the words leaves the white picture as the backing
export const worstContrasts = (painted: Painted) => {
  const painting = painted.hidden || !painted.covers ? 0 : painted.opacity;
  const white = [255, 255, 255];
  return painted.texts.map(({ selector, color: text, from, to }) => {
    const distances = [from, to];
    for (let d = Math.ceil(from); d < to; d++) {
      distances.push(d);
    }
    let worst = Infinity;
    for (const distance of distances) {
      const { rgb, alpha } = fadeAt(painted, distance);
      const backing = composite(
        [rgb[0]!, rgb[1]!, rgb[2]!, alpha * painting],
        white,
      );
      const ratio = contrastRatio(
        composite([text[0]!, text[1]!, text[2]!, text[3] ?? 1], backing),
        backing,
      );
      worst = Math.min(worst, ratio);
    }
    return { selector, ratio: worst };
  });
};
