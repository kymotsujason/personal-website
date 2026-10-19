import { test } from "node:test";
import assert from "node:assert/strict";
import { readContributions } from "./github.js";

const DAYS = [{ date: "2026-10-14", level: 0 }, { date: "2026-10-15", level: 4 }];

test("the home route's github part reads back as days and a total", () => {
    assert.deepEqual(readContributions({ days: DAYS, total: 12 }), { days: DAYS, total: 12 });
});

test("a missing github part gives null, for the empty grid", () => {
    assert.equal(readContributions(null), null);
    assert.equal(readContributions({ days: DAYS }), null);
    assert.equal(readContributions({ days: "DAYS", total: 12 }), null);
});

test("a day without a date or with a level outside 0 to 4 gives null", () => {
    assert.equal(readContributions({ days: [{ level: 1 }], total: 1 }), null);
    assert.equal(readContributions({ days: [{ date: "2026-10-15", level: 5 }], total: 1 }), null);
    assert.equal(readContributions({ days: [{ date: "2026-10-15", level: "2" }], total: 1 }), null);
});
