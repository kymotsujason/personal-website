// the layout's music in 3d, without webgl, and with the scene chunk blocked, against the capture build
import { expect, test, type Page } from "@playwright/test";
import TRACKS from "../../src/data/tracks.json" with { type: "json" };
import { artFor, cleanTitle } from "../../src/scene/music.js";
import {
  FAKE_YOUTUBE,
  quiet,
  scrollPage,
  settledOn,
  tapIcon,
  watchErrors,
} from "./scene";

const isSceneChunk = (body: string) => body.includes("the scene failed");

const HEADINGS: Record<string, string> = {
  "/": "Jason Yue",
  "/about": "About",
  "/music": "Music",
};
const APPS: Record<string, string | null> = {
  "/": null,
  "/about": "About",
  "/music": "Music",
};

type Youtube = {
  players: number;
  plays: number;
  pauses: number;
  playedAt: number[];
  state: number;
};

const youtube = (page: Page): Promise<Youtube | null> =>
  page.evaluate(() => {
    const yt = (window as unknown as { __yt?: Youtube }).__yt;
    return yt
      ? {
          players: yt.players,
          plays: yt.plays,
          pauses: yt.pauses,
          playedAt: [...yt.playedAt],
          state: yt.state,
        }
      : null;
  });

const placement = (page: Page) =>
  page.evaluate(() => {
    const round = (r: DOMRect) =>
      [r.left, r.top, r.width, r.height].map((v) => Math.round(v));
    const slot = document.querySelector("#page .player-slot");
    return {
      host: round(
        document.getElementById("player-host")!.getBoundingClientRect(),
      ),
      slot: slot ? round(slot.getBoundingClientRect()) : null,
    };
  });

const expectOverSlot = async (page: Page) => {
  await expect
    .poll(
      async () => {
        const { host, slot } = await placement(page);
        return slot !== null && slot[2] > 0 && host.join() === slot.join();
      },
      { message: "the player sits over the slot" },
    )
    .toBe(true);
};

const expectParked = async (page: Page) => {
  await expect
    .poll(async () => (await placement(page)).host[0], {
      message: "the player waits off screen",
    })
    .toBe(-10000);
};

// a link inside the current page, the way a page's own content links elsewhere
const followLink = async (page: Page, href: string) => {
  await page.evaluate((href) => {
    const link = document.createElement("a");
    link.href = href;
    link.id = "test-link";
    link.textContent = "a link";
    document.querySelector("#page .column")!.prepend(link);
  }, href);
  await page.locator("#test-link").click();
};

type Mode = {
  arrived: (page: Page, path: string) => Promise<void>;
  goHome: (page: Page) => Promise<void>;
  openAbout: (page: Page) => Promise<void>;
};

const THREE_D: Mode = {
  arrived: (page, path) => settledOn(page, path, APPS[path]),
  goHome: (page) => page.keyboard.press("Escape"),
  openAbout: (page) =>
    page.evaluate(() => {
      const icon = [
        ...document.querySelectorAll<HTMLElement>(
          "#css-layer .panel.main .app-icon",
        ),
      ].find((el) => el.textContent?.includes("About"));
      icon!.click();
    }),
};

const FLAT: Mode = {
  arrived: async (page, path) => {
    await expect(page).toHaveURL((url) => url.pathname === path);
    await expect(page.locator("#page h1")).toHaveText(HEADINGS[path]);
    await expect(page.locator("#page h1")).toBeVisible();
    await expect(page.locator("html")).not.toHaveClass(/has-3d/);
  },
  goHome: (page) => page.locator("#page .home-bar").click(),
  openAbout: (page) => page.locator('#page .app-icon[href="/about"]').click(),
};

