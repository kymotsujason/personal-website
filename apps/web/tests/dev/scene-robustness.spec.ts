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
