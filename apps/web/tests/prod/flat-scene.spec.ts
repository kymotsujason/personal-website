// the 2d scene's folds, apps, and navigations, against the capture build (window.__flat, src/flat/probeHook.js)
import { loadavg } from "node:os";
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

  test("the closing set joins after the intro, and a close then plays on it", async ({
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
        // the first frame has the opening set and the volume buttons' pressed pictures, and the closing set comes
        // once the intro is over, so a phone's first download is the opening set alone
        first: w.__flat.manifest.frames.length + volume.frames.length,
        all:
          w.__flat.manifest.frames.length +
          volume.frames.length +
          closing.frames.length,
      };
    });
    expect(counts.shown).toBe(counts.first);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.querySelector(".flat-frames")!.children.length,
          ),
        { timeout: 20000 },
      )
      .toBe(counts.all);
    // a close plays on the closing set's frames, which come after the opening set's and the buttons' in the layer
    await page.keyboard.press("Escape");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "closed", busy: false });
    const on = await page.evaluate(() =>
      [...document.querySelectorAll(".flat-frame")].findIndex((el) =>
        el.classList.contains("on"),
      ),
    );
    expect(on).toBeGreaterThanOrEqual(counts.first);
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
    drawing: boolean;
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
      await page.addInitScript(() => {
        localStorage.removeItem("introSeen");
        // the throttle is this test's slow device, which the last step would otherwise send to the flat page
        Object.assign(window, { __flatNoSlowStep: true });
      });
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
      // each time the rain starts moving, whether the loop was drawing yet, since a verdict can land before the
      // unfold ends and the rain waits for the loop as the frosted glass does
      await page.addInitScript(() => {
        const starts: boolean[] = [];
        (window as any).__rainStarts = starts;
        new MutationObserver((records) => {
          for (const record of records) {
            const el = record.target as Element;
            if (
              el.classList.contains("flat-fall") &&
              !el.hasAttribute("data-still")
            ) {
              starts.push((window as any).__flat?.effects().drawing ?? false);
            }
          }
        }).observe(document, {
          subtree: true,
          attributes: true,
          attributeFilter: ["data-still"],
        });
      });
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
      const starts = await page.evaluate(() => (window as any).__rainStarts);
      expect(starts.length).toBeGreaterThan(0);
      expect(starts).not.toContain(false);
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

