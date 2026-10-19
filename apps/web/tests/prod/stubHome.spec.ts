import { expect, test } from "@playwright/test";
import { stubHome } from "../stubHome";

test("the stub answers /api/home with a query string", async ({ page }) => {
  await stubHome(page);
  await page.goto("/");
  const body = await page.evaluate(async () => {
    const res = await fetch("/api/home?tz=America/Vancouver");
    return { status: res.status, json: await res.json() };
  });
  expect(body).toEqual({ status: 200, json: { weather: null, github: null } });
});
