import { test } from "node:test";
import assert from "node:assert/strict";
import { conditionFor, sunHours, moonHours, loadHome, readWeather, createWeatherFeed, DEFAULT_TIMEOUT, SCENES } from "./weather.js";
import { UPSTREAM_TIMEOUT } from "../../worker/weather.js";

const TABLE = [
    [[0, 1], "clear", "moderate"],
    [[2], "partly cloudy", "moderate"],
    [[3], "cloudy", "moderate"],
    [[45, 48], "fog", "moderate"],
    [[51, 56], "drizzle", "light"],
    [[53], "drizzle", "moderate"],
    [[55, 57], "drizzle", "heavy"],
    [[61, 66, 80], "rain", "light"],
    [[63, 81], "rain", "moderate"],
    [[65, 67, 82], "rain", "heavy"],
    [[71, 77, 85], "snow", "light"],
    [[73], "snow", "moderate"],
    [[75, 86], "snow", "heavy"],
    [[95, 97], "thunder", "moderate"],
    [[96, 99], "thunder", "heavy"]
];

test("every code in the spec's table maps to its scene and intensity", () => {
    TABLE.forEach(([codes, scene, intensity]) => {
        codes.forEach((code) => assert.deepEqual(conditionFor(code), { scene, intensity }, `code ${code}`));
    });
});

test("every scene in the table is one the shader knows", () => {
    TABLE.forEach(([, scene]) => assert.ok(SCENES.includes(scene), scene));
});

test("an unknown code is a clear sky", () => {
    assert.deepEqual(conditionFor(42), { scene: "clear", intensity: "moderate" });
    assert.deepEqual(conditionFor(undefined), { scene: "clear", intensity: "moderate" });
});

// vancouver in october: utc - 7. a fake date only needs getTimezoneOffset, which is minutes west of utc
const VANCOUVER = { code: 3, sunrise: 7.53, sunset: 18.38, utcOffset: -25200, polar: null, moon: null };
const visitorAt = (minutesWest) => ({ getTimezoneOffset: () => minutesWest });
const near = (a, b) => Math.abs(a - b) < 1e-9;

test("a visitor in the location's own zone sees the location's sun times", () => {
    const sun = sunHours(VANCOUVER, visitorAt(420));
    assert.ok(near(sun.sunrise, 7.53) && near(sun.sunset, 18.38), JSON.stringify(sun));
});

test("a visitor three hours east sees them three hours later", () => {
    const sun = sunHours(VANCOUVER, visitorAt(240));
    assert.ok(near(sun.sunrise, 10.53) && near(sun.sunset, 21.38), JSON.stringify(sun));
});

test("a sunset that lands past midnight on the visitor's clock wraps", () => {
    // utc + 1 is 8 hours ahead of vancouver, so sunset at 18.38 there is 2.38 the next morning here
    const sun = sunHours(VANCOUVER, visitorAt(-60));
    assert.ok(near(sun.sunrise, 15.53) && near(sun.sunset, 2.38), JSON.stringify(sun));
});

const answer = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const GITHUB = { days: [{ date: "2026-10-15", level: 3 }], total: 4 };

test("the home route's answer comes back as it was sent, asked with the visitor's time zone", async () => {
    let asked = "";
    const fetchImpl = async (url) => {
        asked = url;
        return answer(200, { weather: VANCOUVER, github: GITHUB })();
    };
    assert.deepEqual(await loadHome({ fetchImpl }), { weather: VANCOUVER, github: GITHUB });
    assert.match(asked, /^\/api\/home\?tz=/);
});

test("an error status gives null", async () => {
    assert.equal(await loadHome({ fetchImpl: answer(502, { error: "down" }) }), null);
});

test("a fetch that throws gives null", async () => {
    const fetchImpl = async () => {
        throw new Error("offline");
    };
    assert.equal(await loadHome({ fetchImpl }), null);
});

