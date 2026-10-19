import { test } from "node:test";
import assert from "node:assert/strict";
import { daylight } from "./daylight.js";

// the schedule daylight followed before it took sunrise and sunset, kept here to hold the defaults to it
const oldDaylight = (hour) => {
    const clamp01 = (t) => Math.min(Math.max(t, 0), 1);
    const smooth = (t) => t * t * (3 - 2 * t);
    const h = ((hour % 24) + 24) % 24;
    const day = smooth(clamp01(Math.min((h - 6) / 2, (20 - h) / 2)));
    const warm = Math.max(0, 1 - Math.abs(h - 7) / 1.2, 1 - Math.abs(h - 19) / 1.2);
    return { day, warm };
};

test("the defaults match the old fixed schedule at every quarter hour", () => {
    for (let q = 0; q <= 96; q++) {
        assert.deepEqual(daylight(q / 4), oldDaylight(q / 4), `at ${q / 4}`);
    }
});

test("an earlier sunrise moves the morning ramp by the same amount", () => {
    for (let q = 0; q <= 48; q++) {
        const hour = q / 4;
        assert.ok(Math.abs(daylight(hour, 5.5).day - oldDaylight(hour + 1.5).day) < 1e-12, `at ${hour}`);
    }
});

test("warm peaks at the sunrise and sunset it's given", () => {
    assert.equal(daylight(5.5, 5.5, 21).warm, 1);
    assert.equal(daylight(21, 5.5, 21).warm, 1);
    assert.equal(daylight(13, 5.5, 21).warm, 0);
});

test("a sunset that wraps past midnight still gives a day", () => {
    // sunrise at 22 and sunset at 9 the next morning, for a visitor whose clock is far from where they are
    assert.equal(daylight(3, 22, 9).day, 1);
    assert.equal(daylight(15, 22, 9).day, 0);
    const dawn = daylight(22, 22, 9).day;
    assert.ok(dawn > 0 && dawn < 1, `dawn was ${dawn}`);
});

test("polar night has no daylight at any hour, and polar day is all daylight", () => {
    for (const hour of [0, 6, 12, 18]) {
        assert.deepEqual(daylight(hour, 0, 0, "night"), { day: 0, warm: 0 }, `night at ${hour}`);
        assert.deepEqual(daylight(hour, 0, 0, "day"), { day: 1, warm: 0 }, `day at ${hour}`);
    }
});
