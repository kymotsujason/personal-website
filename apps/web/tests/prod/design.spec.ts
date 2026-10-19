// the page shell's glass and depth, against the capture build
import { expect, test } from "@playwright/test";
import { daylight } from "../../src/scene/daylight.js";
import { sunPlace } from "../../src/scene/skyPath.js";
import { skyVars } from "../../src/lib/sky.js";
import { quiet, settledOn, tapIcon } from "./scene";

const flatSite = async (page: import("@playwright/test").Page) => {
  await page.addInitScript(() => localStorage.setItem("2d", "1"));
};

test.describe("the flat site", () => {
  for (const path of [
    "/about",
    "/projects",
    "/projects/device-intro",
    "/blog",
    "/blog/new-equipment-to-keep-things-interesting",
    "/music",
    "/no-such-page",
  ]) {
    test(`${path} doesn't scroll sideways at 320 by 568`, async ({ page }) => {
      await flatSite(page);
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto(path);
      await expect(page.locator("#page h1")).toBeVisible();
      const sizes = await page.evaluate(() => {
        const body = document.querySelector("#page > .body")!;
        return { scroll: body.scrollWidth, client: body.clientWidth };
      });
      expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
    });
  }

  test("glass shows a focus ring", async ({ page }) => {
    await flatSite(page);
    await page.goto("/projects/device-intro");
    const first = page.locator("#page a").first();
    await expect(first).toHaveClass(/glass/);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      if (await first.evaluate((el) => el === document.activeElement)) {
        break;
      }
    }
    await expect(first).toBeFocused();
    // the glass always has a drop shadow, so only the outline can show focus
    const ring = await first.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        style: cs.outlineStyle,
        width: cs.outlineWidth,
        color: cs.outlineColor,
      };
    });
    // the site's own rule in flat.css, since the browser's default ring is "auto"
    expect(ring).toEqual({
      style: "solid",
      width: "2px",
      color: "rgba(255, 255, 255, 0.9)",
    });
  });

  test("the sky drifts against the pointer", async ({ page }) => {
    await flatSite(page);
    await page.goto("/about");
    await page.mouse.move(40, 40);
    await page.mouse.move(1000, 600);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            getComputedStyle(document.querySelector("#page .sky")!).transform,
        ),
      )
      .not.toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  });

  const IDENTITY =
    /^(none|matrix\(1, 0, 0, 1, 0, 0\)|matrix3d\(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1\))$/;

  // the stylesheet's own guard: with the depth inputs set by hand, which depth.js would never write under reduced
  // motion, the layers stay still
  test("reduced motion's css leaves depth layers untransformed", async ({
    page,
  }) => {
    await flatSite(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/about");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--px", "1");
      document.documentElement.style.setProperty("--py", "1");
    });
    const transforms = await page.evaluate(() =>
      [...document.querySelectorAll("#page .sky, #page .depth")].map(
        (el) => getComputedStyle(el).transform,
      ),
    );
    expect(transforms.length).toBeGreaterThan(0);
    for (const transform of transforms) {
      expect(transform).toMatch(IDENTITY);
    }
  });

  // the control for the test below: without reduced motion these pointer moves do write the depth inputs
  test("the same pointer moves write depth inputs without reduced motion", async ({
    page,
  }) => {
    await flatSite(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/about");
    await page.mouse.move(40, 40);
    await page.mouse.move(1000, 600);
    await expect
      .poll(() =>
        page.evaluate(() =>
          ["--px", "--py"].map((name) =>
            document.documentElement.style.getPropertyValue(name),
          ),
        ),
      )
      .not.toEqual(["", ""]);
    const lit = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>("#page .glass")].filter(
          (el) => el.style.getPropertyValue("--hl-x"),
        ).length,
    );
    expect(lit).toBeGreaterThan(0);
  });

  // the script's own guard: the same pointer moves that drift the sky write no depth input under reduced motion
  test("reduced motion's script writes no depth inputs", async ({ page }) => {
    await flatSite(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/about");
    await page.mouse.move(40, 40);
    await page.mouse.move(1000, 600);
    await page.waitForTimeout(500);
    const inputs = await page.evaluate(() =>
      ["--px", "--py"].map((name) =>
        document.documentElement.style.getPropertyValue(name),
      ),
    );
    expect(inputs).toEqual(["", ""]);
    const lit = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>("#page .glass")].filter(
          (el) => el.style.getPropertyValue("--hl-x"),
        ).length,
    );
    expect(lit).toBe(0);
  });

  // the panes carry a depth transform, which measures a fixed background from the pane, so the highlight is written
  // in each pane's own coordinates
  test("the glass highlight sits under the pointer", async ({ page }) => {
    await flatSite(page);
    await page.goto("/about");
    const pane = page.locator("#page .glass").first();
    const box = await pane.boundingBox();
    if (!box) {
      throw new Error("no glass pane on /about");
    }
    await page.mouse.move(box.x + 120, box.y + 80);
    await expect
      .poll(async () => {
        const [x, y, now] = await pane.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return [
            el.style.getPropertyValue("--hl-x"),
            el.style.getPropertyValue("--hl-y"),
            { x: r.x, y: r.y },
          ] as const;
        });
        return [
          Math.abs(parseFloat(x) - (box.x + 120 - now.x)) <= 1,
          Math.abs(parseFloat(y) - (box.y + 80 - now.y)) <= 1,
        ];
      })
      .toEqual([true, true]);
    await page.mouse.move(-10, -10);
    await page.evaluate(() =>
      document.documentElement.dispatchEvent(new PointerEvent("pointerleave")),
    );
    await expect
      .poll(() => pane.evaluate((el) => el.style.getPropertyValue("--hl-x")))
      .toBe("");
  });

  test("only a page with a ring or a hero gets the scroll inputs", async ({
    page,
  }) => {
    await flatSite(page);
    await page.goto("/about");
    await page.locator("#page > .body").evaluate((el) => (el.scrollTop = 50));
    await page.mouse.move(40, 40);
    await page.waitForTimeout(300);
    const written = (names: string[]) =>
      page.evaluate(
        (list) =>
          list.map((name) =>
            document.documentElement.style.getPropertyValue(name),
          ),
        names,
      );
    expect(await written(["--read", "--scroll"])).toEqual(["", ""]);
    await page.goto("/blog/new-equipment-to-keep-things-interesting");
    await page.locator("#page > .body").evaluate((el) => (el.scrollTop = 50));
    await expect
      .poll(async () => (await written(["--scroll"]))[0])
      .not.toBe("");
  });
});

