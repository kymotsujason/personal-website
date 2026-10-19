import { expect, test } from "@playwright/test";

const POST = {
  title: "Old posts are coming back",
  day: "October 18, 2026",
  year: "2026",
  excerpt: "The posts from the old blog are being brought over.",
  path: "/blog/old-posts-are-coming-back",
  image: "/desk-small.jpg",
};

test.describe("with javascript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the blog list shows the post under its year", async ({ page }) => {
    await page.goto("/blog");
    const year = page.locator("#page .year");
    await expect(year).toHaveCount(1);
    await expect(year.locator(".num")).toHaveText(POST.year);
    const row = year.locator(".rows.glass .post-row");
    await expect(row).toHaveCount(1);
    await expect(row.locator("h3")).toHaveText(POST.title);
    await expect(row.locator("time")).toHaveText(POST.day);
    await expect(row.locator("time")).toHaveAttribute(
      "datetime",
      /^2026-10-18/,
    );
    await expect(row.locator(".excerpt")).toContainText(POST.excerpt);
    await expect(row).toHaveAttribute("href", POST.path);
    await expect(row.locator(".thumb")).toHaveCount(0);
  });

  test("the post shows its feature image and its text", async ({
    page,
    request,
  }) => {
    await page.goto(POST.path);
    await expect(page.locator("#page h1")).toHaveCount(1);
    await expect(page.locator("#page .sheet h1")).toHaveText(POST.title);
    await expect(page.locator("#page .sheet time")).toHaveText(POST.day);
    await expect(page.locator("#page .sheet .post-body")).toContainText(
      "holds the place until they land",
    );
    const image = page.locator("#page .hero img.feature-image");
    await expect(image).toHaveAttribute("src", POST.image);
    const response = await request.get(POST.image);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/jpeg");
  });
});

test.describe("with javascript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the toolbar's ring is hidden without JavaScript", async ({ page }) => {
    await page.goto(POST.path);
    await expect(page.locator("#page .toolbar")).toBeVisible();
    await expect(page.locator("#page .toolbar .ring")).toBeHidden();
    await expect(
      page.locator("#page .toolbar a", { hasText: "Top" }),
    ).toBeVisible();
  });
});

test("the toolbar's ring shows with JavaScript", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("2d", "1"));
  await page.goto(POST.path);
  await expect(page.locator("#page .toolbar .ring")).toBeVisible();
});

test("a long post title wraps inside its row", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("2d", "1"));
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/blog");
  const sizes = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>("#page .post-row")!;
    const title = row.querySelector("h3")!;
    title.textContent = `${"Very long words ".repeat(12)}${"x".repeat(80)}`;
    return { scroll: row.scrollWidth, client: row.clientWidth };
  });
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
});

test("the feed is valid RSS that lists the post", async ({ page, request }) => {
  const response = await request.get("/blog/rss.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("xml");
  const feed = await page.evaluate(
    (text) => {
      const doc = new DOMParser().parseFromString(text, "application/xml");
      const items = [...doc.querySelectorAll("rss > channel > item")].map(
        (item) => ({
          title: item.querySelector("title")?.textContent,
          link: item.querySelector("link")?.textContent,
          date: item.querySelector("pubDate")?.textContent,
        }),
      );
      return {
        broken: doc.querySelector("parsererror") !== null,
        root: doc.documentElement.nodeName,
        version: doc.documentElement.getAttribute("version"),
        items,
      };
    },
    await response.text(),
  );
  expect(feed.broken).toBe(false);
  expect(feed.root).toBe("rss");
  expect(feed.version).toBe("2.0");
  expect(feed.items).toEqual([
    {
      title: POST.title,
      link: `https://jasonyue.ca${POST.path}`,
      date: "Sun, 18 Oct 2026 07:00:00 GMT",
    },
  ]);
});
