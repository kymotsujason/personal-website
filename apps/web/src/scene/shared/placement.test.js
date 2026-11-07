import { test } from "node:test";
import assert from "node:assert/strict";
import { place } from "./placement.js";

test("a 1280 by 800 window places the phone where the spike measured it", () => {
    const placed = place({ width: 1280, height: 800, portrait: false });
    assert.ok(Math.abs(placed.rest.z - -23.8847) < 1e-3, `rest.z ${placed.rest.z}`);
    assert.ok(Math.abs(placed.stage.z - -26.2732) < 1e-3, `stage.z ${placed.stage.z}`);
    assert.equal(placed.homeDist, -placed.rest.z);
});

test("a narrow portrait window is width limited, so the phone sits farther back", () => {
    const phone = place({ width: 390, height: 844, portrait: true });
    const tablet = place({ width: 768, height: 1024, portrait: true });
    assert.ok(phone.homeDist > tablet.homeDist, `${phone.homeDist} against ${tablet.homeDist}`);
});
