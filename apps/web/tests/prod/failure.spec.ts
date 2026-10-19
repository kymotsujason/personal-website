// each way the scene can fail ends on the flat page with its content and scroll, and logs no error. runs against the
// capture build (playwright.config.ts builds the prod preview with CAPTURE=1), whose window.__capture reads the
// phone's state and throws in a frame on request
import { expect, test, type Page } from "@playwright/test";
import {
  expectFlatPage,
  quiet,
  scrollPage,
  settledOn,
  tapIcon,
  watchErrors,
  SCROLL,
} from "./scene";

const isSceneChunk = (body: string) => body.includes("the scene failed");

// a request held until the test lets it go, so the test can scroll the page before the failure lands
const gate = () => {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};

const failedAt = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __failedAt?: number }).__failedAt,
  );

test.beforeEach(async ({ page }) => {
  await quiet(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __failedAt?: number; __frames: number };
    // the moment scene-failed lands, in the page's own clock. the init script runs before <html> exists, so it
    // watches the whole document
    new MutationObserver(() => {
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
    // every animation frame the page asks for, so a scene still running shows up as a growing count. the layout's
    // depth input asks for its own on a scroll or a pointer move, and that isn't the scene, and it marks the callback
    w.__frames = 0;
    const ask = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      if (!(callback as unknown as { layout?: boolean }).layout) {
        w.__frames += 1;
      }
      return ask(callback);
    };
  });
});

// the scene asks for no more frames and has let go of its webgl context
const expectStopped = async (page: Page) => {
  const frames = () =>
    page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  const before = await frames();
  await page.waitForTimeout(1000);
  expect(await frames(), "no frames asked for after the failure").toBe(before);
  const lost = await page.evaluate(() => {
    const canvas = document.getElementById("gl-layer") as HTMLCanvasElement;
    const gl = canvas.getContext("webgl2");
    return gl ? gl.isContextLost() : null;
  });
  expect(lost, "the webgl context is released").toBe(true);
};

test("a blocked scene chunk leaves the flat page", async ({ page }) => {
  const { errors, blocked } = watchErrors(page);
  const held = gate();
  let asked = 0;
  await page.route("**/_astro/*.js", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (!isSceneChunk(body)) {
      await route.fulfill({ response, body });
      return;
    }
    blocked.add(route.request().url());
    asked += 1;
    // the first refusal makes the layout load the page again once, as it would after a deploy, and the second
    // waits until the page is scrolled
    if (asked > 1) {
      await held.opened;
    }
    await route.abort();
  });
  await page.goto("/about");
  await expect.poll(() => asked).toBe(2);
  await scrollPage(page);
  held.open();
  await expectFlatPage(page, "About");
  expect(errors).toEqual([]);
});

// the scene chunk's request, held until the test lets it go and then refused, and the number of times it was asked for
const holdSceneChunk = async (page: Page, blocked: Set<string>) => {
  const held = gate();
  const counts = { asked: 0 };
  await page.route("**/_astro/*.js", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (!isSceneChunk(body)) {
      await route.fulfill({ response, body });
      return;
    }
    blocked.add(route.request().url());
    counts.asked += 1;
    await held.opened;
    await route.abort();
  });
  return { held, counts };
};

// the layout has heard that the scene's import failed, and a reload it started would have begun
const importFailed = (page: Page) =>
  page.waitForEvent("console", {
    predicate: (message) => message.text().includes("the scene didn't load"),
    timeout: 15000,
  });

test("a scene chunk that fails after the watchdog doesn't reload the page", async ({
  page,
}) => {
  test.setTimeout(60000);
  const { errors, blocked } = watchErrors(page);
  const { held, counts } = await holdSceneChunk(page, blocked);
  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });
  await page.goto("/about");
  await expect.poll(() => counts.asked).toBe(1);
  await expect(page.locator("html")).toHaveClass(/scene-failed/, {
    timeout: 15000,
  });
  await scrollPage(page);
  const failed = importFailed(page);
  held.open();
  await failed;
  await page.waitForTimeout(1000);
  expect(loads, "no reload").toBe(1);
  expect(counts.asked).toBe(1);
  await expectFlatPage(page, "About");
  expect(errors).toEqual([]);
});

