import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readGithub, refreshGithub, shapeCalendar } from "./github.js";

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

const calendar = (weeks, total = 9) => ({
  data: {
    user: {
      contributionsCollection: {
        contributionCalendar: { totalContributions: total, weeks },
      },
    },
  },
});

const WEEKS = [
  {
    contributionDays: [
      { date: "2026-10-11", contributionLevel: "NONE" },
      { date: "2026-10-12", contributionLevel: "FIRST_QUARTILE" },
      { date: "2026-10-13", contributionLevel: "SECOND_QUARTILE" },
    ],
  },
  {
    contributionDays: [
      { date: "2026-10-14", contributionLevel: "THIRD_QUARTILE" },
      { date: "2026-10-15", contributionLevel: "FOURTH_QUARTILE" },
    ],
  },
];

const DAYS = [
  { date: "2026-10-11", level: 0 },
  { date: "2026-10-12", level: 1 },
  { date: "2026-10-13", level: 2 },
  { date: "2026-10-14", level: 3 },
  { date: "2026-10-15", level: 4 },
];

const SAVED = JSON.stringify({
  days: [{ date: "2026-10-01", level: 2 }],
  total: 1,
});

const answering = (status, body) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

let logged = null;

beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("each week's days come out in order with github's levels as 0 to 4", () => {
  expect(shapeCalendar(calendar(WEEKS))).toEqual({ days: DAYS, total: 9 });
});

test("an answer without the calendar's weeks gives null", () => {
  expect(shapeCalendar(null)).toBeNull();
  expect(
    shapeCalendar({ data: null, errors: [{ message: "bad" }] }),
  ).toBeNull();
  expect(shapeCalendar(calendar("weeks"))).toBeNull();
  expect(shapeCalendar(calendar(WEEKS, "9"))).toBeNull();
  expect(
    shapeCalendar(
      calendar([{ contributionDays: [{ contributionLevel: "NONE" }] }]),
    ),
  ).toBeNull();
});

test("a good answer is saved as days and a total", async () => {
  const env = { HOME: fakeKv({ github: SAVED }), GITHUB_TOKEN: "token" };
  const fetchImpl = answering(200, calendar(WEEKS));
  await refreshGithub(env, fetchImpl);
  expect(JSON.parse(env.HOME.items.get("github"))).toEqual({
    days: DAYS,
    total: 9,
  });
  const [url, options] = fetchImpl.mock.calls[0];
  expect(url).toBe("https://api.github.com/graphql");
  expect(options.method).toBe("POST");
  expect(options.headers.Authorization).toBe("bearer token");
  expect(options.headers["User-Agent"]).toBeTruthy();
  expect(JSON.parse(options.body).variables).toEqual({
    login: "kymotsujason",
  });
  expect(options.signal).toBeInstanceOf(AbortSignal);
});

test("a status 200 answer with errors leaves the saved data alone and logs why", async () => {
  const env = { HOME: fakeKv({ github: SAVED }), GITHUB_TOKEN: "token" };
  await expect(
    refreshGithub(
      env,
      answering(200, {
        data: null,
        errors: [{ message: "Bad credentials" }],
      }),
    ),
  ).rejects.toThrow(/Bad credentials/);
  expect(env.HOME.items.get("github")).toBe(SAVED);
  expect(logged).toHaveBeenCalled();
  expect(String(logged.mock.calls[0])).toMatch(/Bad credentials/);
});

const keepsSaved = async (weeks) => {
  const env = { HOME: fakeKv({ github: SAVED }), GITHUB_TOKEN: "token" };
  await expect(
    refreshGithub(env, answering(200, calendar(weeks))),
  ).rejects.toThrow(/github: /);
  expect(env.HOME.items.get("github")).toBe(SAVED);
  expect(logged).toHaveBeenCalled();
};

test("a week without its days array leaves the saved data alone", async () => {
  await keepsSaved([WEEKS[0], { days: [] }]);
});

test("a level that isn't one of github's five leaves the saved data alone", async () => {
  await keepsSaved([
    {
      contributionDays: [
        { date: "2026-10-11", contributionLevel: "NONE" },
        { date: "2026-10-12", contributionLevel: "FIFTH_QUARTILE" },
      ],
    },
  ]);
});

test("a calendar with no days leaves the saved data alone", async () => {
  await keepsSaved([]);
  await keepsSaved([{ contributionDays: [] }]);
});

test("an error status, a network failure, and a missing token each fail the run and leave the saved data alone", async () => {
  const env = { HOME: fakeKv({ github: SAVED }), GITHUB_TOKEN: "token" };
  await expect(
    refreshGithub(env, answering(401, { message: "Bad credentials" })),
  ).rejects.toThrow(/answered 401/);
  await expect(
    refreshGithub(env, async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow(/offline/);
  const fetchImpl = answering(200, calendar(WEEKS));
  await expect(refreshGithub({ HOME: env.HOME }, fetchImpl)).rejects.toThrow(
    /GITHUB_TOKEN/,
  );
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(env.HOME.items.get("github")).toBe(SAVED);
  expect(logged).toHaveBeenCalledTimes(3);
});

test("a read that fails is logged and reads as null", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const boom = new Error("kv down");
  const HOME = {
    get: async () => {
      throw boom;
    },
  };
  expect(await readGithub({ HOME })).toBeNull();
  expect(warn).toHaveBeenCalledWith("github_unavailable", boom);
  warn.mockClear();
  expect(
    await readGithub({ HOME: fakeKv({ github: "{not json" }) }),
  ).toBeNull();
  expect(warn).toHaveBeenCalledWith("github_unavailable", expect.anything());
});

test("the saved data reads back, and nothing saved reads as null", async () => {
  expect(await readGithub({ HOME: fakeKv({ github: SAVED }) })).toEqual(
    JSON.parse(SAVED),
  );
  expect(await readGithub({ HOME: fakeKv() })).toBeNull();
  expect(
    await readGithub({ HOME: fakeKv({ github: "{not json" }) }),
  ).toBeNull();
});

test("a day whose date isn't a real yyyy-mm-dd day gives null and leaves the saved data alone", async () => {
  for (const date of [
    "Oct 15, 2026",
    "2026-10-15T00:00:00Z",
    "2026-13-45",
    "",
  ]) {
    expect(
      shapeCalendar(
        calendar([
          WEEKS[0],
          { contributionDays: [{ date, contributionLevel: "NONE" }] },
        ]),
      ),
      date,
    ).toBeNull();
  }
  await keepsSaved([
    WEEKS[0],
    { contributionDays: [{ date: "Oct 15", contributionLevel: "NONE" }] },
  ]);
});
