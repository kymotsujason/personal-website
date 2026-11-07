import { expect, test } from "vitest";
import { quadToQuad } from "./warp.js";

// a matrix3d string applied to a point on the element's own plane, the way the browser draws it with origin 0 0
const apply = (css, [x, y]) => {
  const m = css
    .slice("matrix3d(".length, -1)
    .split(",")
    .map((value) => Number(value));
  expect(m).toHaveLength(16);
  const w = m[3] * x + m[7] * y + m[15];
  return [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w];
};

test("quadToQuad maps the corners exactly", () => {
  const src = [
    [0, 0],
    [320, 0],
    [320, 480],
    [0, 480],
  ];
  const dst = [
    [173.49, 72.26],
    [641.18, 80.1],
    [630.5, 727.74],
    [160.2, 700.3],
  ];
  const css = quadToQuad(src, dst);
  expect(css.startsWith("matrix3d(")).toBe(true);
  src.forEach((point, i) => {
    const [x, y] = apply(css, point);
    expect(x).toBeCloseTo(dst[i][0], 6);
    expect(y).toBeCloseTo(dst[i][1], 6);
  });
  // a quad that isn't a square in, so the source side is really inverted
  const tilted = [
    [10, 20],
    [300, 5],
    [310, 400],
    [-5, 390],
  ];
  const back = quadToQuad(dst, tilted);
  dst.forEach((point, i) => {
    const [x, y] = apply(back, point);
    expect(x).toBeCloseTo(tilted[i][0], 6);
    expect(y).toBeCloseTo(tilted[i][1], 6);
  });
});

test("quadToQuad of a square to itself is identity", () => {
  const square = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];
  const m = quadToQuad(square, square)
    .slice("matrix3d(".length, -1)
    .split(",")
    .map((value) => Number(value));
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  m.forEach((value, i) => expect(value).toBeCloseTo(identity[i], 12));
});
