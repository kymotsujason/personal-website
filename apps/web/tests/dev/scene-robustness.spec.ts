import { expect, test, type Page } from "@playwright/test";
import { stubHome } from "../stubHome";

// every request that leaves the dev server is answered here, so no test waits on the network
const quiet = async (page: Page) => {
  await stubHome(page);
  await page.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => route.fulfill({ status: 503, body: "" }),
  );
};

const phone = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).spike.state;
    return { phone: s.phone, busy: s.busy, zoomed: s.zoomed };
  });

const openAt = async (page: Page, path: string, zoomed: boolean) => {
  await page.goto(`${path}?dev&noweather`);
  await page.waitForFunction(() => Boolean((window as any).spike));
  await expect
    .poll(() => phone(page), { timeout: 15000 })
    .toEqual({ phone: "open", busy: false, zoomed });
};

// resizes the window and waits for the phone to be built again for it, at rest
const rebuildAt = async (
  page: Page,
  size: { width: number; height: number },
  zoomed: boolean,
) => {
  const before = await page.evaluateHandle(() =>
    document.querySelector("#css-layer .screen"),
  );
  await page.setViewportSize(size);
  await expect
    .poll(() =>
      page.evaluate(
        (el) => document.querySelector("#css-layer .screen") !== el,
        before,
      ),
    )
    .toBe(true);
  await expect
    .poll(() => phone(page))
    .toEqual({ phone: "open", busy: false, zoomed });
};

test.beforeEach(async ({ page }) => {
  await quiet(page);
  await page.addInitScript(() => {
    localStorage.setItem("introSeen", "1");
  });
});

test("with reduced motion the cable goes in at once, with no reach for it and no shake", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openAt(page, "/", false);
  const statusPath = "/src/scene/status.js";
  // a battery near empty loads the cable's code, and the charge starts a moment later
  await page.evaluate(async (path) => {
    const { BATTERY_DRAIN } = await import(path);
    (window as any).spike.statusBar.setBattery(BATTERY_DRAIN - 20000);
  }, statusPath);
  await page.waitForFunction(() => Boolean((window as any).spike.charger()));
  const seen = await page.evaluate(async (path) => {
    const { BATTERY_DRAIN } = await import(path);
    const spike = (window as any).spike;
    spike.statusBar.setBattery(BATTERY_DRAIN - 200);
    const moved = { busy: false, lift: 0, handOff: 0 };
    const end = performance.now() + 3500;
    while (performance.now() < end) {
      await new Promise(requestAnimationFrame);
      const charger = spike.charger();
      moved.busy = moved.busy || charger.busy();
      moved.lift = Math.max(moved.lift, charger.lift());
      moved.handOff = Math.max(moved.handOff, charger.handOff());
    }
    return {
      ...moved,
      plugged: spike.charger().plugged(),
      charging: spike.statusBar.status.charging,
    };
  }, statusPath);
  expect(seen).toEqual({
    busy: false,
    lift: 0,
    handOff: 0,
    plugged: true,
    charging: true,
  });
});

test("a fold swipe held through a rebuild is dropped, not finished with the old phone's poses", async ({
  page,
}) => {
  await openAt(page, "/", false);
  const { outer, inner } = await page.evaluate(() =>
    (window as any).spike.phoneEdges(),
  );
  // landscape closes from the border on the left
  const x = (outer.left + inner.left) / 2;
  const y = (outer.top + outer.bottom) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(x + i * 40, y);
  }
  expect(await phone(page)).toEqual({
    phone: "open",
    busy: true,
    zoomed: false,
  });
  await rebuildAt(page, { width: 1100, height: 700 }, false);
  await page.mouse.move(x + 400, y);
  await page.mouse.up();
  // longer than a fold the release could have finished
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const { state, pose } = (window as any).spike;
    return {
      phone: state.phone,
      busy: state.busy,
      fold: pose.fold,
      z: Math.abs(pose.z - state.poses.rest.z) < 1e-6,
    };
  });
  expect(after).toEqual({ phone: "open", busy: false, fold: 0, z: true });
});

