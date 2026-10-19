import { expect, test, type Page } from "@playwright/test";
import { stubHome } from "../stubHome";
import { settledOn, stubArt } from "./scene";

const ROUTES = [
  { path: "/", heading: "Jason Yue" },
  { path: "/about", heading: "About" },
  { path: "/projects", heading: "Projects" },
  { path: "/projects/device-intro", heading: "Device intro" },
  { path: "/blog", heading: "Blog" },
  { path: "/music", heading: "Music" },
];

// the scene's requests that leave the preview are answered here, so no test waits on the network
const quiet = async (page: Page) => {
  await stubHome(page);
  await stubArt(page);
};

const isSceneChunk = (body: string) => body.includes("the scene failed");

test.describe("with javascript off", () => {
  test.use({ javaScriptEnabled: false });

  for (const route of ROUTES) {
    test(`${route.path} shows its heading`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.locator("html")).not.toHaveClass(/has-3d/);
      const heading = page.locator("#page h1");
      await expect(heading).toHaveText(route.heading);
      await expect(heading).toBeVisible();
    });
  }

  // visitors took a while to find their way home, so every app page has a home button: before the large title on an
  // app's own page, and opposite a detail page's back pill
  test("an app page links home beside its title or its back pill", async ({
    page,
  }) => {
    await page.goto("/about");
    const beside = page.locator("#page .title-row a.home-link");
    await expect(beside).toHaveAccessibleName("Home");
    await expect(beside).toHaveAttribute("href", "/");
    await expect(beside).toBeVisible();
    await expect(page.locator("#page .title-row h1")).toHaveText("About");
    await page.goto("/projects/device-intro");
    await expect(page.locator("#page > header a.back")).toHaveText("Projects");
    const round = page.locator("#page > header a.home-icon");
    await expect(round).toHaveAttribute("href", "/");
    await expect(round).toHaveAccessibleName("Home");
    await round.click();
    await expect(page.locator("#page h1")).toHaveText("Jason Yue");
  });

  test("an unknown address shows the not found page", async ({ page }) => {
    const response = await page.goto("/nothing-here");
    expect(response?.status()).toBe(404);
    await expect(page.locator("#page h1")).toHaveText(
      "No connection to this page",
    );
    await expect(page.locator("#page h1")).toBeVisible();
  });
});

test("without webgl every route is the flat site", async ({
  playwright,
}, testInfo) => {
  const browser = await playwright.chromium.launch({
    args: ["--disable-webgl", "--disable-webgl2"],
  });
  try {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
    });
    const page = await context.newPage();
    await quiet(page);
    for (const route of ROUTES) {
      await page.goto(route.path);
      const webgl2 = await page.evaluate(() =>
        Boolean(document.createElement("canvas").getContext("webgl2")),
      );
      expect(webgl2, "the flags turned webgl2 off").toBe(false);
      await expect(page.locator("html")).not.toHaveClass(/has-3d/);
      await expect(page.locator("#page")).toBeVisible();
      await expect(page.locator("#page h1")).toHaveText(route.heading);
      await expect(page.locator("#page h1")).toBeVisible();
      await expect(page.locator("#gl-layer")).toBeHidden();
    }
  } finally {
    await browser.close();
  }
});