test("a scene chunk that fails while offline doesn't reload the page", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const { errors, blocked } = watchErrors(page);
  const { held, counts } = await holdSceneChunk(page, blocked);
  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });
  await page.goto("/about");
  await expect.poll(() => counts.asked).toBe(1);
  await scrollPage(page);
  await context.setOffline(true);
  try {
    const failed = importFailed(page);
    held.open();
    await failed;
    await page.waitForTimeout(1000);
    expect(loads, "no reload").toBe(1);
    await expectFlatPage(page, "About");
  } finally {
    await context.setOffline(false);
  }
  // the flat page's blurred desk can't load while the browser is offline, which the browser logs as an error
  expect(
    errors.filter((text) => !text.includes("ERR_INTERNET_DISCONNECTED")),
  ).toEqual([]);
});

test("a blocked model request leaves the flat page", async ({ page }) => {
  const { errors, blocked } = watchErrors(page);
  const held = gate();
  await page.route("**/models/phone.packed.glb", async (route) => {
    blocked.add(route.request().url());
    await held.opened;
    await route.abort();
  });
  await page.goto("/about");
  await expect(page.locator("html")).toHaveClass(/has-3d/);
  await expect.poll(() => blocked.size).toBe(1);
  await scrollPage(page);
  held.open();
  await expectFlatPage(page, "About");
  expect(await failedAt(page), "before the watchdog").toBeLessThan(9000);
  await expectStopped(page);
  expect(errors).toEqual([]);
});

for (const route of [
  { path: "/about", heading: "About" },
  { path: "/", heading: "Jason Yue" },
]) {
  test(`a model request on ${route.path} that never answers fails by about 8 s`, async ({
    page,
  }) => {
    const { errors } = watchErrors(page);
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") {
        warnings.push(message.text());
      }
    });
    let asked = 0;
    await page.route("**/models/*.glb", () => {
      // left unanswered
      asked += 1;
    });
    await page.goto(route.path);
    await expect.poll(() => asked).toBeGreaterThan(0);
    await scrollPage(page);
    await expectFlatPage(page, route.heading);
    const at = await failedAt(page);
    expect(at, "after the model's 8 s").toBeGreaterThan(8000);
    expect(at, "before the head script's 10 s watchdog").toBeLessThan(10000);
    expect(
      warnings.some((w) => w.includes("timed out")),
      "the model's own timeout ended the wait",
    ).toBe(true);
    await expectStopped(page);
    expect(errors).toEqual([]);
  });
}

test("desk images at 64 kbit/s end as the 3d site or the flat page", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { errors } = watchErrors(page);
  await page.route(
    (url) => /^\/desk[^/]*\.(jpg|png)$/.test(url.pathname),
    async (route) => {
      const response = await route.fetch();
      const body = await response.body();
      // 64 kbit/s is 8000 bytes a second
      await new Promise((resolve) =>
        setTimeout(resolve, (body.length / 8000) * 1000),
      );
      await route.fulfill({ response, body }).catch(() => {});
    },
  );
  await page.goto("/about");
  await expect(page.locator("html")).toHaveClass(/has-3d/);
  await scrollPage(page);
  const ending = async () =>
    page.evaluate(() => {
      const root = document.documentElement;
      if (root.classList.contains("scene-failed")) {
        return "flat";
      }
      const capture = (window as any).__capture;
      const p = capture ? capture.pose() : null;
      return p && p.zoomed && !p.busy && p.app === "About" ? "3d" : "waiting";
    });
  await expect.poll(ending, { timeout: 60000 }).not.toBe("waiting");
  const ended = await ending();
  test.info().annotations.push({ type: "ending", description: ended });
  if (ended === "flat") {
    await expectFlatPage(page, "About");
  } else {
    await settledOn(page, "/about", "About");
    await expect(page.locator("#page")).toBeVisible();
    await expect(page.locator("#page h1")).toHaveText("About");
    await expect(page.locator("#page h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.querySelector("#page > .body")!.scrollTop,
      ),
    ).toBe(SCROLL);
  }
  expect(errors).toEqual([]);
});