test.describe("the charger", () => {
  // the battery's cycle (src/scene/status.js): ten minutes draining, then two charging
  const DRAIN = 10 * 60 * 1000;
  const CYCLE = 12 * 60 * 1000;

  type ChargerState = {
    ready: boolean;
    failed: boolean;
    target: boolean;
    plugged: boolean;
    busy: boolean;
    running: boolean;
    set: string | null;
    index: number | null;
    folds: string | null;
  };
  type Seen = ChargerState & { transform: string; phone: string; fold: number };

  const chargerState = (page: Page): Promise<ChargerState> =>
    page.evaluate(() => (window as any).__flat.charger());

  // moves the battery's own clock to `at` ms into its cycle, through the status bar's test control
  const setBattery = (page: Page, at: number) =>
    page.evaluate((ms) => (window as any).__flat.battery(ms), at);

  // the battery a few seconds above 5%, so the charger's sets load, and the cable goes in 300 ms later
  const lowThenPlug = async (page: Page) => {
    await setBattery(page, DRAIN - 30000);
    await expect
      .poll(async () => (await chargerState(page)).ready, { timeout: 20000 })
      .toBe(true);
    await record(page);
    await setBattery(page, DRAIN - 300);
  };

  // the charger's state and the frames' transform on every frame from now, till the cable is where the battery wants
  // it and the run has let go of the folds
  const record = (page: Page) =>
    page.evaluate(() => {
      const w = window as any;
      w.__runSeen = [];
      w.__runDone = false;
      let moved = false;
      const look = () => {
        const s = w.__flat.charger();
        moved ||= s.busy;
        w.__runSeen.push({
          ...s,
          phone: w.__flat.status().phone,
          fold: w.__flat.status().fold,
          transform: (document.querySelector(".flat-frames") as HTMLElement)
            .style.transform,
        });
        if (moved && !s.busy && s.target === s.plugged) {
          w.__runDone = true;
        } else if (w.__runSeen.length < 900) {
          requestAnimationFrame(look);
        }
      };
      requestAnimationFrame(look);
    });

  const recorded = async (page: Page): Promise<Seen[]> => {
    await expect
      .poll(() => page.evaluate(() => (window as any).__runDone), {
        timeout: 15000,
      })
      .toBe(true);
    return page.evaluate(() => (window as any).__runSeen);
  };

  const running = (seen: Seen[]) => seen.filter((s) => s.running);

  for (const [name, viewport, base] of [
    ["landscape", { width: 1280, height: 800 }, "landscape"],
    ["portrait", { width: 600, height: 900 }, "portrait"],
  ] as const) {
    test.describe(name, () => {
      test.use({ viewport });

      test("a plug open and an unplug closed play the plug frames both ways", async ({
        page,
      }) => {
        test.setTimeout(60000);
        await page.goto("/");
        await settledOn(page, "/", null);
        const rest = await page.evaluate(
          () =>
            (document.querySelector(".flat-frames") as HTMLElement).style
              .transform,
        );
        await lowThenPlug(page);
        const plug = running(await recorded(page));
        expect(plug.length, "frames of the plug").toBeGreaterThan(60);
        expect(new Set(plug.map((s) => s.set))).toEqual(
          new Set([`charger-${base}-open`]),
        );
        const plugIndexes = plug.map((s) => s.index!);
        expect(plugIndexes[0]).toBeLessThan(10);
        expect(plugIndexes.at(-1)).toBeGreaterThan(150);
        plugIndexes.slice(1).forEach((index, i) => {
          expect(index).toBeGreaterThanOrEqual(plugIndexes[i]);
        });
        // the phone moves while the hand works: the frames' transform isn't the resting one through the run
        expect(plug.some((s) => s.transform !== rest)).toBe(true);
        const after = await chargerState(page);
        expect(after).toMatchObject({
          plugged: true,
          busy: false,
          folds:
            base === "landscape" ? "cable-landscape" : "cable-portrait-open",
        });
        // closed with the cable in, then unplugged closed
        await page.keyboard.press("Escape");
        await expect
          .poll(() => flatStatus(page))
          .toMatchObject({ phone: "closed", busy: false, fold: 1 });
        await record(page);
        await setBattery(page, CYCLE - 300);
        const unplug = running(await recorded(page));
        expect(unplug.length, "frames of the unplug").toBeGreaterThan(60);
        expect(new Set(unplug.map((s) => s.set))).toEqual(
          new Set([`charger-${base}-closed`]),
        );
        const unplugIndexes = unplug.map((s) => s.index!);
        expect(unplugIndexes[0]).toBeGreaterThan(100);
        expect(unplugIndexes.at(-1)).toBeLessThan(10);
        unplugIndexes.slice(1).forEach((index, i) => {
          expect(index).toBeLessThanOrEqual(unplugIndexes[i]);
        });
        expect(await chargerState(page)).toMatchObject({
          plugged: false,
          busy: false,
          folds: base === "landscape" ? "landscape" : "portrait-open",
        });
        // the cable free sets fold the phone again
        await page.keyboard.press("Enter");
        await expect
          .poll(() => flatStatus(page))
          .toMatchObject({ phone: "open", busy: false, fold: 0 });
      });
    });
  }

  test("a fold pressed during a run waits for it to end", async ({ page }) => {
    test.setTimeout(60000);
    await page.goto("/");
    await settledOn(page, "/", null);
    await lowThenPlug(page);
    await expect
      .poll(async () => (await chargerState(page)).running)
      .toBe(true);
    await page.keyboard.press("Escape");
    const seen = await recorded(page);
    // the run played to its end with the phone open and still, and the close came after it
    expect(running(seen).length, "frames of the run").toBeGreaterThan(60);
    expect(running(seen).at(-1)!.index).toBeGreaterThan(150);
    expect(
      seen
        .filter((s) => s.busy)
        .every((s) => s.phone === "open" && s.fold === 0),
    ).toBe(true);
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "closed", busy: false, fold: 1 });
  });

  test("a run while an app is zoomed skips to its end", async ({ page }) => {
    test.setTimeout(60000);
    await page.goto("/");
    await settledOn(page, "/", null);
    await page
      .locator('.flat-home .app-icon[data-app="About"]')
      .click({ force: true });
    await settledOn(page, "/about", "About");
    await lowThenPlug(page);
    const seen = await recorded(page);
    expect(running(seen)).toEqual([]);
    expect(await chargerState(page)).toMatchObject({
      plugged: true,
      folds: "cable-landscape",
    });
    // home again, the phone shows the cable set's frames
    await page.goBack();
    await settledOn(page, "/", null);
  });

  test("reduced motion snaps the cable in", async ({ page }) => {
    test.setTimeout(60000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await settledOn(page, "/", null);
    await lowThenPlug(page);
    const seen = await recorded(page);
    expect(running(seen)).toEqual([]);
    expect(await chargerState(page)).toMatchObject({ plugged: true });
  });

  test("a cable that never downloads starts no run, and the folds and the scene go on", async ({
    page,
  }) => {
    test.setTimeout(60000);
    // the cable's images are asked for and never answered
    await page.route(/\/flat\/cable-[^/]+\/[^/]+\.webp$/, () => {});
    await page.goto("/");
    await settledOn(page, "/", null);
    await setBattery(page, DRAIN - 30000);
    await expect
      .poll(async () => (await chargerState(page)).ready, { timeout: 20000 })
      .toBe(true);
    await record(page);
    await setBattery(page, DRAIN - 300);
    // it charges, with the bolt and no cable
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .querySelector(".flat-home .battery")
            ?.getAttribute("data-charging"),
        ),
      )
      .toBe("true");
    const seen: Seen[] = await page.evaluate(() => (window as any).__runSeen);
    expect(seen.filter((s) => s.busy)).toEqual([]);
    expect(await chargerState(page)).toMatchObject({
      target: true,
      plugged: false,
      busy: false,
      folds: "landscape",
    });
    await page.keyboard.press("Escape");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "closed", busy: false, fold: 1 });
    await expect(page.locator("html")).toHaveClass(/has-flat-scene/);
  });

  test("a charger that doesn't load leaves the battery cycling with no cable", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.route(/\/flat\/charger-[^/]+\/manifest\.json$/, (route) =>
      route.abort(),
    );
    await page.goto("/");
    await settledOn(page, "/", null);
    await setBattery(page, DRAIN - 30000);
    await expect.poll(async () => (await chargerState(page)).failed).toBe(true);
    await setBattery(page, DRAIN - 300);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .querySelector(".flat-home .battery")
            ?.getAttribute("data-charging"),
        ),
      )
      .toBe("true");
    expect(await chargerState(page)).toMatchObject({
      plugged: false,
      busy: false,
      folds: "landscape",
    });
    await expect(page.locator("html")).toHaveClass(/has-flat-scene/);
    await page.keyboard.press("Escape");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "closed", busy: false, fold: 1 });
  });
});

