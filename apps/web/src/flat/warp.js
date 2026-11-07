// the homography between two quads, ported from the spike's build_packed.py. quads are four [x, y] points in order
// around the edge (top left, top right, bottom right, bottom left), the order the capture records them in, while
// scene/pin.js cornerPin takes tl, tr, bl, br

const squareToQuad = ([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) => {
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
  }
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return [
    x1 - x0 + g * x1,
    x3 - x0 + h * x3,
    x0,
    y1 - y0 + g * y1,
    y3 - y0 + h * y3,
    y0,
    g,
    h,
    1,
  ];
};

const multiply = (a, b) =>
  Array.from({ length: 9 }, (_, n) => {
    const i = Math.floor(n / 3);
    const j = n % 3;
    return a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
  });

const invert = (m) => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const adj = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
  const det = a * adj[0] + b * adj[3] + c * adj[6];
  return adj.map((value) => value / det);
};

// the 3 by 3 matrix, row by row, that takes src's corners onto dst's
export const homography = (src, dst) => {
  const m = multiply(squareToQuad(dst), invert(squareToQuad(src)));
  return m.map((value) => value / m[8]);
};

export const mapPoint = (m, [x, y]) => {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
};

// as a css matrix3d for an element with transform-origin 0 0
export const quadToQuad = (src, dst) => {
  const m = homography(src, dst);
  return `matrix3d(${[m[0], m[3], 0, m[6], m[1], m[4], 0, m[7], 0, 0, 1, 0, m[2], m[5], 0, m[8]].join(", ")})`;
};
