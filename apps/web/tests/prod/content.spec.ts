import { expect, test, type Page } from "@playwright/test";
import { alphaAt, paintedFade, worstContrasts, type FadeSpec } from "./fade";
import {
  byRank,
  dayText,
  firstParagraph,
  newest,
  projectPath,
} from "../projects";
import { quiet } from "./scene";

const FEATURED = 3;

const STORIES = byRank.map((e) => e.slug);
const PROJECT = {
  title: newest.data.title,
  date: newest.data.date,
  summary: newest.data.summary,
  path: projectPath(newest),
};

// each layout case reads the first entry that has the trait, so editing an entry's words never moves a test
const WITH_LOOP = byRank.find(
  (e) => e.data.hero.loop && (e.data.links?.length ?? 0) >= 2,
)!;
const NO_LOOP = byRank.find((e) => !e.data.hero.loop)!;
const PRIVATE = byRank.find((e) => e.data.source === "private")!;
const UNRELEASED = byRank.find((e) => e.data.source === "unreleased")!;
const BUILT_ON = byRank.find((e) => e.data.builtOn)!;

// the page's astro smartypants turns straight quotes curly, so both sides are read with straight ones
const plain = (text: string) =>
  text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

// the dark fade each page paints under its words. a story's follows its words block, a card's is the card's own pseudo-element
const STORY_FADE: FadeSpec = {
  owner: "#page .story-hero .words",
  pseudo: "::before",
  words: ".words",
  texts: [".sub", "h1"],
};
const CARD_FADE: FadeSpec = {
  owner: "#page a.project-card.featured",
  pseudo: "::after",
  words: ".words",
  texts: [".sub", "h2"],
};

const expectOnFade = async (page: Page, spec: FadeSpec, label: string) => {
  const painted = await paintedFade(page, spec);
  expect(painted.gradient, label).toContain("linear-gradient(to top");
  expect(painted.stops.length, label).toBeGreaterThanOrEqual(3);
  // the second stop is where the solid part of the fade ends, and the words' top has to be under it
  // half a pixel absorbs the layout's rounding
  expect(painted.distance - 0.5, label).toBeLessThanOrEqual(
    painted.stops[1]!.at,
  );
  expect(alphaAt(painted, painted.distance), label).toBeGreaterThan(0.5);
  for (const { selector, ratio } of worstContrasts(painted)) {
    expect(ratio, `${label} ${selector}`).toBeGreaterThanOrEqual(4.5);
  }
};

