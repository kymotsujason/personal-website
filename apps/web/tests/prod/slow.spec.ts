import { expect, test } from "@playwright/test";
import { quiet, settledOn } from "./scene";

const savedChoice = (page: import("@playwright/test").Page) =>
  page.evaluate(() => ({
    choice: localStorage.getItem("2d"),
    auto: localStorage.getItem("2dAuto"),
  }));

test("webgl drawn in software gets the flat site, and ?3d still shows the scene", async ({
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
    await expect(page.locator("#page h1")).toBeVisible();

    await page.goto("/?3d");
    await expect(page.locator("html")).toHaveClass(/has-3d/);
    expect(await savedChoice(page)).toEqual({ choice: "0", auto: null });
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/has-3d/);
  } finally {
    await browser.close();
  }
});

test("a device still too slow at the last step switches to the flat site and stays there", async ({
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

  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/has-3d/);
  await expect(page.locator("#page h1")).toBeVisible();

  // the flat site's 3d link takes the visitor back to 3d, and that choice outlasts the switch
  await page.locator('a[data-version="3d"]').first().click();
  await expect(page.locator("html")).toHaveClass(/has-3d/);
  expect(await savedChoice(page)).toEqual({ choice: "0", auto: null });
});