// a track tapped before the player is ready, then seven navigations with the music playing on
const checkMusic = async (page: Page, mode: Mode) => {
  const { errors, blocked } = watchErrors(page);
  let apiAsked = 0;
  let oembed = 0;
  let releaseApi = () => {};
  const apiHeld = new Promise<void>((resolve) => {
    releaseApi = resolve;
  });
  page.on("request", (request) => {
    if (request.url().includes("youtube.com/oembed")) {
      oembed += 1;
    }
  });
  // held, so the track is tapped before the player is ready
  await page.route("https://www.youtube.com/iframe_api", async (route) => {
    apiAsked += 1;
    await apiHeld;
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: FAKE_YOUTUBE,
    });
  });
  return {
    errors,
    blocked,
    run: async () => {
      await mode.arrived(page, "/music");
      await expect
        .poll(() => apiAsked, { message: "the music page loads the player" })
        .toBe(1);
      expect(await youtube(page), "the player isn't ready yet").toBeNull();
      const track = page.locator('#page .tracks li[data-track="4"]');
      await track.click();
      releaseApi();
      await expect
        .poll(() => youtube(page))
        .toMatchObject({ players: 1, playedAt: [4], state: 1, pauses: 0 });
      await expect(track).toHaveClass(/current/);
      await expect(page.locator("#page .tracks li.current")).toHaveCount(1);
      await expectOverSlot(page);
      await scrollPage(page);
      await expectOverSlot(page);
      await page.setViewportSize({ width: 1000, height: 640 });
      await mode.arrived(page, "/music");
      await expectOverSlot(page);
      await page.evaluate(() => {
        const w = window as unknown as { __frame?: Element | null };
        w.__frame = document.querySelector("#player-host iframe");
      });

      const steps: [string, string, (page: Page) => Promise<unknown>][] = [
        ["home", "/", mode.goHome],
        ["Back", "/music", (p) => p.goBack()],
        ["Forward", "/", (p) => p.goForward()],
        ["an app", "/about", mode.openAbout],
        ["another app", "/music", (p) => followLink(p, "/music")],
        ["Back", "/about", (p) => p.goBack()],
        ["Forward", "/music", (p) => p.goForward()],
      ];
      for (const [name, path, go] of steps) {
        await go(page);
        await mode.arrived(page, path);
        if (path === "/music") {
          await expectOverSlot(page);
          await expect(track).toHaveClass(/current/);
        } else {
          await expectParked(page);
        }
        const now = await page.evaluate(() => {
          const w = window as unknown as { __frame?: Element | null };
          const frame = document.querySelector("#player-host iframe");
          return { same: frame === w.__frame, src: frame?.getAttribute("src") };
        });
        expect(now.same, `the same iframe after ${name}`).toBe(true);
        expect(now.src).toBe("about:blank#fake-youtube-1");
        expect(
          await youtube(page),
          `still playing after ${name}`,
        ).toMatchObject({ players: 1, pauses: 0, state: 1 });
      }
      expect(oembed, "no oembed requests").toBe(0);
      expect(errors).toEqual([]);
    },
  };
};

test.describe("with javascript off", () => {
  test.use({ javaScriptEnabled: false });

  test("/music lists the 13 tracks with their titles, channels, and art", async ({
    page,
  }) => {
    await quiet(page);
    await page.goto("/music");
    const items = page.locator("#page .tracks li");
    await expect(items).toHaveCount(13);
    expect(TRACKS).toHaveLength(13);
    await expect(items.locator(".t")).toHaveText(
      TRACKS.map((t) => cleanTitle(t.title)),
    );
    await expect(items.locator(".c")).toHaveText(TRACKS.map((t) => t.channel));
    const art = await items
      .locator("img")
      .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src")));
    expect(art).toEqual(TRACKS.map((t) => artFor(t.id)));
    // youtube's thumbnails load as the list scrolls to them, not all with the page
    const loading = await items
      .locator("img")
      .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("loading")));
    expect(loading).toEqual(TRACKS.map(() => "lazy"));
    await expect(page.locator("#page .player-slot")).toBeVisible();
    // the server's html shows the first track as the one playing
    const now = page.locator("#page .music .now");
    await expect(now.locator(".now-title")).toHaveText(
      cleanTitle(TRACKS[0].title),
    );
    await expect(now.locator(".now-channel")).toHaveText(TRACKS[0].channel);
    await expect(page.locator("#page > .backdrop img")).toHaveAttribute(
      "src",
      artFor(TRACKS[0].id),
    );
    await expect(page.locator("#page .music .count")).toHaveText(
      `${TRACKS.length} songs`,
    );
    await expect(page.locator("#page .tracks li.current")).toHaveAttribute(
      "data-track",
      "0",
    );
    await expect(page.locator("#page .tracks li.current")).toHaveCount(1);
  });

  test("the home card shows the first track and its art", async ({ page }) => {
    await quiet(page);
    await page.goto("/");
    const card = page.locator("#page .music-card");
    await expect(card.locator(".m-title")).toHaveText(
      cleanTitle(TRACKS[0].title),
    );
    await expect(card.locator(".m-channel")).toHaveText(TRACKS[0].channel);
    await expect(card.locator("img.art")).toHaveAttribute(
      "src",
      `https://i.ytimg.com/vi/${TRACKS[0].id}/hqdefault.jpg`,
    );
  });
});