test.describe("when the scene chunk doesn't arrive", () => {
  test.beforeEach(async ({ page }) => {
    await quiet(page);
    // the moment scene-failed lands, in the page's own clock
    await page.addInitScript(() => {
      // the init script runs before <html> exists, so it watches the whole document
      new MutationObserver(() => {
        const w = window as unknown as { __failedAt?: number };
        const root = document.documentElement;
        if (
          root?.classList.contains("scene-failed") &&
          w.__failedAt === undefined
        ) {
          w.__failedAt = performance.now();
        }
      }).observe(document, {
        attributes: true,
        attributeFilter: ["class"],
        subtree: true,
      });
    });
  });

  test("a chunk that never answers fails over within 11 s", async ({
    page,
  }) => {
    let held = 0;
    await page.route("**/_astro/*.js", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (isSceneChunk(body)) {
        // left unanswered, so only the head script's watchdog can end the wait
        held += 1;
        return;
      }
      await route.fulfill({ response, body });
    });
    await page.goto("/about");
    await expect.poll(() => held).toBe(1);
    await expect(page.locator("html")).toHaveClass(/scene-failed/, {
      timeout: 11000,
    });
    const failedAt = await page.evaluate(
      () => (window as unknown as { __failedAt?: number }).__failedAt,
    );
    expect(failedAt).toBeGreaterThan(9000);
    expect(failedAt).toBeLessThan(11000);
    await expect(page.locator("html")).not.toHaveClass(/has-3d/);
    await expect(page.locator("#page")).toBeVisible();
    await expect(page.locator("#page h1")).toHaveText("About");
    await expect(page.locator("#page h1")).toBeVisible();
  });

  test("a chunk that fails to load fails over at once", async ({ page }) => {
    await page.route("**/_astro/*.js", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (isSceneChunk(body)) {
        await route.abort();
        return;
      }
      await route.fulfill({ response, body });
    });
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/scene-failed/, {
      timeout: 11000,
    });
    const failedAt = await page.evaluate(
      () => (window as unknown as { __failedAt?: number }).__failedAt,
    );
    expect(failedAt).toBeLessThan(5000);
    await expect(page.locator("#page")).toBeVisible();
    await expect(page.locator("#page h1")).toHaveText("Jason Yue");
    await expect(page.locator("#page h1")).toBeVisible();
  });
});

test("a scene whose models arrive after the watchdog stays stopped", async ({
  page,
}) => {
  test.setTimeout(60000);
  await quiet(page);
  // every animation frame the page asks for, so a scene that keeps running shows up as a growing count
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: number };
    w.__frames = 0;
    const ask = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      w.__frames += 1;
      return ask(callback);
    };
  });
  const held: (() => Promise<void>)[] = [];
  await page.route("**/models/*.glb", (route) => {
    held.push(() => route.continue());
  });
  await page.goto("/about");
  await expect(page.locator("html")).toHaveClass(/has-3d/);
  await expect.poll(() => held.length).toBe(2);
  await expect(page.locator("html")).toHaveClass(/scene-failed/, {
    timeout: 11000,
  });
  await Promise.all(held.map((release) => release()));
  // the models' arrival has had time to reach the scene
  await page.waitForTimeout(2000);
  const frames = () =>
    page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  const before = await frames();
  await page.waitForTimeout(1500);
  expect(await frames(), "no frames asked for after the release").toBe(before);
  await expect(page.locator("body")).not.toHaveClass(/ready/);
  // the scene stopped before it built the phone, instead of building it and failing later
  await expect(page.locator("#css-layer > *")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveClass(/has-3d/);
  await expect(page.locator("#page")).toBeVisible();
  await expect(page.locator("#page h1")).toHaveText("About");
  await expect(page.locator("#page h1")).toBeVisible();
});

type Sample = {
  at: number;
  sceneShown: boolean;
  pageFirst: boolean;
  visible: boolean;
  page: DOMRect;
  heading: DOMRect;
  transform: string;
};

// app pages to reload, including a nested one and a trailing slash, which both find their app by the first segment
const RELOADS = [
  { path: "/about", heading: "About" },
  { path: "/about/", heading: "About" },
  { path: "/projects/device-intro", heading: "Device intro" },
];

