// the glass takes on a little of the sky's color: warm at dawn, navy at night, gray in the rain. the sky's average,
// read back small (wallpaper.js measure), scaled so its brightest channel is full, then mostly white again, so the
// glass leans toward the sky without turning its color
export const TINT_STRENGTH = 0.35;

export const skyTint = (probe) => {
    const { pixels } = probe;
    const sum = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) {
        sum[0] += pixels[i];
        sum[1] += pixels[i + 1];
        sum[2] += pixels[i + 2];
    }
    const top = Math.max(...sum);
    if (top <= 0) {
        return [1, 1, 1];
    }
    return sum.map((c) => 1 - TINT_STRENGTH + (TINT_STRENGTH * c) / top);
};

// about the color a widget's frosted glass comes out (composite.js): the sky's average lifted toward the tint, and
// darkened to the glass's ceiling over a bright sky. GLASS_CEILING is the shader's own, kept the same by hand. an app
// window grown out of a widget takes this color on its way back into it
export const GLASS_CEILING = 0.3;
const GLASS_LIFT = 0.14;
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export const glassColor = (probe, tint) => {
    const { pixels } = probe;
    const sum = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) {
        sum[0] += pixels[i];
        sum[1] += pixels[i + 1];
        sum[2] += pixels[i + 2];
    }
    const count = Math.max(pixels.length / 4, 1);
    const glass = sum.map((c, i) => (c / count / 255) * (1 - GLASS_LIFT) + tint[i] * GLASS_LIFT);
    const linear = glass.map(toLinear);
    const light = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    if (light <= GLASS_CEILING) {
        return glass;
    }
    return linear.map((c) => toSrgb((c * GLASS_CEILING) / light));
};