test.describe("the flat music page", () => {
  const flatMusic = async (page: Page, music?: "on") => {
    await page.addInitScript((music) => {
      localStorage.setItem("2d", "1");
      if (music) {
        localStorage.setItem("music", music);
      }
    }, music);
  };

  // the player is cued and waiting, the way the music page leaves it after the load event
  const ready = (page: Page) =>
    expect
      .poll(() => youtube(page), { message: "the player is cued" })
      .toMatchObject({ players: 1, state: 5, plays: 0 });

  test("the first press on the play pill plays once", async ({ page }) => {
    await quiet(page);
    // music left on last visit, so a first press anywhere else would resume it
    await flatMusic(page, "on");
    await page.goto("/music");
    await ready(page);
    const toggle = page.locator('#page [data-music="toggle"]');
    await expect(toggle).toHaveText("Play");
    await toggle.click();
    await expect
      .poll(() => youtube(page))
      .toMatchObject({ plays: 1, pauses: 0, state: 1 });
    await expect(toggle).toHaveText("Pause");
    // a later frame could still pause or play again
    await page.waitForTimeout(300);
    expect(await youtube(page)).toMatchObject({ plays: 1, pauses: 0 });
  });

  test("a track change updates the title, the channel, the backdrop, and the current row", async ({
    page,
  }) => {
    await quiet(page);
    await flatMusic(page);
    await page.goto("/music");
    await ready(page);
    const now = page.locator("#page .music .now");
    const backdrop = page.locator("#page > .backdrop img.front");
    const expectTrack = async (i: number) => {
      await expect(now.locator(".now-title")).toHaveText(
        cleanTitle(TRACKS[i].title),
      );
      await expect(now.locator(".now-channel")).toHaveText(TRACKS[i].channel);
      await expect(backdrop).toHaveAttribute("src", artFor(TRACKS[i].id));
      await expect(backdrop).toBeVisible();
      await expect(page.locator("#page .tracks li.current")).toHaveAttribute(
        "data-track",
        String(i),
      );
      await expect(page.locator("#page .tracks li.current")).toHaveCount(1);
    };
    await expect(page.locator("#page .sky")).toBeHidden();
    await page.locator('#page .tracks li[data-track="4"]').click();
    await expectTrack(4);
    await expect(page.locator('#page [data-music="toggle"]')).toHaveText(
      "Pause",
    );
    await page.locator('#page [data-music="previous"]').click();
    await expectTrack(3);
    await page.locator('#page [data-music="toggle"]').click();
    await expect(page.locator('#page [data-music="toggle"]')).toHaveText(
      "Play",
    );
    expect(await youtube(page)).toMatchObject({ pauses: 1, state: 2 });
    await expect(page.locator("#page .sky")).toBeHidden();
  });

  test("art that fails to load leaves the sky", async ({ page }) => {
    await quiet(page);
    await page.route(
      (url) => url.hostname === "i.ytimg.com",
      (route) => route.abort(),
    );
    await flatMusic(page);
    await page.goto("/music");
    await ready(page);
    await expect(page.locator("#page > .backdrop img")).toHaveCount(1);
    await expect(page.locator("#page > .backdrop")).toBeHidden();
    await expect(page.locator("#page .sky")).toBeVisible();
  });

  test("the player stays over the slot when a long title comes in", async ({
    page,
  }) => {
    await quiet(page);
    await flatMusic(page);
    await page.setViewportSize({ width: 1400, height: 850 });
    await page.goto("/music");
    await ready(page);
    await expectOverSlot(page);
    const longest = TRACKS.reduce(
      (best, track, i) =>
        cleanTitle(track.title).length > cleanTitle(TRACKS[best].title).length
          ? i
          : best,
      0,
    );
    // a click without the scroll into view that would move the player anyway
    await page
      .locator(`#page .tracks li[data-track="${longest}"]`)
      .dispatchEvent("click");
    await expect(page.locator("#page .now-title")).toHaveText(
      cleanTitle(TRACKS[longest].title),
    );
    await expectOverSlot(page);
  });

  test("a press on Prev before the player is ready runs once it is", async ({
    page,
  }) => {
    await quiet(page);
    let apiAsked = 0;
    let releaseApi = () => {};
    const apiHeld = new Promise<void>((resolve) => {
      releaseApi = resolve;
    });
    await page.route("https://www.youtube.com/iframe_api", async (route) => {
      apiAsked += 1;
      await apiHeld;
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: FAKE_YOUTUBE,
      });
    });
    await flatMusic(page);
    await page.goto("/music");
    await expect.poll(() => apiAsked).toBe(1);
    expect(await youtube(page), "the player isn't ready yet").toBeNull();
    await page.locator('#page [data-music="previous"]').click();
    releaseApi();
    // the list loops, so the first track's previous is the last
    await expect
      .poll(() => youtube(page))
      .toMatchObject({ playedAt: [TRACKS.length - 1], state: 1, pauses: 0 });
    await expect(page.locator("#page .now-title")).toHaveText(
      cleanTitle(TRACKS[TRACKS.length - 1].title),
    );
  });

  test("a blocked youtube api says the music is unavailable, and a later press plays once it's back", async ({
    page,
  }) => {
    await quiet(page);
    const { errors, blocked } = watchErrors(page);
    const apiUrl = "https://www.youtube.com/iframe_api";
    blocked.add(apiUrl);
    await page.route(apiUrl, (route) => route.abort());
    await flatMusic(page);
    await page.goto("/music");
    const toggle = page.locator('#page [data-music="toggle"]');
    await expect(toggle).toHaveText("Music unavailable");
    await page.unroute(apiUrl);
    await page.route(apiUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: FAKE_YOUTUBE,
      }),
    );
    await toggle.click();
    await expect
      .poll(() => youtube(page))
      .toMatchObject({ players: 1, plays: 1, state: 1 });
    await expect(toggle).toHaveText("Pause");
    await expect(page.locator("html")).not.toHaveClass(/scene-failed/);
    expect(errors).toEqual([]);
  });

  test("five presses on Next before the player is ready run once", async ({
    page,
  }) => {
    await quiet(page);
    let apiAsked = 0;
    let releaseApi = () => {};
    const apiHeld = new Promise<void>((resolve) => {
      releaseApi = resolve;
    });
    await page.route("https://www.youtube.com/iframe_api", async (route) => {
      apiAsked += 1;
      await apiHeld;
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: FAKE_YOUTUBE,
      });
    });
    await flatMusic(page);
    await page.goto("/music");
    await expect.poll(() => apiAsked).toBe(1);
    const next = page.locator('#page [data-music="next"]');
    for (let i = 0; i < 5; i++) {
      await next.click();
    }
    releaseApi();
    await expect
      .poll(() => page.evaluate(() => (window as any).__yt?.nexts))
      .toBe(1);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__yt.nexts)).toBe(1);
  });

  test("the track rows are buttons, and the current one is marked", async ({
    page,
  }) => {
    await quiet(page);
    await flatMusic(page);
    await page.goto("/music");
    await ready(page);
    const rows = page.locator("#page .tracks li[data-track] > button");
    await expect(rows).toHaveCount(TRACKS.length);
    await expect(rows.nth(0)).toHaveAttribute("aria-current", "true");
    await rows.nth(4).focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => youtube(page))
      .toMatchObject({ playedAt: [4], state: 1 });
    await expect(rows.nth(4)).toHaveAttribute("aria-current", "true");
    await expect(rows.nth(0)).not.toHaveAttribute("aria-current", "true");
    await expect(
      page.locator('#page .tracks [aria-current="true"]'),
    ).toHaveCount(1);
  });

  test("the parked player can't take focus, and can over the slot", async ({
    page,
  }) => {
    await quiet(page);
    await flatMusic(page);
    await page.goto("/");
    const inert = () =>
      page.evaluate(
        () => (document.getElementById("player-host") as HTMLElement).inert,
      );
    expect(await inert(), "parked on the home page").toBe(true);
    await page.goto("/music");
    await ready(page);
    await expectOverSlot(page);
    expect(await inert(), "over the slot").toBe(false);
    await page.locator("#page .home-bar").click();
    await expectParked(page);
    expect(await inert(), "parked again").toBe(true);
  });

  test("a first Escape or modifier key doesn't resume the music, and a letter does", async ({
    page,
  }) => {
    await quiet(page);
    await flatMusic(page, "on");
    await page.goto("/");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift");
    await page.keyboard.press("Control");
    await page.waitForTimeout(500);
    expect(await youtube(page), "no player yet").toBeNull();
    await page.keyboard.press("a");
    await expect
      .poll(() => youtube(page))
      .toMatchObject({ players: 1, state: 1 });
  });

  test("art that loads again after a failed track's art shows again", async ({
    page,
  }) => {
    await quiet(page);
    await page.route(
      (url) =>
        url.hostname === "i.ytimg.com" && url.pathname.includes(TRACKS[4].id),
      (route) => route.abort(),
    );
    await flatMusic(page);
    await page.goto("/music");
    await ready(page);
    const backdrop = page.locator("#page > .backdrop");
    const sky = page.locator("#page .sky");
    await expect(sky).toBeHidden();
    await page.locator('#page .tracks li[data-track="4"]').click();
    await expect(backdrop).toBeHidden();
    await expect(sky).toBeVisible();
    await page.locator('#page .tracks li[data-track="0"]').click();
    await expect(page.locator("#page .now-title")).toHaveText(
      cleanTitle(TRACKS[0].title),
    );
    await expect(backdrop).toBeVisible();
    await expect(backdrop.locator("img.front")).toHaveAttribute(
      "src",
      artFor(TRACKS[0].id),
    );
    await expect(sky).toBeHidden();
  });

  test("every track row keeps its title inside the row", async ({ page }) => {
    await quiet(page);
    await flatMusic(page);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/music");
    const titles = page.locator("#page .tracks li .t");
    await expect(titles).toHaveCount(TRACKS.length);
    const overflows = await titles.evaluateAll((els) =>
      els
        .filter((el) => el.scrollWidth > el.clientWidth)
        .map((el) => el.textContent),
    );
    expect(overflows).toEqual([]);
    const widths = await titles.evaluateAll((els) =>
      els.map((el) => el.clientWidth),
    );
    for (const width of widths) {
      expect(width).toBeGreaterThan(0);
    }
  });
});

