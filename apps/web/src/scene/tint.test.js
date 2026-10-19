import { test } from "node:test";
import assert from "node:assert/strict";
import { skyTint, TINT_STRENGTH } from "./tint.js";

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
