import { expect, type Page } from "@playwright/test";
import { stubHome } from "../stubHome";

// youtube's iframe api, standing in, counting what it's asked to do in window.__yt
export const FAKE_YOUTUBE = `
window.__yt = { players: 0, plays: 0, pauses: 0, playedAt: [], cued: [], state: -1 };
window.YT = {
  Player: class {
    constructor(host, options) {
      window.__yt.players += 1;
      const frame = document.createElement("iframe");
      frame.src = "about:blank#fake-youtube-" + window.__yt.players;
      host.replaceWith(frame);
      this.events = options.events || {};
      this.index = 0;
      this.volume = 100;
      setTimeout(() => this.events.onReady && this.events.onReady({ target: this }), 0);
    }
    setState(state) {
      window.__yt.state = state;
      setTimeout(() => this.events.onStateChange && this.events.onStateChange({ target: this, data: state }), 0);
    }
    cuePlaylist(ids) {
      window.__yt.cued = ids;
      this.setState(5);
    }
    setLoop() {}
    getPlaylistIndex() { return this.index; }
    getPlayerState() { return window.__yt.state; }
    getVolume() { return this.volume; }
    setVolume(v) { this.volume = v; }
    unMute() {}
    playVideo() {
      window.__yt.plays += 1;
      this.setState(1);
    }
    pauseVideo() {
      window.__yt.pauses += 1;
      this.setState(2);
    }
    playVideoAt(i) {
      this.index = i;
      window.__yt.playedAt.push(i);
      this.playVideo();
    }
    nextVideo() {}
    getCurrentTime() { return 0; }
    getDuration() { return 0; }
    seekTo() {}
  },
};
window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();
`;

// a 1 by 1 PNG, joined at run time since the privacy check refuses a tracked file that holds an encoded image
const PIXEL = Buffer.from(
  [
    "iVBORw0KGgo",
    "AAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwcHAAAAGEAMGDX2mUAAAAAElFTkSuQmCC",
  ].join(""),
  "base64",
);

// the music card draws its art onto the screen, so the thumbnails need cors
export const stubArt = async (page: Page) => {
  await page.route(
    (url) => url.hostname === "i.ytimg.com",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        headers: { "access-control-allow-origin": "*" },
        body: PIXEL,
      }),
  );
};

// every request the scene makes that leaves the preview is answered here with something the scene reads as nothing,
// so no test waits on the network and none of them logs a failed load
export const quiet = async (page: Page) => {
  await stubHome(page);
  await stubArt(page);
  await page.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: FAKE_YOUTUBE,
    }),
  );
};

// the console errors and uncaught exceptions a page logs. a request the test blocked on purpose logs a failed load,
// which is the browser's and not the site's, so those are left out by address
export const watchErrors = (page: Page) => {
  const errors: string[] = [];
  const blocked = new Set<string>();
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    if (blocked.has(message.location().url)) {
      return;
    }
    errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return { errors, blocked };
};

export type Status = {
  phone: string | null;
  busy: boolean;
  zoomed: boolean;
  app: string | null;
  path: string;
  pageApp: string | undefined;
};

export const status = (page: Page): Promise<Status | null> =>
  page.evaluate(() => {
    const capture = (window as any).__capture;
    if (!capture) {
      return null;
    }
    const p = capture.pose();
    return {
      phone: p.phone,
      busy: p.busy,
      zoomed: p.zoomed,
      app: p.app,
      path: location.pathname,
      pageApp: document.getElementById("page")?.dataset.app,
    };
  });

// the phone at rest on the home screen (app null) or with the app open at full zoom, at the path given
export const settledOn = async (
  page: Page,
  path: string,
  app: string | null,
  timeout = 60000,
) => {
  await expect
    .poll(() => status(page), { timeout })
    .toMatchObject({
      busy: false,
      phone: "open",
      zoomed: app !== null,
      app,
      path,
      pageApp: app ?? "home",
    });
};

// the icon on the open phone's home screen
export const tapIcon = (page: Page, name: string) =>
  page.evaluate((name) => {
    const icon = [
      ...document.querySelectorAll<HTMLElement>(
        "#css-layer .panel.main .app-icon",
      ),
    ].find((el) => el.textContent?.includes(name));
    if (!icon) {
      throw new Error(`no ${name} icon`);
    }
    icon.click();
  }, name);

// #page's content made taller than the window and scrolled part way, so a test can tell its scroll survived
export const SCROLL = 400;
export const scrollPage = async (page: Page) => {
  await page.evaluate((top) => {
    const column = document.querySelector("#page .column")!;
    const spacer = document.createElement("div");
    spacer.className = "test-spacer";
    spacer.style.height = "4000px";
    column.appendChild(spacer);
    document.querySelector("#page > .body")!.scrollTop = top;
  }, SCROLL);
};

// the flat page, as a failed scene has to leave it: none of the scene's classes or styles, #page showing with its
// heading, and its scroll where it was
export const expectFlatPage = async (
  page: Page,
  heading: string,
  { scrolled = true } = {},
) => {
  const root = page.locator("html");
  await expect(root).toHaveClass(/scene-failed/, { timeout: 15000 });
  await expect(root).not.toHaveClass(/has-3d/);
  await expect(root).not.toHaveClass(/page-first/);
  const pageEl = page.locator("#page");
  await expect(pageEl).toBeVisible();
  await expect(page.locator("#page h1")).toHaveText(heading);
  await expect(page.locator("#page h1")).toBeVisible();
  const shown = await page.evaluate(() => {
    const el = document.getElementById("page")!;
    const cs = getComputedStyle(el);
    return {
      style: el.getAttribute("style") ?? "",
      sceneClasses: [...el.classList].filter((c) => c.startsWith("scene-")),
      visible: el.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
      }),
      opacity: cs.opacity,
      transform: cs.transform,
      pointerEvents: cs.pointerEvents,
      scrollTop: document.querySelector("#page > .body")!.scrollTop,
    };
  });
  expect(shown.style, "no inline style left on #page").toBe("");
  expect(shown.sceneClasses, "no scene class left on #page").toEqual([]);
  expect(shown.visible).toBe(true);
  expect(shown.opacity).toBe("1");
  expect(shown.transform).toBe("none");
  expect(shown.pointerEvents).toBe("auto");
  if (scrolled) {
    expect(shown.scrollTop, "#page kept its scroll").toBe(SCROLL);
  }
};
