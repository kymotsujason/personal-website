import { afterEach, beforeEach, expect, test, vi } from "vitest";
import worker from "./index.js";

// the cache api, standing in. entries never expire here, since these tests only ask once
const fakeCache = () => {
  const entries = new Map();
  return {
    entries,
    match: async (key) => {
      const entry = entries.get(key);
      return entry
        ? new Response(entry.body, { headers: entry.headers })
        : undefined;
    },
    put: async (key, response) => {
      entries.set(key, {
        body: await response.text(),
        headers: response.headers,
      });
    },
  };
};

const fakeKv = (initial = {}) => {
  const items = new Map(Object.entries(initial));
  return {
    items,
    get: async (key, type) => {
      const value = items.has(key) ? items.get(key) : null;
      return type === "json" && value !== null ? JSON.parse(value) : value;
    },
    put: async (key, value) => {
      items.set(key, value);
    },
  };
};

const FORECAST = {
  utc_offset_seconds: -25200,
  current: { time: "2026-10-14T19:15", interval: 900, weather_code: 3 },
  daily: {
    time: ["2026-10-14"],
    sunrise: ["2026-10-14T07:32"],
    sunset: ["2026-10-14T18:23"],
  },
};

const WEATHER = {
  code: 3,
  sunrise: 7.53,
  sunset: 18.38,
  utcOffset: -25200,
  polar: null,
  moon: null,
};

const GITHUB = { days: [{ date: "2026-10-15", level: 3 }], total: 4 };

const homeRequest = (query, cf) => {
  const request = new Request(`https://jasonyue.ca/api/home${query}`);
  Object.defineProperty(request, "cf", { value: cf });
  return request;
};

let cache = null;
let waiting = null;
let ctx = null;

const openMeteo = (status, body) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

const call = async (request, env) => {
  const response = await worker.fetch(request, env, ctx);
  await Promise.all(waiting);
  return response;
};

beforeEach(() => {
  cache = fakeCache();
  waiting = [];
  ctx = { waitUntil: (promise) => waiting.push(promise) };
  vi.stubGlobal("caches", { default: cache });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("a failing weather still answers 200 with the saved github data", async () => {
  vi.stubGlobal("fetch", openMeteo(503, {}));
  const env = { HOME: fakeKv({ github: JSON.stringify(GITHUB) }) };
  const response = await call(
    homeRequest("?tz=America/Vancouver", {
      latitude: "49.28",
      longitude: "-123.12",
    }),
    env,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ weather: null, github: GITHUB });
});

test("nothing saved yet gives github null beside the weather", async () => {
  vi.stubGlobal("fetch", openMeteo(200, FORECAST));
  const response = await call(
    homeRequest("?tz=America/Vancouver", {
      latitude: "49.28",
      longitude: "-123.12",
    }),
    { HOME: fakeKv() },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ weather: WEATHER, github: null });
});

test("the request's own location picks the cell", async () => {
  const fetchImpl = openMeteo(200, FORECAST);
  vi.stubGlobal("fetch", fetchImpl);
  await call(
    homeRequest("?tz=America/Vancouver", {
      latitude: "40.7142",
      longitude: "-74.0064",
    }),
    { HOME: fakeKv() },
  );
  expect(fetchImpl.mock.calls[0][0]).toMatch(/latitude=40\.5&longitude=-74&/);
});

test("a missing or unreadable coordinate falls back to the time zone's city", async () => {
  const fetchImpl = openMeteo(200, FORECAST);
  vi.stubGlobal("fetch", fetchImpl);
  const locations = [
    { longitude: "-74.0064" },
    { latitude: "", longitude: "-74.0064" },
    { latitude: "40.7142" },
    undefined,
  ];
  for (const cf of locations) {
    const response = await call(homeRequest("?tz=America/Vancouver", cf), {
      HOME: fakeKv(),
    });
    expect((await response.json()).weather, JSON.stringify(cf)).toEqual(
      WEATHER,
    );
  }
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][0]).toMatch(/latitude=49\.5&longitude=-123&/);
});

test("no location and no known time zone gives weather null without asking open-meteo", async () => {
  const fetchImpl = openMeteo(200, FORECAST);
  vi.stubGlobal("fetch", fetchImpl);
  const response = await call(homeRequest("?tz=__proto__", {}), {
    HOME: fakeKv(),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ weather: null, github: null });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("the stored cache entry lasts 30 minutes", async () => {
  vi.stubGlobal("fetch", openMeteo(200, FORECAST));
  await call(
    homeRequest("?tz=America/Vancouver", {
      latitude: "49.28",
      longitude: "-123.12",
    }),
    { HOME: fakeKv() },
  );
  const entry = cache.entries.get(
    "https://jasonyue.ca/__cache/weather/49.5/-123",
  );
  expect(entry.headers.get("Cache-Control")).toBe("max-age=1800");
});

test("a cache that throws still gives the weather", async () => {
  vi.stubGlobal("caches", {
    default: {
      match: async () => {
        throw new Error("cache down");
      },
      put: async () => {},
    },
  });
  vi.stubGlobal("fetch", openMeteo(200, FORECAST));
  const response = await call(
    homeRequest("?tz=America/Vancouver", {
      latitude: "49.28",
      longitude: "-123.12",
    }),
    { HOME: fakeKv({ github: JSON.stringify(GITHUB) }) },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ weather: WEATHER, github: GITHUB });
});

test("any other path goes to the static assets", async () => {
  const fromAssets = new Response("not found page", { status: 404 });
  const env = { ASSETS: { fetch: vi.fn(async () => fromAssets) } };
  const request = new Request("https://jasonyue.ca/api/nothing");
  const response = await call(request, env);
  expect(env.ASSETS.fetch).toHaveBeenCalledWith(request);
  expect(response).toBe(fromAssets);
});

test("the cron saves github's calendar", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              user: {
                contributionsCollection: {
                  contributionCalendar: {
                    totalContributions: 4,
                    weeks: [
                      {
                        contributionDays: [
                          {
                            date: "2026-10-15",
                            contributionLevel: "THIRD_QUARTILE",
                          },
                        ],
                      },
                    ],
                  },
                },
              },
            },
          }),
        ),
    ),
  );
  const env = { HOME: fakeKv(), GITHUB_TOKEN: "token" };
  await worker.scheduled({}, env, ctx);
  await Promise.all(waiting);
  expect(JSON.parse(env.HOME.items.get("github"))).toEqual(GITHUB);
});
