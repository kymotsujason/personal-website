import { expect, test, type Page } from "@playwright/test";
import { posts } from "../posts";

const SITE = "https://jasonyue.ca";

const PAGES = [
  { path: "/", type: "website" },
  { path: "/about", type: "website" },
  { path: "/music", type: "website" },
  { path: "/projects", type: "website" },
  { path: "/projects/device-intro", type: "article" },
  { path: "/blog", type: "website" },
  { path: "/blog/new-equipment-to-keep-things-interesting", type: "article" },
];

const meta = (page: Page, attribute: "name" | "property", key: string) =>
  page.locator(`head meta[${attribute}="${key}"]`).getAttribute("content");

test.describe("with javascript off", () => {
  test.use({ javaScriptEnabled: false });

  for (const { path, type } of PAGES) {
    test(`${path} sets its link preview`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
        "href",
        `${SITE}${path}`,
      );
      expect(await meta(page, "property", "og:url")).toBe(`${SITE}${path}`);
      expect(await meta(page, "property", "og:image")).toBe(`${SITE}/og.jpg`);
      expect(await meta(page, "property", "og:image:width")).toBe("1200");
      expect(await meta(page, "property", "og:image:height")).toBe("630");
      expect(await meta(page, "property", "og:type")).toBe(type);
      expect(await meta(page, "property", "og:site_name")).toBe("Jason Yue");
      expect(await meta(page, "name", "twitter:card")).toBe(
        "summary_large_image",
      );

      const title = await meta(page, "property", "og:title");
      expect(title).toBeTruthy();
      expect(await page.title()).toContain(title!);

      const description = await meta(page, "name", "description");
      expect(description).toBeTruthy();
      expect(await meta(page, "property", "og:description")).toBe(description);

      const feed = page.locator(
        'head link[rel="alternate"][type="application/rss+xml"]',
      );
      await expect(feed).toHaveAttribute("href", "/blog/rss.xml");
    });
  }

  test("every page has its own description", async ({ page }) => {
    const descriptions: string[] = [];
    for (const { path } of PAGES) {
      await page.goto(path);
      descriptions.push((await meta(page, "name", "description")) ?? "");
    }
    expect(descriptions.every((text) => text !== "")).toBe(true);
    expect(new Set(descriptions).size).toBe(PAGES.length);
  });

  test("the project and the post show their own title in the card", async ({
    page,
  }) => {
    await page.goto("/projects/device-intro");
    expect(await meta(page, "property", "og:title")).toBe("Device intro");
    expect(await meta(page, "property", "og:description")).toBe(
      "A foldable phone, live in the browser",
    );
    await page.goto("/blog/new-equipment-to-keep-things-interesting");
    expect(await meta(page, "property", "og:title")).toBe(
      "New equipment to keep things interesting",
    );
  });

  test("an unknown blog path gives the not found page with a link to the blog", async ({
    page,
  }) => {
    const response = await page.goto("/blog/tag/anything");
    expect(response?.status()).toBe(404);
    await expect(page.locator("#page h1")).toHaveText(
      "No connection to this page",
    );
    await expect(page.locator('#page a[href="/blog"]')).toBeVisible();
    // the address isn't known when the page is built, so the card has no url to claim
    await expect(page.locator('head link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex",
    );
  });

  test("the link on the not found page opens the blog", async ({ page }) => {
    await page.goto("/blog/tag/anything");
    await page.locator('#page a[href="/blog"]').click();
    await expect(page).toHaveURL(/\/blog$/);
    await expect(page.locator("#page h1")).toHaveText("Blog");
  });
});

test("the preview image is a 1200 by 630 jpeg", async ({ request }) => {
  const response = await request.get("/og.jpg");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/jpeg");
  const bytes = await response.body();
  expect(bytes.subarray(0, 3).toString("hex")).toBe("ffd8ff");
  // the first start of frame marker holds the height, then the width
  let at = 2;
  while (at < bytes.length) {
    const marker = bytes[at + 1];
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      expect(bytes.readUInt16BE(at + 5)).toBe(630);
      expect(bytes.readUInt16BE(at + 7)).toBe(1200);
      return;
    }
    at += 2 + length;
  }
  throw new Error("the jpeg has no frame header");
});

test("the sitemap lists every page once, without slashes, and not the 404", async ({
  request,
}) => {
  const index = await request.get("/sitemap-index.xml");
  expect(index.status()).toBe(200);
  const indexText = await index.text();
  const files = [...indexText.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => match[1],
  );
  expect(files.length).toBeGreaterThan(0);

  const urls: string[] = [];
  for (const file of files) {
    expect(file.startsWith(`${SITE}/`)).toBe(true);
    const sitemap = await request.get(new URL(file).pathname);
    expect(sitemap.status()).toBe(200);
    const text = await sitemap.text();
    urls.push(...[...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  }
  const expected = new Set([
    ...PAGES.map(({ path }) => `${SITE}${path}`),
    ...posts.map((post) => `${SITE}/blog/${post.slug}`),
  ]);
  expect([...urls].sort()).toEqual([...expected].sort());
});

test("robots.txt allows everything and names the sitemap", async ({
  request,
}) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text).toMatch(/^User-agent: \*$/m);
  expect(text).toMatch(/^Allow: \/$/m);
  expect(text).not.toMatch(/^Disallow: ./m);
  expect(text).toContain(`Sitemap: ${SITE}/sitemap-index.xml`);
});
