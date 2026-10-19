// the scene with the home route answering real shaped data, since every other test stubs it with nulls. runs against
// the capture build, like the other prod scene tests
import { expect, test, type Page } from "@playwright/test";
import { quiet, watchErrors } from "./scene";

// the worker's shapeForecast output: rain code 61 with a moon that is up from yesterday evening to this afternoon
const WEATHER = {
  code: 61,
  sunrise: 7.53,
  sunset: 18.38,
  utcOffset: -25200,
  polar: null,
  moon: {
    phase: 0.5,
    ups: [
      [-3.25, 5.5],
      [21.75, 29.5],
    ],
  },
};

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

const glassFill = (page: Page) =>
  page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--glass-fill"),
  );

test("the scene runs with a real weather and github answer", async ({
  page,
  browser,
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

  // the sky's tint is read back once the weather crossfade is done, and rain tints the glass differently from the
  // clear sky a page with no weather keeps
  const other = await browser.newContext();
  const clear = await other.newPage();
  await quiet(clear);
  await clear.goto("/");
  await sceneShown(clear);
  await expect.poll(() => glassFill(page), { timeout: 15000 }).not.toBe("");
  await expect.poll(() => glassFill(clear), { timeout: 15000 }).not.toBe("");
  await page.waitForTimeout(3000);
  await clear.waitForTimeout(3000);
  expect(await glassFill(page)).not.toBe(await glassFill(clear));
  await other.close();

  expect(watched.errors).toEqual([]);
});