// the sky from the visitor's clock, in a browser whose clock is fixed in Vancouver
const HOURS = [
  { label: "noon", iso: "2026-10-18T12:00:00-07:00", hour: 12 },
  { label: "23:00", iso: "2026-10-18T23:00:00-07:00", hour: 23 },
];

for (const { label, iso, hour } of HOURS) {
  const expected = () => {
    const sun = sunPlace(hour, { sunrise: 7, sunset: 19 });
    const { day, warm } = daylight(hour);
    return skyVars({
      day,
      warm,
      scene: "clear",
      intensity: "moderate",
      sun: [sun.x, sun.y],
      sunUp: sun.up,
      moon: null,
      moonUp: 0,
    });
  };
  const rootVars = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const style = document.documentElement.style;
      return {
        top: style.getPropertyValue("--sky-top"),
        low: style.getPropertyValue("--sky-low"),
        dimTop: style.getPropertyValue("--dim-top"),
      };
    });

  test(`the flat site's sky follows a fixed clock at ${label}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      timezoneId: "America/Vancouver",
    });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(iso) });
    await flatSite(page);
    await page.goto("/about");
    const want = expected();
    await expect
      .poll(() => rootVars(page))
      .toEqual({
        top: want["--sky-top"],
        low: want["--sky-low"],
        dimTop: want["--dim-top"],
      });
    await context.close();
  });

  test(`a 3d page first arrival shows the clock's sky at ${label} before the scene`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      timezoneId: "America/Vancouver",
    });
    const page = await context.newPage();
    // only Date moves, since Playwright's fake clock hides the reload from the head script, and that reload is
    // what makes this a page first arrival
    await page.addInitScript((time) => {
      const Real = Date;
      const offset = time - Real.now();
      window.Date = class extends Real {
        constructor(...args: unknown[]) {
          if (args.length === 0) {
            super(Real.now() + offset);
          } else {
            super(...(args as [number]));
          }
        }
        static now() {
          return Real.now() + offset;
        }
      } as DateConstructor;
    }, new Date(iso).getTime());
    // the phone model never arrives, so the scene can't show or write its own sky
    await page.route("**/models/phone.packed.glb", () => {});
    await page.goto("/about");
    await page.reload({ waitUntil: "domcontentloaded" });
    const state = await page.evaluate(() => ({
      pageFirst: document.documentElement.classList.contains("page-first"),
      has3d: document.documentElement.classList.contains("has-3d"),
      shown: Boolean(
        (window as unknown as { __sceneShown?: boolean }).__sceneShown,
      ),
    }));
    expect(state).toEqual({ pageFirst: true, has3d: true, shown: false });
    const want = expected();
    await expect
      .poll(() => rootVars(page))
      .toEqual({
        top: want["--sky-top"],
        low: want["--sky-low"],
        dimTop: want["--dim-top"],
      });
    expect(
      await page.evaluate(
        () => (window as unknown as { __sceneShown?: boolean }).__sceneShown,
      ),
    ).toBeFalsy();
    await context.close();
  });
}

test("glass blurs at full zoom and not while pinned", async ({ page }) => {
  test.setTimeout(120000);
  await quiet(page);
  await page.goto("/");
  await settledOn(page, "/", null);
  await tapIcon(page, "Projects");
  await settledOn(page, "/projects", "Projects");
  await page.locator('#page a[href="/projects/device-intro"]').click();
  await settledOn(page, "/projects/device-intro", "Projects");
  const filter = () =>
    page.evaluate(() => {
      const pill = document.querySelector<HTMLElement>("#page .pill.back");
      return {
        blur: pill ? getComputedStyle(pill).backdropFilter : "missing",
        pinned: document.documentElement.classList.contains("page-pinned"),
      };
    });
  const zoomed = await filter();
  expect(zoomed.pinned).toBe(false);
  expect(zoomed.blur).toContain("blur");

  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.documentElement.classList.contains("page-pinned"),
    null,
    { polling: "raf", timeout: 30000 },
  );
  const pinned = await filter();
  expect(pinned.blur).toBe("none");
});