test("a home bar swipe held through a rebuild is dropped, and the app stays whole", async ({
  page,
}) => {
  await openAt(page, "/about", true);
  const bar = await page.locator("#page .home-bar").boundingBox();
  expect(bar).not.toBeNull();
  const x = bar!.x + bar!.width / 2;
  const y = bar!.y + bar!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 3; i++) {
    await page.mouse.move(x, y - i * 30);
  }
  expect(await phone(page)).toEqual({
    phone: "open",
    busy: true,
    zoomed: true,
  });
  await rebuildAt(page, { width: 1100, height: 700 }, true);
  await page.mouse.move(x, y - 120);
  const card = await page.evaluate(() => {
    const { screen } = (window as any).spike.state;
    const r = screen.appHole.material.uniforms.rect.value;
    return [r.x, r.y, r.z, r.w].map((v, i) =>
      Math.round(v - [0, 0, screen.fullW, screen.fullH][i]),
    );
  });
  await page.mouse.up();
  expect(card, "the app window still fills the screen").toEqual([0, 0, 0, 0]);
  await page.waitForTimeout(800);
  expect(await phone(page)).toEqual({
    phone: "open",
    busy: false,
    zoomed: true,
  });
});

test("a fold swipe that arms after Escape started the close doesn't move the phone alongside it", async ({
  page,
}) => {
  await openAt(page, "/", false);
  const { outer, inner } = await page.evaluate(() =>
    (window as any).spike.phoneEdges(),
  );
  const x = (outer.left + inner.left) / 2;
  const y = (outer.top + outer.bottom) / 2;
  // the fold and busy in every frame from here until the close has long ended
  await page.evaluate(() => {
    const w = window as any;
    w.__folds = [];
    const take = () => {
      const { state, pose } = w.spike;
      w.__folds.push({ fold: pose.fold, busy: state.busy });
      if (w.__folds.length < 240) {
        requestAnimationFrame(take);
      }
    };
    requestAnimationFrame(take);
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => (window as any).spike.state.busy, null, {
    polling: "raf",
  });
  for (let i = 1; i <= 3; i++) {
    await page.mouse.move(x + i * 15, y);
  }
  // a slow last step, so the release is no flick and a swipe that took hold would spring back
  await page.waitForTimeout(150);
  await page.mouse.move(x + 46, y);
  await page.mouse.up();
  await page.waitForFunction(
    () => (window as any).__folds.length >= 240,
    null,
    { timeout: 15000 },
  );
  const folds: { fold: number; busy: boolean }[] = await page.evaluate(
    () => (window as any).__folds,
  );
  const backward = folds.findIndex(
    (f, i) => i > 0 && f.fold < folds[i - 1].fold - 1e-9,
  );
  expect(backward, "the fold never turned back during the close").toBe(-1);
  expect(
    folds.some((f) => !f.busy && f.fold > 0.001 && f.fold < 0.999),
    "the phone never folded while the scene said it was still",
  ).toBe(false);
  const after = await page.evaluate(() => {
    const { state, pose } = (window as any).spike;
    return { phone: state.phone, busy: state.busy, fold: pose.fold };
  });
  expect(after).toEqual({ phone: "closed", busy: false, fold: 1 });
});

test("a home bar swipe that arms after Escape started the close is dropped, and the flat page doesn't stay over home", async ({
  page,
}) => {
  await openAt(page, "/about", true);
  const bar = await page.locator("#page .home-bar").boundingBox();
  expect(bar).not.toBeNull();
  const x = bar!.x + bar!.width / 2;
  const y = bar!.y + bar!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => {
      const { state } = (window as any).spike;
      return state.busy && !state.zoomed;
    },
    null,
    { polling: "raf" },
  );
  for (let i = 1; i <= 3; i++) {
    await page.mouse.move(x, y - i * 6);
  }
  // a slow last step, so the release is no flick and a swipe that took hold would spring back
  await page.waitForTimeout(150);
  await page.mouse.move(x, y - 19);
  await page.mouse.up();
  await expect
    .poll(() => phone(page), { timeout: 15000 })
    .toEqual({ phone: "open", busy: false, zoomed: false });
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => {
    const { state } = (window as any).spike;
    return {
      pageFlat: state.pageFlat,
      busy: state.busy,
      zoomed: state.zoomed,
      path: location.pathname,
    };
  });
  expect(after).toEqual({
    pageFlat: false,
    busy: false,
    zoomed: false,
    path: "/",
  });
});

