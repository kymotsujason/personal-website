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
