import { expect, test, type Page, type Route } from "@playwright/test";
import { stubHome } from "../stubHome";

// youtube's iframe api, standing in: one player per page load, which makes an iframe where youtube's would and
// counts what it's asked to do
const FAKE_YOUTUBE = `
window.__yt = { players: 0, plays: 0, pauses: 0, nexts: 0, seeks: [], time: 0 };
window.YT = {
  Player: class {
    constructor(host, options) {
      window.__yt.players += 1;
      const frame = document.createElement("iframe");
      frame.src = "about:blank#fake-youtube-" + window.__yt.players;
      host.replaceWith(frame);
      this.events = options.events || {};
      this.volume = 100;
      this.index = 0;
      setTimeout(() => this.events.onReady && this.events.onReady({ target: this }), 0);
    }
    setLoop() {}
    cuePlaylist() { this.state = 5; }
    getPlayerState() { return this.state; }
    getPlaylistIndex() { return this.index; }
    getVolume() { return this.volume; }
    setVolume(v) { this.volume = v; }
    unMute() {}
    playVideo() {
      window.__yt.plays += 1;
      this.state = 1;
      setTimeout(() => this.events.onStateChange({ data: 1 }), 0);
    }
    pauseVideo() {
      window.__yt.pauses += 1;
      this.state = 2;
      setTimeout(() => this.events.onStateChange({ data: 2 }), 0);
    }
    playVideoAt(i) { this.index = i; this.playVideo(); }
    nextVideo() { window.__yt.nexts += 1; this.index = (this.index + 1) % 3; }
    getCurrentTime() { return window.__yt.time; }
    getDuration() { return 200; }
    seekTo(t) { window.__yt.seeks.push(t); }
  },
};
window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();
`;

// every request the scene makes that leaves the dev server is answered here, so no test waits on the network
const quiet = async (page: Page) => {
  await stubHome(page);
  await page.route(
    (url) =>
      url.hostname === "i.ytimg.com" ||
      (url.hostname === "www.youtube.com" && url.pathname === "/oembed"),
    (route) => route.fulfill({ status: 503, body: "" }),
  );
  await page.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: FAKE_YOUTUBE,
    }),
  );
};

type Phone = {
  busy: boolean;
  phone: string | null;
  zoomed: boolean;
  app: string | null;
  shown: boolean;
  path: string;
  pageApp: string | undefined;
};

const phone = (page: Page): Promise<Phone> =>
  page.evaluate(() => {
    const s = (window as any).spike.state;
    return {
      busy: s.busy,
      phone: s.phone,
      zoomed: s.zoomed,
      app: s.zoomed ? (s.openApp?.name ?? null) : null,
      shown: s.appVisible || s.pageFlat,
      path: location.pathname,
      pageApp: document.getElementById("page")?.dataset.app,
    };
  });

// the phone at rest on the home screen (app null) or with the app open at full zoom, at the path given
const settledOn = async (
  page: Page,
  path: string,
  app: string | null,
  timeout = 15000,
) => {
  await expect
    .poll(() => phone(page), { timeout })
    .toMatchObject({
      busy: false,
      phone: "open",
      zoomed: app !== null,
      app,
      shown: app !== null,
      path,
      pageApp: app ?? "home",
    });
};

// the sum of the ink layer's alpha in a band around the first element matching the selector, where a focus ring is
// drawn. the rest of the screen has live parts (the clock, the music card), so only the band is compared
const ringSum = (
  page: Page,
  which: "screen" | "cover",
  selector: string,
  text = "",
) =>
  page.evaluate(
    ({ which, selector, text }) => {
      const state = (window as any).spike.state;
      const root = which === "screen" ? state.screen.homeEl : state.cover.el;
      const el = [...root.querySelectorAll(selector)].find((e: any) =>
        e.textContent.includes(text),
      ) as HTMLElement;
      let x = 0;
      let y = 0;
      for (
        let n: HTMLElement | null = el;
        n && n !== root;
        n = n.offsetParent as HTMLElement | null
      ) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      const canvas = state[which].ink.image as HTMLCanvasElement;
      const scale = canvas.width / root.offsetWidth;
      const pad = 8;
      const x0 = Math.max(0, Math.floor((x - pad) * scale));
      const y0 = Math.max(0, Math.floor((y - pad) * scale));
      const w = Math.min(
        canvas.width - x0,
        Math.ceil((el.offsetWidth + pad * 2) * scale),
      );
      const h = Math.min(
        canvas.height - y0,
        Math.ceil((el.offsetHeight + pad * 2) * scale),
      );
      const data = canvas.getContext("2d")!.getImageData(x0, y0, w, h).data;
      let sum = 0;
      for (let i = 3; i < data.length; i += 4) {
        sum += data[i];
      }
      return sum;
    },
    { which, selector, text },
  );

