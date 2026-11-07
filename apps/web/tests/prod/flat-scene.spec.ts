// the 2d scene's folds, apps, and navigations, against the capture build (window.__flat, src/flat/probeHook.js)
import { expect, test, type Page } from "@playwright/test";
import { quiet } from "./scene";

type FlatStatus = {
  phone: string | null;
  busy: boolean;
  zoomed: boolean;
  app: string | null;
  fold: number;
  path: string;
  pageApp: string | undefined;
};

const flatStatus = (page: Page): Promise<FlatStatus | null> =>
  page.evaluate(() => {
    const hook = (window as any).__flat;
    if (!hook || !hook.status) {
      return null;
    }
    const s = hook.status();
    return {
      phone: s.phone,
      busy: s.busy,
      zoomed: s.zoomed,
      app: s.app,
      fold: s.fold,
      path: location.pathname,
      pageApp: document.getElementById("page")?.dataset.app,
    };
  });

// the phone open and still on the home screen (app null) or with the app open at full zoom, at the path given
const settledOn = async (page: Page, path: string, app: string | null) => {
  await expect
    .poll(() => flatStatus(page), { timeout: 20000 })
    .toMatchObject({
      phone: "open",
      busy: false,
      zoomed: app !== null,
      app,
      path,
      pageApp: app ?? "home",
    });
};

// the 2d scene, chosen with the 2d link, as a returning visit so the fast intro plays
const flatScene = async (page: Page) => {
  await quiet(page);
  await page.addInitScript(() => {
    localStorage.setItem("2d", "1");
    localStorage.setItem("introSeen", "1");
  });
};

test.beforeEach(async ({ page }) => {
  await flatScene(page);
});

test("Escape and Enter fold and unfold", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/has-flat-scene/);
  await settledOn(page, "/", null);
  await page.keyboard.press("Escape");
  await expect
    .poll(() => flatStatus(page))
    .toMatchObject({ phone: "closed", busy: false, fold: 1 });
  await expect(page.locator(".flat-cover")).toBeVisible();
  await expect(page.locator(".flat-cover")).not.toHaveAttribute("inert");
  await expect(page.locator(".flat-home")).toHaveAttribute("inert");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => flatStatus(page))
    .toMatchObject({ phone: "open", busy: false, fold: 0 });
  await expect(page.locator(".flat-home")).not.toHaveAttribute("inert");
});

test("a tap on an icon opens the app and Back closes it", async ({ page }) => {
  await page.goto("/");
  await settledOn(page, "/", null);
  await page.locator('.flat-home .app-icon[data-app="About"]').click();
  await settledOn(page, "/about", "About");
  await expect(page.locator("#page h1")).toHaveText("About");
  await expect(page.locator("#page h1")).toBeVisible();
  // at full zoom #page is the flat page, with no transform or clip left on it
  const shown = await page.evaluate(() => {
    const el = document.getElementById("page")!;
    const cs = getComputedStyle(el);
    return {
      transform: cs.transform,
      clip: cs.clipPath,
      pinned: document.documentElement.classList.contains("page-pinned"),
    };
  });
  expect(shown).toEqual({ transform: "none", clip: "none", pinned: false });
  await page.goBack();
  await settledOn(page, "/", null);
  await expect(page.locator("#page")).toBeHidden();
});

test("rapid history", async ({ page }) => {
  await page.goto("/");
  await settledOn(page, "/", null);
  await page.locator('.flat-home .app-icon[data-app="About"]').click();
  await settledOn(page, "/about", "About");
  // a link in About to Music, as the apps link to each other
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/music";
    link.id = "test-link";
    link.textContent = "a link";
    document.querySelector("#page .column")!.prepend(link);
  });
  await page.locator("#test-link").click();
  await settledOn(page, "/music", "Music");
  // Back, Back, and Forward within 200 ms, while each navigation is still playing
  await page.evaluate(async () => {
    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    history.back();
    await wait(80);
    history.back();
    await wait(80);
    history.forward();
  });
  await expect(page).toHaveURL((url) => url.pathname === "/about");
  await settledOn(page, "/about", "About");
  await expect(page.locator("#page h1")).toHaveText("About");
});

test("a resting swipe opens the switcher and Escape returns", async ({
  page,
}) => {
  await page.goto("/");
  await settledOn(page, "/", null);
  await page.locator('.flat-home .app-icon[data-app="About"]').click();
  await settledOn(page, "/about", "About");
  const bar = await page.locator("#page .home-bar").boundingBox();
  expect(bar).not.toBeNull();
  const x = bar!.x + bar!.width / 2;
  const y = bar!.y + bar!.height / 2;
  // pulled up a fifth of the window and held there, still pressed
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 160, { steps: 16 });
  await expect
    .poll(() => page.evaluate(() => (window as any).__flat.status().switcher))
    .toBe(true);
  await page.mouse.up();
  // the cards come in over the darkened backdrop, each with its label, and #page rides the open app's card, clipped
  await expect(page.locator(".flat-backdrop")).toBeVisible();
  await expect(page.locator(".flat-card-label:visible")).toHaveCount(4);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".flat-card-label")].map(
          (el) => el.style.opacity,
        ),
      ),
    )
    .toEqual(["1", "1", "1", "1"]);
  const pinned = await page.evaluate(() => {
    const el = document.getElementById("page")!;
    return { transform: el.style.transform, clip: el.style.clipPath };
  });
  expect(pinned.transform).not.toBe("");
  expect(pinned.clip).toMatch(/^inset\(/);
  await expect
    .poll(() => flatStatus(page))
    .toMatchObject({ busy: true, zoomed: true, path: "/about" });
  await page.keyboard.press("Escape");
  await settledOn(page, "/about", "About");
  await expect
    .poll(() => page.evaluate(() => (window as any).__flat.status().switcher))
    .toBe(false);
  await expect(page.locator(".flat-cards")).toBeHidden();
  await expect(page.locator(".flat-backdrop")).toBeHidden();
  await expect(page.locator("#page h1")).toHaveText("About");
});

