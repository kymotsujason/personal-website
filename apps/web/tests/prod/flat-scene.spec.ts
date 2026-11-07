// the 2d scene's folds, apps, and navigations, against the capture build (window.__flat, src/flat/probeHook.js)
import { expect, test, type Page } from "@playwright/test";
import { stubHome } from "../stubHome";
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
  await page
    .locator('.flat-home .app-icon[data-app="About"]')
    .click({ force: true });
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
  await page
    .locator('.flat-home .app-icon[data-app="About"]')
    .click({ force: true });
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
  await page
    .locator('.flat-home .app-icon[data-app="About"]')
    .click({ force: true });
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
      const volume = await fetch(
        `/flat/volume-portrait-${lighting}-${size}/manifest.json`,
      ).then((r) => r.json());
      return {
        shown: w.__framesAtShown,
        // the volume buttons' pressed pictures decode with the two sets too
        both:
          w.__flat.manifest.frames.length +
          closing.frames.length +
          volume.frames.length,
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
    await page
      .locator('.flat-home .app-icon[data-app="About"]')
      .click({ force: true });
    await settledOn(page, "/about", "About");
    const shown: { z: string; clip: string }[] = await page.evaluate(
      () => (window as any).__page,
    );
    expect(shown.some((p) => p.z === "1")).toBe(true);
    expect(shown.filter((p) => p.clip !== "")).toEqual([]);
  });
});