const openHome = async (page: Page) => {
  await page.goto("/?dev&noweather");
  await page.waitForFunction(() => Boolean((window as any).spike));
  await settledOn(page, "/", null);
};

const closeToCover = async (page: Page) => {
  await page.evaluate(() => (window as any).spike.closePhone());
  await expect
    .poll(() => phone(page))
    .toMatchObject({ busy: false, phone: "closed" });
};

// tabs until focus lands on something matching the selector, so the focus is a keyboard one
const tabTo = async (page: Page, selector: string) => {
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    if (
      await page.evaluate(
        (s) => document.activeElement?.matches(s) ?? false,
        selector,
      )
    ) {
      return;
    }
  }
  throw new Error(`Tab never reached ${selector}`);
};

test.describe("keyboard use of the 3D screens", () => {
  test.beforeEach(async ({ page }) => {
    await quiet(page);
    await page.addInitScript(() => {
      localStorage.setItem("introSeen", "1");
    });
    await page.clock.install();
  });

  test("a focused icon on the home screen is drawn on the screen's texture", async ({
    page,
  }) => {
    await openHome(page);
    const icon = ".panel.main .app-icon";
    const before = await ringSum(page, "screen", icon);
    await tabTo(page, "#css-layer .panel.main .app-icon");
    await page.clock.runFor(100);
    await expect.poll(() => ringSum(page, "screen", icon)).not.toBe(before);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.clock.runFor(100);
    await expect.poll(() => ringSum(page, "screen", icon)).toBe(before);
  });

  test("a focused icon on the cover is drawn on the cover's texture", async ({
    page,
  }) => {
    await openHome(page);
    await closeToCover(page);
    const icon = ".app-icon";
    const before = await ringSum(page, "cover", icon);
    await tabTo(page, "#css-layer .cover-screen .app-icon");
    await page.clock.runFor(100);
    await expect.poll(() => ringSum(page, "cover", icon)).not.toBe(before);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.clock.runFor(100);
    await expect.poll(() => ringSum(page, "cover", icon)).toBe(before);
  });

  test("the 2D version link and a widget draw a ring when focused", async ({
    page,
  }) => {
    await openHome(page);
    const link = ".credit[data-version]";
    const widget = '.widget[data-action="project"]';
    const linkBefore = await ringSum(page, "screen", link);
    const widgetBefore = await ringSum(page, "screen", widget);
    await tabTo(page, "#css-layer .panel.main .credit[data-version]");
    await page.clock.runFor(100);
    await expect.poll(() => ringSum(page, "screen", link)).not.toBe(linkBefore);
    await tabTo(page, '#css-layer .widget[data-action="project"]');
    await page.clock.runFor(100);
    await expect
      .poll(() => ringSum(page, "screen", widget))
      .not.toBe(widgetBefore);
  });

  test("a resize keeps focus on the same icon, still drawn", async ({
    page,
  }) => {
    await openHome(page);
    await tabTo(page, "#css-layer .panel.main .app-icon");
    const name = await page.evaluate(() => document.activeElement!.textContent);
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.clock.runFor(1000);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          return el.matches("#css-layer .app-icon") ? el.textContent : null;
        }),
      )
      .toBe(name);
    await page.clock.runFor(100);
    const icon = ".panel.main .app-icon";
    const focused = await ringSum(page, "screen", icon, name!.trim().slice(-5));
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.clock.runFor(100);
    await expect
      .poll(() => ringSum(page, "screen", icon, name!.trim().slice(-5)))
      .not.toBe(focused);
  });

  for (const place of [0, 1]) {
    test(`Enter on the cover's icon number ${place + 1} opens that app, not just the phone`, async ({
      page,
    }) => {
      await openHome(page);
      await closeToCover(page);
      await tabTo(page, "#css-layer .cover-screen .app-icon");
      for (let i = 0; i < place; i++) {
        await page.keyboard.press("Tab");
      }
      const name = await page.evaluate(() => {
        const el = document.activeElement!;
        return el.matches("#css-layer .cover-screen .app-icon")
          ? el.lastElementChild!.textContent!.trim()
          : "";
      });
      expect(name.length, "focus is on a cover icon").toBeGreaterThan(0);
      await page.keyboard.press("Enter");
      await settledOn(page, "/" + name.toLowerCase(), name);
    });
  }

  test("Enter on the cover with nothing focused still opens the phone", async ({
    page,
  }) => {
    await openHome(page);
    await closeToCover(page);
    await page.keyboard.press("Enter");
    await expect
      .poll(() => phone(page), { timeout: 15000 })
      .toMatchObject({ busy: false, phone: "open", zoomed: false });
  });

  test("a widget opens its app from the keyboard", async ({ page }) => {
    await openHome(page);
    await tabTo(page, '#css-layer .widget[data-action="project"]');
    expect(
      await page.evaluate(() => document.activeElement!.getAttribute("role")),
    ).toBe("button");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => phone(page), { timeout: 15000 })
      .toMatchObject({ busy: false, zoomed: true, app: "Projects" });
  });

  test("the music card's controls are named and work from the keyboard", async ({
    page,
  }) => {
    await openHome(page);
    await page.clock.runFor(1000);
    const names = await page.evaluate(() =>
      [...document.querySelectorAll("#css-layer .ctl")].map((el) => [
        el.getAttribute("role"),
        el.getAttribute("aria-label"),
        el.getAttribute("tabindex"),
      ]),
    );
    expect(names).toEqual([
      ["button", "Previous", "0"],
      ["button", "Play", "0"],
      ["button", "Next", "0"],
    ]);
    await tabTo(page, '#css-layer .ctl[data-control="toggle"]');
    await page.keyboard.press("Space");
    await page.clock.runFor(500);
    expect(
      await page.evaluate(() => (window as any).__yt.plays),
    ).toBeGreaterThan(0);
    expect(
      await page.evaluate(() =>
        document.activeElement!.getAttribute("aria-label"),
      ),
    ).toBe("Pause");
    expect(await phone(page)).toMatchObject({ zoomed: false });
  });

  test("the music card's next waits for the player, and five presses before it's ready run once", async ({
    page,
  }) => {
    await quiet(page);
    let asked = 0;
    let releaseApi = () => {};
    const apiHeld = new Promise<void>((resolve) => {
      releaseApi = resolve;
    });
    await page.route("https://www.youtube.com/iframe_api", async (route) => {
      asked += 1;
      await apiHeld;
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: FAKE_YOUTUBE,
      });
    });
    await openHome(page);
    await page.clock.runFor(1000);
    await page.evaluate(() => {
      const next = document.querySelector<HTMLElement>(
        '#css-layer .ctl[data-control="next"]',
      )!;
      for (let i = 0; i < 5; i++) {
        next.click();
      }
    });
    await expect.poll(() => asked, { timeout: 15000 }).toBe(1);
    releaseApi();
    await expect
      .poll(
        async () => {
          await page.clock.runFor(200);
          return page.evaluate(() => (window as any).__yt?.nexts);
        },
        { timeout: 15000 },
      )
      .toBe(1);
    await page.clock.runFor(2000);
    expect(await page.evaluate(() => (window as any).__yt.nexts)).toBe(1);
  });

  test("the music card says the music is unavailable when youtube's api is blocked, and plays once it's back", async ({
    page,
  }) => {
    const apiUrl = "https://www.youtube.com/iframe_api";
    const refuse = (route: Route) => route.abort();
    await page.route(apiUrl, refuse);
    await openHome(page);
    await page.clock.runFor(1000);
    const card = () =>
      page.evaluate(() => {
        const el = document.querySelector("#css-layer .music-card")!;
        return {
          toggle: el
            .querySelector('[data-control="toggle"]')!
            .getAttribute("aria-label"),
          channel: el.querySelector(".m-channel")!.textContent,
        };
      });
    const pressToggle = () =>
      page.evaluate(() =>
        document
          .querySelector<HTMLElement>('#css-layer .ctl[data-control="toggle"]')!
          .click(),
      );
    await pressToggle();
    await expect
      .poll(
        async () => {
          await page.clock.runFor(200);
          return card();
        },
        { timeout: 15000 },
      )
      .toEqual({ toggle: "Music unavailable", channel: "Music unavailable" });
    await page.unroute(apiUrl, refuse);
    await pressToggle();
    await expect
      .poll(
        async () => {
          await page.clock.runFor(200);
          return (await card()).toggle;
        },
        { timeout: 15000 },
      )
      .toBe("Pause");
    expect((await card()).channel).not.toBe("Music unavailable");
  });

  test("the progress bar is a slider and the status indicators a button", async ({
    page,
  }) => {
    await openHome(page);
    const attrs = await page.evaluate(() => {
      const bar = document.querySelector("#css-layer .m-progress")!;
      const ind = document.querySelector("#css-layer .indicators")!;
      return [
        bar.getAttribute("role"),
        bar.getAttribute("tabindex"),
        ind.getAttribute("role"),
        ind.getAttribute("tabindex"),
      ];
    });
    expect(attrs).toEqual(["slider", "0", "button", "0"]);
  });

  test("app icon glyphs are hidden from the accessible name, in 3D and in the flat home", async ({
    page,
  }) => {
    await openHome(page);
    const bad = await page.evaluate(
      () =>
        [...document.querySelectorAll(".app-icon .glyph")].filter(
          (el) => el.getAttribute("aria-hidden") !== "true",
        ).length,
    );
    const count = await page.evaluate(
      () => document.querySelectorAll(".app-icon .glyph").length,
    );
    expect(count).toBeGreaterThan(0);
    expect(bad).toBe(0);
    const html = await (await page.request.get("/")).text();
    const flat = html.match(/<span class="glyph"[^>]*>/g) ?? [];
    expect(flat.length).toBeGreaterThan(0);
    expect(flat.filter((tag) => !tag.includes('aria-hidden="true"'))).toEqual(
      [],
    );
  });

  test("an open app takes the home screen out of the tab order, focus moves into the page, and closing puts it back on the icon", async ({
    page,
  }) => {
    await openHome(page);
    await tabTo(page, "#css-layer .app-icon");
    const name = await page.evaluate(() =>
      document.activeElement!.lastElementChild!.textContent!.trim(),
    );
    await page.keyboard.press("Enter");
    await settledOn(page, "/" + name.toLowerCase(), name);
    await page.clock.runFor(500);
    const open = await page.evaluate(() => ({
      inert: (
        document.querySelector(
          "#css-layer .screen.hit:not(.cover-screen)",
        ) as HTMLElement
      ).inert,
      inPage: document.getElementById("page")!.contains(document.activeElement),
    }));
    expect(open).toEqual({ inert: true, inPage: true });
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(
          () => !!document.activeElement?.closest("#css-layer"),
        ),
      ).toBe(false);
    }
    await page.evaluate(() => {
      (document.activeElement as HTMLElement).blur();
      (window as any).spike.closeApp();
    });
    await expect
      .poll(() => phone(page), { timeout: 15000 })
      .toMatchObject({ busy: false, zoomed: false, shown: false });
    await page.clock.runFor(500);
    expect(
      await page.evaluate(() => {
        const a = document.activeElement as HTMLElement;
        return [
          a.matches("#css-layer .app-icon"),
          a.lastElementChild!.textContent!.trim(),
          (
            document.querySelector(
              "#css-layer .screen.hit:not(.cover-screen)",
            ) as HTMLElement
          ).inert,
        ];
      }),
    ).toEqual([true, name, false]);
  });

  test("with reduced motion an open app still takes focus and a close gives it back to the icon", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    await tabTo(page, "#css-layer .app-icon");
    const name = await page.evaluate(() =>
      document.activeElement!.lastElementChild!.textContent!.trim(),
    );
    await page.keyboard.press("Enter");
    await settledOn(page, "/" + name.toLowerCase(), name);
    await page.clock.runFor(500);
    expect(
      await page.evaluate(() =>
        document.getElementById("page")!.contains(document.activeElement),
      ),
    ).toBe(true);
    await page.evaluate(() => (window as any).spike.closeApp());
    await expect
      .poll(() => phone(page), { timeout: 15000 })
      .toMatchObject({ busy: false, zoomed: false, shown: false });
    await page.clock.runFor(500);
    expect(
      await page.evaluate(() =>
        document.activeElement!.matches("#css-layer .app-icon"),
      ),
    ).toBe(true);
  });

  test("each face of the 3D home is a named region with the site's heading, the shown one only", async ({
    page,
  }) => {
    await openHome(page);
    await expect(page.getByRole("region", { name: "Home screen" })).toHaveCount(
      1,
    );
    await expect(
      page.getByRole("region", { name: "Cover screen" }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("region", { name: "Home screen" })
        .getByRole("heading", { level: 1, name: "Jason Yue" }),
    ).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await closeToCover(page);
    await expect(
      page
        .getByRole("region", { name: "Cover screen" })
        .getByRole("heading", { level: 1, name: "Jason Yue" }),
    ).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Home screen" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("Escape's close moves a keyboard focus onto the cover, and Enter's open moves it back onto the home screen", async ({
    page,
  }) => {
    await openHome(page);
    await tabTo(page, "#css-layer .panel.main .app-icon");
    await page.keyboard.press("Escape");
    await expect
      .poll(() => phone(page), { timeout: 15000 })
      .toMatchObject({ busy: false, phone: "closed" });
    await page.clock.runFor(100);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.activeElement === (window as any).spike.state.cover.el,
        ),
      )
      .toBe(true);
    await page.keyboard.press("Enter");
    await expect
      .poll(() => phone(page), { timeout: 15000 })
      .toMatchObject({ busy: false, phone: "open", zoomed: false });
    await page.clock.runFor(100);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.activeElement ===
            (window as any).spike.state.screen.homeEl,
        ),
      )
      .toBe(true);
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () =>
          !!document.activeElement?.closest(
            "#css-layer .screen.hit:not(.cover-screen)",
          ),
      ),
      "Tab goes on into the home screen",
    ).toBe(true);
  });

  test("the GitHub widget is a link that opens GitHub in a new tab, from Enter too", async ({
    page,
  }) => {
    await page
      .context()
      .route("https://github.com/**", (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: "" }),
      );
    await openHome(page);
    const widget = '#css-layer .widget[data-action="github"]';
    expect(
      await page.evaluate((s) => {
        const el = document.querySelector(s)!;
        return [
          el.tagName,
          el.getAttribute("href"),
          el.getAttribute("target"),
          el.getAttribute("rel"),
          el.getAttribute("role"),
        ];
      }, widget),
    ).toEqual([
      "A",
      "https://github.com/kymotsujason",
      "_blank",
      "noopener",
      null,
    ]);
    await tabTo(page, widget);
    const popup = page.waitForEvent("popup");
    await page.keyboard.press("Enter");
    expect((await popup).url()).toBe("https://github.com/kymotsujason");
    expect(await phone(page)).toMatchObject({ zoomed: false });
  });

  test("the music card itself answers no keys, only its controls do", async ({
    page,
  }) => {
    await openHome(page);
    await page.evaluate(() =>
      document
        .querySelector("#css-layer .music-card")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
    );
    await page.clock.runFor(1000);
    await page.waitForTimeout(500);
    expect(await phone(page)).toMatchObject({
      busy: false,
      zoomed: false,
      app: null,
    });
  });

  test("the music card holds its controls without being a button itself", async ({
    page,
  }) => {
    await openHome(page);
    expect(
      await page.evaluate(() => {
        const card = document.querySelector("#css-layer .music-card")!;
        return [card.getAttribute("role"), card.getAttribute("tabindex")];
      }),
    ).toEqual([null, null]);
  });

  test("holding Enter or Space on a control presses it once", async ({
    page,
  }) => {
    await openHome(page);
    await page.clock.runFor(1000);
    const toggles = () =>
      page.evaluate(() => {
        const yt = (window as any).__yt;
        return yt.plays + yt.pauses;
      });
    await tabTo(page, '#css-layer .ctl[data-control="toggle"]');
    for (let i = 0; i < 4; i++) {
      await page.keyboard.down("Enter");
    }
    await page.keyboard.up("Enter");
    await page.clock.runFor(500);
    expect(await toggles()).toBe(1);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.down("Space");
    }
    await page.clock.runFor(500);
    expect(await toggles()).toBe(1);
    await page.keyboard.up("Space");
    await page.clock.runFor(500);
    expect(await toggles()).toBe(2);
  });

  test("the seek slider answers ArrowUp and ArrowDown like ArrowRight and ArrowLeft", async ({
    page,
  }) => {
    await openHome(page);
    await page.clock.runFor(1000);
    await tabTo(page, "#css-layer .m-progress");
    // the first key press loads the player, which has no length until then
    await page.keyboard.press("ArrowLeft");
    await page.clock.runFor(1000);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => (window as any).__yt.seeks)).toEqual([
      5, 0,
    ]);
  });

  test("the seek slider reads as a time and answers Home, End, and the page keys", async ({
    page,
  }) => {
    await openHome(page);
    await page.clock.runFor(1000);
    const bar = "#css-layer .m-progress";
    await tabTo(page, bar);
    // the first key press loads the player, which has no length until then
    await page.keyboard.press("ArrowLeft");
    await page.clock.runFor(1000);
    expect(
      await page.evaluate(
        (s) => document.querySelector(s)!.getAttribute("aria-valuetext"),
        bar,
      ),
    ).toBe("0:00 of 3:20");
    // from the middle of the track, so PageDown and ArrowLeft land somewhere Home doesn't
    await page.evaluate(() => {
      (window as any).__yt.time = 100;
      (window as any).__yt.seeks.length = 0;
    });
    for (const key of [
      "ArrowRight",
      "ArrowLeft",
      "PageUp",
      "PageDown",
      "End",
      "Home",
    ]) {
      await page.keyboard.press(key);
    }
    const seeks = await page.evaluate(() => (window as any).__yt.seeks);
    expect(seeks.map(Math.round)).toEqual([105, 95, 120, 80, 200, 0]);
  });
});
