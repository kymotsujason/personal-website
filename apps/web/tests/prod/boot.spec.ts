import { expect, test } from "@playwright/test";
import { stubHome } from "../stubHome";

test("the home page answers with the page shell", async ({ page }) => {
  await stubHome(page);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("main#page")).toHaveCount(1);
});