test.describe("continuous effects", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  type Effects = {
    yaw: number;
    pitch: number;
    targetYaw: number;
    targetPitch: number;
    avoidX: number;
    avoidY: number;
    idle: number;
    calm: boolean;
    judged: boolean;
    verdict: "fast" | "slow" | null;
    frosted: boolean;
  };

  const effects = (page: Page): Promise<Effects> =>
    page.evaluate(() => (window as any).__flat.effects());

  // the phone closed and still, with the cover live
  const closePhone = async (page: Page) => {
    await page.goto("/");
    await settledOn(page, "/", null);
    await page.keyboard.press("Escape");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "closed", busy: false, fold: 1 });
  };

  // a drag from one point to another, in steps, with the pointer let go at the end
  const dragFrom = async (
    page: Page,
    from: [number, number],
    to: [number, number],
  ) => {
    const steps = 40;
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(
        from[0] + ((to[0] - from[0]) * i) / steps,
        from[1] + ((to[1] - from[1]) * i) / steps,
      );
    }
    await page.mouse.up();
  };

  test("a drag off the closed phone turns the desk", async ({ page }) => {
    await closePhone(page);
    const start = await effects(page);
    expect(start.yaw).toBe(0);
    // dragging right turns the view to the left, to the clamp the 3d desk has at 1280 by 800
    await dragFrom(page, [40, 400], [1240, 400]);
    await expect
      .poll(async () => (await effects(page)).yaw)
      .toBeCloseTo(-33.448, 2);
    await dragFrom(page, [1240, 400], [40, 400]);
    await dragFrom(page, [1240, 400], [40, 400]);
    await expect
      .poll(async () => (await effects(page)).yaw)
      .toBeCloseTo(43.89, 2);
    // down and up reach the pitch limits
    await dragFrom(page, [640, 790], [640, 10]);
    await expect
      .poll(async () => (await effects(page)).pitch)
      .toBeCloseTo(-23.1, 2);
    await dragFrom(page, [640, 10], [640, 790]);
    await dragFrom(page, [640, 10], [640, 790]);
    await expect
      .poll(async () => (await effects(page)).pitch)
      .toBeCloseTo(12.5, 2);
    // a press on the phone looks nowhere
    const before = await effects(page);
    await dragFrom(page, [640, 400], [700, 400]);
    expect((await effects(page)).targetYaw).toBe(before.targetYaw);
    // opening the phone brings the view back
    await page.keyboard.press("Enter");
    await settledOn(page, "/", null);
    await expect.poll(async () => (await effects(page)).yaw).toBeCloseTo(0, 2);
    expect((await effects(page)).pitch).toBeCloseTo(-0.9, 2);
  });

  test("the closed phone dodges a mouse and ignores touch", async ({
    page,
  }) => {
    await closePhone(page);
    await page.mouse.move(1200, 40);
    await expect
      .poll(async () => (await effects(page)).avoidX)
      .toBeLessThan(-5);
    // the mouse above the phone moves it down
    expect((await effects(page)).avoidY).toBeGreaterThan(0);
    // the mouse back over the phone lets it settle
    await page.mouse.move(640, 400);
    await expect
      .poll(async () => Math.abs((await effects(page)).avoidX))
      .toBeLessThan(0.5);
    // a touch pointer moving over the desk moves nothing
    await page.evaluate(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerType: "touch",
          clientX: 1200,
          clientY: 40,
          bubbles: true,
        }),
      );
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve(0))),
    );
    expect(Math.abs((await effects(page)).avoidX)).toBeLessThan(0.5);
    // with the phone open it doesn't dodge either
    await page.keyboard.press("Enter");
    await settledOn(page, "/", null);
    await page.mouse.move(1200, 40);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve(0))),
    );
    expect(Math.abs((await effects(page)).avoidX)).toBeLessThan(0.5);
  });

  // the unfold has played and the phone is open and still
  const unfolded = (page: Page) =>
    expect
      .poll(() => flatStatus(page), { timeout: 90000 })
      .toMatchObject({ phone: "open", busy: false, fold: 0 });

  // the rest rule has turned the drift, the rain's motion, and the frosted glass on
  const turnedOn = async (page: Page) => {
    await expect
      .poll(() => flatStatus(page), { timeout: 60000 })
      .not.toBeNull();
    await expect
      .poll(async () => (await effects(page)).calm, { timeout: 60000 })
      .toBe(false);
  };

  // everything the rule holds back is held back
  const stillCalm = async (page: Page) => {
    const now = await effects(page);
    expect(now.calm).toBe(true);
    expect(now.frosted).toBe(false);
    expect(now.idle).toBe(0);
    await expect(page.locator(".flat-fall[data-still]")).toHaveCount(3);
    await expect(page.locator(".flat-face.frosted")).toHaveCount(0);
  };

  test("the phone drifts at rest and the drift settles once it moves", async ({
    page,
  }) => {
    await page.goto("/");
    await settledOn(page, "/", null);
    await turnedOn(page);
    await expect.poll(async () => (await effects(page)).idle).toBe(1);
    const transforms = await page.evaluate(async () => {
      const el = document.querySelector(".flat-frames") as HTMLElement;
      const seen = new Set<string>();
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(0)));
        seen.add(el.style.transform);
      }
      return seen.size;
    });
    expect(transforms).toBeGreaterThan(5);
    await page.keyboard.press("Escape");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "closed", busy: false });
    // once it's at rest again it eases back in, and in an app it stays still with no frames asked for
    await expect.poll(async () => (await effects(page)).idle).toBe(1);
    await page.keyboard.press("Enter");
    await settledOn(page, "/", null);
    await page
      .locator('.flat-home .app-icon[data-app="About"]')
      .click({ force: true });
    await settledOn(page, "/about", "About");
    expect((await effects(page)).idle).toBe(0);
  });

  const RAIN = {
    weather: {
      code: 63,
      sunrise: 7.5,
      sunset: 18.4,
      utcOffset: -25200,
      moon: null,
    },
    github: null,
  };

  test("rain falls on the screens' sky under a rainy weather", async ({
    page,
  }) => {
    await stubHome(page, RAIN);
    await page.goto("/");
    await settledOn(page, "/", null);
    await turnedOn(page);
    await expect(page.locator(".flat-fall[data-kind='rain']")).toHaveCount(3);
    const falling = await page.evaluate(() => {
      const layer = document.querySelector(".flat-fall i") as HTMLElement;
      return {
        still: document.querySelector(".flat-fall")!.hasAttribute("data-still"),
        state: getComputedStyle(layer).animationPlayState,
        animations: layer.getAnimations().length,
        // under the widgets in the sky, which is before the panels in the face
        beforePanel:
          document.querySelector(".flat-fall")!.parentElement!.className ===
          "flat-sky",
      };
    });
    expect(falling).toEqual({
      still: false,
      state: "running",
      animations: 1,
      beforePanel: true,
    });
    await page.screenshot({ path: "test-results/flat-rain.png" });
  });

  test("snow falls under a snowy weather", async ({ page }) => {
    await stubHome(page, {
      ...RAIN,
      weather: { ...RAIN.weather, code: 73 },
    });
    await page.goto("/");
    await settledOn(page, "/", null);
    await expect(page.locator(".flat-fall[data-kind='snow']")).toHaveCount(3);
  });

  test("a clear sky has no fall", async ({ page }) => {
    await page.goto("/");
    await settledOn(page, "/", null);
    await expect(page.locator(".flat-fall:not([hidden])")).toHaveCount(0);
  });

  test.describe("the rest rule", () => {
    test("a full size device stays calm when the unfold is slow", async ({
      page,
    }) => {
      await page.addInitScript(() => localStorage.removeItem("introSeen"));
      await stubHome(page, RAIN);
      const client = await page.context().newCDPSession(page);
      await client.send("Emulation.setCPUThrottlingRate", { rate: 20 });
      await page.goto("/");
      await unfolded(page);
      // a throttled unfold may give too few frames to judge, and then the next opening folds are measured
      for (let i = 0; i < 3 && !(await effects(page)).judged; i++) {
        await page.keyboard.press("Escape");
        await expect
          .poll(() => flatStatus(page), { timeout: 90000 })
          .toMatchObject({ phone: "closed", busy: false });
        await page.keyboard.press("Enter");
        await unfolded(page);
      }
      await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      expect(await effects(page)).toMatchObject({
        judged: true,
        verdict: "slow",
      });
      await stillCalm(page);
    });

    test("a full size device turns things on once the unfold measures fast", async ({
      page,
    }) => {
      await page.addInitScript(() => localStorage.removeItem("introSeen"));
      await stubHome(page, RAIN);
      await page.goto("/");
      await turnedOn(page);
      expect(await effects(page)).toMatchObject({
        judged: true,
        verdict: "fast",
      });
      await expect.poll(async () => (await effects(page)).idle).toBe(1);
      await expect(page.locator(".flat-fall[data-still]")).toHaveCount(0);
      await expect(page.locator(".flat-face.frosted")).toHaveCount(3);
    });

    test("a page arrival stays calm until an opening fold is measured, and a close alone doesn't judge", async ({
      page,
    }) => {
      await stubHome(page, RAIN);
      await page.goto("/about");
      await settledOn(page, "/about", "About");
      // a reload of an app's page is the arrival with no intro (head.js arrivalFor)
      await page.reload();
      await settledOn(page, "/about", "About");
      expect(await effects(page)).toMatchObject({
        calm: true,
        judged: false,
      });
      // out of the app, then the phone closes: neither is an opening fold
      await page.keyboard.press("Escape");
      await settledOn(page, "/", null);
      await page.keyboard.press("Escape");
      await expect
        .poll(() => flatStatus(page))
        .toMatchObject({ phone: "closed", busy: false });
      expect(await effects(page)).toMatchObject({
        calm: true,
        judged: false,
      });
      await page.keyboard.press("Enter");
      await unfolded(page);
      await turnedOn(page);
      expect(await effects(page)).toMatchObject({
        judged: true,
        verdict: "fast",
      });
    });

    test("with reduced motion nothing is measured, so it stays calm for the visit", async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await stubHome(page, RAIN);
      await page.goto("/");
      await unfolded(page);
      await page.keyboard.press("Escape");
      await expect
        .poll(() => flatStatus(page))
        .toMatchObject({ phone: "closed", busy: false });
      await page.keyboard.press("Enter");
      await unfolded(page);
      expect(await effects(page)).toMatchObject({
        calm: true,
        judged: false,
      });
    });

    test("a device through 2dAuto stays calm even when the unfold is fast", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        localStorage.setItem("2dAuto", String(Date.now()));
        localStorage.removeItem("introSeen");
      });
      await stubHome(page, RAIN);
      await page.goto("/");
      await unfolded(page);
      // a fold after it, which a verdict could also have come from, changes nothing
      await page.keyboard.press("Escape");
      await expect
        .poll(() => flatStatus(page))
        .toMatchObject({ phone: "closed", busy: false });
      await page.keyboard.press("Enter");
      await unfolded(page);
      await stillCalm(page);
    });

    test.describe("at half size", () => {
      test.use({ viewport: { width: 640, height: 400 } });

      test("a device turns things on once the unfold measures fast", async ({
        page,
      }) => {
        await page.addInitScript(() => localStorage.removeItem("introSeen"));
        await stubHome(page, RAIN);
        await page.goto("/");
        await turnedOn(page);
        const size = await page.evaluate(
          () => (window as any).__flat.manifest.size,
        );
        expect(size).toBe("half");
        expect(await effects(page)).toMatchObject({
          judged: true,
          verdict: "fast",
        });
        await expect.poll(async () => (await effects(page)).idle).toBe(1);
        await expect(page.locator(".flat-face.frosted")).toHaveCount(3);
      });
    });
  });

  test("the status bar shows the clock and the battery on both screens", async ({
    page,
  }) => {
    await page.goto("/");
    await settledOn(page, "/", null);
    const bars = await page.evaluate(() => {
      return {
        times: [...document.querySelectorAll(".flat-face .status .time")].map(
          (el) => el.textContent,
        ),
        levels: [...document.querySelectorAll(".flat-face .battery")].map(
          (el) => Number((el as HTMLElement).dataset.level),
        ),
      };
    });
    expect(bars.times).toHaveLength(2);
    // the minute may have turned over between the two reads
    bars.times.forEach((time) => expect(time).toMatch(/^\d{1,2}:\d{2}$/));
    expect(bars.times[0]).toBe(bars.times[1]);
    bars.levels.forEach((level) => {
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(100);
    });
  });
});