test("in 3d the backdrop blurs at full zoom and not while pinned", async ({
  page,
}) => {
  test.setTimeout(120000);
  await quiet(page);
  await page.goto("/");
  await settledOn(page, "/", null);
  await tapIcon(page, "Music");
  const pinned = await page.waitForFunction(
    () => {
      const img = document.querySelector(
        '#page[data-page="music"] > .backdrop img.front',
      );
      const sky = document.querySelector("#page .sky");
      const page = document.getElementById("page")!;
      // the scene shows #page partway into the open, and the sky inherits its visibility until then
      if (
        !img ||
        !sky ||
        !document.documentElement.classList.contains("page-pinned") ||
        getComputedStyle(page).visibility !== "visible"
      ) {
        return null;
      }
      return {
        filter: getComputedStyle(img).filter,
        sky: getComputedStyle(sky).visibility,
      };
    },
    null,
    { polling: "raf", timeout: 30000 },
  );
  const whilePinned = await pinned.jsonValue();
  expect(whilePinned!.filter).not.toContain("blur");
  expect(whilePinned!.sky).toBe("visible");
  await settledOn(page, "/music", "Music");
  await expect(page.locator("html")).not.toHaveClass(/page-pinned/);
  const zoomed = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector("#page > .backdrop img.front")!)
        .filter,
  );
  expect(zoomed).toContain("blur");
});

