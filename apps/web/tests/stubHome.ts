import type { Page } from "@playwright/test";

export type Home = { weather: unknown; github: unknown };

export async function stubHome(
  page: Page,
  home: Home = { weather: null, github: null },
) {
  await page.route(
    (url) => url.pathname === "/api/home",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(home),
      }),
  );
}
