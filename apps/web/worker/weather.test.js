import { describe, expect, test } from "vitest";
import {
  buildCities,
  cacheKey,
  cityFor,
  createWeatherSource,
  forecastUrl,
  parseIso6709,
  parseLinks,
  parseZoneTab,
  roundCell,
  shapeForecast,
  toHours,
} from "./weather.js";

// the cache api, standing in: an entry lasts as long as its cache-control header says, on a clock the test moves
const fakeCache = (now = () => 0) => {
  const entries = new Map();
  return {
    entries,
    match: async (key) => {
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }
      const maxAge = Number(
        /max-age=(\d+)/.exec(entry.headers.get("Cache-Control") || "")?.[1] ||
          0,
      );
      if (now() - entry.at >= maxAge * 1000) {
        return undefined;
      }
      return new Response(entry.body, { headers: entry.headers });
    },
    put: async (key, response) => {
      entries.set(key, {
        at: now(),
        body: await response.text(),
        headers: response.headers,
      });
    },
  };
};

test("locations round to half a degree", () => {
  expect(roundCell(49.2667, -123.1167)).toEqual([49.5, -123]);
  expect(roundCell(40.7142, -74.0064)).toEqual([40.5, -74]);
  expect(roundCell(-33.8667, 151.2167)).toEqual([-34, 151]);
});

test("tzdata coordinates parse with and without seconds", () => {
  expect(parseIso6709("+4916-12307")).toEqual([49.2667, -123.1167]);
  expect(parseIso6709("+404251-0740023")).toEqual([40.7142, -74.0064]);
  expect(parseIso6709("nonsense")).toBeNull();
});

test("the zone table skips comments and keeps each zone's city", () => {
  const text =
    "# a comment\nCA\t+4916-12307\tAmerica/Vancouver\tMST - BC (most areas)\nUS\t+404251-0740023\tAmerica/New_York\n";
  expect(parseZoneTab(text)).toEqual({
    "America/Vancouver": [49.2667, -123.1167],
    "America/New_York": [40.7142, -74.0064],
  });
});

test("tzdata links come back as target and alias", () => {
  const text =
    "Z Asia/Kolkata 5:30 - IST\nL Asia/Kolkata Asia/Calcutta\nL Etc/UTC UTC\n";
  expect(parseLinks(text)).toEqual([
    ["Asia/Kolkata", "Asia/Calcutta"],
    ["Etc/UTC", "UTC"],
  ]);
});

test("open-meteo's local times turn into decimal hours", () => {
  expect(toHours("2026-10-14T07:32")).toBe(7.53);
  expect(toHours("2026-10-14T18:23")).toBe(18.38);
  expect(toHours(null)).toBeNull();
  expect(toHours("garbage")).toBeNull();
});

test("the forecast url asks for the current code and three days of sun and moon times", () => {
  expect(forecastUrl(49.5, -123)).toBe(
    "https://api.open-meteo.com/v1/forecast?latitude=49.5&longitude=-123&current=weather_code&daily=sunrise,sunset,moonrise,moonset,moon_phase&timezone=auto&past_days=1&forecast_days=2",
  );
});

// the shape of a real answer from 2026-10-14, cut down to what's used
const FORECAST = {
  utc_offset_seconds: -25200,
  current: { time: "2026-10-14T19:15", interval: 900, weather_code: 3 },
  daily: {
    time: ["2026-10-14"],
    sunrise: ["2026-10-14T07:32"],
    sunset: ["2026-10-14T18:23"],
  },
};

test("a forecast becomes the route's answer", () => {
  expect(shapeForecast(FORECAST)).toEqual({
    code: 3,
    sunrise: 7.53,
    sunset: 18.38,
    utcOffset: -25200,
    polar: null,
    moon: null,
  });
});

test("a forecast missing its sunrise, as polar night might, gives null", () => {
  const polar = {
    ...FORECAST,
    daily: { ...FORECAST.daily, sunrise: [null] },
  };
  expect(shapeForecast(polar)).toBeNull();
  expect(shapeForecast(null)).toBeNull();
  expect(shapeForecast({})).toBeNull();
});

const counting = (status, body) => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fetchImpl };
};