test("in 3d the music plays on through the navigations", async ({ page }) => {
  test.setTimeout(180000);
  await quiet(page);
  const check = await checkMusic(page, THREE_D);
  await page.goto("/music");
  await expect(page.locator("html")).toHaveClass(/has-3d/);
  await check.run();
  await expect(page.locator("html")).not.toHaveClass(/scene-failed/);
});

test("in 3d a track tapped while the app opens loads youtube once the phone is still", async ({
  page,
}) => {
  test.setTimeout(120000);
  await quiet(page);
  const { errors } = watchErrors(page);
  // whether the phone was moving as each youtube script went in
  await page.addInitScript(() => {
    const w = window as unknown as {
      __loadsWhileBusy: (boolean | null)[];
      __capture?: { pose: () => { busy: boolean } };
    };
    w.__loadsWhileBusy = [];
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (
            node instanceof HTMLScriptElement &&
            node.src.includes("youtube.com/iframe_api")
          ) {
            w.__loadsWhileBusy.push(
              w.__capture ? w.__capture.pose().busy : null,
            );
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/");
  await settledOn(page, "/", null);
  await tapIcon(page, "Music");
  await page.waitForFunction(
    () => {
      const capture = (window as any).__capture;
      const track = document.querySelector<HTMLElement>(
        '#page .tracks li[data-track="4"]',
      );
      if (location.pathname === "/music" && capture.pose().busy && track) {
        track.click();
        return true;
      }
      return false;
    },
    null,
    { polling: "raf", timeout: 30000 },
  );
  await settledOn(page, "/music", "Music");
  await expect
    .poll(() => youtube(page))
    .toMatchObject({ players: 1, playedAt: [4], state: 1 });
  const loads = await page.evaluate(
    () =>
      (window as unknown as { __loadsWhileBusy: boolean[] }).__loadsWhileBusy,
  );
  expect(loads, "one load, with the phone still").toEqual([false]);
  expect(errors).toEqual([]);
});

test("without webgl the music plays on through the navigations", async ({
  playwright,
}, testInfo) => {
  test.setTimeout(120000);
  const browser = await playwright.chromium.launch({
    args: ["--disable-webgl", "--disable-webgl2"],
  });
  try {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
    });
    const page = await context.newPage();
    await quiet(page);
    const check = await checkMusic(page, FLAT);
    await page.goto("/music");
    const webgl2 = await page.evaluate(() =>
      Boolean(document.createElement("canvas").getContext("webgl2")),
    );
    expect(webgl2, "the flags turned webgl2 off").toBe(false);
    await check.run();
  } finally {
    await browser.close();
  }
});

test("with the scene chunk blocked the music plays on through the navigations", async ({
  page,
}) => {
  test.setTimeout(120000);
  await quiet(page);
  const check = await checkMusic(page, FLAT);
  let asked = 0;
  await page.route("**/_astro/*.js", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (!isSceneChunk(body)) {
      await route.fulfill({ response, body });
      return;
    }
    check.blocked.add(route.request().url());
    asked += 1;
    await route.abort();
  });
  await page.goto("/music");
  // the first refusal reloads once, and the second shows the flat site
  await expect.poll(() => asked).toBe(2);
  await expect(page.locator("html")).toHaveClass(/scene-failed/);
  await check.run();
});

