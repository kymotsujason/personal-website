import type { Page } from "@playwright/test";

export async function stubHome(page: Page) {
  await page.route(
    (url) => url.pathname === "/api/home",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ weather: null, github: null }),
      }),
  );
}
