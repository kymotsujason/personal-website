// reduced motion and the 2d and 3d version links, against the capture build (see failure.spec.ts)
import { expect, test, type Page } from "@playwright/test";
import { quiet, settledOn, tapIcon, watchErrors } from "./scene";

type Pose = {
  root: number[];
  parts: Record<string, number[]>;
  bones: Record<string, number[]>;
  fold: number;
  phone: string | null;
  busy: boolean;
};

const pose = (page: Page): Promise<Pose> =>
  page.evaluate(() => (window as any).__capture.pose());

const largestChange = (a: Pose, b: Pose) => {
  let worst = 0;
  const pairs: [number[], number[]][] = [[a.root, b.root]];
  for (const key of Object.keys(a.parts)) {
    pairs.push([a.parts[key], b.parts[key]]);
  }
  for (const key of Object.keys(a.bones)) {
    pairs.push([a.bones[key], b.bones[key]]);
  }
  for (const [x, y] of pairs) {
    for (let i = 0; i < 16; i++) {
      worst = Math.max(worst, Math.abs(x[i] - y[i]));
    }
  }
  return worst;
};

test.beforeEach(async ({ page }) => {
  await quiet(page);
});

test.describe("with reduced motion", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("the scene fades in with the phone open and the hands still", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const { errors } = watchErrors(page);
    await page.goto("/");
    await page.waitForFunction(
      () => (window as unknown as { __sceneShown?: boolean }).__sceneShown,
      null,
      { timeout: 30000 },
    );
    const first = await pose(page);
    expect(first.phone, "the phone is open as the scene shows").toBe("open");
    expect(first.busy).toBe(false);
    expect(first.fold).toBe(0);
    expect(Object.keys(first.bones).length).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(200);
      const later = await pose(page);
      expect(
        largestChange(first, later),
        `the phone and the hands moved by ${(i + 1) * 200} ms`,
      ).toBeLessThan(1e-9);
    }
    expect(errors).toEqual([]);
  });

  test("an app opens and closes with a crossfade and no zoom", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const { errors } = watchErrors(page);
    await page.goto("/");
    await settledOn(page, "/", null);
    // every frame from the tap until the app is open, then until it has closed: #page's transform and opacity, and
    // whether the scene is moving
    const sample = () =>
      page.evaluate(() => {
        const w = window as any;
        w.__frames = [];
        const take = () => {
          const el = document.getElementById("page")!;
          const cs = getComputedStyle(el);
          w.__frames.push({
            transform: cs.transform,
            opacity: Number(cs.opacity),
            shown: el.checkVisibility({ visibilityProperty: true }),
            busy: w.__capture.pose().busy,
          });
          if (w.__frames.length < 400) {
            requestAnimationFrame(take);
          }
        };
        requestAnimationFrame(take);
      });
    type Frame = {
      transform: string;
      opacity: number;
      shown: boolean;
      busy: boolean;
    };
    const frames = (): Promise<Frame[]> =>
      page.evaluate(() => (window as any).__frames);

    await sample();
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    const opening = (await frames()).filter((f) => f.shown);
    expect(opening.length).toBeGreaterThan(0);
    for (const f of opening) {
      expect(f.transform, "no scale on the window as it opens").toBe("none");
    }
    expect(
      opening.some((f) => f.busy && f.opacity > 0 && f.opacity < 1),
      "the page faded in",
    ).toBe(true);
    await expect(page.locator("#page h1")).toHaveText("About");
    await expect(page.locator("#page h1")).toBeVisible();

    await sample();
    await page.keyboard.press("Escape");
    await settledOn(page, "/", null);
    const closing = (await frames()).filter((f) => f.shown);
    for (const f of closing) {
      expect(f.transform, "no scale on the window as it closes").toBe("none");
    }
    expect(
      closing.some((f) => f.busy && f.opacity > 0 && f.opacity < 1),
      "the page faded out",
    ).toBe(true);
    expect(errors).toEqual([]);
  });

  test("Escape and Enter close and open the phone at once, with no fold played", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const { errors } = watchErrors(page);
    await page.goto("/");
    await settledOn(page, "/", null);
    const first = await pose(page);
    // the fold in every frame from here on
    await page.evaluate(() => {
      const w = window as any;
      w.__folds = [];
      const take = () => {
        w.__folds.push(w.__capture.pose().fold);
        if (w.__folds.length < 600) {
          requestAnimationFrame(take);
        }
      };
      requestAnimationFrame(take);
    });
    const nextFrame = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      );
    await page.keyboard.press("Escape");
    await nextFrame();
    const closed = await pose(page);
    expect({
      phone: closed.phone,
      busy: closed.busy,
      fold: closed.fold,
    }).toEqual({
      phone: "closed",
      busy: false,
      fold: 1,
    });
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
    await nextFrame();
    const opened = await pose(page);
    expect({
      phone: opened.phone,
      busy: opened.busy,
      fold: opened.fold,
    }).toEqual({
      phone: "open",
      busy: false,
      fold: 0,
    });
    await page.waitForTimeout(500);
    const folds: number[] = await page.evaluate(() => (window as any).__folds);
    expect(
      folds.filter((f) => f !== 0 && f !== 1),
      "no frame caught the phone part way through a fold",
    ).toEqual([]);
    expect(
      largestChange(first, await pose(page)),
      "the phone and the hands are back where they started",
    ).toBeLessThan(1e-6);
    expect(errors).toEqual([]);
  });
});