test.describe("with javascript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the list shows every project in rank order", async ({ page }) => {
    await page.goto("/projects");
    const hrefs = await page
      .locator("#page a[data-project]")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(STORIES.map((slug) => `/projects/${slug}`));
  });

  test("the first three are featured cards and the rest are rows", async ({
    page,
  }) => {
    await page.goto("/projects");
    const cards = page.locator("#page a.project-card.featured");
    await expect(cards).toHaveCount(FEATURED);
    await expect(page.locator("#page .more a.project-row")).toHaveCount(
      STORIES.length - FEATURED,
    );
    await expect(page.locator("#page .more h2")).toHaveText("More projects");
    for (const [i, slug] of STORIES.slice(0, FEATURED).entries()) {
      await expect(cards.nth(i)).toHaveAttribute("data-project", slug);
    }
    for (const [i, slug] of STORIES.slice(FEATURED).entries()) {
      await expect(
        page.locator("#page .more a.project-row").nth(i),
      ).toHaveAttribute("data-project", slug);
    }
    for (const [i, e] of byRank.slice(0, FEATURED).entries()) {
      await expect(cards.nth(i).locator("h2")).toHaveText(e.data.title);
      await expect(cards.nth(i).locator(".sub")).toHaveText(e.data.summary);
      await expect(cards.nth(i).locator(".kicker")).toHaveText(e.data.kicker);
    }
  });

  test("a featured card's chip is its first number", async ({ page }) => {
    await page.goto("/projects");
    for (const e of byRank.slice(0, FEATURED)) {
      const first = e.data.stats[0]!;
      const chip = page.locator(`#page a[data-project="${e.slug}"] .proof`);
      await expect(chip.locator("b"), e.slug).toHaveText(first.value);
      await expect(chip, e.slug).toHaveText(`${first.value} ${first.label}`);
    }
  });

  test("the list has no Latest label and no glass strip", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.locator("#page .project-card .strip")).toHaveCount(0);
    await expect(page.locator("#page .project-card time")).toHaveCount(0);
    await expect(
      page.locator("#page .kicker", { hasText: "Latest" }),
    ).toHaveCount(0);
  });

  for (const width of [320, 393]) {
    test(`a featured card's words don't run into its chip at ${width} wide`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 852 });
      await page.goto("/projects");
      const cards = page.locator("#page a.project-card.featured");
      for (let i = 0; i < 3; i++) {
        const chip = await cards.nth(i).locator(".proof").boundingBox();
        const words = await cards.nth(i).locator(".words").boundingBox();
        expect(chip && words).toBeTruthy();
        expect(chip!.y + chip!.height, `card ${i}`).toBeLessThanOrEqual(
          words!.y,
        );
      }
    });
  }

  test("the story shows the hero, links, three numbers, and the sheet in order", async ({
    page,
  }) => {
    await page.goto(projectPath(WITH_LOOP));
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
    const { data } = WITH_LOOP;
    const stats = page.locator("#page .story-stats .stat");
    await expect(stats).toHaveCount(3);
    for (const [i, stat] of data.stats.entries()) {
      await expect(stats.nth(i).locator("b")).toHaveText(stat.value);
      await expect(stats.nth(i).locator("span")).toHaveText(stat.label);
    }
    const highlights = page.locator("#page .highlights li");
    await expect(highlights).toHaveCount(3);
    for (const [i, item] of data.highlights.entries()) {
      await expect(highlights.nth(i).locator("b")).toHaveText(item.title);
      await expect(highlights.nth(i).locator("div > span")).toHaveText(
        item.text,
      );
    }
    await expect(page.locator("#page .story-hero .kicker")).toHaveText(
      data.kicker,
    );
    await expect(page.locator("#page .story-hero .sub")).toHaveText(
      data.summary,
    );
    await expect(page.locator("#page .details time")).toHaveAttribute(
      "datetime",
      data.date,
    );
    await expect(page.locator("#page .details time")).toHaveText(
      dayText(data.date),
    );
    const first = await page
      .locator("#page .sheet > p")
      .first()
      .evaluate((p) => p.textContent ?? "");
    expect(plain(first.replace(/\s+/g, " ").trim())).toBe(
      plain(firstParagraph(WITH_LOOP)),
    );
  });

  test("the story's title is the hero's large title", async ({ page }) => {
    await page.goto(projectPath(WITH_LOOP));
    await expect(page.locator("#page h1")).toHaveCount(1);
    await expect(page.locator("#page .story-hero h1.large-title")).toHaveText(
      WITH_LOOP.data.title,
    );
  });

  test("the story's hero picture has the entry's alt text and still", async ({
    page,
  }) => {
    await page.goto(projectPath(WITH_LOOP));
    const { hero } = WITH_LOOP.data;
    const image = page.locator("#page .story-hero img.pic");
    await expect(image).toHaveAttribute("alt", hero.alt);
    await expect(image).toHaveAttribute("data-still", hero.still);
    await expect(image).toHaveAttribute("src", hero.loop!);
    await expect(
      page.locator("#page .story-hero picture > source"),
    ).toHaveAttribute("srcset", hero.still);
  });

  test("a story without a loop has no source and shows its still", async ({
    page,
  }) => {
    await page.goto(projectPath(NO_LOOP));
    await expect(
      page.locator("#page .story-hero picture > source"),
    ).toHaveCount(0);
    await expect(page.locator("#page .story-hero img.pic")).toHaveAttribute(
      "src",
      NO_LOOP.data.hero.still,
    );
  });

  test("the first link is the accent pill", async ({ page }) => {
    await page.goto(projectPath(WITH_LOOP));
    const links = WITH_LOOP.data.links!;
    const pills = page.locator("#page .story-links a.pill");
    await expect(pills).toHaveCount(links.length);
    await expect(pills.first()).toHaveClass(/\baccent\b/);
    await expect(pills.first()).toHaveAttribute("href", links[0]!.url);
    await expect(pills.first()).toHaveText(links[0]!.label);
    await expect(pills.nth(1)).not.toHaveClass(/\baccent\b/);
  });

  test("a private source shows as text with no pill", async ({ page }) => {
    await page.goto(projectPath(PRIVATE));
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
    await page.goto(projectPath(UNRELEASED));
    await expect(page.locator("#page .story-links")).toHaveCount(0);
    await expect(page.locator("#page .details")).toContainText(
      "Not public yet",
    );
  });

  test("Details shows Built on as a link", async ({ page }) => {
    await page.goto(projectPath(BUILT_ON));
    const { builtOn } = BUILT_ON.data;
    const row = page.locator("#page .details dd a");
    await expect(row).toHaveText(builtOn!.name);
    await expect(row).toHaveAttribute("href", builtOn!.url);
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

    test(`story figures reserve their image height (${slug})`, async ({
      page,
    }) => {
      await page.goto(`/projects/${slug}`);
      const images = page.locator("#page .sheet figure img");
      expect(await images.count()).toBeGreaterThan(0);
      for (const img of await images.all()) {
        const size = await img.evaluate((el: HTMLImageElement) => ({
          width: Number(el.getAttribute("width")),
          height: Number(el.getAttribute("height")),
        }));
        expect(size.width).toBeGreaterThan(0);
        expect(size.height).toBeGreaterThan(0);
        // height auto lets the attributes' ratio reserve the space before the file loads
        const box = await img.evaluate((el: HTMLImageElement) => ({
          ratio:
            el.getBoundingClientRect().width /
            el.getBoundingClientRect().height,
          aspect: getComputedStyle(el).aspectRatio,
        }));
        expect(box.aspect).toContain(`${size.width} / ${size.height}`);
        expect(box.ratio).toBeCloseTo(size.width / size.height, 1);
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

  for (const width of [320, 393]) {
    test(`every story's words sit on the painted fade at ${width} wide`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 852 });
      for (const slug of STORIES) {
        await page.goto(`/projects/${slug}`);
        await expectOnFade(page, STORY_FADE, slug);
      }
    });

    test(`a story's longer summary stays on the painted fade at ${width} wide`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 852 });
      for (const slug of STORIES) {
        await page.goto(`/projects/${slug}`);
        await page.locator("#page .story-hero .sub").evaluate((sub) => {
          sub.textContent = `${sub.textContent} `.repeat(3).trim();
        });
        await expectOnFade(page, STORY_FADE, `${slug} with a longer summary`);
      }
    });
  }

  for (const width of [320, 393]) {
    test(`the small bar title clears both pills on every story at ${width} wide`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 852 });
      for (const slug of STORIES) {
        await page.goto(`/projects/${slug}`);
        const back = (await page
          .locator("#page > header .pill.back")
          .boundingBox())!;
        const home = (await page
          .locator("#page > header .pill.home-icon")
          .last()
          .boundingBox())!;
        const title = (await page
          .locator("#page > header .inline-title")
          .boundingBox())!;
        expect(title.x, slug).toBeGreaterThanOrEqual(back.x + back.width);
        expect(title.x + title.width, slug).toBeLessThanOrEqual(home.x);
      }
    });
  }

  for (const width of [320, 393]) {
    test(`a featured card's words sit on the painted fade at ${width} wide`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 852 });
      await page.goto("/projects");
      for (let i = 0; i < FEATURED; i++) {
        await expectOnFade(page, { ...CARD_FADE, index: i }, `card ${i}`);
      }
    });
  }

  for (const slug of STORIES) {
    test(`the story's first load stays under 4 MB of images (${slug})`, async ({
      page,
    }) => {
      await page.goto(`/projects/${slug}`);
      const sources = await page
        .locator("#page img")
        .evaluateAll((imgs) =>
          [
            ...new Set(
              imgs.map(
                (img) =>
                  (img as HTMLImageElement).currentSrc ||
                  (img as HTMLImageElement).src,
              ),
            ),
          ].filter(Boolean),
        );
      expect(sources.length, slug).toBeGreaterThan(0);
      const hero = await page
        .locator("#page .story-hero img.pic")
        .evaluate(async (img: HTMLImageElement) => {
          await img.decode();
          return { width: img.naturalWidth, height: img.naturalHeight };
        });
      expect(hero.width, `${slug} hero width`).toBeGreaterThan(0);
      expect(hero.height, `${slug} hero height`).toBeGreaterThan(0);
      let total = 0;
      for (const src of sources) {
        const response = await page.request.get(src);
        expect(response.ok(), src).toBe(true);
        total += (await response.body()).length;
      }
      expect(total, `${slug} ${total} bytes`).toBeLessThan(4_000_000);
    });
  }

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