test.describe("failure, resizing, and turning", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  // what the scene left behind in the stage and on #page and the root
  const leftovers = (page: Page) =>
    page.evaluate(() => {
      const root = document.documentElement;
      return {
        parts: document.querySelectorAll(
          "#stage .flat-layer, #stage .flat-desk, #stage .flat-black, #stage .flat-blackout, #stage .flat-window, #stage .flat-cards",
        ).length,
        pageStyle: document.getElementById("page")!.getAttribute("style"),
        pageAnimations: document.getElementById("page")!.getAnimations().length,
        hasScene: root.classList.contains("has-flat-scene"),
        ready: root.classList.contains("flat-ready"),
        failed: root.classList.contains("scene-failed"),
      };
    });

  const gone = {
    parts: 0,
    pageStyle: null,
    pageAnimations: 0,
    hasScene: false,
    ready: false,
    failed: true,
  };

  // each frame's orientations among the frames in the stage, and whether the black cover was up
  const watchTurn = (page: Page) =>
    page.evaluate(() => {
      const w = window as any;
      w.__turn = { both: 0, covered: 0, frames: 0 };
      const sample = () => {
        const sets = [
          ...document.querySelectorAll<HTMLElement>(".flat-frame"),
        ].map((el) => el.dataset.set ?? "");
        const portrait = sets.some((s) => s.includes("portrait"));
        const landscape = sets.some((s) => s.includes("landscape"));
        w.__turn.frames += 1;
        if (portrait && landscape) {
          w.__turn.both += 1;
        }
        if (document.querySelector(".flat-blackout")) {
          w.__turn.covered += 1;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

  const turnSeen = (page: Page) =>
    page.evaluate(() => ({ ...(window as any).__turn }));

  const frameSets = (page: Page) =>
    page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll<HTMLElement>(".flat-frame")].map(
          (el) => el.dataset.set,
        ),
      ),
    ]);

  test("resize mid motion", async ({ page }) => {
    await page.goto("/");
    await settledOn(page, "/", null);
    // a resize partway through a close shows the address again, which on the home screen is the phone open
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await flatStatus(page))?.busy).toBe(true);
    await page.setViewportSize({ width: 1100, height: 760 });
    await settledOn(page, "/", null);
    expect(await flatStatus(page)).toMatchObject({ fold: 0 });
    const fitted = () =>
      page.evaluate(() => {
        const { width, height } = (window as any).__flat.stage.geometry;
        return { width, height };
      });
    await expect.poll(fitted).toEqual({ width: 1100, height: 760 });

    // and partway through an open, it's the app at full zoom
    await page
      .locator('.flat-home .app-icon[data-app="About"]')
      .click({ force: true });
    await expect
      .poll(async () => {
        const s = await flatStatus(page);
        return s?.busy && s.path === "/about";
      })
      .toBe(true);
    await page.setViewportSize({ width: 1280, height: 800 });
    await settledOn(page, "/about", "About");
    await expect.poll(fitted).toEqual({ width: 1280, height: 800 });
    const shown = await page.evaluate(() => {
      const el = document.getElementById("page")!;
      const cs = getComputedStyle(el);
      return { transform: cs.transform, clip: cs.clipPath };
    });
    expect(shown).toEqual({ transform: "none", clip: "none" });
    await expect(page.locator("#page h1")).toBeVisible();
    // the folds work in the new size
    await page.goBack();
    await settledOn(page, "/", null);
    await page.keyboard.press("Escape");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "closed", busy: false, fold: 1 });
  });

  test("turning holds one orientation", async ({ page }) => {
    test.setTimeout(60000);
    await page.goto("/");
    await settledOn(page, "/", null);
    await page
      .locator('.flat-home .app-icon[data-app="About"]')
      .click({ force: true });
    await settledOn(page, "/about", "About");
    await watchTurn(page);
    await page.setViewportSize({ width: 600, height: 900 });
    // the turn starts once the resizes have stopped for a moment, and the phone was already settled before it
    await expect
      .poll(async () => (await turnSeen(page)).covered)
      .toBeGreaterThan(0);
    await settledOn(page, "/about", "About");
    await expect(page.locator(".flat-blackout")).toHaveCount(0);
    let seen = await turnSeen(page);
    expect(seen.both, "frames when both orientations were in the stage").toBe(
      0,
    );
    expect(seen.covered).toBeGreaterThan(0);
    expect(await frameSets(page)).not.toContain("landscape");
    expect(await frameSets(page)).toContain("portrait-open");
    await expect(page.locator("#page h1")).toBeVisible();

    // back on the home screen with the phone closed, a turn shows the phone open
    await page.goBack();
    await settledOn(page, "/", null);
    await page.keyboard.press("Escape");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "closed", busy: false });
    await page.evaluate(() =>
      Object.assign((window as any).__turn, { covered: 0 }),
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect
      .poll(async () => (await turnSeen(page)).covered)
      .toBeGreaterThan(0);
    await settledOn(page, "/", null);
    seen = await turnSeen(page);
    expect(seen.both).toBe(0);
    expect(await frameSets(page)).toContain("landscape");
    expect(
      (await frameSets(page)).filter((s) => s?.includes("portrait")),
    ).toEqual([]);
    await expect(page.locator(".flat-home .flat-body")).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/has-flat-scene/);
    // the turned phone folds
    await page.keyboard.press("Escape");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "closed", busy: false, fold: 1 });
  });

  test("a turn drops a desk drag in progress", async ({ page }) => {
    test.setTimeout(60000);
    await page.goto("/");
    await settledOn(page, "/", null);
    await page.keyboard.press("Escape");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "closed", busy: false, fold: 1 });
    const look = () =>
      page.evaluate(() => {
        const w = window as any;
        const { targetYaw, targetPitch, dragging } = w.__flat.effects();
        return { targetYaw, targetPitch, dragging, slow: w.__flat.slowStep() };
      });
    // a drag off the phone, held down through the turn
    await page.mouse.move(40, 400);
    await page.mouse.down();
    await page.mouse.move(300, 400, { steps: 10 });
    await expect.poll(async () => (await look()).dragging).toBe(true);
    await watchTurn(page);
    await page.setViewportSize({ width: 600, height: 900 });
    await expect
      .poll(async () => (await turnSeen(page)).covered)
      .toBeGreaterThan(0);
    // its release lands under the cover, where the scene takes no input
    await page.mouse.up();
    await settledOn(page, "/", null);
    const after = await look();
    expect(after.dragging).toBe(false);
    // a mouse move with no button down moves nothing
    await page.mouse.move(100, 300, { steps: 10 });
    await page.mouse.move(500, 600, { steps: 10 });
    const moved = await look();
    expect(moved.targetYaw).toBe(after.targetYaw);
    expect(moved.targetPitch).toBe(after.targetPitch);
    // and the phone counts as at rest, so the last step could drop a slow device here
    await expect.poll(async () => (await look()).slow.atRest).toBe(true);
    await expect(page.locator("body")).not.toHaveClass(/looking/);
  });

  test("a turn while the first sets load is seen once they're in", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const held: (() => Promise<void>)[] = [];
    await page.route(/\/flat\/landscape-[^/]+\/a\d+\.webp$/, (route) => {
      held.push(() => route.continue());
    });
    await page.goto("/");
    await expect.poll(() => held.length).toBeGreaterThan(0);
    await page.setViewportSize({ width: 600, height: 900 });
    await page.unroute(/\/flat\/landscape-[^/]+\/a\d+\.webp$/);
    await Promise.all(held.map((release) => release()));
    await expect
      .poll(() => frameSets(page), { timeout: 20000 })
      .toContain("portrait-open");
    await settledOn(page, "/", null);
    expect(
      (await frameSets(page)).filter((set) => set?.includes("landscape")),
    ).toEqual([]);
    const fitted = await page.evaluate(() => {
      const { width, height } = (window as any).__flat.stage.geometry;
      return { width, height };
    });
    expect(fitted).toEqual({ width: 600, height: 900 });
  });

  test("a blocked frame image drops to the plain flat page", async ({
    page,
  }) => {
    await page.route(/\/flat\/landscape-[^/]+\/a\d+\.webp$/, (route) =>
      route.abort(),
    );
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/scene-failed/);
    expect(await leftovers(page)).toEqual(gone);
    await expect(page.locator("#page h1")).toBeVisible();
    await expect(page.locator("#page h1")).toHaveText("Jason Yue");
  });

  test("the watchdog drops a 2D scene that never shows", async ({ page }) => {
    test.setTimeout(60000);
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
    await page.route(/\/flat\/landscape-[^/]+\/a\d+\.webp$/, (route) => {
      held.push(() => route.continue());
    });
    await page.goto("/about");
    await expect(page.locator("html")).toHaveClass(/has-flat-scene/);
    await expect.poll(() => held.length).toBeGreaterThan(0);
    await expect(page.locator("html")).toHaveClass(/scene-failed/, {
      timeout: 12000,
    });
    // the images arrive after the watchdog, and the scene that waited for them stays stopped
    await Promise.all(held.map((release) => release()));
    await page.waitForTimeout(1500);
    const frames = () =>
      page.evaluate(() => (window as unknown as { __frames: number }).__frames);
    const before = await frames();
    await page.waitForTimeout(1000);
    expect(await frames(), "no frames asked for after the release").toBe(
      before,
    );
    expect(await leftovers(page)).toEqual(gone);
    expect(
      await page.evaluate(() => Boolean((window as any).__flatShown)),
    ).toBe(false);
    await expect(page.locator("#page h1")).toHaveText("About");
    await expect(page.locator("#page h1")).toBeVisible();
  });
});