test.describe("with reduced motion and a home bar swipe", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("letting go of the swipe crossfades home with no zoom and no pose tween", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const { errors } = watchErrors(page);
    await page.goto("/");
    await settledOn(page, "/", null);
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    const bar = await page.locator("#page .home-bar").boundingBox();
    expect(bar).not.toBeNull();
    const x = bar!.x + bar!.width / 2;
    const y = bar!.y + bar!.height / 2;
    // every frame from here until the close has settled, and the moment the pointer lets go
    await page.evaluate(() => {
      const w = window as any;
      w.__frames = [];
      addEventListener(
        "pointerup",
        () => {
          w.__upAt = performance.now();
        },
        { capture: true, once: true },
      );
      const take = () => {
        const el = document.getElementById("page")!;
        const p = w.__capture.pose();
        w.__frames.push({
          at: performance.now(),
          transform: getComputedStyle(el).transform,
          shown: el.checkVisibility({ visibilityProperty: true }),
          root: p.root,
        });
        if (w.__frames.length < 600) {
          requestAnimationFrame(take);
        }
      };
      requestAnimationFrame(take);
    });
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(x, y - i * 30);
    }
    await page.mouse.up();
    await settledOn(page, "/", null);
    type Frame = {
      at: number;
      transform: string;
      shown: boolean;
      root: number[];
    };
    const { frames, upAt } = await page.evaluate(() => ({
      frames: (window as any).__frames as Frame[],
      upAt: (window as any).__upAt as number,
    }));
    expect(upAt, "the pointer let go").toBeGreaterThan(0);
    const during = frames.filter((f) => f.at < upAt);
    expect(
      during.some((f) => f.transform !== "none"),
      "the drag still moves the window",
    ).toBe(true);
    // the first frame after the release can still show the drag's last styles, since this sampler may run before the
    // scene's own frame
    const after = frames.filter((f) => f.at > upAt).slice(1);
    expect(after.length).toBeGreaterThan(5);
    for (const f of after.filter((f) => f.shown)) {
      expect(f.transform, "no scale on the window after the release").toBe(
        "none",
      );
    }
    const roots = new Set(after.map((f) => JSON.stringify(f.root)));
    expect(roots.size, "the phone jumped to rest instead of moving").toBe(1);
    expect(errors).toEqual([]);
  });
});

test("the 2D version link loads the flat site and the 3D version link loads 3d again", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { errors } = watchErrors(page);
  await page.goto("/");
  await settledOn(page, "/", null);
  // the flat home page doesn't carry the 2d link, the 3d home screen does
  await expect(page.locator('#page a[data-version="2d"]')).toHaveCount(0);
  const link = page.locator('#css-layer .panel.main a[data-version="2d"]');
  await expect(link).toHaveText("2D version");
  // a full page load starts a new document, so a mark left on this one is gone after it
  await page.evaluate(() => Object.assign(window, { __before: true }));
  await Promise.all([page.waitForEvent("load"), link.click()]);
  await expect(page.locator("html")).not.toHaveClass(/has-3d/);
  expect(await page.evaluate(() => "__before" in window)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("2d"))).toBe("1");
  await expect(page.locator("#page h1")).toHaveText("Jason Yue");
  await expect(page.locator("#page h1")).toBeVisible();

  // the choice holds on the next visit
  await page.goto("/about");
  await expect(page.locator("html")).not.toHaveClass(/has-3d/);
  const back = page.locator('#page a[data-version="3d"]');
  await expect(back).toBeVisible();
  await page.evaluate(() => Object.assign(window, { __before: true }));
  await Promise.all([page.waitForEvent("load"), back.click()]);
  expect(await page.evaluate(() => "__before" in window)).toBe(false);
  await expect(page.locator("html")).toHaveClass(/has-3d/);
  expect(await page.evaluate(() => localStorage.getItem("2d"))).toBeNull();
  await page.waitForFunction(
    () => (window as unknown as { __sceneShown?: boolean }).__sceneShown,
    null,
    { timeout: 30000 },
  );
  // in 3d the flat footer's 3d link doesn't show
  await settledOn(page, "/about", "About");
  await expect(page.locator('#page a[data-version="3d"]')).toBeHidden();
  expect(errors).toEqual([]);
});
