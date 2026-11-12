import { expect, test, type Page } from "@playwright/test";

// the home screen's ink over a sky whose bright cloud edge runs down the middle of the clock. the composite judges the
// clock as one word (composite.js), so its half over the blue sky turns dark with the half over the cloud, where
// judging each pixel left it white beside a dark half (the "1 1:02" seen on the live site on 2026-11-12)
const splitSky = (page: Page) =>
  page.evaluate(async () => {
    const { state } = await import("/src/scene/state.js" as string);
    const { inkWords } = await import(
      "/src/scene/shared/homeDraw.js" as string
    );
    const homeEl = state.screen.homeEl;
    const words = inkWords(homeEl);
    const time = words[0];
    const canvas = document.createElement("canvas");
    canvas.width = homeEl.offsetWidth;
    canvas.height = homeEl.offsetHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#3a5f9a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e6ecf2";
    ctx.fillRect(0, 0, (time.x0 + time.x1) / 2, canvas.height);
    const Texture = state.screen.icons.constructor;
    const sky = new Texture(canvas);
    sky.needsUpdate = true;
    state.screen.composite.setSky(sky);
    (window as any).__ink = { words, time };
  });

// the brightest channel of any pixel in the clock's right half, from the composite's own target, with the words given
// to the composite or not
const brightestRightHalf = (page: Page, withWords: boolean) =>
  page.evaluate(async (on) => {
    const { state } = await import("/src/scene/state.js" as string);
    const { renderer } = await import("/src/scene/renderer.js" as string);
    const { words, time } = (window as any).__ink;
    const composite = state.screen.composite;
    composite.setFrosted(false);
    composite.setWords(on ? words : []);
    composite.invalidate();
    composite.render();
    const target = composite.target;
    const scale = target.width / state.screen.homeEl.offsetWidth;
    const x0 = Math.ceil(((time.x0 + time.x1) / 2 + 2) * scale);
    const x1 = Math.floor(time.x1 * scale);
    const rowTop = Math.floor(
      (state.screen.homeEl.offsetHeight - time.y1) * scale,
    );
    const rows = Math.floor((time.y1 - time.y0) * scale);
    const pixels = new Uint8Array((x1 - x0) * rows * 4);
    renderer.readRenderTargetPixels(target, x0, rowTop, x1 - x0, rows, pixels);
    let brightest = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      brightest = Math.max(brightest, pixels[i], pixels[i + 1], pixels[i + 2]);
    }
    return brightest;
  }, withWords);

test("the clock turns dark as one word across a cloud edge", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("introSeen", "1");
  });
  await page.goto("/?dev&noweather");
  await page.waitForFunction(
    () => (window as any).__sceneShown === true,
    null,
    {
      timeout: 90000,
    },
  );
  await splitSky(page);
  // the control: judged by the pixel, the right half of the clock stays white over the blue
  expect(await brightestRightHalf(page, false)).toBeGreaterThan(230);
  expect(await brightestRightHalf(page, true)).toBeLessThan(180);
});
