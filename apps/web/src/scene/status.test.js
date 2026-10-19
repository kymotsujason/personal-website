import { test } from "node:test";
import assert from "node:assert/strict";
import { nextCheck } from "./status.js";

test("a draining battery is checked each second while its phase has more than that left", () => {
    assert.equal(nextCheck({ charging: false, phaseLeft: 5000 }, 1), 1000);
    assert.equal(nextCheck({ charging: false, phaseLeft: 1001 }, 1), 1000);
});

test("a charging battery is checked every 300 ms", () => {
    assert.equal(nextCheck({ charging: true, phaseLeft: 90000 }, 1), 300);
});

test("a phase that ends before the next check is checked 20 ms after it ends", () => {
    assert.equal(nextCheck({ charging: false, phaseLeft: 1000 }, 1), 1020);
    assert.equal(nextCheck({ charging: false, phaseLeft: 992 }, 1), 1012);
    assert.equal(nextCheck({ charging: false, phaseLeft: 8 }, 1), 28);
    assert.equal(nextCheck({ charging: true, phaseLeft: 290 }, 1), 310);
});

test("the checks follow the battery's clock speed", () => {
    assert.equal(nextCheck({ charging: false, phaseLeft: 5000 }, 10), 100);
    assert.equal(nextCheck({ charging: false, phaseLeft: 5000 }, 1000), 1);
});