test.describe("with reduced motion", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("the phone is open at once and a fold snaps", async ({ page }) => {
    // every animation frame from the page's start, so the close's snap is recorded as well as the open's
    await page.addInitScript(() => {
      const w = window as any;
      w.__trace = [];
      const look = () => {
        const s = w.__flat?.status?.();
        if (s) {
          w.__trace.push({ fold: s.fold, busy: s.busy, phone: s.phone });
        }
        if (w.__trace.length < 5000) {
          requestAnimationFrame(look);
        }
      };
      requestAnimationFrame(look);
    });
    await page.goto("/");
    await settledOn(page, "/", null);
    await page.keyboard.press("Escape");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "closed", busy: false, fold: 1 });
    // a few frames closed, so the trace has the close in it (a snap lasts less than one frame before the Enter)
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => requestAnimationFrame(done)),
          ),
        ),
    );
    await page.keyboard.press("Enter");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "open", busy: false, fold: 0 });
    // one more frame after the last change
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
    const trace: { fold: number; busy: boolean; phone: string }[] =
      await page.evaluate(() => (window as any).__trace);
    expect(
      trace.some((t) => t.phone === "closed" && t.fold === 1),
      "the close was seen",
    ).toBe(true);
    expect(
      trace.filter((t) => t.busy),
      "no fold in motion",
    ).toEqual([]);
    for (const t of trace) {
      expect([0, 1], "only the ends of the fold").toContain(t.fold);
    }
    expect(trace[trace.length - 1].fold).toBe(0);
  });

  test("an app crossfades with no clip or transform on the page", async ({
    page,
  }) => {
    await page.goto("/");
    await settledOn(page, "/", null);
    await page.evaluate(() => {
      const w = window as any;
      w.__page = [];
      const look = () => {
        const el = document.getElementById("page")!;
        const cs = getComputedStyle(el);
        w.__page.push({
          clip: cs.clipPath,
          transform: cs.transform,
          opacity: Number(cs.opacity),
          shown: cs.visibility === "visible",
        });
        if (w.__page.length < 600) {
          requestAnimationFrame(look);
        }
      };
      requestAnimationFrame(look);
    });
    await page
      .locator('.flat-home .app-icon[data-app="About"]')
      .click({ force: true });
    await settledOn(page, "/about", "About");
    await page.goBack();
    await settledOn(page, "/", null);
    const seen: {
      clip: string;
      transform: string;
      opacity: number;
      shown: boolean;
    }[] = await page.evaluate(() => (window as any).__page);
    const shown = seen.filter((s) => s.shown);
    expect(shown.length).toBeGreaterThan(5);
    for (const s of shown) {
      expect(s.clip, "no clip on the page").toBe("none");
      expect(s.transform, "no transform on the page").toBe("none");
    }
    expect(
      shown.some((s) => s.opacity > 0 && s.opacity < 1),
      "the page fades",
    ).toBe(true);
  });
});