test("one frame per paint during an unfold", async ({ page }) => {
  await page.goto("/");
  await settledOn(page, "/", null);
  await page.keyboard.press("Escape");
  await expect
    .poll(() => flatStatus(page))
    .toMatchObject({ phone: "closed", busy: false });
  await page.evaluate(() => {
    const w = window as any;
    w.__samples = [];
    const sample = () => {
      const on = [...document.querySelectorAll(".flat-frame.on")];
      const all = [...document.querySelectorAll(".flat-frame")];
      const s = w.__flat.status();
      w.__samples.push({
        on: on.length,
        index: on.length === 1 ? all.indexOf(on[0]) : -1,
        fold: s.fold,
        busy: s.busy,
        phone: s.phone,
      });
      if (w.__samples.length < 400 && !(s.phone === "open" && !s.busy)) {
        requestAnimationFrame(sample);
      }
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.press("Enter");
  await settledOn(page, "/", null);
  const samples: { on: number; index: number; fold: number }[] =
    await page.evaluate(() => (window as any).__samples);
  expect(samples.length).toBeGreaterThan(30);
  for (const [i, s] of samples.entries()) {
    expect(s.on, `frames on at sample ${i}`).toBe(1);
  }
  // the unfold steps forward through the frames, one at a time per paint, and never back
  const indexes = samples.map((s) => s.index);
  for (let i = 1; i < indexes.length; i++) {
    expect(indexes[i]).toBeGreaterThanOrEqual(indexes[i - 1]);
  }
  expect(new Set(indexes).size).toBeGreaterThan(20);
});

test.describe("in a portrait window", () => {
  test.use({ viewport: { width: 600, height: 900 } });

  test("the closing set decodes with the opening one, before the first frame", async ({
    page,
  }) => {
    // the frames in the layer at the moment the first frame shows
    await page.addInitScript(() => {
      const w = window as any;
      const look = () => {
        if (w.__flatShown && w.__framesAtShown === undefined) {
          w.__framesAtShown =
            document.querySelector(".flat-frames")?.children.length ?? 0;
          return;
        }
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await page.goto("/");
    await settledOn(page, "/", null);
    const counts = await page.evaluate(async () => {
      const w = window as any;
      const { lighting, size } = w.__flat.manifest;
      const closing = await fetch(
        `/flat/portrait-close-${lighting}-${size}/manifest.json`,
      ).then((r) => r.json());
      return {
        shown: w.__framesAtShown,
        both: w.__flat.manifest.frames.length + closing.frames.length,
        opening: w.__flat.manifest.frames.length,
      };
    });
    expect(counts.shown).toBe(counts.both);
    // a close plays on the closing set's frames, which come after the opening set's in the layer
    await page.keyboard.press("Escape");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "closed", busy: false });
    const on = await page.evaluate(() =>
      [...document.querySelectorAll(".flat-frame")].findIndex((el) =>
        el.classList.contains("on"),
      ),
    );
    expect(on).toBeGreaterThanOrEqual(counts.opening);
  });
});

test.describe("on the slow path", () => {
  test.beforeEach(async ({ page }) => {
    // the 3d scene sent this device here for being slow
    await page.addInitScript(() =>
      localStorage.setItem("2dAuto", String(Date.now())),
    );
  });

  test("the screens show their picture while moving, and apps crossfade", async ({
    page,
  }) => {
    await page.goto("/");
    await settledOn(page, "/", null);
    await expect(page.locator(".flat-face.pictured")).toHaveCount(0);
    await page.evaluate(() => {
      const w = window as any;
      w.__pictured = [];
      const look = () => {
        w.__pictured.push(
          document.querySelectorAll(".flat-face.pictured").length,
        );
        const s = w.__flat.status();
        if (w.__pictured.length < 200 && !(s.phone === "closed" && !s.busy)) {
          requestAnimationFrame(look);
        }
      };
      requestAnimationFrame(look);
    });
    await page.keyboard.press("Escape");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "closed", busy: false });
    const pictured: number[] = await page.evaluate(
      () => (window as any).__pictured,
    );
    expect(Math.max(...pictured), "pictured while folding").toBe(3);
    await expect(page.locator(".flat-face.pictured")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await settledOn(page, "/", null);
    // the open fades #page in over the phone, in front with the apps' background, and never clips it
    await page.evaluate(() => {
      const w = window as any;
      w.__page = [];
      const look = () => {
        const el = document.getElementById("page")!;
        w.__page.push({ z: el.style.zIndex, clip: el.style.clipPath });
        const s = w.__flat.status();
        if (w.__page.length < 200 && !(s.zoomed && !s.busy)) {
          requestAnimationFrame(look);
        }
      };
      requestAnimationFrame(look);
    });
    await page.locator('.flat-home .app-icon[data-app="About"]').click();
    await settledOn(page, "/about", "About");
    const shown: { z: string; clip: string }[] = await page.evaluate(
      () => (window as any).__page,
    );
    expect(shown.some((p) => p.z === "1")).toBe(true);
    expect(shown.filter((p) => p.clip !== "")).toEqual([]);
  });
});
