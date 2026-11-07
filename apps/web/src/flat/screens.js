// the 2d scene's screens: the home screen across the open pair (the flap's half with the widgets, the body's half with
// the icons) and the cover screen, as live html cloned from the layout's template (components/FlatScreens.astro) into
// the stage's screens layer. each face is laid out at the 3d screen's own px and warped onto the corners the capture
// recorded for the frame showing. the 3d scene draws these screens in webgl from invisible html (scene/home.js), so
// this has its own html that shows, with the same layout and classes, and the 3d scene's drawing for its picture
import { fillGraph } from "../scene/github.js";
import { facing } from "../scene/pin.js";
import {
  drawHome,
  drawProgress,
  elementRect,
  roundedRect,
} from "../scene/shared/homeDraw.js";
import {
  clock,
  fitLines,
  githubTotal,
  listenForPress,
  musicCard,
  seekFor,
} from "../scene/shared/homeParts.js";
import { screenLayout } from "../scene/shared/placement.js";
import { TAP_FOLD } from "../scene/state.js";
import { quadToQuad } from "./warp.js";

const FACES = ["cover", "flap", "body"];
// the 3d scene hides a face turned away or nearly edge on, where the warp blows up (loop.js pin)
const MIN_FACING = 4;
// the scale the 3d scene draws its screens at (home.js refreshStatus)
const PICTURE_SCALE = 2;
// the widgets' plain glass, the sky lifted toward white (composite.js), for the picture
const PLAIN_GLASS = "rgba(255, 255, 255, 0.22)";

// the capture records each screen's corners from its mesh's own frame (top left, top right, bottom right, bottom left
// there), which isn't the content's: the cover's mesh is on the flap's back, so it's mirrored, and portrait's roll turns
// every mesh a quarter. these pick the recorded corners in the content's order, upright on screen at the fold each
// face is seen at, which the tests check against the captured sets
const CONTENT_ORDER = {
  landscape: { cover: [1, 0, 3, 2], flap: [0, 1, 2, 3], body: [0, 1, 2, 3] },
  portrait: { cover: [2, 1, 0, 3], flap: [3, 0, 1, 2], body: [3, 0, 1, 2] },
};

// which faces take input, under the 3d scene's conditions (loop.js): the open home screen once the fold is under
// TAP_FOLD with no app over it, and the cover while the phone is closed and not moving. the flat page at full zoom and
// the reduced motion crossfade cover the home screen too
export const faceInput = ({
  fold,
  phone,
  busy,
  appVisible,
  pageFlat = false,
  fading = false,
}) => ({
  home: fold < TAP_FOLD && !appVisible && !pageFlat && !fading,
  cover: phone === "closed" && !busy,
});

// each face's quad in the frames' own px (the manifest's corners are in the capture window's), in the content's order
// (tl, tr, br, bl), with its depth and whether it faces the camera
export const faceQuads = (frame, manifest) => {
  const order =
    CONTENT_ORDER[
      manifest.orientation === "portrait" ? "portrait" : "landscape"
    ];
  const names = manifest.screens ?? FACES;
  const { x, top } = manifest.margin;
  return Object.fromEntries(
    names.map((name, i) => {
      const recorded = frame.corners.screens[i];
      const quad = order[name].map((k) => [
        recorded[k][0] + x,
        recorded[k][1] + top,
      ]);
      const [tl, tr, , bl] = quad;
      return [
        name,
        {
          quad,
          depth: frame.corners.depths[i],
          facing: facing([tl, tr, bl]) >= MIN_FACING,
        },
      ];
    }),
  );
};

const px = (v) => `${v}px`;

const setBox = (el, { x = 0, y = 0, w, h }) => {
  Object.assign(el.style, {
    left: px(x),
    top: px(y),
    width: px(w),
    height: px(h),
  });
};

