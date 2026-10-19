// the scene with the home route answering real shaped data, since every other test stubs it with nulls. runs against
// the capture build, like the other prod scene tests
import { expect, test, type Browser, type Page } from "@playwright/test";
import { shapeForecast } from "../../worker/weather.js";
import { quiet, watchErrors } from "./scene";

// open-meteo's answer at 02:00 local with rain, and the moon up from the evening before until late morning, shaped by
// the worker itself so the page reads what the worker really sends
const WEATHER = shapeForecast({
  utc_offset_seconds: -25200,
  current: { time: "2026-10-14T02:00", interval: 900, weather_code: 61 },
  daily: {
    time: ["2026-10-13", "2026-10-14", "2026-10-15"],
    sunrise: ["2026-10-13T07:30", "2026-10-14T07:32", "2026-10-15T07:33"],
    sunset: ["2026-10-13T18:25", "2026-10-14T18:23", "2026-10-15T18:21"],
    moonrise: ["2026-10-13T21:10", "2026-10-14T22:05", "2026-10-15T23:01"],
    moonset: ["2026-10-13T10:02", "2026-10-14T11:15", "2026-10-15T12:30"],
    moon_phase: [0.45, 0.5, 0.55],
  },
});

// 02:00 in the weather's own zone, when the sun is down and the moon is up
const NIGHT = new Date("2026-10-14T09:00:00Z");

const levels = [0, 1, 2, 3, 4];
const GITHUB = {
  total: 1234,
  days: Array.from({ length: 400 }, (_, i) => {
    const date = new Date(Date.UTC(2025, 8, 1 + i)).toISOString().slice(0, 10);
    return { date, level: levels[i % 5] };
  }),
};

const sceneShown = (page: Page) =>
  page.waitForFunction(
    () => (window as unknown as { __sceneShown?: boolean }).__sceneShown,
    null,
    { timeout: 60000 },
  );

const skyLook = (page: Page) =>
  page.evaluate(() => {
    const style = document.documentElement.style;
    return {
      fill: style.getPropertyValue("--glass-fill"),
      rim: style.getPropertyValue("--rim-angle"),
    };
  });

// a page at the fixed night hour with the weather given, once its glass tint and rim light are read back
const settledSky = async (
  browser: Browser,
  weather: unknown,
): Promise<{ fill: string; rim: string }> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.clock.setFixedTime(NIGHT);
  await quiet(page, { weather, github: null });
  await page.goto("/");
  await sceneShown(page);
  await expect
    .poll(async () => (await skyLook(page)).fill, { timeout: 15000 })
    .not.toBe("");
  await expect
    .poll(async () => (await skyLook(page)).rim, { timeout: 15000 })
    .not.toBe("");
  await page.waitForTimeout(3000);
  const look = await skyLook(page);
  await context.close();
  return look;
};

test("the scene runs with a real weather and github answer", async ({
  page,
}) => {
  test.setTimeout(180000);
  const watched = watchErrors(page);
  await quiet(page, { weather: WEATHER, github: GITHUB });
  await page.goto("/");
  await sceneShown(page);
  await expect(page.locator("html")).not.toHaveClass(/scene-failed/);

  await expect(page.locator("#css-layer .gh-total")).toHaveText(
    "1,234 in the last year",
  );
  const colors = await page.evaluate(() => {
    const cells = [
      ...document.querySelectorAll<HTMLElement>(
        "#css-layer .widget .graph span",
      ),
    ];
    return new Set(cells.map((cell) => cell.style.background)).size;
  });
  expect(colors, "the graph's cells use every level's color").toBe(5);

  expect(watched.errors).toEqual([]);
});

test("rain tints the glass and the moon lights the rims", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const rain = await settledSky(browser, WEATHER);
  const clear = await settledSky(browser, { ...WEATHER, code: 0 });
  const noMoon = await settledSky(browser, { ...WEATHER, moon: null });
  expect(rain.fill, "rain against a clear sky, all else equal").not.toBe(
    clear.fill,
  );
  expect(rain.rim, "the moon against none, all else equal").not.toBe(
    noMoon.rim,
  );
});
