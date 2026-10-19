import { expect, test } from "@playwright/test";
import { posts } from "../posts";

const POST = {
  slug: "new-equipment-to-keep-things-interesting",
  title: "New equipment to keep things interesting",
  day: "January 1, 2020",
  year: "2020",
  excerpt: "Recently, I've decided to change things up",
  path: "/blog/new-equipment-to-keep-things-interesting",
  image: "/blog/content/images/2020/01/20191206_200441-1.jpg",
  thumb: "/blog/thumbs/new-equipment-to-keep-things-interesting.jpg",
};

test.describe("with javascript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the blog list shows the post under its year, with its thumbnail", async ({
    page,
    request,
  }) => {
    await page.goto("/blog");
    await expect(page.locator("#page .year .num")).toHaveText([
      "2020",
      "2019",
      "2018",
    ]);
    const year = page.locator("#page .year", {
      has: page.locator(`[data-post="${POST.slug}"]`),
    });
    await expect(year.locator(".num")).toHaveText(POST.year);
    const row = year.locator(`.rows.glass .post-row[data-post="${POST.slug}"]`);
    await expect(row).toHaveCount(1);
    await expect(row.locator("h3")).toHaveText(POST.title);
    await expect(row.locator("time")).toHaveText(POST.day);
    await expect(row.locator("time")).toHaveAttribute(
      "datetime",
      /^2020-01-01/,
    );
    await expect(row.locator(".excerpt")).toContainText(POST.excerpt);
    await expect(row).toHaveAttribute("href", POST.path);
    await expect(row.locator(".thumb")).toHaveAttribute("src", POST.thumb);
    const response = await request.get(POST.thumb);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/jpeg");
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
      "Nebia Spa Shower",
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

test("the feed is valid RSS that lists every post, newest first", async ({
  page,
  request,
}) => {
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
  expect(feed.items).toEqual(
    posts.map((post) => ({
      title: post.title,
      link: `https://jasonyue.ca/blog/${post.slug}`,
      date: new Date(post.date).toUTCString(),
    })),
  );
  expect(feed.items).toContainEqual({
    title: POST.title,
    link: `https://jasonyue.ca${POST.path}`,
    date: "Thu, 02 Jan 2020 01:56:51 GMT",
  });
});
