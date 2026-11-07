// the switcher's cards in css, where the 3d scene draws them in webgl (the card shader in scene/screens.js and the
// snapshot holes of scene/snapshotCards.js). each card is a box in the open screen's px, warped onto the frame through
// the screen's corners the way the app window is: a stand in in the page's sky with the app's icon, a plain one, or
// up to three kept pages (lib/snapshots.js) as copies of #page in closed shadow roots, each with its label above. the
// darkened sky behind them sits in the screens layer under the app window, and the cards in a layer over #page, as the
// 3d cards are drawn over the window's hole
import { forHost, snapshotNodes, snapshotOf } from "../lib/snapshots.js";
import { EXTRA_HOLES } from "../scene/shared/motion.js";
import { quadToQuad } from "./warp.js";

// the kept pages of the apps a switcher or a swipe may show, read from storage once as it starts instead of each frame
export const createKept = () => {
  let kept = new Map();
  return {
    prepare: (apps) => {
      kept = new Map(
        apps
          .map((app) => [app.name, snapshotOf(app.name)])
          .filter(([, shot]) => shot),
      );
    },
    has: (name) => kept.has(name),
    get: (name) => kept.get(name) ?? null,
    path: (name) => kept.get(name)?.path ?? null,
    scroll: (name) => kept.get(name)?.scroll ?? 0,
  };
};

// a stand in's icon in its card's own px, as the shader samples it: a third of the card's short side, of which the
// rounded square takes 160 of the atlas' 192 px, with its glyph at 88
export const standInIcon = (w, h) => {
  const side = Math.min(w, h) * 0.3;
  return {
    size: (side * 160) / 192,
    radius: (side * 38) / 192,
    font: (side * 88) / 192,
  };
};

// a label's parts in its own px, from the atlas' 256 by 64 cell: the icon at 8, 10 and 44 square, its glyph at 24, and
// the name at 62 across in 26, both centered on 33 down
const labelParts = (h) => {
  const s = h / 64;
  return {
    icon: { left: 8 * s, top: 10 * s, size: 44 * s, radius: 11 * s },
    glyph: 24 * s,
    name: { left: 62 * s, middle: 33 * s, font: 26 * s },
  };
};

const rgb = ([r, g, b], k = 1) =>
  `rgb(${[r, g, b].map((c) => Math.round(c * k * 255)).join(" ")})`;

// the backdrop's sky, darkened, from the page's top to its bottom (span, in the screen's px)
export const backdropBackground = (sky, span, fullH) => {
  const from = (span[0] / fullH) * 100;
  const to = (span[1] / fullH) * 100;
  return `linear-gradient(to bottom, ${rgb(sky.top, 0.55)} ${from}%, ${rgb(sky.low, 0.55)} ${to}%)`;
};