for (const route of RELOADS) {
  test(`a reload of ${route.path} shows it first, and the scene takes over in place`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await quiet(page);
    // a first visit plays the intro, then opens the address's app with #page on it
    await page.goto(route.path);
    await expect(page.locator("html")).toHaveClass(/has-3d/);
    await page.waitForFunction(
      () => (window as unknown as { __sceneShown?: boolean }).__sceneShown,
      null,
      { timeout: 60000 },
    );
    await expect(page.locator("#page h1")).toHaveText(route.heading);
    await expect(page.locator("#page h1")).toBeVisible({ timeout: 30000 });

    // every frame from the first paint until 30 frames after the scene shows, #page's box, its heading's box, its
    // transform, and whether it shows
    await page.addInitScript(() => {
      const w = window as unknown as {
        __sceneShown?: boolean;
        __samples?: Sample[];
        __shownFrames?: number;
      };
      w.__samples = [];
      w.__shownFrames = 0;
      const sample = () => {
        const pageEl = document.getElementById("page");
        const heading = pageEl?.querySelector("h1");
        if (pageEl && heading) {
          w.__samples!.push({
            at: performance.now(),
            sceneShown: Boolean(w.__sceneShown),
            pageFirst:
              document.documentElement.classList.contains("page-first"),
            visible:
              pageEl.checkVisibility({
                visibilityProperty: true,
                opacityProperty: true,
              }) && heading.getBoundingClientRect().height > 0,
            page: pageEl.getBoundingClientRect().toJSON(),
            heading: heading.getBoundingClientRect().toJSON(),
            transform: getComputedStyle(pageEl).transform,
          });
        }
        if (w.__sceneShown) {
          w.__shownFrames! += 1;
        }
        if (w.__shownFrames! < 30) {
          requestAnimationFrame(sample);
        }
      };
      requestAnimationFrame(sample);
    });
    await page.reload();
    await page.waitForFunction(
      () =>
        (window as unknown as { __shownFrames?: number }).__shownFrames! >= 30,
      null,
      { timeout: 60000 },
    );
    // once the scene covers the page, the blurred desk under it stops drawing
    await expect(page.locator("html")).not.toHaveClass(/page-first/);
    const samples = await page.evaluate(
      () => (window as unknown as { __samples: Sample[] }).__samples,
    );
    const first = samples.find((s) => s.visible);
    expect(first, "#page showed").toBeDefined();
    expect(first!.at).toBeLessThan(500);
    expect(first!.sceneShown).toBe(false);
    expect(first!.pageFirst, "the page showed first").toBe(true);
    const later = samples.slice(samples.indexOf(first!));
    expect(later.some((s) => s.sceneShown)).toBe(true);
    for (const s of later) {
      expect(s.visible, `#page shows at ${Math.round(s.at)} ms`).toBe(true);
      expect(s.transform, `no transform at ${Math.round(s.at)} ms`).toBe(
        "none",
      );
      expect(s.page).toEqual(first!.page);
      expect(s.heading).toEqual(first!.heading);
    }
  });
}

// the flat site, chosen with the 2d link, so the navigations below run without the scene
const flatSite = async (page: Page) => {
  await quiet(page);
  await page.addInitScript(() => localStorage.setItem("2d", "1"));
};

const bodyScroll = (page: Page) =>
  page.evaluate(() => document.querySelector("#page > .body")!.scrollTop);

// #page's .body scrolled to near its end, which a short window makes room for
const scrollNearEnd = async (page: Page) => {
  const top = await page.evaluate(() => {
    const body = document.querySelector("#page > .body")!;
    const room = body.scrollHeight - body.clientHeight;
    body.scrollTop = Math.min(200, room);
    return room >= 100 ? body.scrollTop : -1;
  });
  expect(top, "the page has room to scroll").toBeGreaterThan(0);
  return top;
};

test.describe("the page's scroll", () => {
  test.use({ viewport: { width: 1280, height: 300 } });

  test("Back returns to the place the page was left", async ({ page }) => {
    await flatSite(page);
    await page.goto("/about");
    const top = await scrollNearEnd(page);
    await page.locator("#page .home-bar").click();
    await expect(page.locator("#page h1")).toHaveText("Jason Yue");
    expect(await bodyScroll(page), "the next page starts at the top").toBe(0);
    await page.goBack();
    await expect(page.locator("#page h1")).toHaveText("About");
    await expect.poll(() => bodyScroll(page)).toBe(top);
    await page.goForward();
    await expect(page.locator("#page h1")).toHaveText("Jason Yue");
    expect(await bodyScroll(page)).toBe(0);
  });

  test("a reload keeps the place on the page", async ({ page }) => {
    await flatSite(page);
    await page.goto("/about");
    const top = await scrollNearEnd(page);
    // past the save that follows a scroll once it settles
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.locator("#page h1")).toHaveText("About");
    await expect.poll(() => bodyScroll(page)).toBe(top);
  });

  test("in 3d Back returns to the place the page was left", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await quiet(page);
    await page.goto("/about");
    await settledOn(page, "/about", "About");
    const top = await scrollNearEnd(page);
    await page.keyboard.press("Escape");
    await settledOn(page, "/", null);
    await page.goBack();
    await settledOn(page, "/about", "About");
    expect(await bodyScroll(page)).toBe(top);
  });
});

