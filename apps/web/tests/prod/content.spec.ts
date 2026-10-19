import { expect, test } from "@playwright/test";
import { quiet } from "./scene";

const PROJECT = {
  title: "Device intro",
  date: "2026-10-12",
  summary: "A foldable phone, live in the browser",
  path: "/projects/device-intro",
};

const PROJECT_DAY = "October 12, 2026";

test.describe("with javascript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the project list shows the project", async ({ page }) => {
    await page.goto("/projects");
    const card = page.locator("#page .project-card");
    await expect(card).toHaveCount(1);
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

  test("the project page renders the file", async ({ page }) => {
    await page.goto(PROJECT.path);
    await expect(page.locator("#page h1")).toHaveText(PROJECT.title);
    await expect(page.locator("#page .sheet h1")).toHaveText(PROJECT.title);
    await expect(page.locator("#page .sheet time")).toHaveText(PROJECT_DAY);
    await expect(page.locator("#page .sheet time")).toHaveAttribute(
      "datetime",
      PROJECT.date,
    );
    await expect(page.locator("#page .column")).toContainText(
      "Hands take out an iPhone Duo and unfold it",
    );
  });

  test("the project page shows its title in the sheet and no toolbar without links", async ({
    page,
  }) => {
    await page.goto(PROJECT.path);
    await expect(page.locator("#page .large-title")).toHaveCount(0);
    await expect(page.locator("#page .toolbar")).toHaveCount(0);
    await expect(page.locator("#page .hero")).toHaveCount(0);
  });

  test("a project with no image starts its sheet under the bar", async ({
    page,
  }) => {
    await page.goto(PROJECT.path);
    const gap = await page.evaluate(() => {
      const body = document.querySelector("#page > .body")!;
      const sheet = document.querySelector("#page .sheet")!;
      return (
        sheet.getBoundingClientRect().top - body.getBoundingClientRect().top
      );
    });
    expect(gap).toBeLessThanOrEqual(120);
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
      tile.locator('a[href="/blog/old-posts-are-coming-back"]'),
    ).toContainText("Old posts are coming back");
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
