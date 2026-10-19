import { test } from "node:test";
import assert from "node:assert/strict";
import { state, pose, settings, DUO, TAP_FOLD, FOV, HOME_FILL } from "./state.js";

const FIELDS = [
    "flap", "body", "hands", "screen", "cover", "wallpaper", "frost", "glass", "volume", "charger", "phone", "openApp",
    "pendingPage", "openIcon", "appEl", "pageFlat", "appSplash", "appLive", "surfaces", "homeLaidOut", "screensChanged",
    "statusChanged", "chargeFit", "warmedUp", "busy", "zoomed", "appVisible", "portrait", "posing", "lead", "foldPath",
    "lastFold", "root", "handModel", "poses", "pageFade"
];

test("every field the scene sets on state is declared up front", () => {
    FIELDS.forEach((field) => {
        assert.ok(Object.hasOwn(state, field), `state.${field} is declared`);
    });
});

test("the pose, the settings, and the constants are there", () => {
    assert.deepEqual(Object.keys(pose), ["x", "y", "z", "rx", "ry", "rz", "blur", "idle", "fold"]);
    assert.deepEqual(settings, { flatAtFullZoom: true, device: "auto", hands: "hands", finish: "star-white" });
    assert.equal(DUO.halfW, 8.23);
    assert.equal(TAP_FOLD, 0.12);
    assert.equal(FOV, 32);
    assert.equal(HOME_FILL, 0.86);
});