test.describe("a frame that throws", () => {
  test("after the takeover with an app open leaves the flat page", async ({
    page,
  }) => {
    test.setTimeout(120000);
    const { errors } = watchErrors(page);
    await page.goto("/about");
    await settledOn(page, "/about", "About");
    // a reload of an app page shows it first, then the scene takes over at full zoom
    await page.reload();
    expect(await page.evaluate(() => (window as any).__arrival)).toBe("page");
    await page.waitForFunction(
      () => (window as unknown as { __sceneShown?: boolean }).__sceneShown,
    );
    await settledOn(page, "/about", "About");
    await scrollPage(page);
    await page.evaluate(() => (window as any).__capture.throwNextFrame());
    await expectFlatPage(page, "About");
    await expectStopped(page);
    expect(errors).toEqual([]);
  });

  test("on / with the home screen showing leaves the flat page", async ({
    page,
  }) => {
    test.setTimeout(120000);
    const { errors } = watchErrors(page);
    await page.goto("/");
    await settledOn(page, "/", null);
    await scrollPage(page);
    await page.evaluate(() => (window as any).__capture.throwNextFrame());
    await expectFlatPage(page, "Jason Yue");
    await expectStopped(page);
    // the status bar's timers ran on past a failure and drew into a screen that had gone. the battery ticks about
    // every 6 s while it drains, so this waits past one
    await page.waitForTimeout(7000);
    expect(errors).toEqual([]);
  });

  test("on / after a close leaves the flat page", async ({ page }) => {
    test.setTimeout(120000);
    const { errors } = watchErrors(page);
    await page.goto("/");
    await settledOn(page, "/", null);
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    await page.keyboard.press("Escape");
    await settledOn(page, "/", null);
    await expect(page.locator("#page h1")).toHaveText("Jason Yue");
    await scrollPage(page);
    await page.evaluate(() => (window as any).__capture.throwNextFrame());
    await expectFlatPage(page, "Jason Yue");
    await expectStopped(page);
    expect(errors).toEqual([]);
  });
});

test("an intro that throws once the page has faded in leaves the flat page", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { errors } = watchErrors(page);
  await page.goto("/", { waitUntil: "commit" });
  // set while the page is still black, so it throws as the intro starts to play
  const set = await page.waitForFunction(
    () => {
      const capture = (window as any).__capture;
      if (!capture) {
        return false;
      }
      if (document.body.classList.contains("ready")) {
        return "too late";
      }
      capture.throwInIntro();
      return "set";
    },
    null,
    { polling: "raf", timeout: 30000 },
  );
  expect(await set.jsonValue()).toBe("set");
  await expectFlatPage(page, "Jason Yue", { scrolled: false });
  await expectStopped(page);
  expect(errors).toEqual([]);
});

test("a frame that throws with the phone closed leaves no desk cursor", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { errors } = watchErrors(page);
  await page.goto("/");
  await settledOn(page, "/", null);
  await page.evaluate(() => (window as any).__capture.act("close"));
  await expect
    .poll(() => page.evaluate(() => document.body.className))
    .toMatch(/\bclosed\b/);
  // a drag over the desk and a hover over a volume button leave these two
  await page.evaluate(() =>
    document.body.classList.add("looking", "over-volume"),
  );
  await page.evaluate(() => (window as any).__capture.throwNextFrame());
  await expectFlatPage(page, "Jason Yue", { scrolled: false });
  const body = await page.evaluate(() => ({
    classes: ["closed", "looking", "over-volume"].filter((name) =>
      document.body.classList.contains(name),
    ),
    cursor: getComputedStyle(document.body).cursor,
  }));
  expect(body).toEqual({ classes: [], cursor: "auto" });
  expect(errors).toEqual([]);
});

