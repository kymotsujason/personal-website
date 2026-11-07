import { expect, test } from "@playwright/test";
import { quiet, settledOn } from "./scene";

const savedChoice = (page: import("@playwright/test").Page) =>
  page.evaluate(() => ({
    choice: localStorage.getItem("2d"),
    auto: localStorage.getItem("2dAuto"),
  }));

test("webgl drawn in software gets the 2d scene, and ?3d still shows the 3d one", async ({
  playwright,
}, testInfo) => {
  // the runner adds the project's gpu flags to this launch too, so swiftshader is asked for by name
  const browser = await playwright.chromium.launch({
    args: ["--use-angle=swiftshader"],
  });
  try {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
    });
    const page = await context.newPage();
    await quiet(page);
    await page.goto("/");
    const renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl && info
        ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
        : "";
    });
    expect(renderer, "the browser draws webgl in software").toMatch(
      /swiftshader/i,
    );
    await expect(page.locator("html")).not.toHaveClass(/has-3d/);
    await expect(page.locator("html")).toHaveClass(/has-flat-scene/);
    await expect(page.locator(".flat-home h1")).toHaveText("Jason Yue");
    await expect(page.locator(".flat-home .flat-body")).toBeVisible();

    await page.goto("/?3d");
    await expect(page.locator("html")).toHaveClass(/has-3d/);
    expect(await savedChoice(page)).toEqual({ choice: "0", auto: null });
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/has-3d/);
  } finally {
    await browser.close();
  }
});

test("a device still too slow at the last step switches to the 2d scene and stays there", async ({
  page,
}) => {
  test.setTimeout(180000);
  // each frame takes at least 60 ms, under 17 fps, which no step of the ladder can fix
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf((time) => {
        const end = performance.now() + 60;
        while (performance.now() < end) {
          // the slow device
        }
        callback(time);
      });
  });
  await quiet(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/has-3d/);
  await settledOn(page, "/", null, 90000);
  await expect(page.locator("html")).toHaveClass(/scene-failed/, {
    timeout: 120000,
  });
  await expect(page.locator("#page h1")).toBeVisible();
  const saved = await savedChoice(page);
  expect(saved.choice).toBeNull();
  const age = Date.now() - Number(saved.auto);
  expect(age).toBeGreaterThanOrEqual(0);
  expect(age).toBeLessThan(180000);

  // the reload lands in the 2d scene, whose home screen has the 3d link in its credits row
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/has-3d/);
  await expect(page.locator("html")).toHaveClass(/has-flat-scene/);
  const home = page.locator(".flat-home");
  await expect(home.locator("h1")).toHaveText("Jason Yue");
  await expect(home.locator(".flat-body")).toBeVisible();
  await expect(home).not.toHaveAttribute("inert", { timeout: 15000 });

  // the 2d home screen's 3d link takes the visitor back to 3d, and that choice outlasts the switch
  await home.locator('a[data-version="3d"]').click();
  await expect(page.locator("html")).toHaveClass(/has-3d/);
  expect(await savedChoice(page)).toEqual({ choice: "0", auto: null });
});

test("a 2d scene still too slow drops to the plain flat page and stays there", async ({
  page,
}) => {
  test.setTimeout(120000);
  // each frame takes at least 60 ms, under 17 fps
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf((time) => {
        const end = performance.now() + 60;
        while (performance.now() < end) {
          // the slow device
        }
        callback(time);
      });
  });
  await quiet(page);
  await page.goto("/?2d");
  await expect(page.locator("html")).toHaveClass(/has-flat-scene/);
  // a first visit's intro may not give 3 s of motion past each start's 200 ms, so the phone folds until it has
  const root = page.locator("html");
  for (let i = 0; i < 6; i++) {
    const failed = await root.evaluate((el) =>
      el.classList.contains("scene-failed"),
    );
    if (failed) {
      break;
    }
    const s = await page.evaluate(() => (window as any).__flat?.status());
    if (s && s.phone !== null && !s.busy) {
      await page.keyboard.press(s.phone === "open" ? "Escape" : "Enter");
    }
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const root = document.documentElement;
            const s = (window as any).__flat?.status();
            return (
              root.classList.contains("scene-failed") ||
              Boolean(s && s.phone !== null && !s.busy)
            );
          }),
        { timeout: 30000 },
      )
      .toBe(true);
  }
  await expect(root).toHaveClass(/scene-failed/);
  await expect(root).toHaveClass(/flat-slow/);
  await expect(root).not.toHaveClass(/has-flat-scene/);
  const age = await page.evaluate(
    () => Date.now() - Number(localStorage.getItem("flatAuto")),
  );
  expect(age).toBeGreaterThanOrEqual(0);
  expect(age).toBeLessThan(120000);
  await expect(page.locator("#page h1")).toBeVisible();
  await expect(page.locator("#stage .flat-layer")).toHaveCount(0);
  await expect(page.locator('#page a[data-version="2d"]')).toBeVisible();

  // the next load stays on the plain flat page, with the 2d link from its first paint
  await page.reload();
  await expect(root).not.toHaveClass(/has-flat-scene/);
  await expect(root).not.toHaveClass(/has-3d/);
  await expect(root).toHaveClass(/flat-slow/);
  await expect(page.locator('#page a[data-version="2d"]')).toBeVisible();

  // the 2d link tries the 2d scene again
  await page.locator('#page a[data-version="2d"]').click();
  await expect(root).toHaveClass(/has-flat-scene/);
  expect(await page.evaluate(() => localStorage.getItem("flatAuto"))).toBe(
    null,
  );
});
