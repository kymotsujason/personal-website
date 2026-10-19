import { expect, test, type Page } from "@playwright/test";
import { stubHome } from "../stubHome";

// youtube's iframe api, standing in: one player per page load, which makes an iframe where youtube's would and
// counts what it's asked to do
const FAKE_YOUTUBE = `
window.__yt = { players: 0, plays: 0, pauses: 0 };
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
    nextVideo() { this.index = (this.index + 1) % 3; }
    getCurrentTime() { return 0; }
    getDuration() { return 200; }
    seekTo() {}
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

const historyIndex = (page: Page) =>
  page.evaluate(() => (window as any).navigation.currentEntry.index as number);

// a returning visitor, so the fast intro plays
const returning = async (page: Page) => {
  await page.addInitScript(() => {
    localStorage.setItem("introSeen", "1");
  });
};

const openHome = async (page: Page) => {
  await page.goto("/?dev&noweather");
  await page.waitForFunction(() => Boolean((window as any).spike));
  await settledOn(page, "/", null);
};

// the icon on the open phone's home screen, or on the cover screen of the closed phone
const tapIcon = (page: Page, name: string, cover = false) =>
  page.evaluate(
    ({ name, cover }) => {
      const selector = cover
        ? "#css-layer .screen > .home .app-icon"
        : "#css-layer .panel.main .app-icon";
      const icon = [...document.querySelectorAll<HTMLElement>(selector)].find(
        (el) => el.textContent?.includes(name),
      );
      if (!icon) {
        throw new Error(`no ${name} icon`);
      }
      icon.click();
    },
    { name, cover },
  );

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

test.describe("with the clock installed", () => {
  test.beforeEach(async ({ page }) => {
    await quiet(page);
    await returning(page);
    await page.clock.install();
  });

  test("tapping an icon opens the app and pushes its address", async ({
    page,
  }) => {
    await openHome(page);
    const before = await historyIndex(page);
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    expect(await historyIndex(page)).toBe(before + 1);
    await expect(page.locator("#page h1")).toHaveText("About");
    await expect(page.locator("#page h1")).toBeVisible();
  });

  test("Back closes the app with its content shown until the zoom ends, and Forward opens it again", async ({
    page,
  }) => {
    await openHome(page);
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    // every frame from Back until the close has settled: whether the window shows #page, and what #page holds
    await page.evaluate(() => {
      const w = window as any;
      w.__frames = [];
      const sample = () => {
        const s = w.spike.state;
        w.__frames.push({
          shown: s.appVisible || s.pageFlat,
          busy: s.busy,
          pageApp: document.getElementById("page")!.dataset.app,
        });
        if (w.__frames.length < 600) {
          requestAnimationFrame(sample);
        }
      };
      requestAnimationFrame(sample);
    });
    await page.goBack();
    await settledOn(page, "/", null);
    const frames: { shown: boolean; busy: boolean; pageApp: string }[] =
      await page.evaluate(() => (window as any).__frames);
    const closing = frames.filter((f) => f.busy);
    expect(
      closing.some((f) => f.shown),
      "a frame showed the window closing",
    ).toBe(true);
    expect(
      frames.filter((f) => f.shown).every((f) => f.pageApp === "About"),
      "#page held About whenever the window showed it",
    ).toBe(true);
    // the phone keeps moving back to rest after the window has shrunk into its icon, so the swap can land while busy
    const lastShown = frames.findLastIndex((f) => f.shown);
    const swapped = frames.findIndex((f) => f.pageApp !== "About");
    expect(
      swapped,
      "#page took the home page by the time the close settled",
    ).toBeGreaterThan(-1);
    expect(
      swapped > lastShown && swapped <= frames.findLastIndex((f) => f.busy) + 1,
      "#page took the home page only once the window had shrunk into its icon",
    ).toBe(true);
    await expect(page.locator("#page h1")).toHaveText("Jason Yue");

    await page.goForward();
    await settledOn(page, "/about", "About");
  });

  test("Back, Back, Forward within 200 ms ends on the final address", async ({
    page,
  }) => {
    await openHome(page);
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    await followLink(page, "/projects");
    await settledOn(page, "/projects", "Projects");
    const took = await page.evaluate(async () => {
      const popped = () =>
        new Promise((resolve) =>
          addEventListener("popstate", resolve, { once: true }),
        );
      const start = performance.now();
      history.back();
      await popped();
      history.back();
      await popped();
      history.forward();
      await popped();
      return performance.now() - start;
    });
    expect(took).toBeLessThan(200);
    await settledOn(page, "/about", "About");
    await expect(page.locator("#page h1")).toHaveText("About");
  });

  test("a link tapped during the intro opens once the intro is over", async ({
    page,
  }) => {
    // the intro at half speed, so the tap lands well inside it
    await page.goto("/?dev&noweather&slow=2");
    // the intro waits for the page to fade in, so the tap waits for it too
    await page.waitForFunction(() => {
      const s = (window as any).spike?.state;
      return (
        s &&
        s.busy &&
        s.phone === null &&
        s.poses &&
        document.body.classList.contains("ready")
      );
    });
    // the intro writes it again once it has played through, and not when something cuts it short
    await page.evaluate(() => localStorage.removeItem("introSeen"));
    // every frame: whether the intro has unlocked the phone, and whether the app window shows
    await page.evaluate(() => {
      const w = window as any;
      w.__frames = [];
      const sample = () => {
        const s = w.spike.state;
        w.__frames.push({ phone: s.phone, shown: s.appVisible || s.pageFlat });
        if (w.__frames.length < 900) {
          requestAnimationFrame(sample);
        }
      };
      requestAnimationFrame(sample);
    });
    const atTap = await page.evaluate(() => {
      const w = window as any;
      const icon = [
        ...document.querySelectorAll<HTMLElement>(
          "#css-layer .panel.main .app-icon",
        ),
      ].find((el) => el.textContent?.includes("About"))!;
      const at = { phone: w.spike.state.phone, fold: w.spike.pose.fold };
      icon.click();
      return at;
    });
    expect(atTap.phone, "the tap came before the intro unlocked").toBe(null);
    expect(atTap.fold).toBeGreaterThan(0.5);
    await expect
      .poll(() => page.evaluate(() => location.pathname))
      .toBe("/about");
    await settledOn(page, "/about", "About", 30000);
    expect(
      await page.evaluate(() => localStorage.getItem("introSeen")),
      "the intro played through",
    ).toBe("1");
    const frames: { phone: string | null; shown: boolean }[] =
      await page.evaluate(() => (window as any).__frames);
    const firstShown = frames.findIndex((f) => f.shown);
    expect(firstShown, "the app window showed").toBeGreaterThan(0);
    expect(
      frames.slice(0, firstShown).some((f) => f.phone === null),
      "the intro was still playing after the tap",
    ).toBe(true);
    expect(
      frames.slice(firstShown).every((f) => f.phone === "open"),
      "the app opened only once the intro had unlocked the phone",
    ).toBe(true);
  });

  test("a navigation that lands on the settle's last move still settles", async ({
    page,
  }) => {
    await openHome(page);
    // one move per settle, so the open below is the last move and Back lands during it
    await page.evaluate(() => {
      (window as any).spike.settleLimit.moves = 1;
    });
    await tapIcon(page, "About");
    await page.waitForFunction(() => {
      const s = (window as any).spike.state;
      return (
        location.pathname === "/about" &&
        document.getElementById("page")!.dataset.app === "About" &&
        s.busy &&
        s.appVisible &&
        !s.zoomed
      );
    });
    await page.evaluate(() => {
      const w = window as any;
      w.__frames = [];
      const sample = () => {
        const s = w.spike.state;
        w.__frames.push({
          shown: s.appVisible || s.pageFlat,
          pageApp: document.getElementById("page")!.dataset.app,
        });
        if (w.__frames.length < 900) {
          requestAnimationFrame(sample);
        }
      };
      requestAnimationFrame(sample);
      w.__backAt = performance.now();
      history.back();
    });
    await settledOn(page, "/", null);
    const took = await page.evaluate(
      () => performance.now() - (window as any).__backAt,
    );
    // the open and the close take about 1.3 s, and a stranded navigation waits out the 4 s cap first
    expect(took, "settled without waiting out the cap").toBeLessThan(3500);
    const frames: { shown: boolean; pageApp: string }[] = await page.evaluate(
      () => (window as any).__frames,
    );
    expect(
      frames.filter((f) => f.shown).every((f) => f.pageApp === "About"),
      "#page held About whenever the window showed it",
    ).toBe(true);
  });

  // the scene has no app for it, so it's the flat site, and never that app or the home screen hiding it
  test("a not found page under an app's path shows as the flat site", async ({
    page,
  }) => {
    const expectFlatNotFound = async () => {
      await expect(page).toHaveURL((url) =>
        url.pathname.startsWith("/about/nothing-here"),
      );
      await expect(page.locator("html")).not.toHaveClass(/has-3d/);
      await expect(page.locator("#page")).toHaveAttribute("data-app", "home");
      await expect(page.locator("#page h1")).toHaveText(
        "No connection to this page",
      );
      await expect(page.locator("#page h1")).toBeVisible();
    };
    await openHome(page);
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    await followLink(page, "/about/nothing-here");
    await expectFlatNotFound();

    await page.goto("/about/nothing-here?dev&noweather");
    await expectFlatNotFound();
  });

  test("a link tapped with the phone closed opens the phone, then the app", async ({
    page,
  }) => {
    await openHome(page);
    await page.evaluate(() => (window as any).spike.closePhone());
    await expect
      .poll(() => phone(page))
      .toMatchObject({ busy: false, phone: "closed" });
    await page.evaluate(() => {
      const w = window as any;
      w.__frames = [];
      const sample = () => {
        const s = w.spike.state;
        w.__frames.push({ phone: s.phone, shown: s.appVisible || s.pageFlat });
        if (w.__frames.length < 900) {
          requestAnimationFrame(sample);
        }
      };
      requestAnimationFrame(sample);
    });
    await tapIcon(page, "About", true);
    await settledOn(page, "/about", "About");
    const frames: { phone: string; shown: boolean }[] = await page.evaluate(
      () => (window as any).__frames,
    );
    const firstShown = frames.findIndex((f) => f.shown);
    expect(firstShown).toBeGreaterThan(0);
    expect(frames[firstShown].phone).toBe("open");
    expect(frames.slice(0, firstShown).some((f) => f.phone === "closed")).toBe(
      true,
    );
  });

  test("Escape goes Back when the previous entry is the home screen", async ({
    page,
  }) => {
    await openHome(page);
    const home = await historyIndex(page);
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    await page.keyboard.press("Escape");
    await settledOn(page, "/", null);
    expect(await historyIndex(page)).toBe(home);
  });

  test("Escape pushes the home screen when the page was opened directly", async ({
    page,
  }) => {
    await page.goto("/about?dev&noweather");
    await page.waitForFunction(() => Boolean((window as any).spike));
    await settledOn(page, "/about", "About");
    const before = await historyIndex(page);
    await page.keyboard.press("Escape");
    await settledOn(page, "/", null);
    expect(await historyIndex(page)).toBe(before + 1);
  });

  const swipeHome = async (page: Page) => {
    const bar = await page.locator("#page .home-bar").boundingBox();
    expect(bar).not.toBeNull();
    const x = bar!.x + bar!.width / 2;
    const y = bar!.y + bar!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(x, y - i * 30);
    }
    await page.mouse.up();
  };

  test("the home bar swipe goes Back when the previous entry is the home screen", async ({
    page,
  }) => {
    await openHome(page);
    const home = await historyIndex(page);
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    await swipeHome(page);
    await settledOn(page, "/", null);
    expect(await historyIndex(page)).toBe(home);
  });

  test("the home button beside the title goes Back to the home screen, like the home bar", async ({
    page,
  }) => {
    await openHome(page);
    const home = await historyIndex(page);
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    await page.locator("#page .title-row .home-link").click();
    await settledOn(page, "/", null);
    expect(await historyIndex(page)).toBe(home);
  });

  // the button beside the title scrolls away with it, so the bar shows one once the small title does
  test("the bar's home button shows once the title scrolls away, and goes home", async ({
    page,
  }) => {
    await openHome(page);
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    const inBar = page.locator("#page > header .header-home");
    await expect(inBar).toHaveCSS("opacity", "0");
    await expect(inBar).toHaveCSS("pointer-events", "none");
    await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>("#page > .body")!;
      body.scrollTop = body.scrollHeight;
    });
    await expect(page.locator("#page > header")).toHaveClass(/scrolled/);
    await expect(inBar).toHaveCSS("opacity", "1");
    await inBar.click();
    await settledOn(page, "/", null);
  });

  test("a detail page's round home button goes home, past its list", async ({
    page,
  }) => {
    await page.goto("/projects/device-intro?dev&noweather");
    await page.waitForFunction(() => Boolean((window as any).spike));
    await settledOn(page, "/projects/device-intro", "Projects");
    // the dev panel covers the top right corner, so the click comes from the element itself
    await page.evaluate(() =>
      document.querySelector<HTMLElement>("#page > header .home-icon")!.click(),
    );
    await settledOn(page, "/", null);
  });

  // visitors took a while to find their way home, so the first app shows how, once per browser
  test("the first app opened nudges the home bar with a hint, and the next doesn't", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("homeHintSeen");
    });
    await openHome(page);
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    await expect(page.locator("#page")).toHaveClass(/hint-home/);
    await expect(page.locator("#page .home-hint")).toHaveText(
      "Swipe up to go home",
    );
    await expect(page.locator("#page")).not.toHaveClass(/hint-home/, {
      timeout: 6000,
    });
    await swipeHome(page);
    await settledOn(page, "/", null);
    await tapIcon(page, "Blog");
    await settledOn(page, "/blog", "Blog");
    await expect(page.locator("#page")).not.toHaveClass(/hint-home/);
  });

  // the scene moves focus to the page's heading when an app opens, and its focus ring drew a white box around the
  // title. the ring stays for anything a Tab reaches
  test("the heading the scene focuses shows no ring, and a Tab still does", async ({
    page,
  }) => {
    await openHome(page);
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName))
      .toBe("H1");
    expect(
      await page.evaluate(
        () => getComputedStyle(document.activeElement!).outlineStyle,
      ),
    ).toBe("none");
    await page.keyboard.press("Tab");
    const next = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      outline: getComputedStyle(document.activeElement!).outlineStyle,
    }));
    expect(next.tag).not.toBe("H1");
    expect(next.outline).toBe("solid");
  });

  // the screen runs past a window shaped unlike it, so a card cut to the whole screen showed bare strips beside #page
  test("the swipe's card is cut to the page, not the whole screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/about?dev&noweather");
    await page.waitForFunction(() => Boolean((window as any).spike));
    await settledOn(page, "/about", "About");
    const bar = await page.locator("#page .home-bar").boundingBox();
    expect(bar).not.toBeNull();
    const x = bar!.x + bar!.width / 2;
    const y = bar!.y + bar!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(x, y - i * 30);
    }
    const shapes = await page.evaluate(() => {
      const { screen } = (window as any).spike.state;
      const r = screen.appHole.material.uniforms.rect.value;
      return {
        card: (r.z - r.x) / (r.w - r.y),
        screen: screen.fullW / screen.fullH,
        window: innerWidth / innerHeight,
      };
    });
    await page.mouse.up();
    expect(Math.abs(shapes.screen - shapes.window)).toBeGreaterThan(0.05);
    expect(shapes.card).toBeCloseTo(shapes.window, 1);
  });

  // the sky pauses while an app fills the screen, and a page opened straight into one never drew it, so a swipe home
  // showed the icons over black
  test("a page opened straight into an app still draws the home screen's sky", async ({
    page,
  }) => {
    await page.goto("/about?dev&noweather");
    await page.waitForFunction(() => Boolean((window as any).spike));
    await settledOn(page, "/about", "About");
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).spike.state.wallpaper.drawn()),
      )
      .toBe(true);
  });

  // a window let go mid swipe can fly in from below its icon, so the icon is left out of the home screen while the
  // window shows, or it poked out past the window's top
  test("the open app's icon is left out until its window lands on it", async ({
    page,
  }) => {
    await openHome(page);
    const hidden = () =>
      page.evaluate(() =>
        (window as any).spike.state.screen.composite.hidden(),
      );
    expect(await hidden()).toBeNull();
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    expect(await hidden()).not.toBeNull();
    await swipeHome(page);
    await settledOn(page, "/", null);
    expect(await hidden()).toBeNull();
  });

  // ios grows an app out of the widget that opened it, so the widget stays and the window fades in over it
  test("a widget opens its app out of the widget, not the icon", async ({
    page,
  }) => {
    await openHome(page);
    await page.evaluate(() =>
      document
        .querySelector<HTMLElement>('#css-layer [data-action="project"]')!
        .click(),
    );
    await expect
      .poll(() => phone(page))
      .toMatchObject({ busy: false, zoomed: true, app: "Projects" });
    const opened = await page.evaluate(() => {
      const { state } = (window as any).spike;
      return {
        fromWidget: state.openFromWidget,
        hidden: state.screen.composite.hidden(),
      };
    });
    expect(opened).toEqual({ fromWidget: true, hidden: null });
  });

  test("the home bar swipe pushes the home screen when the page was opened directly", async ({
    page,
  }) => {
    await page.goto("/about?dev&noweather");
    await page.waitForFunction(() => Boolean((window as any).spike));
    await settledOn(page, "/about", "About");
    const before = await historyIndex(page);
    await swipeHome(page);
    await settledOn(page, "/", null);
    expect(await historyIndex(page)).toBe(before + 1);
  });

  test("music keeps playing across five navigations", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("music", "on");
    });
    await openHome(page);
    // browsers hold sound until the first key or tap, which is when the player loads and the music fades in
    await page.keyboard.press("a");
    await expect
      .poll(() => page.evaluate(() => (window as any).spike.music().playing))
      .toBe(true);
    await page.evaluate(() => {
      const w = window as any;
      w.__frame = document.querySelector("#player-host iframe");
      w.__src = w.__frame.src;
    });
    await tapIcon(page, "Music");
    await settledOn(page, "/music", "Music");
    await page.goBack();
    await settledOn(page, "/", null);
    await page.goForward();
    await settledOn(page, "/music", "Music");
    await followLink(page, "/about");
    await settledOn(page, "/about", "About");
    await page.goBack();
    await settledOn(page, "/music", "Music");
    const after = await page.evaluate(() => {
      const w = window as any;
      const frame = document.querySelector("#player-host iframe");
      return {
        same: frame === w.__frame,
        src: frame?.getAttribute("src"),
        before: w.__src,
        playing: w.spike.music().playing,
        yt: w.__yt,
      };
    });
    expect(after.same, "the same iframe node").toBe(true);
    expect(after.src).toBe("about:blank#fake-youtube-1");
    expect(after.playing).toBe(true);
    expect(after.yt.players).toBe(1);
    expect(after.yt.pauses).toBe(0);
  });

  test("a resize during an open, and after it, keeps the page's scroll and the address's state", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 360 });
    await openHome(page);
    const screenBefore = await page.evaluateHandle(() =>
      document.querySelector("#css-layer .screen"),
    );
    await tapIcon(page, "About");
    // the swap has landed and the window is growing out of the icon
    await page.waitForFunction(() => {
      const s = (window as any).spike.state;
      return (
        document.getElementById("page")!.dataset.app === "About" &&
        s.busy &&
        s.appVisible
      );
    });
    const scrolled = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>("#page > .body")!;
      body.scrollTop = 40;
      return body.scrollTop;
    });
    expect(scrolled, "the about page scrolls at this size").toBe(40);
    await page.setViewportSize({ width: 900, height: 360 });
    await settledOn(page, "/about", "About");
    const rebuilt = await page.evaluate(
      (before) => document.querySelector("#css-layer .screen") !== before,
      screenBefore,
    );
    expect(rebuilt, "the resize built the phone again").toBe(true);
    expect(
      await page.evaluate(
        () => document.querySelector<HTMLElement>("#page > .body")!.scrollTop,
      ),
    ).toBe(40);

    const screenMid = await page.evaluateHandle(() =>
      document.querySelector("#css-layer .screen"),
    );
    await page.setViewportSize({ width: 1100, height: 360 });
    await expect
      .poll(() =>
        page.evaluate(
          (before) => document.querySelector("#css-layer .screen") !== before,
          screenMid,
        ),
      )
      .toBe(true);
    await settledOn(page, "/about", "About");
    expect(
      await page.evaluate(
        () => document.querySelector<HTMLElement>("#page > .body")!.scrollTop,
      ),
    ).toBe(40);
    await expect(page.locator("#page h1")).toBeVisible();
  });

  test("with session storage refused, a new build shows the flat page without reloading", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "sessionStorage", {
        get: () => {
          throw new DOMException("refused", "SecurityError");
        },
      });
    });
    let loads = 0;
    await page.route(
      (url) => url.pathname === "/about",
      async (route) => {
        if (route.request().resourceType() === "document") {
          loads += 1;
        }
        const response = await route.fetch();
        const body = (await response.text()).replace(
          /<meta name="build-id" content="[^"]*"/,
          '<meta name="build-id" content="next-build"',
        );
        await route.fulfill({ response, body });
      },
    );
    await openHome(page);
    await page.evaluate(() => {
      (window as any).__sameLoad = true;
    });
    await tapIcon(page, "About");
    await expect(page.locator("html")).toHaveClass(/scene-failed/);
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.locator("#page h1")).toHaveText("About");
    await expect(page.locator("#page h1")).toBeVisible();
    await expect(page.locator("html")).not.toHaveClass(/has-3d/);
    expect(
      await page.evaluate(() => (window as any).__sameLoad),
      "no reload",
    ).toBe(true);
    expect(loads).toBe(0);
  });
});

// these depend on the navigation type, which playwright's clock leaves empty, so they run on the real clock
test.describe("on the real clock", () => {
  test.beforeEach(async ({ page }) => {
    await quiet(page);
  });

  test("a new build reloads once per address and build, and a second failure shows the flat page", async ({
    page,
  }) => {
    await returning(page);
    const loads: string[] = [];
    await page.route(
      (url) => url.pathname === "/about",
      async (route) => {
        if (route.request().resourceType() === "document") {
          loads.push(route.request().url());
        }
        const response = await route.fetch();
        const body = (await response.text()).replace(
          /<meta name="build-id" content="[^"]*"/,
          '<meta name="build-id" content="next-build"',
        );
        await route.fulfill({ response, body });
      },
    );
    await openHome(page);
    await tapIcon(page, "About");
    await expect.poll(() => loads.length).toBe(1);
    await expect(page).toHaveURL(/\/about$/);
    // the reload counts as one for the arrival, so the page shows at once, and the scene takes over
    expect(await page.evaluate(() => (window as any).__arrival)).toBe("page");
    await page.waitForFunction(() => (window as any).__sceneShown === true);
    await expect(page.locator("#page h1")).toHaveText("About");
    await expect(page.locator("#page h1")).toBeVisible();
    await expect(page.locator("html")).not.toHaveClass(/scene-failed/);

    // a later visit in the same tab is a visit like any other
    await page.goto("/about?dev&noweather");
    expect(loads.length).toBe(2);
    expect(await page.evaluate(() => (window as any).__arrival)).toBe("fast");

    await openHome(page);
    await page.evaluate(() => {
      (window as any).__sameLoad = true;
    });
    await tapIcon(page, "About");
    await expect(page.locator("html")).toHaveClass(/scene-failed/);
    await expect(page.locator("#page h1")).toHaveText("About");
    await expect(page.locator("#page h1")).toBeVisible();
    expect(await page.evaluate(() => (window as any).__sameLoad)).toBe(true);
    expect(loads.length, "no second reload for the same build").toBe(2);
  });

  test("a first visit reloaded partway through the intro plays the full intro again", async ({
    page,
  }) => {
    await page.goto("/?dev&noweather");
    expect(await page.evaluate(() => (window as any).__arrival)).toBe("full");
    await page.waitForFunction(() => {
      const w = window as any;
      const s = w.spike?.state;
      return s && s.busy && s.phone === null && s.poses;
    });
    expect(await page.evaluate(() => localStorage.getItem("introSeen"))).toBe(
      null,
    );
    await page.reload();
    expect(
      await page.evaluate(
        () =>
          (
            performance.getEntriesByType("navigation")[0] as
              PerformanceNavigationTiming | undefined
          )?.type,
      ),
    ).toBe("reload");
    expect(await page.evaluate(() => (window as any).__arrival)).toBe("full");
    await page.waitForFunction(() => Boolean((window as any).spike));
    await settledOn(page, "/", null);
    expect(await page.evaluate(() => localStorage.getItem("introSeen"))).toBe(
      "1",
    );
  });

  // the page stays black until the desk's screen mask is in, so holding it keeps the intro waiting for the fade
  for (const { path, tap, app } of [
    { path: "/about", tap: false, app: "About" },
    { path: "/", tap: false, app: null },
    { path: "/", tap: true, app: "About" },
  ]) {
    test(`a resize while the page is black on ${path} plays the intro${tap ? " and keeps a tap made during it" : ""}`, async ({
      page,
    }) => {
      await returning(page);
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(
        (url) => url.pathname === "/desk-wall-mask-small.png",
        async (route) => {
          await held;
          await route.continue().catch(() => {});
        },
      );
      await page.goto(`${path}?dev&noweather&slow=2`, { waitUntil: "commit" });
      await page.waitForFunction(() => {
        const s = (window as any).spike?.state;
        return s && s.busy && s.phone === null && s.poses;
      });
      // every frame: whether the page has faded in, and what the phone and the app window are doing
      await page.evaluate(() => {
        const w = window as any;
        w.__frames = [];
        const sample = () => {
          const s = w.spike.state;
          w.__frames.push({
            ready: document.body.classList.contains("ready"),
            phone: s.phone,
            busy: s.busy,
            zoomed: s.zoomed,
            appVisible: s.appVisible,
            pageFlat: s.pageFlat,
          });
          if (w.__frames.length < 1200) {
            requestAnimationFrame(sample);
          }
        };
        requestAnimationFrame(sample);
      });
      const screenBefore = await page.evaluateHandle(() =>
        document.querySelector("#css-layer .screen"),
      );
      await page.evaluate(() => dispatchEvent(new Event("resize")));
      await expect
        .poll(() =>
          page.evaluate(
            (before) => document.querySelector("#css-layer .screen") !== before,
            screenBefore,
          ),
        )
        .toBe(true);
      const black = await page.evaluate(() => {
        const s = (window as any).spike.state;
        return {
          ready: document.body.classList.contains("ready"),
          phone: s.phone,
          busy: s.busy,
          zoomed: s.zoomed,
          shown: s.appVisible || s.pageFlat,
        };
      });
      expect(black, "the rebuild left the intro waiting").toEqual({
        ready: false,
        phone: null,
        busy: true,
        zoomed: false,
        shown: false,
      });
      release();
      if (tap) {
        const atTap = await page.waitForFunction(
          () => {
            const s = (window as any).spike.state;
            if (!document.body.classList.contains("ready")) {
              return null;
            }
            const icon = [
              ...document.querySelectorAll<HTMLElement>(
                "#css-layer .panel.main .app-icon",
              ),
            ].find((el) => el.textContent?.includes("About"))!;
            const at = { phone: s.phone, busy: s.busy };
            icon.click();
            return at;
          },
          null,
          { polling: "raf" },
        );
        expect(
          await atTap.jsonValue(),
          "the tap came during the intro",
        ).toEqual({ phone: null, busy: true });
        await expect
          .poll(() => page.evaluate(() => location.pathname))
          .toBe("/about");
      }
      await settledOn(page, app ? "/about" : "/", app, 30000);
      const frames: {
        ready: boolean;
        phone: string | null;
        busy: boolean;
        zoomed: boolean;
        appVisible: boolean;
        pageFlat: boolean;
      }[] = await page.evaluate(() => (window as any).__frames);
      const intro = frames.filter((f) => f.phone === null);
      expect(
        intro.some((f) => f.ready),
        "the intro played after the fade",
      ).toBe(true);
      expect(
        intro.every((f) => !f.zoomed && !f.appVisible && !f.pageFlat),
        "no app showed under the intro",
      ).toBe(true);
      if (app) {
        expect(
          frames.some(
            (f) => f.phone === "open" && f.busy && f.appVisible && !f.zoomed,
          ),
          "the app grew out of its icon once the intro was over",
        ).toBe(true);
      }
    });
  }
});

test("a back and forward cache restore shows the page as it was left", async ({
  playwright,
}, testInfo) => {
  // playwright turns the cache off unless asked, and the headless shell keeps it off, so this runs the full chromium
  const browser = await playwright.chromium.launch({
    channel: "chromium",
    ignoreDefaultArgs: ["--disable-back-forward-cache"],
  });
  try {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
    });
    const page = await context.newPage();
    await quiet(page);
    await returning(page);
    await page.addInitScript(() => {
      addEventListener("pageshow", (event) => {
        (window as any).__restored = event.persisted;
      });
    });
    await openHome(page);
    await tapIcon(page, "About");
    await settledOn(page, "/about", "About");
    await page.evaluate(() => {
      document.querySelector<HTMLElement>("#page > .body")!.scrollTop = 0;
      (window as any).__left = true;
    });
    await page.route("http://elsewhere.test/", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>elsewhere</title><p>elsewhere</p>",
      }),
    );
    await page.goto("http://elsewhere.test/");
    // a page restored from the cache fires no load event
    await page.goBack({ waitUntil: "commit" });
    await expect
      .poll(() => page.evaluate(() => (window as any).__restored))
      .toBe(true);
    expect(await page.evaluate(() => (window as any).__left)).toBe(true);
    await settledOn(page, "/about", "About");
    await expect(page.locator("#page h1")).toHaveText("About");
    await expect(page.locator("#page h1")).toBeVisible();
    await expect(page.locator("html")).not.toHaveClass(/scene-failed/);
  } finally {
    await browser.close();
  }
});