test("an answer that isn't an object gives null", async () => {
    assert.equal(await loadHome({ fetchImpl: answer(200, null) }), null);
    assert.equal(await loadHome({ fetchImpl: answer(200, "weather") }), null);
});

test("a route that never answers gives null after the timeout", async () => {
    const hang = (url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
    assert.equal(await loadHome({ fetchImpl: hang, timeoutMs: 20 }), null);
});

test("the default timeout outlasts the worker's own 5 s for open-meteo", async () => {
    const realSetTimeout = globalThis.setTimeout;
    const delays = [];
    globalThis.setTimeout = (fn, ms) => {
        delays.push(ms);
        return realSetTimeout(fn, 0);
    };
    try {
        await loadHome({ fetchImpl: answer(200, { weather: null, github: null }) });
    } finally {
        globalThis.setTimeout = realSetTimeout;
    }
    assert.deepEqual(delays, [DEFAULT_TIMEOUT]);
    assert.ok(DEFAULT_TIMEOUT > UPSTREAM_TIMEOUT);
});

test("the weather part reads back when it has its numbers", () => {
    assert.deepEqual(readWeather({ weather: VANCOUVER, github: null }), VANCOUVER);
});

test("a missing weather part, or one missing a number, gives null", () => {
    assert.equal(readWeather(null), null);
    assert.equal(readWeather({ weather: null, github: GITHUB }), null);
    assert.equal(readWeather({ weather: { code: 3, sunrise: 7.5, utcOffset: 0 } }), null);
    assert.equal(readWeather({ weather: { code: "3", sunrise: 7.5, sunset: 18, utcOffset: 0 } }), null);
});

// a stand in for the feed's load that answers from a list, one answer per ask, and counts the asks
const answers = (...list) => {
    const load = async () => {
        load.asks++;
        return list.shift() ?? null;
    };
    load.asks = 0;
    return load;
};

test("the feed asks again once its weather is 30 minutes old", async () => {
    let clock = 0;
    const heard = [];
    const load = answers({ ...VANCOUVER, code: 3 }, { ...VANCOUVER, code: 61 });
    const feed = createWeatherFeed({ load, now: () => clock, onWeather: (w) => heard.push(w.code) });
    await feed.refresh();
    clock = 29 * 60 * 1000;
    await feed.refresh();
    assert.equal(load.asks, 1);
    clock = 30 * 60 * 1000;
    await feed.refresh();
    assert.equal(load.asks, 2);
    assert.deepEqual(heard, [3, 61]);
    assert.equal(feed.weather().code, 61);
});

test("a failed ask keeps the last good weather and tries again after 5 minutes", async () => {
    let clock = 0;
    const load = answers(VANCOUVER, null, { ...VANCOUVER, code: 71 });
    const feed = createWeatherFeed({ load, now: () => clock });
    await feed.refresh();
    clock = 30 * 60 * 1000;
    await feed.refresh();
    assert.deepEqual(feed.weather(), VANCOUVER);
    clock += 4 * 60 * 1000;
    await feed.refresh();
    assert.equal(load.asks, 2);
    clock += 60 * 1000;
    await feed.refresh();
    assert.equal(load.asks, 3);
    assert.equal(feed.weather().code, 71);
});

test("refreshes that overlap share one ask", async () => {
    const load = answers(VANCOUVER);
    const feed = createWeatherFeed({ load, now: () => 0 });
    await Promise.all([feed.refresh(), feed.refresh(), feed.refresh()]);
    assert.equal(load.asks, 1);
});

const MOONLIT = { ...VANCOUVER, moon: { phase: 0.132, ups: [[-12.6, -4.75], [12.52, 19.85], [37.53, 44.62]] } };

test("the moon's stretches move onto the visitor's clock the same way the sun's times do", () => {
    const here = moonHours(MOONLIT, visitorAt(420));
    assert.equal(here.phase, 0.132);
    assert.deepEqual(here.ups, MOONLIT.moon.ups);
    const east = moonHours(MOONLIT, visitorAt(240));
    east.ups.forEach(([rise, set], i) => {
        assert.ok(near(rise, MOONLIT.moon.ups[i][0] + 3) && near(set, MOONLIT.moon.ups[i][1] + 3), JSON.stringify(east.ups));
    });
});

test("weather without a moon gives no moon", () => {
    assert.equal(moonHours(VANCOUVER, visitorAt(420)), null);
});

test("a load that rejects hands the error on and leaves the feed free to ask again after 5 minutes", async () => {
    let clock = 0;
    const offline = new Error("offline");
    let asks = 0;
    const load = async () => {
        asks++;
        if (asks === 1) {
            throw offline;
        }
        return VANCOUVER;
    };
    const feed = createWeatherFeed({ load, now: () => clock });
    await assert.rejects(feed.refresh(), offline);
    clock = 4 * 60 * 1000;
    await feed.refresh();
    assert.equal(asks, 1);
    clock = 5 * 60 * 1000;
    assert.deepEqual(await feed.refresh(), VANCOUVER);
    assert.equal(asks, 2);
});

test("an onWeather that throws hands the error on and doesn't leave the feed stuck on that ask", async () => {
    let clock = 0;
    const broken = new Error("broken");
    const heard = [];
    const load = answers(VANCOUVER, { ...VANCOUVER, code: 61 });
    const onWeather = (w) => {
        heard.push(w.code);
        if (heard.length === 1) {
            throw broken;
        }
    };
    const feed = createWeatherFeed({ load, now: () => clock, onWeather });
    await assert.rejects(feed.refresh(), broken);
    clock = 30 * 60 * 1000;
    await feed.refresh();
    assert.equal(load.asks, 2);
    assert.deepEqual(heard, [3, 61]);
});

test("a moon that isn't the shape the sky reads is left out, and the rest of the weather is kept", () => {
    const bad = [
        "full",
        { phase: "0.5", ups: [] },
        { phase: 0.5 },
        { phase: 0.5, ups: "12-19" },
        { phase: 0.5, ups: [[12.5]] },
        { phase: 0.5, ups: [[12.5, "19"]] },
        { phase: 0.5, ups: [null] }
    ];
    bad.forEach((moon) => {
        const read = readWeather({ weather: { ...VANCOUVER, moon } });
        assert.equal(read.moon, null, JSON.stringify(moon));
        assert.equal(read.code, VANCOUVER.code);
        assert.equal(moonHours(read, visitorAt(420)), null);
    });
    assert.deepEqual(readWeather({ weather: MOONLIT }), MOONLIT);
});

test("a hidden tab doesn't ask, and the next refresh once it's shown asks", async () => {
    let hidden = true;
    const load = answers(VANCOUVER);
    const feed = createWeatherFeed({ load, now: () => 0, hidden: () => hidden });
    assert.equal(await feed.refresh(), null);
    assert.equal(load.asks, 0);
    hidden = false;
    assert.deepEqual(await feed.refresh(), VANCOUVER);
    assert.equal(load.asks, 1);
});

test("asks that keep failing wait twice as long each time, up to the 30 minutes a good answer waits", async () => {
    let clock = 0;
    const load = answers(null, null, null, null, null, VANCOUVER, null);
    const feed = createWeatherFeed({ load, now: () => clock });
    await feed.refresh();
    const minutes = [5, 15, 35, 65, 95];
    for (const [i, at] of minutes.entries()) {
        clock = at * 60 * 1000 - 1;
        await feed.refresh();
        assert.equal(load.asks, i + 1, `not yet at ${at} minutes`);
        clock = at * 60 * 1000;
        await feed.refresh();
        assert.equal(load.asks, i + 2, `asked at ${at} minutes`);
    }
    assert.deepEqual(feed.weather(), VANCOUVER);
    // a good answer starts the wait over, so the next failure waits 5 minutes again
    clock += 30 * 60 * 1000;
    await feed.refresh();
    assert.equal(load.asks, 7);
    clock += 5 * 60 * 1000;
    await feed.refresh();
    assert.equal(load.asks, 8);
});
