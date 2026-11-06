import { expect, test } from "vitest";
import {
  alphaAt,
  CARD_FADE,
  STORY_FADE,
  worstContrasts,
  type Painted,
} from "../prod/fade";

const WHITE = [255, 255, 255, 1];

const at = (distance: number, color = WHITE, selector = "h1") => [
  { selector, color, from: distance, to: distance },
];

const painted = (over: Partial<Painted> = {}): Painted => ({
  gradient: "linear-gradient(to top, ...)",
  stops: [
    { rgb: [0, 0, 0], alpha: 0.96, at: 0 },
    { rgb: [0, 0, 0], alpha: 0.8, at: 170 },
    { rgb: [0, 0, 0], alpha: 0, at: 260 },
  ],
  distance: 120,
  height: 260,
  opacity: 1,
  hidden: false,
  covers: true,
  texts: at(120),
  ...over,
});

test("a dark fade under white words passes with room to spare", () => {
  const [h1] = worstContrasts(painted());
  expect(h1!.ratio).toBeGreaterThan(9);
});

test("a white second stop paints white, so white words get a ratio of 1", () => {
  const [h1] = worstContrasts(
    painted({
      stops: [
        { rgb: [0, 0, 0], alpha: 0.8, at: 0 },
        { rgb: [255, 255, 255], alpha: 0.8, at: 170 },
        { rgb: [255, 255, 255], alpha: 0, at: 260 },
      ],
      distance: 170,
      texts: at(170),
    }),
  );
  expect(h1!.ratio).toBeCloseTo(1, 5);
});

test("a color halfway between two stops is the mix of both", () => {
  const [h1] = worstContrasts(
    painted({
      stops: [
        { rgb: [0, 0, 0], alpha: 1, at: 0 },
        { rgb: [255, 255, 255], alpha: 1, at: 100 },
        { rgb: [255, 255, 255], alpha: 0, at: 260 },
      ],
      distance: 50,
      texts: at(50),
    }),
  );
  // a backing of 127.5 grey against white words
  expect(h1!.ratio).toBeCloseTo(1.05 / (0.2158 + 0.05), 1);
});

test("a fade with zero opacity paints nothing", () => {
  const [h1] = worstContrasts(painted({ opacity: 0 }));
  expect(h1!.ratio).toBeCloseTo(1, 5);
});

test("half opacity halves the fade's alpha", () => {
  const full = worstContrasts(painted())[0]!.ratio;
  const half = worstContrasts(painted({ opacity: 0.5 }))[0]!.ratio;
  expect(half).toBeLessThan(full);
  expect(half).toBeGreaterThan(1);
});

test("a hidden fade paints nothing", () => {
  const [h1] = worstContrasts(painted({ hidden: true }));
  expect(h1!.ratio).toBeCloseTo(1, 5);
});

test("a backing that doesn't reach the words paints nothing under them", () => {
  const [h1] = worstContrasts(painted({ covers: false }));
  expect(h1!.ratio).toBeCloseTo(1, 5);
});

test("alphaAt is zero outside the fade and follows the stops inside it", () => {
  expect(alphaAt(painted(), -1)).toBe(0);
  expect(alphaAt(painted(), 261)).toBe(0);
  expect(alphaAt(painted(), 0)).toBeCloseTo(0.96, 5);
  expect(alphaAt(painted(), 215)).toBeCloseTo(0.4, 5);
});

const WHITE_FOOT = [
  { rgb: [255, 255, 255], alpha: 1, at: 0 },
  { rgb: [0, 0, 0], alpha: 1, at: 100 },
  { rgb: [0, 0, 0], alpha: 0, at: 260 },
];

test("a text low in the fade fails even when the words' top passes", () => {
  const box = (selector: string, from: number, to: number) => ({
    selector,
    color: WHITE,
    from,
    to,
  });
  const ratios = worstContrasts(
    painted({
      stops: WHITE_FOOT,
      distance: 170,
      texts: [box("h1", 150, 170), box(".sub", 20, 40)],
    }),
  );
  expect(ratios[0]!.ratio).toBeGreaterThan(4.5);
  expect(ratios[1]!.ratio).toBeLessThan(4.5);
});

test("a text crossing a white stop inside its box fails while both edges pass", () => {
  const stops = [
    { rgb: [0, 0, 0], alpha: 1, at: 0 },
    { rgb: [0, 0, 0], alpha: 1, at: 30 },
    { rgb: [255, 255, 255], alpha: 1, at: 50 },
    { rgb: [0, 0, 0], alpha: 1, at: 70 },
    { rgb: [0, 0, 0], alpha: 0, at: 260 },
  ];
  const edges = (from: number, to: number) =>
    worstContrasts(
      painted({
        stops,
        distance: to,
        texts: [{ selector: "h1", color: WHITE, from, to }],
      }),
    )[0]!.ratio;
  expect(edges(20, 20)).toBeGreaterThan(4.5);
  expect(edges(80, 80)).toBeGreaterThan(4.5);
  expect(edges(20, 80)).toBeLessThan(4.5);
});

test("a text's own color decides when only the kicker fails", () => {
  const dark = [30, 30, 30, 1];
  const ratios = worstContrasts(
    painted({
      texts: [
        { selector: ".kicker", color: dark, from: 100, to: 112 },
        { selector: "h1", color: WHITE, from: 60, to: 100 },
      ],
    }),
  );
  expect(ratios[0]!.selector).toBe(".kicker");
  expect(ratios[0]!.ratio).toBeLessThan(4.5);
  expect(ratios[1]!.ratio).toBeGreaterThan(4.5);
});

test("both fade specs check the kicker", () => {
  expect(STORY_FADE.texts).toContain(".kicker");
  expect(CARD_FADE.texts).toContain(".kicker");
});