test.describe("keyboard focus", () => {
  const focused = (page: Page) =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) {
        return null;
      }
      return {
        face: el.closest(".flat-cover")
          ? "cover"
          : el.closest(".flat-home")
            ? "home"
            : el.closest("#page")
              ? "page"
              : "other",
        app: el.closest<HTMLElement>("[data-app]")?.dataset.app ?? null,
        label: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
      };
    });

  const tabAround = async (page: Page, count: number) => {
    const seen: NonNullable<Awaited<ReturnType<typeof focused>>>[] = [];
    for (let i = 0; i < count; i++) {
      await page.keyboard.press("Tab");
      const now = await focused(page);
      if (now) {
        seen.push(now);
      }
    }
    return seen;
  };

  test("Tab stays on the faces that are showing", async ({ page }) => {
    await page.goto("/");
    await settledOn(page, "/", null);
    const open = await tabAround(page, 24);
    expect(
      open.length,
      "the open phone has something to focus",
    ).toBeGreaterThan(4);
    expect(
      open.filter((f) => f.face !== "home"),
      "an open phone's Tab never leaves the home screen's faces",
    ).toEqual([]);
    expect(
      new Set(open.map((f) => f.app).filter(Boolean)).size,
      "the icons are reached",
    ).toBeGreaterThan(3);

    await page.keyboard.press("Escape");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "closed", busy: false });
    const cover = await page.evaluate(
      () => document.querySelectorAll(".flat-cover :is(a, button)").length,
    );
    const closed = await tabAround(page, 8);
    expect(
      closed.filter((f) => f.face === "home"),
      "the home screen is inert while the phone is closed",
    ).toEqual([]);
    if (cover > 0) {
      expect(closed.some((f) => f.face === "cover")).toBe(true);
    }

    await page.keyboard.press("Enter");
    await expect
      .poll(() => flatStatus(page))
      .toMatchObject({ phone: "open", busy: false });
    const again = await tabAround(page, 6);
    expect(again.filter((f) => f.face === "cover")).toEqual([]);
  });

  test("an app takes the focus and gives it back to its icon", async ({
    page,
  }) => {
    await page.goto("/");
    await settledOn(page, "/", null);
    const glyph = page.locator('.flat-home .app-icon[data-app="About"] .glyph');
    // the icon's glyph is left out of the home screen while the window grows out of it
    await page.evaluate(() => {
      const w = window as any;
      w.__glyph = [];
      const look = () => {
        const g = document.querySelector<HTMLElement>(
          '.flat-home .app-icon[data-app="About"] .glyph',
        )!;
        w.__glyph.push({
          visibility: getComputedStyle(g).visibility,
          busy: w.__flat.status().busy,
        });
        if (w.__glyph.length < 600) {
          requestAnimationFrame(look);
        }
      };
      requestAnimationFrame(look);
    });
    await page
      .locator('.flat-home .app-icon[data-app="About"]')
      .click({ force: true });
    await settledOn(page, "/about", "About");
    const heading = await page.evaluate(
      () => document.activeElement?.tagName ?? null,
    );
    expect(heading, "focus is on the page's heading").toBe("H1");
    await page.goBack();
    await settledOn(page, "/", null);
    await expect(
      page.locator('.flat-home .app-icon[data-app="About"]'),
    ).toBeFocused();
    await expect(glyph).toHaveCSS("visibility", "visible");
    const seen: { visibility: string; busy: boolean }[] = await page.evaluate(
      () => (window as any).__glyph,
    );
    expect(
      seen.some((s) => s.busy && s.visibility === "hidden"),
      "the glyph is hidden while the window moves",
    ).toBe(true);
  });
});