test.describe("a lost webgl context", () => {
  const loseContext = (page: Page) =>
    page.evaluate(() => {
      const canvas = document.getElementById("gl-layer") as HTMLCanvasElement;
      canvas
        .getContext("webgl2")!
        .getExtension("WEBGL_lose_context")!
        .loseContext();
    });

  test("with an app open leaves the flat page", async ({ page }) => {
    test.setTimeout(120000);
    const { errors } = watchErrors(page);
    await page.goto("/about");
    await settledOn(page, "/about", "About");
    await scrollPage(page);
    await loseContext(page);
    await expectFlatPage(page, "About");
    await expectStopped(page);
    expect(errors).toEqual([]);
  });

  test("on / leaves the flat page", async ({ page }) => {
    test.setTimeout(120000);
    const { errors } = watchErrors(page);
    await page.goto("/");
    await settledOn(page, "/", null);
    await scrollPage(page);
    await loseContext(page);
    await expectFlatPage(page, "Jason Yue");
    await expectStopped(page);
    expect(errors).toEqual([]);
  });
});

test("a frame that throws mid open on /music leaves the player over the flat page's slot", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { errors } = watchErrors(page);
  await page.goto("/");
  await settledOn(page, "/", null);
  await tapIcon(page, "Music");
  // once the page has swapped in and the window is still growing
  await page.waitForFunction(
    () => {
      const capture = (window as any).__capture;
      if (location.pathname === "/music" && capture.pose().busy) {
        capture.throwNextFrame();
        return true;
      }
      return false;
    },
    null,
    { polling: "raf", timeout: 30000 },
  );
  await expectFlatPage(page, "Music", { scrolled: false });
  const boxes = await page.evaluate(() => {
    const round = (r: DOMRect) =>
      [r.left, r.top, r.width, r.height].map((v) => Math.round(v));
    return {
      host: round(
        document.getElementById("player-host")!.getBoundingClientRect(),
      ),
      slot: round(
        document.querySelector("#page .player-slot")!.getBoundingClientRect(),
      ),
    };
  });
  expect(boxes.host, "the player sits over the slot").toEqual(boxes.slot);
  expect(errors).toEqual([]);
});

test("after a failure the navigation drives no scene work", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { errors } = watchErrors(page);
  let youtube = 0;
  page.on("request", (request) => {
    if (request.url().includes("youtube.com/iframe_api")) {
      youtube += 1;
    }
  });
  await page.goto("/");
  await settledOn(page, "/", null);
  // a resize is waiting to rebuild the phone when the scene fails, which used to leave it looking pending for good
  await page.evaluate(() => {
    dispatchEvent(new Event("resize"));
    (window as any).__capture.throwNextFrame();
  });
  await expectFlatPage(page, "Jason Yue", { scrolled: false });
  await expectStopped(page);
  const before = await page.evaluate(() => ({
    frames: (window as unknown as { __frames: number }).__frames,
    pose: (({ phone, busy, zoomed, app }) => ({ phone, busy, zoomed, app }))(
      (window as any).__capture.pose(),
    ),
  }));
  await page.locator('#page .app-icon[href="/music"]').click();
  await expect(page.locator("#page h1")).toHaveText("Music");
  await page.goBack();
  await expect(page.locator("#page h1")).toHaveText("Jason Yue");
  await page.goForward();
  await expect(page.locator("#page h1")).toHaveText("Music");
  // past the music player's 250 ms wait for a still phone
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({
    frames: (window as unknown as { __frames: number }).__frames,
    pose: (({ phone, busy, zoomed, app }) => ({ phone, busy, zoomed, app }))(
      (window as any).__capture.pose(),
    ),
  }));
  expect(after.pose, "the phone's state didn't move").toEqual(before.pose);
  expect(after.frames, "no frames asked for").toBe(before.frames);
  // the layout's music loads it on the flat site, so the frames and the pose show the scene did nothing
  expect(youtube, "youtube's script loaded once, by the layout").toBe(1);
  await expectFlatPage(page, "Music", { scrolled: false });
  expect(errors).toEqual([]);
});
