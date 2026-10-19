import { expect, test } from "@playwright/test";
import { quiet } from "../prod/scene";

// firefox's webgl uploads a bitmap cut with createImageBitmap's crop from the top of the whole image, so the desk showed
// its first rows over and over. this runs the photo worker the scene loads and checks every row of what it uploads
test("the photo worker's strips upload as the photo's own rows in firefox", async ({
  page,
}) => {
  await quiet(page);
  await page.goto("/");
  const workerUrl = await page
    .waitForFunction(
      () =>
        performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((name) => name.includes("photoWorker")) ?? null,
      null,
      { timeout: 60000 },
    )
    .then((handle) => handle.jsonValue());

  const result = await page.evaluate(async (workerUrl) => {
    const url = new URL("/desk-small.jpg", location.href).href;
    const options = {
      imageOrientation: "none",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    } as const;
    const cut = await new Promise<{
      error?: string;
      width: number;
      height: number;
      strips: ImageBitmap[];
    }>((resolve) => {
      const worker = new Worker(workerUrl);
      worker.onmessage = ({ data }) => resolve(data);
      worker.postMessage({ id: 1, url, options, rows: 128 });
    });
    if (cut.error) {
      return { error: cut.error, strips: 0, pixelsOff: -1 };
    }

    const { width, height } = cut;
    const whole = await createImageBitmap(
      await (await fetch(url)).blob(),
      options,
    );
    const reference = new OffscreenCanvas(width, height).getContext("2d", {
      willReadFrequently: true,
    })!;
    reference.drawImage(whole, 0, 0);
    const expected = reference.getImageData(0, 0, width, height).data;

    const gl = new OffscreenCanvas(4, 4).getContext("webgl2")!;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    cut.strips.forEach((strip, i) => {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        i * 128,
        strip.width,
        strip.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        strip,
      );
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    const uploaded = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, uploaded);

    let pixelsOff = 0;
    for (let i = 0; i < uploaded.length; i += 4) {
      if (
        Math.abs(uploaded[i] - expected[i]) > 2 ||
        Math.abs(uploaded[i + 1] - expected[i + 1]) > 2 ||
        Math.abs(uploaded[i + 2] - expected[i + 2]) > 2
      ) {
        pixelsOff++;
      }
    }
    return { error: null, strips: cut.strips.length, pixelsOff };
  }, workerUrl as string);

  expect(result.error).toBeNull();
  expect(result.strips).toBeGreaterThan(1);
  expect(result.pixelsOff).toBe(0);
});