// the cpu slowed 4x in Chromium, which slows the main thread and not the gpu or image decoding. the capture build
// keeps the 2d scene's own slow step off, so the throttled run isn't sent to the plain flat page
test.describe("with the cpu slowed 4x", () => {
  test.setTimeout(120000);
  const LIMIT_MS = 17;
  const SKIP_MS = 200;

  const slow = async (page: Page) => {
    await page.addInitScript(() => {
      (window as any).__flatNoSlowStep = true;
    });
    const client = await page.context().newCDPSession(page);
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    return client;
  };

  // the gaps between animation frames, with the time since the run started, while `busy` says to
  const startGaps = (page: Page) =>
    page.evaluate(() => {
      const w = window as any;
      w.__gaps = [];
      w.__stop = false;
      let last = 0;
      let start = 0;
      const look = (now: number) => {
        const s = w.__flat?.status?.();
        const moving = Boolean(s && s.busy);
        if (moving) {
          start ||= now;
          if (last) {
            w.__gaps.push({ at: now - start, gap: now - last });
          }
          last = now;
        } else if (start) {
          w.__stop = true;
        }
        if (!w.__stop) {
          requestAnimationFrame(look);
        }
      };
      requestAnimationFrame(look);
    });

  const gapsAfterSkip = async (page: Page, least: number) => {
    await expect
      .poll(() => page.evaluate(() => (window as any).__stop), {
        timeout: 30000,
      })
      .toBe(true);
    const all: { at: number; gap: number }[] = await page.evaluate(
      () => (window as any).__gaps,
    );
    const kept = all.filter((g) => g.at > SKIP_MS).map((g) => g.gap);
    // the open lasts about 580 ms, so too few frames means long gaps or an open cut short. other work on the machine
    // gives long gaps too (other jobs' load dropped this to 7 to 15 frames on 2026-11-12), so the message says which
    const lasted = all.length > 0 ? Math.round(all[all.length - 1].at) : 0;
    const gaps = kept.map((gap) => Math.round(gap)).join(" ");
    expect(
      kept.length,
      `enough frames to judge (open ${lasted} ms, gaps ${gaps} ms, load ${loadavg()[0].toFixed(1)})`,
    ).toBeGreaterThan(least);
    const sorted = [...kept].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
    return { p95, worst: sorted[sorted.length - 1], count: kept.length };
  };

  test("the intro's frames take at most 17 ms", async ({ page }) => {
    await quiet(page);
    await page.addInitScript(() => {
      // a first visit, so the full intro plays
      localStorage.setItem("2d", "1");
      localStorage.removeItem("introSeen");
    });
    await slow(page);
    await page.addInitScript(() => {
      const w = window as any;
      w.__intro = { gaps: [], done: false };
      let last = 0;
      let start = 0;
      const look = (now: number) => {
        const ready = document.documentElement.classList.contains("flat-ready");
        const s = w.__flat?.status?.();
        if (ready && !start) {
          start = now;
        }
        if (start && last) {
          w.__intro.gaps.push({ at: now - start, gap: now - last });
        }
        last = now;
        if (start && s && s.phone === "open" && !s.busy) {
          w.__intro.done = true;
          return;
        }
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await page.goto("/");
    await expect
      .poll(() => page.evaluate(() => (window as any).__intro.done), {
        timeout: 60000,
      })
      .toBe(true);
    const all: { at: number; gap: number }[] = await page.evaluate(
      () => (window as any).__intro.gaps,
    );
    const kept = all.filter((g) => g.at > SKIP_MS).map((g) => g.gap);
    expect(kept.length, "enough frames to judge").toBeGreaterThan(30);
    const sorted = [...kept].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
    console.log(
      `SLOW4X intro frames ${kept.length}, p95 ${p95.toFixed(1)} ms, worst ${sorted[sorted.length - 1].toFixed(1)} ms`,
    );
    expect(p95, "95% of the intro's frames").toBeLessThanOrEqual(LIMIT_MS);
  });

  test("the check can fail: a 25 ms busy loop in every frame gives a p95 over 17 ms", async ({
    page,
  }) => {
    await quiet(page);
    await page.addInitScript(() => {
      localStorage.setItem("2d", "1");
      localStorage.setItem("introSeen", "1");
      const ask = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) =>
        ask((time) => {
          const end = performance.now() + 25;
          while (performance.now() < end) {
            // the slow frame
          }
          callback(time);
        });
    });
    await slow(page);
    await page.goto("/");
    await settledOn(page, "/", null);
    await startGaps(page);
    await page
      .locator('.flat-home .app-icon[data-app="About"]')
      .click({ force: true });
    const stats = await gapsAfterSkip(page, 3);
    console.log(
      `SLOW4X control p95 ${stats.p95.toFixed(1)} ms over ${stats.count} frames`,
    );
    expect(stats.p95).toBeGreaterThan(LIMIT_MS);
  });

  test("an app open's frames take at most 17 ms, with #page on the window", async ({
    page,
  }) => {
    await quiet(page);
    await page.addInitScript(() => {
      localStorage.setItem("2d", "1");
      localStorage.setItem("introSeen", "1");
    });
    await slow(page);
    await page.goto("/");
    await settledOn(page, "/", null);
    await startGaps(page);
    await page.evaluate(() => {
      const w = window as any;
      w.__aligned = [];
      const look = () => {
        const win = document.querySelector<HTMLElement>(".flat-window");
        const el = document.getElementById("page")!;
        const s = w.__flat.status();
        if (
          win &&
          s.busy &&
          getComputedStyle(win).visibility === "visible" &&
          getComputedStyle(el).visibility === "visible" &&
          getComputedStyle(el).opacity !== "0"
        ) {
          const a = win.getBoundingClientRect();
          const b = el.getBoundingClientRect();
          // the window is taller than the page it carries, which is clipped to the window's shape, so the page matches
          // the window's sides and sits on its middle. the frames and the screens layer get one transform string from the
          // stage, so only the window and the page are compared
          w.__aligned.push({
            left: b.left - a.left,
            right: b.right - a.right,
            middle: (b.top + b.bottom) / 2 - (a.top + a.bottom) / 2,
          });
        }
        if (!w.__stop) {
          requestAnimationFrame(look);
        }
      };
      requestAnimationFrame(look);
    });
    await page
      .locator('.flat-home .app-icon[data-app="About"]')
      .click({ force: true });
    const stats = await gapsAfterSkip(page, 15);
    console.log(
      `SLOW4X app open frames ${stats.count}, p95 ${stats.p95.toFixed(1)} ms, worst ${stats.worst.toFixed(1)} ms`,
    );
    expect(stats.p95, "95% of the open's frames").toBeLessThanOrEqual(LIMIT_MS);
    const aligned: Record<string, number>[] = await page.evaluate(
      () => (window as any).__aligned,
    );
    expect(
      aligned.length,
      "frames with #page pinned on the window",
    ).toBeGreaterThan(5);
    const worst = Math.max(
      ...aligned.flatMap((a) => Object.values(a).map(Math.abs)),
    );
    console.log(
      `SLOW4X #page against the window, worst edge ${worst.toFixed(2)} px over ${aligned.length} frames`,
    );
    expect(worst, "#page and the window are aligned").toBeLessThanOrEqual(1);
  });
});
