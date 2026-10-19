import { test } from "node:test";
import assert from "node:assert/strict";
import { unpin } from "./pin.js";

const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

test("a point on the screen maps back to the spot on the pinned element under it", () => {
    // the element scaled by 2 and moved to 100, 50
    const corners = [[100, 50], [300, 50], [100, 250], [300, 250]];
    assert.ok(close(unpin(100, 100, corners, [200, 150]), [50, 50]));
    assert.ok(close(unpin(100, 100, corners, [100, 50]), [0, 0]));
});

test("unpinning undoes the perspective of a tilted surface", () => {
    const corners = [[120, 40], [380, 90], [100, 300], [400, 260]];
    assert.ok(close(unpin(200, 100, corners, [120, 40]), [0, 0]));
    assert.ok(close(unpin(200, 100, corners, [380, 90]), [200, 0]));
    assert.ok(close(unpin(200, 100, corners, [100, 300]), [0, 100]));
    assert.ok(close(unpin(200, 100, corners, [400, 260]), [200, 100]));
});
