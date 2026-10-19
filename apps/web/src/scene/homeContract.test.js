import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeForecast } from "../../worker/weather.js";
import { shapeCalendar } from "../../worker/github.js";
import { readWeather } from "./weather.js";
import { readContributions } from "./github.js";

// open-meteo's answer shape at 02:00 local, with the moon up from the evening before until late morning
const FORECAST = {
    utc_offset_seconds: -25200,
    current: { time: "2026-10-14T02:00", interval: 900, weather_code: 61 },
    daily: {
        time: ["2026-10-13", "2026-10-14", "2026-10-15"],
        sunrise: ["2026-10-13T07:30", "2026-10-14T07:32", "2026-10-15T07:33"],
        sunset: ["2026-10-13T18:25", "2026-10-14T18:23", "2026-10-15T18:21"],
        moonrise: ["2026-10-13T21:10", "2026-10-14T22:05", "2026-10-15T23:01"],
        moonset: ["2026-10-13T10:02", "2026-10-14T11:15", "2026-10-15T12:30"],
        moon_phase: [0.45, 0.5, 0.55]
    }
};

const CALENDAR = {
    data: {
        user: {
            contributionsCollection: {
                contributionCalendar: {
                    totalContributions: 7,
                    weeks: [
                        {
                            contributionDays: [
                                { date: "2026-10-11", contributionLevel: "NONE" },
                                { date: "2026-10-12", contributionLevel: "FIRST_QUARTILE" },
                                { date: "2026-10-13", contributionLevel: "SECOND_QUARTILE" }
                            ]
                        },
                        {
                            contributionDays: [
                                { date: "2026-10-14", contributionLevel: "THIRD_QUARTILE" },
                                { date: "2026-10-15", contributionLevel: "FOURTH_QUARTILE" }
                            ]
                        }
                    ]
                }
            }
        }
    }
};

test("the client's weather reader keeps everything the worker's shape gives it, the moon included", () => {
    const shaped = shapeForecast(FORECAST);
    assert.ok(shaped.moon, "the fixture has a moon");
    assert.deepEqual(readWeather({ weather: shaped }), shaped);
});

test("the client's contribution reader keeps everything the worker's calendar gives it", () => {
    const shaped = shapeCalendar(CALENDAR);
    assert.equal(shaped.days.length, 5);
    assert.deepEqual(readContributions(shaped), shaped);
});
