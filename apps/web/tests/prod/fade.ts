import type { Page } from "@playwright/test";

type Stop = { rgb: number[]; alpha: number; at: number };

export type Painted = {
  gradient: string;
  stops: Stop[];
  // how far the words' top sits above the pseudo-element's foot, and how tall the pseudo-element is
  distance: number;
  height: number;
  texts: { selector: string; color: number[] }[];
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
      const color = (value: string) =>
        (value.match(/[0-9.]+/g) ?? []).map(Number);
      return {
        gradient: style.backgroundImage,
        stops: [],
        distance: foot - wordsEl.getBoundingClientRect().top,
        height: parseFloat(style.height),
        texts: texts.map((selector) => ({
          selector,
          color: color(
            getComputedStyle(wordsEl.querySelector(selector)!).color,
          ),
        })),
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

// the fade's alpha at a distance above its foot, between the stops it was painted with
export const alphaAt = (painted: Painted, distance: number): number => {
  const { stops, height } = painted;
  if (distance < 0 || distance > height) {
    return 0;
  }
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1]!;
    const to = stops[i]!;
    if (distance <= to.at) {
      const t = (distance - from.at) / (to.at - from.at);
      return from.alpha + (to.alpha - from.alpha) * t;
    }
  }
  return 0;
};

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = (rgb: number[]) =>
  0.2126 * channel(rgb[0]!) +
  0.7152 * channel(rgb[1]!) +
  0.0722 * channel(rgb[2]!);

const over = (top: number[], alpha: number, under: number[]) =>
  under.map((u, i) => top[i]! * alpha + u * (1 - alpha));

export const ratio = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// each text's contrast against the fade over a picture that is pure white behind it, with the text's own alpha laid on top
export const worstContrasts = (painted: Painted) => {
  const alpha = alphaAt(painted, painted.distance);
  const color = painted.stops[0]?.rgb ?? [255, 255, 255];
  const backing = over(color, alpha, [255, 255, 255]);
  return painted.texts.map(({ selector, color: text }) => ({
    selector,
    ratio: ratio(over(text.slice(0, 3), text[3] ?? 1, backing), backing),
  }));
};
