import { expect, test } from "@playwright/test";
import { quiet } from "./scene";

const PROJECT = {
  title: "Super Hexagon RL",
  date: "2026-10-19",
  summary: "An agent that plays every level of the real game live",
  path: "/projects/super-hexagon-rl",
};

const PROJECT_DAY = "October 19, 2026";

const STORIES = [
  "super-hexagon-rl",
  "pickban-gg",
  "battlebgm",
  "jasonyue-ca",
  "virtual-ascii",
  "tobii-gaze-linux",
  "mouse-battery",
  "mangadex-paperback",
];

test.describe("with javascript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the project list starts with the rank 1 project", async ({ page }) => {
    await page.goto("/projects");
    const card = page.locator("#page .project-card").first();
    await expect(card.locator("h2")).toHaveText(PROJECT.title);
    await expect(card.locator(".sub")).toHaveText(PROJECT.summary);
    await expect(card.locator("time")).toHaveText(PROJECT_DAY);
    await expect(card.locator("time")).toHaveAttribute(
      "datetime",
      PROJECT.date,
    );
    await expect(card).toHaveAttribute("href", PROJECT.path);
    await expect(card.locator(".kicker")).toHaveText("Latest");
  });

  test("the story shows the hero, links, three numbers, and the sheet in order", async ({
    page,
  }) => {
    await page.goto(PROJECT.path);
    const order = await page.evaluate(
      (selectors) => {
        const nodes = selectors.map((s) => document.querySelector(s));
        return nodes.map((node, i) =>
          node && i > 0
            ? Boolean(
                nodes[i - 1]!.compareDocumentPosition(node) &
                Node.DOCUMENT_POSITION_FOLLOWING,
              )
            : node !== null,
        );
      },
      [
        "#page .story-hero",
        "#page .story-links",
        "#page .story-stats",
        "#page .sheet",
        "#page .sheet > p",
        "#page .sheet .highlights",
        "#page .sheet .stack",
        "#page .sheet .details",
      ],
    );
    expect(order).toEqual(order.map(() => true));
    await expect(page.locator("#page .story-stats .stat")).toHaveCount(3);
    await expect(
      page.locator("#page .story-stats .stat").first(),
    ).toContainText("120/120");
    await expect(page.locator("#page .highlights li")).toHaveCount(3);
    await expect(page.locator("#page .story-hero .kicker")).toHaveText(
      "Reinforcement learning",
    );
    await expect(page.locator("#page .story-hero .sub")).toHaveText(
      PROJECT.summary,
    );
    await expect(page.locator("#page .details time")).toHaveAttribute(
      "datetime",
      PROJECT.date,
    );
    await expect(page.locator("#page .details time")).toHaveText(PROJECT_DAY);
    await expect(page.locator("#page .column")).toContainText(
      "Super Hexagon RL is a self learning agent",
    );
  });

  test("the story's title is the hero's large title", async ({ page }) => {
    await page.goto(PROJECT.path);
    await expect(page.locator("#page h1")).toHaveCount(1);
    await expect(page.locator("#page .story-hero h1.large-title")).toHaveText(
      PROJECT.title,
    );
  });

  test("the story's hero picture has the entry's alt text and still", async ({
    page,
  }) => {
    await page.goto(PROJECT.path);
    const image = page.locator("#page .story-hero img.pic");
    await expect(image).toHaveAttribute(
      "alt",
      "The agent steering through the walls of a Super Hexagon level",
    );
    await expect(image).toHaveAttribute(
      "data-still",
      "/projects/super-hexagon-rl/hero.webp",
    );
    await expect(image).toHaveAttribute(
      "src",
      "/projects/super-hexagon-rl/hero-loop.webp",
    );
    await expect(
      page.locator("#page .story-hero picture > source"),
    ).toHaveAttribute("srcset", "/projects/super-hexagon-rl/hero.webp");
  });

  test("a story without a loop has no source and shows its still", async ({
    page,
  }) => {
    await page.goto("/projects/tobii-gaze-linux");
    await expect(
      page.locator("#page .story-hero picture > source"),
    ).toHaveCount(0);
    await expect(page.locator("#page .story-hero img.pic")).toHaveAttribute(
      "src",
      "/projects/tobii-gaze-linux/hero.webp",
    );
  });

  test("the first link is the accent pill", async ({ page }) => {
    await page.goto(PROJECT.path);
    const pills = page.locator("#page .story-links a.pill");
    await expect(pills).toHaveCount(2);
    await expect(pills.first()).toHaveClass(/\baccent\b/);
    await expect(pills.first()).toHaveAttribute(
      "href",
      "https://github.com/kymotsujason/super-hexagon-rl",
    );
    await expect(pills.first()).toHaveText("GitHub");
    await expect(pills.nth(1)).not.toHaveClass(/\baccent\b/);
  });

  test("a private source shows as text with no pill", async ({ page }) => {
    await page.goto("/projects/battlebgm");
    await expect(page.locator("#page .story-links span.private")).toHaveText(
      "Source is private",
    );
    await expect(page.locator("#page .story-links .private.pill")).toHaveCount(
      0,
    );
    await expect(
      page.locator("#page .details dd", { hasText: "Private" }),
    ).toHaveCount(1);
  });

  test("an unreleased source shows Not public yet and no link row", async ({
    page,
  }) => {
    await page.goto("/projects/virtual-ascii");
    await expect(page.locator("#page .story-links")).toHaveCount(0);
    await expect(page.locator("#page .details")).toContainText(
      "Not public yet",
    );
  });

  test("Details shows Built on as a link", async ({ page }) => {
    await page.goto("/projects/tobii-gaze-linux");
    const row = page.locator("#page .details dd a");
    await expect(row).toHaveText("tobiifree");
    await expect(row).toHaveAttribute(
      "href",
      "https://github.com/Aetherall/tobiifree",
    );
  });

  for (const slug of STORIES) {
    test(`a body figure keeps its caption (${slug})`, async ({ page }) => {
      await page.goto(`/projects/${slug}`);
      const figures = page.locator("#page .sheet figure");
      expect(await figures.count()).toBeGreaterThan(0);
      for (const figure of await figures.all()) {
        await expect(figure.locator("img")).toHaveAttribute("alt", /\S/);
        await expect(figure.locator("figcaption")).toHaveText(/\S/);
      }
    });

    test(`the story has no toolbar (${slug})`, async ({ page }) => {
      await page.goto(`/projects/${slug}`);
      await expect(page.locator("#page .toolbar")).toHaveCount(0);
    });
  }

  test("every story's title clears the top bar at iPhone width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    for (const slug of STORIES) {
      await page.goto(`/projects/${slug}`);
      const bar = (await page.locator("#page > header").boundingBox())!;
      const words = (await page
        .locator("#page .story-hero .words")
        .boundingBox())!;
      const hero = (await page.locator("#page .story-hero").boundingBox())!;
      expect(words.y, slug).toBeGreaterThanOrEqual(bar.y + bar.height);
      expect(words.y + words.height, slug).toBeLessThanOrEqual(
        hero.y + hero.height,
      );
    }
  });

  test("the flat home card names the latest project", async ({ page }) => {
    await page.goto("/");
    const card = page.locator("#page .widget", {
      hasText: "LATEST PROJECT",
    });
    await expect(card).toContainText(PROJECT.title);
    await expect(card).toHaveAttribute("href", PROJECT.path);
  });

  test("the about page has the facts and the links", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator("#page h1")).toHaveText("About");
    await expect(
      page.locator("#page .fact", {
        hasText:
          "I believe first impressions matter, UI/UX must be intuitive and elegant",
      }),
    ).toBeVisible();
    await expect(
      page.locator('#page a[href="https://github.com/kymotsujason"]'),
    ).toContainText("GitHub");
  });

  for (const width of [1400, 320]) {
    test(`with no JavaScript every fact shows, unclipped at ${width} wide`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width, height: 850 },
      });
      const page = await context.newPage();
      await page.goto("/about");
      const facts = page.locator("#page .fact");
      await expect(facts).toHaveCount(8);
      for (const fact of await facts.all()) {
        await expect(fact).toBeVisible();
      }
      await expect(page.locator("#page [data-facts-next]")).toBeHidden();
      const edges = await page.evaluate(() => {
        const last = [...document.querySelectorAll("#page .fact")].at(-1)!;
        const widget = document.querySelector("#page .facts-widget")!;
        return {
          fact: last.getBoundingClientRect().bottom,
          widget: widget.getBoundingClientRect().bottom,
        };
      });
      expect(edges.fact).toBeLessThanOrEqual(edges.widget);
      await context.close();
    });
  }

  test("the latest tile links the newest project and post", async ({
    page,
  }) => {
    await page.goto("/about");
    const tile = page.locator("#page .latest");
    await expect(tile.locator(`a[href="${PROJECT.path}"]`)).toContainText(
      PROJECT.title,
    );
    await expect(
      tile.locator('a[href="/blog/planning-on-improvements-to-projects"]'),
    ).toContainText("Planning on improvements to projects");
  });
});