describe("the weather source", () => {
  test("a second ask inside 30 minutes for the same cell doesn't reach open-meteo", async () => {
    let clock = 0;
    const { calls, fetchImpl } = counting(200, FORECAST);
    const weatherFor = createWeatherSource({
      cache: fakeCache(() => clock),
      fetchImpl,
    });
    const first = await weatherFor(49.2667, -123.1167);
    clock = 29 * 60 * 1000;
    // a nearby point in the same cell shares the answer
    const second = await weatherFor(49.4, -122.9);
    expect(calls.length).toBe(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.weather).toEqual(first.weather);
    expect(calls[0]).toMatch(/latitude=49\.5&longitude=-123&/);
  });

  test("after 30 minutes the cell is asked again", async () => {
    let clock = 0;
    const { calls, fetchImpl } = counting(200, FORECAST);
    const weatherFor = createWeatherSource({
      cache: fakeCache(() => clock),
      fetchImpl,
    });
    await weatherFor(49.27, -123.12);
    clock = 30 * 60 * 1000;
    await weatherFor(49.27, -123.12);
    expect(calls.length).toBe(2);
  });

  test("the answer is cached under the site's own host by its cell, for 30 minutes", async () => {
    const cache = fakeCache();
    await createWeatherSource({
      cache,
      fetchImpl: counting(200, FORECAST).fetchImpl,
    })(49.27, -123.12);
    expect(cacheKey(49.5, -123)).toBe(
      "https://jasonyue.ca/__cache/weather/49.5/-123",
    );
    const entry = cache.entries.get(
      "https://jasonyue.ca/__cache/weather/49.5/-123",
    );
    expect(entry.headers.get("Cache-Control")).toBe("max-age=1800");
  });

  test("a cache put handed to waitUntil doesn't hold up the answer", async () => {
    const waiting = [];
    const cache = fakeCache();
    const result = await createWeatherSource({
      cache,
      fetchImpl: counting(200, FORECAST).fetchImpl,
      waitUntil: (promise) => waiting.push(promise),
    })(49.27, -123.12);
    expect(result.ok).toBe(true);
    expect(waiting.length).toBe(1);
    await Promise.all(waiting);
    expect(cache.entries.size).toBe(1);
  });

  test("a cache that refuses the answer still gives the weather", async () => {
    const cache = {
      match: async () => undefined,
      put: async () => {
        throw new Error("cache refused");
      },
    };
    const result = await createWeatherSource({
      cache,
      fetchImpl: counting(200, FORECAST).fetchImpl,
    })(49.27, -123.12);
    expect(result.ok).toBe(true);
  });

  test("an error status, a network failure, and a bad answer each say why", async () => {
    const down = await createWeatherSource({
      cache: fakeCache(),
      ...counting(503, {}),
    })(49, -123);
    expect(down.ok).toBe(false);
    expect(down.reason).toMatch(/503/);
    const offline = await createWeatherSource({
      cache: fakeCache(),
      fetchImpl: async () => {
        throw new Error("offline");
      },
    })(49, -123);
    expect(offline.ok).toBe(false);
    expect(offline.reason).toMatch(/couldn't be reached/);
    const junk = await createWeatherSource({
      cache: fakeCache(),
      ...counting(200, { nope: true }),
    })(49, -123);
    expect(junk.ok).toBe(false);
    expect(junk.reason).toMatch(/missing/);
  });

  test("an open-meteo that never answers gives up instead of holding the request open", async () => {
    const hang = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    const result = await createWeatherSource({
      cache: fakeCache(),
      fetchImpl: hang,
      timeoutMs: 20,
    })(49, -123);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/too long/);
  });

  test("a failure is remembered for a minute, so a busy moment doesn't ask open-meteo again for every visitor", async () => {
    let clock = 0;
    const { calls, fetchImpl } = counting(429, {});
    const cache = fakeCache(() => clock);
    const weatherFor = createWeatherSource({ cache, fetchImpl });
    await weatherFor(49, -123);
    expect(
      cache.entries.get(cacheKey(49, -123)).headers.get("Cache-Control"),
    ).toBe("max-age=60");
    clock = 59 * 1000;
    const again = await weatherFor(49, -123);
    expect(calls.length).toBe(1);
    expect(again.ok).toBe(false);
    expect(again.cached).toBe(true);
    clock = 61 * 1000;
    await weatherFor(49, -123);
    expect(calls.length).toBe(2);
  });
});

// open-meteo's real answers for 2026-10-15: at 85n (polar night) sunrise and sunset are the same midnight, and at
// 85s (polar day) the sunset is the next day's midnight
const polarAnswer = (sunrise, sunset) => ({
  ...FORECAST,
  daily: { time: ["2026-10-15"], sunrise: [sunrise], sunset: [sunset] },
});

test("polar night is marked instead of reading as a day from midnight to midnight", () => {
  const night = shapeForecast(
    polarAnswer("2026-10-15T00:00", "2026-10-15T00:00"),
  );
  expect(night.polar).toBe("night");
});

test("polar day is marked too", () => {
  const day = shapeForecast(
    polarAnswer("2026-10-15T00:00", "2026-10-16T00:00"),
  );
  expect(day.polar).toBe("day");
});