test.describe("the volume buttons", () => {
  type Spot = { x: number; y: number };
  type VolumeState = {
    up: "near" | "far" | null;
    areas: { near: number[][]; far: number[][] } | null;
    sunk: { near: boolean; far: boolean };
  };

  const volumeState = (page: Page): Promise<VolumeState> =>
    page.evaluate(() => (window as any).__flat.volume());

  // the middle of a button's hull in window px, from the hit areas the scene is using now
  const spotOf = async (page: Page, which: "near" | "far"): Promise<Spot> => {
    const { areas } = await volumeState(page);
    expect(areas).not.toBeNull();
    const hull = areas![which];
    return {
      x: hull.reduce((sum, p) => sum + p[0], 0) / hull.length,
      y: hull.reduce((sum, p) => sum + p[1], 0) / hull.length,
    };
  };

  const savedLevel = (page: Page) =>
    page.evaluate(() => Number(localStorage.getItem("volumeLevel")));

  // which button is up follows the orientation, from the set's own manifest
  const upButton = async (page: Page): Promise<"near" | "far"> =>
    (await volumeState(page)).up!;

  const barOf = (page: Page, face: string) =>
    page.evaluate((name) => {
      const el = document.querySelector(`.flat-${name} .flat-volume`)!;
      const cs = getComputedStyle(el);
      return { visibility: cs.visibility, opacity: Number(cs.opacity) };
    }, face);

  // records, once per frame, whether a sunk picture showed and the rest frame had its box cut out
  const watchSink = (page: Page) =>
    page.evaluate(() => {
      const seen = { sunk: false, cut: false, done: false };
      (window as any).__seen = seen;
      const until = performance.now() + 700;
      const look = () => {
        const s = (window as any).__flat.volume();
        seen.sunk ||= s.sunk.near || s.sunk.far;
        seen.cut ||= s.cut;
        if (performance.now() < until) {
          requestAnimationFrame(look);
        } else {
          seen.done = true;
        }
      };
      requestAnimationFrame(look);
    });

  const sinkSeen = async (page: Page) => {
    await page.waitForFunction(() => (window as any).__seen.done);
    return page.evaluate(() => (window as any).__seen);
  };

  const press = async (page: Page, which: "near" | "far") => {
    const spot = await spotOf(page, which);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.up();
  };

  for (const [name, viewport] of [
    ["landscape", { width: 1280, height: 800 }],
    ["portrait", { width: 600, height: 900 }],
  ] as const) {
    test.describe(name, () => {
      test.use({ viewport });

      test("a press steps the volume and shows the bar", async ({ page }) => {
        await page.goto("/");
        await settledOn(page, "/", null);
        const up = await upButton(page);
        const down = up === "near" ? "far" : "near";
        await watchSink(page);
        await press(page, up);
        await expect.poll(() => savedLevel(page)).toBe(9);
        expect(await barOf(page, "home")).toEqual({
          visibility: "visible",
          opacity: 1,
        });
        // the cover's bar is on a face that is turned away while the phone is open
        await expect(page.locator(".flat-cover")).toBeHidden();
        const seen = await sinkSeen(page);
        expect(seen).toMatchObject({ sunk: true, cut: true });
        await press(page, down);
        await press(page, down);
        await expect.poll(() => savedLevel(page)).toBe(7);
        // the picture and the cut go once the press is over, and the bar after it fades
        await expect
          .poll(async () => (await volumeState(page)).sunk.near)
          .toBe(false);
        await expect
          .poll(async () => (await barOf(page, "home")).visibility, {
            timeout: 5000,
          })
          .toBe("hidden");
        expect(
          await page.evaluate(() => (window as any).__flat.volume().cut),
        ).toBe(false);
        // the press didn't start a fold
        expect(await flatStatus(page)).toMatchObject({
          phone: "open",
          fold: 0,
          busy: false,
        });
      });

      test("a press on a button starts no fold swipe and no look", async ({
        page,
      }) => {
        await page.goto("/");
        await settledOn(page, "/", null);
        await page.keyboard.press("Escape");
        await expect
          .poll(() => flatStatus(page))
          .toMatchObject({ phone: "closed", busy: false, fold: 1 });
        await expect
          .poll(async () => (await volumeState(page)).areas !== null)
          .toBe(true);
        const spot = await spotOf(page, "near");
        await page.mouse.move(spot.x, spot.y);
        await page.mouse.down();
        for (let i = 1; i <= 20; i++) {
          await page.mouse.move(spot.x - i * 12, spot.y + i * 3);
        }
        await page.mouse.up();
        const view = await page.evaluate(() => {
          const e = (window as any).__flat.effects();
          return { yaw: e.targetYaw, pitch: e.targetPitch };
        });
        expect(view).toEqual({ yaw: 0, pitch: expect.any(Number) });
        expect(await flatStatus(page)).toMatchObject({
          phone: "closed",
          fold: 1,
          busy: false,
        });
        await expect(page.locator("body")).not.toHaveClass(/looking/);
      });

      test("a press works closed, with the bar on the cover and no sink", async ({
        page,
      }) => {
        await page.goto("/");
        await settledOn(page, "/", null);
        await page.keyboard.press("Escape");
        await expect
          .poll(() => flatStatus(page))
          .toMatchObject({ phone: "closed", busy: false, fold: 1 });
        const up = await upButton(page);
        await expect
          .poll(async () => (await volumeState(page)).areas !== null)
          .toBe(true);
        await watchSink(page);
        await press(page, up);
        await expect.poll(() => savedLevel(page)).toBe(9);
        expect(await barOf(page, "cover")).toEqual({
          visibility: "visible",
          opacity: 1,
        });
        const seen = await sinkSeen(page);
        expect(seen).toMatchObject({ sunk: false, cut: false });
        await expect(page.locator(".flat-cover")).toBeVisible();
      });

      test("a press works while the phone moves", async ({ page }) => {
        await page.goto("/");
        await settledOn(page, "/", null);
        await page.keyboard.press("Escape");
        await expect
          .poll(() => flatStatus(page))
          .toMatchObject({ phone: "closed", busy: false, fold: 1 });
        await page.keyboard.press("Enter");
        // a press in the same task as a read of the areas, partway through the unfold, so the phone can't move between
        const result = await page.evaluate(async () => {
          const hook = (window as any).__flat;
          const wait = () => new Promise((r) => requestAnimationFrame(r));
          while (hook.status().fold > 0.6 || !hook.status().busy) {
            await wait();
          }
          const { areas } = hook.volume();
          const hull = areas.far;
          const x =
            hull.reduce((s: number, p: number[]) => s + p[0], 0) / hull.length;
          const y =
            hull.reduce((s: number, p: number[]) => s + p[1], 0) / hull.length;
          const before = Number(localStorage.getItem("volumeLevel"));
          window.dispatchEvent(
            new PointerEvent("pointerdown", {
              clientX: x,
              clientY: y,
              pointerType: "mouse",
              bubbles: true,
              cancelable: true,
            }),
          );
          return {
            before,
            after: Number(localStorage.getItem("volumeLevel")),
            fold: hook.status().fold,
            busy: hook.status().busy,
            sunk: hook.volume().sunk,
          };
        });
        expect(result.busy).toBe(true);
        expect(result.fold).toBeGreaterThan(0);
        expect(result.fold).toBeLessThan(1);
        expect(Math.abs(result.after - 8)).toBe(1);
        // the sink isn't drawn while it moves
        expect(result.sunk).toEqual({ near: false, far: false });
        await settledOn(page, "/", null);
      });
    });
  }
});