export const createScreens = ({
  host,
  siteData,
  music,
  portrait = false,
  onOpen = () => {},
  onPing = () => {},
}) => {
  const template = document.getElementById("flat-screens");
  if (!(template instanceof HTMLTemplateElement)) {
    throw new Error("the 2d screens' template is missing");
  }
  host.appendChild(template.content.cloneNode(true));
  const home = host.querySelector(".flat-home");
  const faces = Object.fromEntries(
    FACES.map((name) => [name, host.querySelector(`[data-face="${name}"]`)]),
  );
  const { cover, flap, body } = faces;
  const card = flap.querySelector(".music-card");
  const bar = card.querySelector(".m-progress");
  const art = card.querySelector("img.art");
  const statusFaces = [body, cover];
  // each face's own size, for its warp, and whether it showed on the last frame placed
  const sizes = {};
  const shown = { cover: false, flap: false, body: false };
  const pictures = {};
  let fitted = false;

  const appNamed = (name) => siteData.apps.find((app) => app.name === name);

  // the faces at the 3d screens' px: the flap's and the body's halves of the open screen, each holding its part of
  // the one layout (the widgets' panel, and the cover's content where the cover lies over the body's half), and the
  // cover. each face's sky is the open screen's, cut to the part the face shows, so it runs on across the hinge
  const layOut = (turned) => {
    const l = screenLayout(turned);
    const r = px(l.radius);
    const square = "0px";
    setBox(flap, { w: l.flap.w, h: l.flap.h });
    setBox(body, { w: l.body.w, h: l.body.h });
    setBox(cover, { w: l.cover.w, h: l.cover.h });
    flap.style.borderRadius = turned
      ? `${r} ${r} ${square} ${square}`
      : `${r} ${square} ${square} ${r}`;
    body.style.borderRadius = turned
      ? `${square} ${square} ${r} ${r}`
      : `${square} ${r} ${r} ${square}`;
    cover.style.borderRadius = px(l.coverRadius);
    const sky = { w: l.fullW, h: l.fullH };
    setBox(flap.querySelector(".flat-sky"), {
      ...sky,
      x: -l.flap.x,
      y: -l.flap.y,
    });
    setBox(body.querySelector(".flat-sky"), {
      ...sky,
      x: -l.body.x,
      y: -l.body.y,
    });
    setBox(cover.querySelector(".flat-sky"), {
      ...sky,
      x: -l.main.x,
      y: -l.main.y,
    });
    setBox(flap.querySelector(".panel.side"), {
      ...l.side,
      x: l.side.x - l.flap.x,
      y: l.side.y - l.flap.y,
    });
    setBox(body.querySelector(".panel.main"), {
      ...l.main,
      x: l.main.x - l.body.x,
      y: l.main.y - l.body.y,
    });
    setBox(cover.querySelector(".panel.main"), l.cover);
    // in portrait the widgets' half is wide and short, so they sit in two rows across it (site.css)
    flap.querySelector(".widgets").classList.toggle("across", turned);
    Object.assign(sizes, {
      flap: l.flap,
      body: l.body,
      cover: l.cover,
    });
    // a face that isn't laid out yet has no width to fit to
    fitted = flap.offsetWidth > 0;
    if (fitted) {
      fitLines(flap);
    }
  };

  // the music card, from the player's state. only what shows is written, as in 3d
  const showMusic = () => {
    const state = music.state();
    const track = state.current;
    const shownCard = musicCard(state);
    if (card.dataset.shown === shownCard.shown) {
      return;
    }
    card.dataset.shown = shownCard.shown;
    card.querySelector(".m-title").textContent = shownCard.title;
    card.querySelector(".m-channel").textContent = shownCard.channel;
    const toggle = card.querySelector('[data-control="toggle"]');
    toggle.dataset.icon = shownCard.icon;
    toggle.setAttribute("aria-label", shownCard.label);
    if (track && art.dataset.src !== track.art) {
      art.dataset.src = track.art;
      art.classList.remove("loaded");
      art.src = track.art;
    }
  };

  // the bar and its times, from the player each half second, or from the pointer while it's dragged
  let scrub = null;
  let shownPosition = "";
  const showPosition = () => {
    if (scrub && scrub.until <= performance.now()) {
      scrub = null;
    }
    const { time, duration, at } = music.position();
    const shownAt = scrub ? scrub.at : at;
    const shownTime = scrub ? shownAt * duration : time;
    const dragging = Boolean(scrub && scrub.until === Infinity);
    const key = `${Math.round(shownAt * 1000)} ${Math.floor(shownTime)} ${Math.round(duration)} ${dragging}`;
    if (key === shownPosition) {
      return;
    }
    shownPosition = key;
    bar.setAttribute("aria-valuenow", String(Math.round(shownAt * 100)));
    bar.setAttribute(
      "aria-valuetext",
      `${clock(shownTime)} of ${clock(duration)}`,
    );
    Object.assign(bar.dataset, {
      at: shownAt,
      time: shownTime,
      duration,
      dragging: String(dragging),
    });
    bar.style.setProperty("--at", String(shownAt));
    bar.querySelector(".m-time").textContent =
      duration > 0 ? clock(shownTime) : "";
    bar.querySelector(".m-left").textContent =
      duration > 0 ? `-${clock(duration - shownTime)}` : "";
  };

  // the faces only take input at rest, where the phone faces the camera squarely and the bar's box on screen is a
  // plain rectangle, so the pointer's share of it is its share of the bar
  const atPointer = (event) => {
    const box = bar.getBoundingClientRect();
    return Math.min(
      Math.max((event.clientX - box.left) / (box.width || 1), 0),
      1,
    );
  };

  // a box in the open screen's px (both halves as one, the 3d screen's px), from an element's layout in its face. the
  // window grows out of it, as scene/appWindow.js grows it out of glyphRect or a widget's elementRect
  const rectOf = (el) => {
    const name = el.closest("[data-face]")?.dataset.face;
    const face = faces[name];
    let x = 0;
    let y = 0;
    let node = el;
    while (node && node !== face) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent;
    }
    const at = sizes[name] ?? { x: 0, y: 0 };
    return {
      x0: at.x + x,
      y0: at.y + y,
      x1: at.x + x + el.offsetWidth,
      y1: at.y + y + el.offsetHeight,
      radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
    };
  };

  // the app's icon on the body's half, as its glyph's box
  const iconRect = (name) => {
    const glyph = body.querySelector(`.app-icon[data-app="${name}"] .glyph`);
    return glyph ? rectOf(glyph) : { x0: 0, y0: 0, x1: 0, y1: 0, radius: 0 };
  };

  // the open app's own icon is left out of the home screen while its window shows, since a window let go mid swipe can
  // fly in from below it and the icon would show past the window's top (scene/appWindow.js hideOpenIcon). null shows
  // them all
  let hiddenIcon = null;
  const setHiddenIcon = (name) => {
    if (name === hiddenIcon) {
      return;
    }
    const glyphOf = (app) =>
      body.querySelector(`.app-icon[data-app="${app}"] .glyph`);
    if (hiddenIcon !== null) {
      glyphOf(hiddenIcon)?.style.removeProperty("visibility");
    }
    hiddenIcon = name;
    if (name !== null) {
      glyphOf(name)?.style.setProperty("visibility", "hidden");
    }
  };

  // the app's icon button on the body's half, which focus goes back to when the app closes
  const iconButton = (name) =>
    body.querySelector(`.app-icon[data-app="${name}"]`);

  // the home screen behind an app window zooms in around the icon and dims (scene/appWindow.js placeAppWindow), each
  // half around the same point of the open screen. null puts it back
  const dims = {};
  let shownLook = "";
  const setHomeLook = (look) => {
    const key = look ? `${look.zoom} ${look.cx} ${look.cy} ${look.dim}` : "";
    if (key === shownLook) {
      return;
    }
    shownLook = key;
    ["flap", "body"].forEach((name) => {
      const face = faces[name];
      const at = sizes[name];
      [...face.children].forEach((child) => {
        if (child === dims[name] || child.classList.contains("flat-picture")) {
          return;
        }
        if (!look) {
          child.style.transform = "";
          child.style.transformOrigin = "";
          return;
        }
        const ox = look.cx - at.x - child.offsetLeft;
        const oy = look.cy - at.y - child.offsetTop;
        child.style.transformOrigin = `${ox}px ${oy}px`;
        child.style.transform = `scale(${look.zoom})`;
      });
      if (!dims[name]) {
        dims[name] = document.createElement("div");
        dims[name].className = "flat-dim";
        face.appendChild(dims[name]);
      }
      dims[name].style.opacity = look ? String(look.dim) : "0";
    });
  };

  const listen = () => {
    host.querySelectorAll(".app-icon").forEach((button) => {
      const face = cover.contains(button) ? "cover" : "home";
      button.addEventListener("click", () =>
        onOpen({ app: appNamed(button.dataset.app), face, el: button }),
      );
    });
    const actions = { about: "About", project: "Projects", music: "Music" };
    Object.entries(actions).forEach(([action, name]) => {
      const el = flap.querySelector(`[data-action="${action}"]`);
      el.addEventListener("click", () =>
        onOpen({
          app: appNamed(name),
          face: "home",
          el,
          path: el.dataset.path,
        }),
      );
    });
    // the music card holds its controls and isn't a button itself, so only a tap opens it
    flap
      .querySelectorAll('[data-action][role="button"]')
      .forEach((el) => listenForPress(el));
    // the card's buttons act on their own, without opening the music app under them
    flap.querySelectorAll("[data-control]").forEach((el) => {
      listenForPress(el);
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        if (el.dataset.control === "toggle") {
          music.toggle();
        } else if (el.dataset.control === "previous") {
          music.previous();
        } else if (el.dataset.control === "next") {
          music.next();
        }
      });
    });
    statusFaces.forEach((face) => {
      const indicators = face.querySelector(".indicators");
      listenForPress(indicators);
      indicators.addEventListener("click", () =>
        onPing(face === cover ? "cover" : "home"),
      );
    });
    art.addEventListener("load", () => art.classList.add("loaded"));
    bar.addEventListener("pointerdown", (event) => {
      if (!music.position().duration) {
        return;
      }
      bar.setPointerCapture(event.pointerId);
      scrub = { id: event.pointerId, at: atPointer(event), until: Infinity };
      showPosition();
    });
    bar.addEventListener("pointermove", (event) => {
      if (!scrub || scrub.id !== event.pointerId || scrub.until !== Infinity) {
        return;
      }
      scrub.at = atPointer(event);
      showPosition();
    });
    const endScrub = (event) => {
      if (!scrub || scrub.id !== event.pointerId || scrub.until !== Infinity) {
        return;
      }
      music.seek(scrub.at);
      // youtube takes a moment to report the new time, so the bar holds where it was let go until then
      scrub.until = performance.now() + 800;
      showPosition();
    };
    bar.addEventListener("pointerup", endScrub);
    bar.addEventListener("pointercancel", endScrub);
    bar.addEventListener("click", (event) => event.stopPropagation());
    bar.addEventListener("keydown", (event) => {
      const { duration, at } = music.position();
      if (!duration) {
        return;
      }
      const to = seekFor(event.key, at, duration);
      if (to === undefined) {
        return;
      }
      event.preventDefault();
      music.seek(Math.min(Math.max(to, 0), 1));
    });
  };

  // the status bar on the body's half and the cover from scene/status.js's status (time, ping, bars, level,
  // charging), the ping in place of the clock while showPing is set, and the github graph once /api/home answers. null
  // draws the empty grid, and an answer without the graph isn't passed, so it keeps what's shown, as in 3d
  const update = ({ status, showPing = false, contributions } = {}) => {
    if (status) {
      const ping =
        status.ping === null || status.ping === undefined
          ? "offline"
          : `${Math.round(status.ping)} ms`;
      const charging = Boolean(status.charging) && status.level < 100;
      const low = status.level <= 20 && !charging;
      statusFaces.forEach((face) => {
        face.querySelector(".status .time").textContent = showPing
          ? ping
          : status.time;
        face.querySelector(".status .wifi").dataset.bars = String(status.bars);
        const battery = face.querySelector(".status .battery");
        battery.dataset.level = String(status.level);
        battery.dataset.charging = String(Boolean(status.charging));
        battery.dataset.state = charging ? "charging" : low ? "low" : "";
        battery.style.setProperty("--level", String(status.level));
        battery.querySelector(".b-level").textContent = String(status.level);
      });
    }
    if (contributions !== undefined) {
      fillGraph(flap.querySelector(".widget .graph"), contributions);
      flap.querySelector(".gh-total").textContent = githubTotal(contributions);
    }
  };

  // a face going inert or away drops the keyboard focus it held onto the body, so once a face shows again, a focus lost
  // that way moves onto it, and Tab goes on from there. a focus let go while its face still shows stays let go
  // (loop.js syncFaceFocus)
  let focusedFace = null;
  const regions = () => [
    { el: home, shown: shown.flap || shown.body },
    { el: cover, shown: shown.cover },
  ];
  const usable = (face) =>
    face.el.isConnected && face.shown && !face.el.hasAttribute("inert");
  const syncFocus = () => {
    const list = regions();
    const active = document.activeElement;
    const holder = list.find((face) => face.el.contains(active));
    const lastUsable =
      focusedFace && usable(list.find((face) => face.el === focusedFace));
    if (holder || (active && active !== document.body) || lastUsable) {
      focusedFace = holder ? holder.el : null;
      return;
    }
    const next = focusedFace && list.find(usable);
    if (!next) {
      return;
    }
    next.el.tabIndex = -1;
    next.el.focus({ preventScroll: true });
    focusedFace = next.el;
  };

  // the attribute, which the inert property reflects, is only written when it changes
  const setInert = (el, inert) => {
    if (el.hasAttribute("inert") !== inert) {
      el.toggleAttribute("inert", inert);
    }
  };

  const setInput = ({ home: homeLive, cover: coverLive }) => {
    setInert(home, !homeLive);
    setInert(cover, !coverLive);
    syncFocus();
  };

  // each face's warp onto the frame's corners and its place in the stack by depth, and whether it's turned toward the
  // camera (a face turned away has no transform). the intro's keyframes are made from these
  const faceStyles = (frame, manifest) => {
    const quads = faceQuads(frame, manifest);
    const order = FACES.filter((name) => quads[name]).sort(
      (a, b) => quads[a].depth - quads[b].depth,
    );
    return Object.fromEntries(
      order.map((name, i) => {
        const { quad, facing: toCamera } = quads[name];
        const { w, h } = sizes[name];
        const transform = toCamera
          ? quadToQuad(
              [
                [0, 0],
                [w, 0],
                [w, h],
                [0, h],
              ],
              quad,
            )
          : null;
        return [name, { visible: toCamera, zIndex: i + 1, transform }];
      }),
    );
  };

  // warps each face onto the frame's corners, shows only the faces turned toward the camera, and stacks them by depth
  const place = (frame, manifest) => {
    Object.entries(faceStyles(frame, manifest)).forEach(
      ([name, { visible, zIndex, transform }]) => {
        const el = faces[name];
        if (!visible) {
          if (shown[name]) {
            el.style.visibility = "hidden";
            shown[name] = false;
          }
          return;
        }
        el.style.transform = transform;
        el.style.zIndex = String(zIndex);
        if (!shown[name]) {
          el.style.visibility = "visible";
          shown[name] = true;
          // a face laid out before the host had a layout skipped its fit, so the flap fits its lines once it shows
          if (name === "flap" && !fitted && flap.offsetWidth > 0) {
            fitted = true;
            fitLines(flap);
          }
        }
      },
    );
  };

  // the faces drawn into canvases from their live layout, the way the 3d scene draws its screen textures: the sky, the
  // widgets' plain glass, then the 3d scene's own drawing of the icons, the text, and the status bar. each canvas sits
  // in its face, so it's warped with it while showPicture has it in place of the html
  const skyCanvas = (ctx, w, h, frame) => {
    const root = getComputedStyle(document.documentElement);
    const color = (name, fallback) =>
      root.getPropertyValue(name).trim() || fallback;
    const sky = ctx.createLinearGradient(0, frame.y, 0, frame.y + frame.h);
    sky.addColorStop(0, color("--sky-top", "rgb(13, 18, 51)"));
    sky.addColorStop(1, color("--sky-low", "rgb(61, 46, 107)"));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    const dim = ctx.createLinearGradient(0, frame.y, 0, frame.y + frame.h);
    dim.addColorStop(0, `rgba(0, 0, 0, ${color("--dim-top", "0.15")})`);
    dim.addColorStop(1, `rgba(0, 0, 0, ${color("--dim-low", "0.35")})`);
    ctx.fillStyle = dim;
    ctx.fillRect(0, 0, w, h);
  };

  const pictureOf = (name) => {
    const el = faces[name];
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!pictures[name]) {
      pictures[name] = document.createElement("canvas");
      pictures[name].className = "flat-picture";
      pictures[name].setAttribute("aria-hidden", "true");
      el.appendChild(pictures[name]);
    }
    const canvas = pictures[name];
    canvas.width = Math.round(w * PICTURE_SCALE);
    canvas.height = Math.round(h * PICTURE_SCALE);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(PICTURE_SCALE, 0, 0, PICTURE_SCALE, 0, 0);
    const sky = el.querySelector(".flat-sky");
    skyCanvas(ctx, w, h, {
      y: sky.offsetTop,
      h: sky.offsetHeight,
    });
    ctx.fillStyle = PLAIN_GLASS;
    el.querySelectorAll(".widget").forEach((widget) => {
      const box = elementRect(el, widget);
      roundedRect(
        ctx,
        box.x0,
        box.y0,
        box.x1 - box.x0,
        box.y1 - box.y0,
        box.radius || 0,
      );
      ctx.fill();
    });
    const layers = drawHome(el, PICTURE_SCALE, null, name !== "flap", false);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layers.base, 0, 0);
    ctx.drawImage(layers.ink, 0, 0);
    ctx.setTransform(PICTURE_SCALE, 0, 0, PICTURE_SCALE, 0, 0);
    if (name === "flap") {
      drawProgress(ctx, bar, el);
    }
    return canvas;
  };

  const picture = () =>
    Object.fromEntries(FACES.map((name) => [name, pictureOf(name)]));

  const showPicture = (on) => {
    FACES.forEach((name) => faces[name].classList.toggle("pictured", on));
  };

  // backdrop-filter only while the phone is at rest, and the 3d scene's plain glass otherwise
  const setFrosted = (on) => {
    FACES.forEach((name) => faces[name].classList.toggle("frosted", on));
  };

  const setPortrait = (turned) => {
    layOut(turned);
  };

  const destroy = () => {
    stopMusic();
    clearInterval(positionTimer);
    home.remove();
    cover.remove();
  };

  layOut(portrait);
  listen();
  showMusic();
  showPosition();
  const stopMusic = music.subscribe(showMusic);
  const positionTimer = setInterval(showPosition, 500);

  return {
    cover,
    flap,
    body,
    home,
    skies: FACES.map((name) => faces[name].querySelector(".flat-sky")),
    credits: body.querySelector(".credits"),
    update,
    setInput,
    rectOf,
    iconRect,
    iconButton,
    setHiddenIcon,
    setHomeLook,
    place,
    faceStyles,
    picture,
    showPicture,
    setFrosted,
    setPortrait,
    destroy,
  };
};