// the site's css for the copies' shadow roots, read once
const hostSheet = (doc) => {
  let css = "";
  for (const s of doc.styleSheets) {
    try {
      for (const rule of s.cssRules) {
        css += `${rule.cssText}\n`;
      }
    } catch {
      // a sheet from another origin can't be read, and the site has none
    }
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(forHost(css));
  return sheet;
};

// state is { cards, radius, sky, fade, backdrop, span } or null, with each card { app, body, label, kind, alpha }:
// kind 1 is only its label (over the live window), 2 a stand in with the icon, 3 one with nothing on it
export const createCards = ({
  stage,
  full,
  screensHost,
  cardsHost,
  kept,
  slow = () => false,
  doc = document,
}) => {
  const backdrop = doc.createElement("div");
  backdrop.className = "flat-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.style.visibility = "hidden";
  screensHost.append(backdrop);
  cardsHost.hidden = true;
  const bodies = [];
  const labels = [];
  const hosts = [];
  let sheet = null;
  let showing = false;

  // a box in the screen's px as its quad in the frames' px
  const quadOf = (box) =>
    [
      [box.x0, box.y0],
      [box.x1, box.y0],
      [box.x1, box.y1],
      [box.x0, box.y1],
    ].map(([x, y]) => stage.screenPoint([x / full.fullW, y / full.fullH]));
  const warp = (el, w, h, box) => {
    el.style.transform = quadToQuad(
      [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ],
      quadOf(box),
    );
  };
  // the cards are laid out at the zoomed window's px, so their text is as sharp as the window's
  const perScreenPx = () => stage.placed.appW / full.fullW;

  const setShown = (el, shown) => {
    if (el.hidden === shown) {
      el.hidden = !shown;
    }
  };

  const makeBody = () => {
    const el = doc.createElement("div");
    el.className = "flat-card";
    el.setAttribute("aria-hidden", "true");
    const icon = doc.createElement("span");
    icon.className = "flat-card-icon";
    el.append(icon);
    cardsHost.append(el);
    return { el, icon };
  };

  const makeLabel = () => {
    const el = doc.createElement("div");
    el.className = "flat-card-label";
    el.setAttribute("aria-hidden", "true");
    const icon = doc.createElement("span");
    icon.className = "flat-card-label-icon";
    const name = doc.createElement("span");
    name.className = "flat-card-label-name";
    el.append(icon, name);
    cardsHost.append(el);
    return { el, icon, name };
  };

  // a copy of #page in a closed shadow root. the outer box is warped onto the card and the inner one takes the root's
  // classes, as the 3d scene's host does
  const makeHost = () => {
    const el = doc.createElement("div");
    el.className = "flat-snapshot";
    el.setAttribute("aria-hidden", "true");
    el.inert = true;
    el.hidden = true;
    const host = doc.createElement("div");
    const shadow = host.attachShadow({ mode: "closed" });
    sheet ??= hostSheet(doc);
    shadow.adoptedStyleSheets = [sheet];
    const page = doc.createElement("main");
    page.id = "page";
    shadow.append(page);
    el.append(host);
    cardsHost.prepend(el);
    const surface = {
      el,
      host,
      page,
      app: null,
      html: null,
      scroll: 0,
      props: "",
    };
    hosts.push(surface);
    return surface;
  };

  // a copy not showing is taken out of the page entirely, since About's front fact cards set their own visibility. a
  // copy coming back takes its scroll then, since a box that isn't displayed can't be scrolled
  const setHostShown = (surface, shown) => {
    if (surface.el.hidden !== shown) {
      return;
    }
    surface.el.hidden = !shown;
    if (shown) {
      const body = surface.page.querySelector(":scope > .body");
      if (body) {
        body.scrollTop = surface.scroll;
      }
    }
  };

  // the root's own custom properties (the sky's colors, the glass tint), which the scripts set inline on it
  const takeRootProps = (surface) => {
    const root = doc.documentElement.style;
    const names = [...root].filter((name) => name.startsWith("--"));
    const key = names
      .map((name) => `${name}:${root.getPropertyValue(name)}`)
      .join(";");
    if (surface.props === key) {
      return;
    }
    surface.props = key;
    for (const name of names) {
      surface.host.style.setProperty(name, root.getPropertyValue(name));
    }
  };

  const placeHost = (surface, card, opacity, radius) => {
    const shot = kept.get(card.app.name);
    const { width, height } = stage.geometry;
    if (
      surface.app !== card.app.name ||
      surface.html !== shot.html ||
      surface.w !== width ||
      surface.h !== height
    ) {
      Object.assign(surface, {
        app: card.app.name,
        html: shot.html,
        w: width,
        h: height,
        scroll: shot.scroll,
      });
      Object.assign(surface.el.style, {
        width: `${width}px`,
        height: `${height}px`,
      });
      surface.page.dataset.app = card.app.name;
      surface.page.dataset.page = shot.page;
      surface.page.replaceChildren(snapshotNodes(shot.html));
      // a copy already showing takes the new page's scroll as it comes back
      surface.el.hidden = true;
    }
    const classes = doc.documentElement.className;
    if (surface.host.className !== classes) {
      surface.host.className = classes;
    }
    takeRootProps(surface);
    warp(surface.el, width, height, card.body);
    surface.el.style.opacity = String(opacity);
    // the slow path clips nothing (ruling R9), so its kept pages show square
    surface.el.style.clipPath = slow()
      ? ""
      : `inset(0px round ${(radius * width) / Math.max(card.body.x1 - card.body.x0, 1e-6)}px)`;
    setHostShown(surface, opacity > 0);
  };

  const placeBody = (part, card, opacity, radius, sky) => {
    const k = perScreenPx();
    const w = (card.body.x1 - card.body.x0) * k;
    const h = (card.body.y1 - card.body.y0) * k;
    const { el, icon } = part;
    Object.assign(el.style, {
      width: `${w}px`,
      height: `${h}px`,
      borderRadius: `${radius * k}px`,
      background: `linear-gradient(to bottom, ${rgb(sky.top)}, ${rgb(sky.low)})`,
      opacity: String(opacity),
    });
    warp(el, w, h, card.body);
    if (card.kind === 2) {
      const look = standInIcon(w, h);
      Object.assign(icon.style, {
        width: `${look.size}px`,
        height: `${look.size}px`,
        borderRadius: `${look.radius}px`,
        fontSize: `${look.font}px`,
        background: card.app.color,
      });
      icon.textContent = card.app.glyph;
    }
    setShown(icon, card.kind === 2);
    setShown(el, true);
  };

  const placeLabel = (part, card, fade) => {
    const k = perScreenPx();
    const h = (card.label.y1 - card.label.y0) * k;
    const w = (card.label.x1 - card.label.x0) * k;
    const parts = labelParts(h);
    const { el, icon, name } = part;
    Object.assign(el.style, {
      width: `${w}px`,
      height: `${h}px`,
      opacity: String(fade),
    });
    warp(el, w, h, card.label);
    Object.assign(icon.style, {
      left: `${parts.icon.left}px`,
      top: `${parts.icon.top}px`,
      width: `${parts.icon.size}px`,
      height: `${parts.icon.size}px`,
      borderRadius: `${parts.icon.radius}px`,
      fontSize: `${parts.glyph}px`,
      background: card.app.color,
    });
    icon.textContent = card.app.glyph;
    Object.assign(name.style, {
      left: `${parts.name.left}px`,
      top: `${parts.name.middle}px`,
      fontSize: `${parts.name.font}px`,
    });
    name.textContent = card.app.name;
    setShown(el, true);
  };

  const placeBackdrop = (state) => {
    const alpha = state.backdrop * state.fade;
    if (alpha <= 0) {
      backdrop.style.visibility = "hidden";
      return;
    }
    const { appW, appH } = stage.placed;
    Object.assign(backdrop.style, {
      width: `${appW}px`,
      height: `${appH}px`,
      background: backdropBackground(state.sky, state.span, full.fullH),
      opacity: String(alpha),
      visibility: "visible",
    });
    warp(backdrop, appW, appH, {
      x0: 0,
      y0: 0,
      x1: full.fullW,
      y1: full.fullH,
    });
  };

  const hideAll = () => {
    showing = false;
    backdrop.style.visibility = "hidden";
    bodies.forEach((part) => setShown(part.el, false));
    labels.forEach((part) => setShown(part.el, false));
    hosts.forEach((surface) => setHostShown(surface, false));
    cardsHost.hidden = true;
  };

  const draw = (state) => {
    if (!state) {
      if (showing) {
        hideAll();
      }
      return;
    }
    showing = true;
    cardsHost.hidden = false;
    const { cards, radius, sky, fade } = state;
    placeBackdrop(state);
    // the kept pages go on the stand in cards that have one, up to three, each reusing its own copy when it can
    const withPages = cards.filter((c) => c.kind === 2).map((c) => c.app.name);
    const used = new Set();
    cards.forEach((card, i) => {
      const opacity = card.alpha ?? fade;
      let kind = card.kind;
      if (kind === 2 && used.size < EXTRA_HOLES && kept.has(card.app.name)) {
        const surface =
          hosts.find((s) => s.app === card.app.name && !used.has(s)) ||
          hosts.find((s) => !used.has(s) && !withPages.includes(s.app)) ||
          (hosts.length < EXTRA_HOLES ? makeHost() : null);
        if (surface) {
          used.add(surface);
          placeHost(surface, card, opacity, radius);
          kind = 1;
        }
      }
      bodies[i] ??= makeBody();
      if (kind === 1) {
        setShown(bodies[i].el, false);
      } else {
        placeBody(bodies[i], { ...card, kind }, opacity, radius, sky);
      }
      labels[i] ??= makeLabel();
      if (card.label) {
        placeLabel(labels[i], card, fade);
      } else {
        setShown(labels[i].el, false);
      }
    });
    for (let i = cards.length; i < bodies.length; i++) {
      setShown(bodies[i].el, false);
      setShown(labels[i].el, false);
    }
    hosts.filter((s) => !used.has(s)).forEach((s) => setHostShown(s, false));
  };

  // the hosts and cards go with the scene, so a teardown or a handoff leaves none of them in the stage
  const destroy = () => {
    backdrop.remove();
    [...bodies, ...labels, ...hosts].forEach((part) => part.el.remove());
    bodies.length = 0;
    labels.length = 0;
    hosts.length = 0;
  };

  return { draw, destroy };
};