test("a page of another build with no reload left runs none of its scripts", async ({
  page,
}) => {
  await flatSite(page);
  // the one recovery reload for /about on that build has been used
  await page.addInitScript(() =>
    sessionStorage.setItem("recovery:/about:other-build", "used"),
  );
  await page.route(
    (url) => url.pathname === "/about",
    async (route) => {
      const response = await route.fetch();
      const body = (await response.text())
        .replace(
          /<meta name="build-id" content="[^"]*"/,
          '<meta name="build-id" content="other-build"',
        )
        .replace(/(<script[^>]* src="[^"]+)"/g, '$1?other-build"');
      await route.fulfill({ response, body });
    },
  );
  const otherScripts: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("?other-build")) {
      otherScripts.push(request.url());
    }
  });
  await page.goto("/");
  await page.evaluate(() => {
    (window as unknown as { __sameLoad: boolean }).__sameLoad = true;
  });
  await page.locator('#page .app-icon[href="/about"]').click();
  await expect(page.locator("#page h1")).toHaveText("About");
  await expect(page.locator("html")).toHaveClass(/scene-failed/);
  // the swap's scripts run after it, so this waits past them
  await page.waitForTimeout(1000);
  expect(
    await page.evaluate(
      () => (window as unknown as { __sameLoad?: boolean }).__sameLoad,
    ),
    "no reload",
  ).toBe(true);
  expect(otherScripts, "the other build's scripts").toEqual([]);
});

test.describe("the not found page", () => {
  test("shows as the flat site in a browser with 3d", async ({ page }) => {
    await quiet(page);
    const response = await page.goto("/blog/tag/old-ghost-tag");
    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).not.toHaveClass(/has-3d/);
    await expect(page.locator("#page h1")).toHaveText(
      "No connection to this page",
    );
    await expect(page.locator("#page h1")).toBeVisible();
    await expect(page.locator("#page .lost > p")).toHaveText(
      "There's nothing at this address.",
    );
    await expect(page.locator("#page .lost svg")).toBeVisible();
    await expect(page.locator("#page .lost a.pill.glass")).toHaveText([
      "Go home",
      "Read the blog",
    ]);
    await expect(page.locator("#page .lost a[data-astro-reload]")).toHaveCount(
      2,
    );
    const blog = page.locator('#page a[href="/blog"]');
    await expect(blog).toBeVisible();
    await expect(page.locator('head link[rel="preload"]')).toHaveCount(0);
    await expect(page.locator("#page .flat-footer a")).toHaveAttribute(
      "href",
      "/",
    );
    // the blog link is a full page load, so the scene comes back
    await blog.click();
    await expect(page).toHaveURL((url) => url.pathname === "/blog");
    await expect(page.locator("html")).toHaveClass(/has-3d/);
  });

  test("a link to it from a 3d page loads it as the flat site", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await quiet(page);
    await page.goto("/");
    await settledOn(page, "/", null);
    await page.evaluate(() => {
      (window as unknown as { __sameLoad: boolean }).__sameLoad = true;
      const link = document.createElement("a");
      link.href = "/blog/tag/old-ghost-tag";
      link.id = "test-link";
      link.textContent = "an old address";
      document.body.append(link);
      link.click();
    });
    await expect(page).toHaveURL(
      (url) => url.pathname === "/blog/tag/old-ghost-tag",
    );
    await expect(page.locator("#page h1")).toHaveText(
      "No connection to this page",
    );
    await expect(page.locator("#page h1")).toBeVisible();
    await expect(page.locator("html")).not.toHaveClass(/has-3d/);
    expect(
      await page.evaluate(
        () => (window as unknown as { __sameLoad?: boolean }).__sameLoad,
      ),
      "a full page load",
    ).toBeUndefined();
  });
});