test("a normal day isn't polar", () => {
  expect(shapeForecast(FORECAST).polar).toBeNull();
});

// real lines from tzdata 2026: zone1970.tab merged reykjavik into abidjan, zone.tab still gives it its own city, and
// tzdata.zi links it (and calcutta, a plain rename) to the zone it now shares
const ZONE1970 =
  "CI,BF,GH,GM,GN,IS,ML,MR,SH,SL,SN,TG\t+0519-00402\tAfrica/Abidjan\nIN\t+2232+08822\tAsia/Kolkata\n";
const ZONETAB =
  "CI\t+0519-00402\tAfrica/Abidjan\nIS\t+6409-02151\tAtlantic/Reykjavik\nIN\t+2232+08822\tAsia/Kolkata\n";
const ZI =
  "L Africa/Abidjan Atlantic/Reykjavik\nL Asia/Kolkata Asia/Calcutta\nL Etc/UTC UTC\n";

test("a merged zone keeps its own country's city instead of the one it was merged into", () => {
  const cities = buildCities(ZONE1970, ZONETAB, ZI);
  expect(cities["Atlantic/Reykjavik"]).toEqual([64.15, -21.85]);
});

test("a renamed zone still gets its city through the link", () => {
  const cities = buildCities(ZONE1970, ZONETAB, ZI);
  expect(cities["Asia/Calcutta"]).toEqual(cities["Asia/Kolkata"]);
  expect(cities.UTC).toBeUndefined();
});

test("a zone name that's really an object key finds no city", () => {
  const cities = { "America/Vancouver": [49.2667, -123.1167] };
  expect(cityFor(cities, "America/Vancouver")).toEqual([49.2667, -123.1167]);
  expect(cityFor(cities, "__proto__")).toBeNull();
  expect(cityFor(cities, "constructor")).toBeNull();
  expect(cityFor(cities, "toString")).toBeNull();
  expect(cityFor(cities, "")).toBeNull();
});

test("a city that isn't two numbers finds nothing", () => {
  expect(cityFor({ Bad: ["49", -123] }, "Bad")).toBeNull();
  expect(cityFor({ Bad: [49] }, "Bad")).toBeNull();
});

// open-meteo's real answer for vancouver on the evening of 2026-10-14, asking for yesterday through tomorrow
const THREE_DAYS = {
  utc_offset_seconds: -25200,
  current: { time: "2026-10-14T21:00", interval: 900, weather_code: 0 },
  daily: {
    time: ["2026-10-13", "2026-10-14", "2026-10-15"],
    sunrise: ["2026-10-13T07:30", "2026-10-14T07:32", "2026-10-15T07:33"],
    sunset: ["2026-10-13T18:25", "2026-10-14T18:23", "2026-10-15T18:21"],
    moonrise: ["2026-10-13T11:24", "2026-10-14T12:31", "2026-10-15T13:32"],
    moonset: ["2026-10-13T19:15", "2026-10-14T19:51", "2026-10-15T20:37"],
    moon_phase: [0.101, 0.132, 0.163],
  },
};

test("the sun times are today's, not the first day's", () => {
  const shaped = shapeForecast(THREE_DAYS);
  expect(shaped.sunrise).toBe(7.53);
  expect(shaped.sunset).toBe(18.38);
});

test("the moon comes back with today's phase and when it's up, in hours from today's midnight", () => {
  const shaped = shapeForecast(THREE_DAYS);
  expect(shaped.moon.phase).toBe(0.132);
  expect(shaped.moon.ups).toEqual([
    [-12.6, -4.75],
    [12.52, 19.85],
    [37.53, 44.62],
  ]);
});

test("a moon that rises late and sets the next morning is one stretch across midnight", () => {
  const night = {
    ...THREE_DAYS,
    daily: {
      ...THREE_DAYS.daily,
      moonrise: ["2026-10-13T21:10", "2026-10-14T22:05", "2026-10-15T23:01"],
      moonset: ["2026-10-13T10:02", "2026-10-14T11:15", "2026-10-15T12:30"],
    },
  };
  expect(shapeForecast(night).moon.ups).toEqual([
    [-24, -13.97],
    [-2.83, 11.25],
    [22.08, 36.5],
    [47.02, 48],
  ]);
});

test("a moon with no rise or set times, as near the poles, has no stretches", () => {
  const polar = {
    ...THREE_DAYS,
    daily: {
      ...THREE_DAYS.daily,
      moonrise: [null, null, null],
      moonset: [null, null, null],
    },
  };
  expect(shapeForecast(polar).moon.ups).toEqual([]);
});
