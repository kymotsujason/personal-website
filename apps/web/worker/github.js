// the daily cron's github fetch and the home route's read of what it saved. github's graphql api can answer 200 with
// an errors list, so only an answer with the calendar's weeks in place is saved, and any failure keeps the last save
export const GITHUB_USER = "kymotsujason";
const ENDPOINT = "https://api.github.com/graphql";
const KEY = "github";

const QUERY = `query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionLevel
          }
        }
      }
    }
  }
}`;

const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

// github's answer as { days: [{ date, level }], total }, or null when any part of it isn't in the expected shape, so
// a strange answer can't replace a saved graph with an empty or all zero one
export const shapeCalendar = (json) => {
  const calendar =
    json?.data?.user?.contributionsCollection?.contributionCalendar;
  if (
    !Array.isArray(calendar?.weeks) ||
    !Number.isFinite(calendar.totalContributions) ||
    !calendar.weeks.every((week) => Array.isArray(week?.contributionDays))
  ) {
    return null;
  }
  const found = calendar.weeks.flatMap((week) => week.contributionDays);
  const valid = found.every(
    (day) =>
      typeof day?.date === "string" &&
      Object.hasOwn(LEVELS, day.contributionLevel),
  );
  if (!valid || found.length === 0) {
    return null;
  }
  const days = found.map((day) => ({
    date: day.date,
    level: LEVELS[day.contributionLevel],
  }));
  return { days, total: calendar.totalContributions };
};

// how long the cron waits on github before it gives up for the day
const TIMEOUT_MS = 10000;

// logged, then thrown, so cloudflare's cron history shows the run as failed. the last save stays either way
const failure = (message) => {
  console.error(`github: ${message}`);
  return new Error(`github: ${message}`);
};

export const refreshGithub = async (env, fetchImpl = fetch) => {
  if (!env.GITHUB_TOKEN) {
    throw failure("no GITHUB_TOKEN, so the saved data stays");
  }
  let res = null;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `bearer ${env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        // github's api turns away requests without one
        "User-Agent": "jasonyue.ca",
      },
      body: JSON.stringify({ query: QUERY, variables: { login: GITHUB_USER } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw failure(`couldn't be reached (${error})`);
  }
  if (!res.ok) {
    throw failure(`answered ${res.status}`);
  }
  const json = await res.json().catch(() => null);
  const data = shapeCalendar(json);
  if (!data) {
    const errors = Array.isArray(json?.errors)
      ? json.errors.map((error) => error?.message).join("; ")
      : "not in the expected shape";
    throw failure(`the answer had no usable calendar (${errors})`);
  }
  await env.HOME.put(KEY, JSON.stringify(data));
};

// what the cron saved, or null before its first good run
export const readGithub = async (env) => {
  try {
    return await env.HOME.get(KEY, "json");
  } catch (error) {
    console.warn("github_unavailable", error);
    return null;
  }
};