test.describe("the facts stack", () => {
  test("shows one fact at a time and moves on with a click, Enter, and Space", async ({
    page,
  }) => {
    await page.goto("/about");
    const front = page.locator("#page .fact[data-pos='0']");
    const live = page.locator("#page [data-facts-live]");
    const button = page.getByRole("button", { name: "Next fact" });
    await expect(button).toHaveCount(1);
    await expect(page.locator("#page button [data-pos]")).toHaveCount(0);
    await expect(front).toHaveCount(1);
    await expect(front).toHaveText(
      "I believe first impressions matter, UI/UX must be intuitive and elegant",
    );
    // nothing is announced until the visitor asks for the next fact
    await expect(live).toHaveText("");
    await expect(front).not.toHaveAttribute("aria-hidden", /.*/);
    await expect(page.locator("#page .fact[data-pos='1']")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(page.locator("#page .fact[aria-hidden='true']")).toHaveCount(
      7,
    );
    await button.click();
    await expect(front).toHaveText(
      "Optimizing is a road with no end, but I still enjoy it",
    );
    await expect(live).toHaveText(
      "Optimizing is a road with no end, but I still enjoy it",
    );
    await expect(front).not.toHaveAttribute("aria-hidden", /.*/);
    await expect(page.locator("#page .fact[aria-hidden='true']")).toHaveCount(
      7,
    );
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(front).toHaveText(
      "I would like to travel more to certain eastern countries",
    );
    await page.keyboard.press("Space");
    await expect(front).toHaveText("I'm not a fan of paper");
    await expect(page.locator("#page .fact[data-pos='1']")).toHaveCount(1);
  });
});

test("reduced motion stops every transition on the stack's cards", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/about");
  for (const pos of [0, 1, 2, 3]) {
    const durations = await page
      .locator(`#page .fact[data-pos='${pos}']`)
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    for (const d of durations.split(", ")) {
      expect(d).toBe("0s");
    }
  }
  await context.close();
});

test("site-data and the phone's home card name the latest project", async ({
  page,
}) => {
  test.setTimeout(120000);
  await quiet(page);
  await page.goto("/");
  const data = await page.evaluate(() =>
    JSON.parse(document.getElementById("site-data")!.textContent ?? "{}"),
  );
  expect(data.latestProject).toEqual(PROJECT);
  await page.waitForFunction(
    () => (window as unknown as { __sceneShown?: boolean }).__sceneShown,
    null,
    { timeout: 60000 },
  );
  await expect(
    page.locator('#css-layer [data-action="project"] .w-big'),
  ).toHaveText(PROJECT.title);
});
