// wcag contrast, and the compositing the accent checks need

const channel = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const toRgb = (color) =>
  typeof color === "string"
    ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
    : color;

export const luminance = (color) => {
  const [r, g, b] = toRgb(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

// a color is "#rrggbb" or [r, g, b] in 0 to 255
export const contrastRatio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// a translucent [r, g, b, a] over an opaque [r, g, b]
export const composite = ([r, g, b, a], under) => [
  r * a + under[0] * (1 - a),
  g * a + under[1] * (1 - a),
  b * a + under[2] * (1 - a),
];
