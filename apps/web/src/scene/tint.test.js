import { test } from "node:test";
import assert from "node:assert/strict";
import { skyTint, glassColor, GLASS_CEILING, TINT_STRENGTH } from "./tint.js";

const probe = (colors) => {
    const pixels = new Uint8Array(colors.length * 4);
    colors.forEach((c, i) => pixels.set([...c, 255], i * 4));
    return { width: colors.length, height: 1, pixels };
};

test("a gray sky leaves the glass white", () => {
    assert.deepEqual(skyTint(probe([[90, 90, 90], [30, 30, 30]])), [1, 1, 1]);
});

test("a blue sky tints the glass a little blue, keeping its brightest channel at full", () => {
    const [r, g, b] = skyTint(probe([[40, 80, 200], [60, 100, 220]]));
    assert.equal(b, 1);
    assert.ok(r < g && g < b, `got ${[r, g, b]}`);
    assert.ok(r > 1 - TINT_STRENGTH - 1e-9, `the tint is gentle, got ${r}`);
});

test("a black sky leaves the glass white instead of dividing by nothing", () => {
    assert.deepEqual(skyTint(probe([[0, 0, 0]])), [1, 1, 1]);
});

const luma = ([r, g, b]) => {
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

test("a dim sky's glass is the sky's average lifted a little toward the tint", () => {
    const [r, g, b] = glassColor(probe([[20, 40, 80], [40, 60, 100]]), [1, 1, 1]);
    const near = (got, want) => assert.ok(Math.abs(got - want) < 1e-9, `got ${got}, want ${want}`);
    near(r, (30 / 255) * 0.86 + 0.14);
    near(g, (50 / 255) * 0.86 + 0.14);
    near(b, (90 / 255) * 0.86 + 0.14);
});

test("a bright sky's glass darkens to the glass's ceiling, keeping its hue", () => {
    const glass = glassColor(probe([[150, 200, 255]]), [0.8, 0.9, 1]);
    assert.ok(Math.abs(luma(glass) - GLASS_CEILING) < 1e-6, `got ${luma(glass)}`);
    assert.ok(glass[0] < glass[1] && glass[1] < glass[2], `got ${glass}`);
});