test("a fold swipe that's cancelled springs back instead of finishing", async ({
  page,
}) => {
  await openAt(page, "/", false);
  const { outer, inner } = await page.evaluate(() =>
    (window as any).spike.phoneEdges(),
  );
  const x = (outer.left + inner.left) / 2;
  const y = (outer.top + outer.bottom) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x + i * 50, y);
  }
  // a slow last step, so it's no flick either way
  await page.waitForTimeout(150);
  await page.mouse.move(x + 501, y);
  const held = await page.evaluate(async (path) => {
    const { gesture } = await import(path);
    return gesture
      ? { armed: gesture.armed, travel: gesture.travel, id: gesture.id }
      : null;
  }, "/src/scene/fold.js");
  expect(held, "the swipe took hold").not.toBeNull();
  expect(held!.armed).toBe(true);
  expect(
    held!.travel,
    "far enough that a release would finish it",
  ).toBeGreaterThan(0.5);
  await page.evaluate(
    (id) =>
      dispatchEvent(
        new PointerEvent("pointercancel", {
          pointerId: id,
          pointerType: "mouse",
        }),
      ),
    held!.id,
  );
  await page.mouse.up();
  // longer than the spring back or the finish would take
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const { state, pose } = (window as any).spike;
    return { phone: state.phone, busy: state.busy, fold: pose.fold };
  });
  expect(after).toEqual({ phone: "open", busy: false, fold: 0 });
});

test("a music bar scrub held through a rebuild is dropped, and the new bar follows the music", async ({
  page,
}) => {
  await openAt(page, "/", false);
  // a track a quarter of the way through, so the bar takes a drag
  await page.evaluate(async (path) => {
    const { music } = await import(path);
    music.position = () => ({ time: 50, duration: 200, at: 0.25 });
  }, "/src/layout/player.js");
  const bar = () =>
    page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#css-layer .m-progress")!;
      const r = el.getBoundingClientRect();
      return {
        x: r.x + r.width * 0.75,
        y: r.y + r.height / 2,
        at: Number(el.dataset.at),
        dragging: el.dataset.dragging,
      };
    });
  const start = await bar();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 2, start.y);
  const held = await bar();
  expect(held.dragging, "the bar took the drag").toBe("true");
  expect(held.at).toBeGreaterThan(0.5);
  await rebuildAt(page, { width: 1100, height: 700 }, false);
  await page.mouse.up();
  // the bar reads the music each half second
  await page.waitForTimeout(1200);
  const after = await bar();
  expect({ at: after.at, dragging: after.dragging }).toEqual({
    at: 0.25,
    dragging: "false",
  });
});

test("a rebuild draws the music's place on the new bar while the music holds still", async ({
  page,
}) => {
  await openAt(page, "/", false);
  await page.evaluate(async (path) => {
    const { music } = await import(path);
    music.position = () => ({ time: 50, duration: 200, at: 0.25 });
  }, "/src/layout/player.js");
  const shownAt = () =>
    page.evaluate(() =>
      Number(
        document.querySelector<HTMLElement>("#css-layer .m-progress")!.dataset
          .at,
      ),
    );
  await expect.poll(shownAt).toBe(0.25);
  await rebuildAt(page, { width: 1100, height: 700 }, false);
  await page.waitForTimeout(1200);
  expect(await shownAt()).toBe(0.25);
});

test("a rebuild frees the old phone's geometry and textures", async ({
  page,
}) => {
  await openAt(page, "/", false);
  // the volume buttons load once the intro has played, and they're part of the phone a rebuild makes
  await page.waitForFunction(() => Boolean((window as any).spike.state.volume));
  const memory = () =>
    page.evaluate(() => {
      const { geometries, textures } = (window as any).spike.renderInfo();
      return { geometries, textures };
    });
  // a texture or two arrive in the frames after a build, so the count is read once it holds for half a second
  const steady = async () => {
    let last = await memory();
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);
      const now = await memory();
      if (JSON.stringify(now) === JSON.stringify(last)) {
        return now;
      }
      last = now;
    }
    return last;
  };
  await rebuildAt(page, { width: 1100, height: 700 }, false);
  const first = await steady();
  await rebuildAt(page, { width: 1280, height: 720 }, false);
  await rebuildAt(page, { width: 1100, height: 700 }, false);
  await rebuildAt(page, { width: 1280, height: 720 }, false);
  await rebuildAt(page, { width: 1100, height: 700 }, false);
  expect(await steady()).toEqual(first);
});

test("a change of the desk's lighting frees the lighting map it replaces", async ({
  page,
}) => {
  await openAt(page, "/", false);
  const textures = () =>
    page.evaluate(() => (window as any).spike.renderInfo().textures);
  // the lighting map follows the wallpaper, image 0 by day and 1 at dusk (see monitors.js). each image loads once, so
  // after the first two changes a change only makes a new map
  const lightAt = async (hour: number, wait: number) => {
    await page.evaluate((h) => (window as any).spike.daylight(h), hour);
    await page.waitForTimeout(wait);
  };
  await lightAt(12, 1500);
  await lightAt(18, 1500);
  await lightAt(12, 500);
  const first = await textures();
  for (let i = 0; i < 3; i++) {
    await lightAt(18, 500);
    await lightAt(12, 500);
  }
  expect(await textures()).toBe(first);
});
