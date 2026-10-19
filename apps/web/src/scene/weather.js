// the visitor's weather, from the worker's /api/home (a dev route in astro dev). nothing here touches three, so node
// --test can load it
export const SCENES = ["clear", "partly cloudy", "cloudy", "fog", "drizzle", "rain", "snow", "thunder"];
export const INTENSITIES = ["light", "moderate", "heavy"];

// open-meteo's wmo weather codes, each as a scene and how hard it's coming down
const CODES = new Map([
    [0, ["clear", "moderate"]],
    [1, ["clear", "moderate"]],
    [2, ["partly cloudy", "moderate"]],
    [3, ["cloudy", "moderate"]],
    [45, ["fog", "moderate"]],
    [48, ["fog", "moderate"]],
    [51, ["drizzle", "light"]],
    [56, ["drizzle", "light"]],
    [53, ["drizzle", "moderate"]],
    [55, ["drizzle", "heavy"]],
    [57, ["drizzle", "heavy"]],
    [61, ["rain", "light"]],
    [66, ["rain", "light"]],
    [80, ["rain", "light"]],
    [63, ["rain", "moderate"]],
    [81, ["rain", "moderate"]],
    [65, ["rain", "heavy"]],
    [67, ["rain", "heavy"]],
    [82, ["rain", "heavy"]],
    [71, ["snow", "light"]],
    [77, ["snow", "light"]],
    [85, ["snow", "light"]],
    [73, ["snow", "moderate"]],
    [75, ["snow", "heavy"]],
    [86, ["snow", "heavy"]],
    [95, ["thunder", "moderate"]],
    [97, ["thunder", "moderate"]],
    [96, ["thunder", "heavy"]],
    [99, ["thunder", "heavy"]]
]);

export const conditionFor = (code) => {
    const found = CODES.get(code);
    if (!found) {
        return { scene: "clear", intensity: "moderate" };
    }
    return { scene: found[0], intensity: found[1] };
};

const wrap24 = (h) => ((h % 24) + 24) % 24;

// the route's sunrise and sunset are hours in the location's own time. they go through utc onto the visitor's clock,
// since the room's light follows the visitor's clock even when their ip puts them somewhere else
export const sunHours = (weather, date = new Date()) => {
    const shift = -weather.utcOffset / 3600 - date.getTimezoneOffset() / 60;
    return { sunrise: wrap24(weather.sunrise + shift), sunset: wrap24(weather.sunset + shift) };
};

// the moon's stretches above the horizon, moved onto the visitor's clock like the sun's times. they aren't wrapped,
// since a stretch can run past midnight, so whoever reads them compares the hour a day either side too
export const moonHours = (weather, date = new Date()) => {
    if (!weather.moon) {
        return null;
    }
    const shift = -weather.utcOffset / 3600 - date.getTimezoneOffset() / 60;
    return { phase: weather.moon.phase, ups: weather.moon.ups.map(([rise, set]) => [rise + shift, set + shift]) };
};

const isNumber = (n) => typeof n === "number" && Number.isFinite(n);

// asks the home route once, and gives its answer, { weather, github }, or null on any failure. it's the one worker
// request a visit makes, so the github graph reads the same answer. the timeout is longer than the worker's own 5 s
// for open-meteo, so a slow open-meteo still gets the github part through
export const DEFAULT_TIMEOUT = 6000;

export const loadHome = async ({ fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT } = {}) => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(`/api/home?tz=${encodeURIComponent(tz)}`, { signal: controller.signal });
        if (!res.ok) {
            return null;
        }
        const data = await res.json();
        return data && typeof data === "object" ? data : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
};

// { phase, ups } with ups a list of [rise, set] hours, which is all moonHours reads
const isMoon = (moon) => Boolean(moon) && isNumber(moon.phase) && Array.isArray(moon.ups) && moon.ups.every((up) => Array.isArray(up) && up.length === 2 && up.every(isNumber));

// the weather part of the home route's answer, or null when it's missing or short a number, so the sky just stays
// clear and follows the clock. a moon in any other shape is left out, so the sky has no moon instead of throwing
export const readWeather = (home) => {
    const data = home ? home.weather : null;
    if (!data || ![data.code, data.sunrise, data.sunset, data.utcOffset].every(isNumber)) {
        return null;
    }
    if (data.moon && !isMoon(data.moon)) {
        return { ...data, moon: null };
    }
    return data;
};

// keeps the weather current on a long visit. refresh asks the route once the last good answer is `every` old, keeps
// that answer if an ask fails, and lets overlapping refreshes share one ask. a failed ask tries again after `retry`,
// and each failure in a row after it waits twice as long, up to `every`, so a forgotten tab with the weather down asks
// a few times an hour. a hidden tab doesn't ask at all. onWeather hears each new answer. a load that rejects rejects
// that refresh and counts as a failure. an onWeather that throws also rejects that refresh, but the answer is kept and
// the next ask waits `every`
export const createWeatherFeed = ({ load, every = 30 * 60 * 1000, retry = 5 * 60 * 1000, now = Date.now, hidden = () => false, onWeather = () => {} } = {}) => {
    let weather = null;
    let nextAt = -Infinity;
    let asking = null;
    let failures = 0;
    const failed = () => {
        nextAt = now() + Math.min(retry * 2 ** failures, every);
        failures++;
    };
    const refresh = () => {
        if (asking) {
            return asking;
        }
        if (hidden() || now() < nextAt) {
            return Promise.resolve(weather);
        }
        asking = Promise.resolve()
            .then(load)
            .then((data) => {
                if (!data) {
                    failed();
                    return weather;
                }
                weather = data;
                failures = 0;
                nextAt = now() + every;
                onWeather(data);
                return weather;
            }, (error) => {
                failed();
                throw error;
            })
            .finally(() => {
                asking = null;
            });
        return asking;
    };
    return { refresh, weather: () => weather };
};