const backdropOf = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('#page[data-page="music"] > .backdrop')!;
    const style = getComputedStyle(el);
    return { transform: style.transform, transition: style.transitionProperty };
  });

test.describe("the backdrop's drift", () => {
  test.describe("without a fine pointer", () => {
    test.use({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 393, height: 852 },
    });

    test("the backdrop and the sky stay still while the page scrolls", async ({
      page,
    }) => {
      await quiet(page);
      await page.addInitScript(() => localStorage.setItem("2d", "1"));
      await page.goto("/music");
      await scrollPage(page);
      await page.waitForTimeout(500);
      expect((await backdropOf(page)).transform).toBe("none");
      const sky = await page.evaluate(
        () => getComputedStyle(document.querySelector("#page .sky")!).transform,
      );
      expect(sky).toBe("none");
    });
  });

  test("with a fine pointer a pointer move still moves it", async ({
    page,
  }) => {
    await quiet(page);
    await page.addInitScript(() => localStorage.setItem("2d", "1"));
    await page.goto("/music");
    await page.mouse.move(20, 20);
    await page.mouse.move(1000, 700);
    await expect
      .poll(async () => (await backdropOf(page)).transform)
      .not.toBe("none");
  });
});

test.describe("the backdrop's fade after the open", () => {
  const opacities = async (page: Page) => {
    await quiet(page);
    await page.goto("/");
    await settledOn(page, "/", null);
    await tapIcon(page, "Music");
    await page.waitForFunction(
      () => document.documentElement.classList.contains("page-pinned"),
      null,
      { polling: "raf", timeout: 30000 },
    );
    const seen = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const root = document.documentElement;
          const read = () =>
            Number(
              getComputedStyle(
                document.querySelector('#page[data-page="music"] > .backdrop')!,
              ).opacity,
            );
          const poll = () => {
            if (root.classList.contains("page-pinned")) {
              requestAnimationFrame(poll);
              return;
            }
            const values = [read()];
            setTimeout(() => values.push(read()), 150);
            setTimeout(() => {
              values.push(read());
              resolve(values);
            }, 900);
          };
          poll();
        }),
    );
    return seen;
  };

  test("in 3d the art fades in once pinned ends", async ({ page }) => {
    test.setTimeout(120000);
    const [first, mid, last] = await opacities(page);
    expect(first).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(last).toBe(1);
  });

  test("under reduced motion the art is there at once", async ({ page }) => {
    test.setTimeout(120000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const [first, mid, last] = await opacities(page);
    expect([first, mid, last]).toEqual([1, 1, 1]);
  });
});
