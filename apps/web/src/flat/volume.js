// the 2d scene's volume buttons, as scene/volume.js has them: a press on either button steps the music's level, the
// button sinks, and an ios style bar shows on the inner screen when the phone is open and on the cover when closed. the
// buttons are nearly edge on from the front, so the hit areas are the capture's hulls of the 3d scene's enlarged boxes
// (REACH), kept in each volume set's manifest in the capture window's px. the sink is a picture laid over the open
// phone's rest frame, and isn't drawn while the phone moves or closed (the capture has no box to sink there)
import { LEVEL_STEPS } from "../scene/musicInfo.js";
import {
  BAR,
  FADE_OUT,
  LEVEL_EASE,
  PRESS_IN,
  PRESS_OUT,
  SHOW_FOR,
} from "../scene/shared/motion.js";
import { PX_PER_CM, screenLayout } from "../scene/shared/placement.js";
import { drawBar, upButton } from "../scene/shared/volumeParts.js";
import { DUO } from "../scene/state.js";
import { blockNextClick } from "./fold.js";
import { frameSize } from "./frames.js";

export { upButton };

// the buttons' span along the body's top edge, cm from the hinge (art/phone/buildPhone.py), which centers the bar
const BUTTONS_FROM = 0.93;
const BUTTONS_TO = 3.23;
// the sunk button's picture shows while the button is at least this far in, since the capture has only the full press
const SUNK_AT = 0.5;
const SET_NAMES = {
  landscape: "volume-landscape",
  portrait: "volume-portrait",
};

export const volumeSetFor = (portrait) =>
  SET_NAMES[portrait ? "portrait" : "landscape"];

const easeOut = (t) => 1 - (1 - t) * (1 - t);

// how far in a button is t ms after its press, from 0 to 1 and back to 0 (scene/volume.js update)
export const sinkAt = (t) => {
  if (!(t >= 0)) {
    return 0;
  }
  if (t < PRESS_IN) {
    return easeOut(t / PRESS_IN);
  }
  return t < PRESS_IN + PRESS_OUT ? 1 - easeOut((t - PRESS_IN) / PRESS_OUT) : 0;
};

// the bar is fully there for SHOW_FOR ms after a press and then fades over FADE_OUT
export const barOpacityAt = (since) =>
  since < SHOW_FOR ? 1 : Math.max(0, 1 - (since - SHOW_FOR) / FADE_OUT);

export const levelAt = ({ from, to, since }) =>
  from + (to - from) * easeOut(Math.min(since / LEVEL_EASE, 1));

// whether a point is inside a polygon, by counting the edges a ray to the right crosses
export const polygonHas = (polygon, [x, y]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

const centroid = (points) => [
  points.reduce((sum, p) => sum + p[0], 0) / points.length,
  points.reduce((sum, p) => sum + p[1], 0) / points.length,
];

const bounds = (points) => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
};

// the two corners the near and far buttons' four corner faces share, where the hit areas split halfway across the gap
const sharedEdge = (near, far) => {
  const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
  const shared = near.filter((p) => far.some((q) => same(p, q)));
  return shared.length === 2 ? shared : null;
};

// one pose's hit data in the frames' own px: both hulls, the shared edge, and a point on the near button's side of it
const poseAreas = (manifest, pose) => {
  const { margin } = manifest;
  const moved = (points) =>
    points.map(([x, y]) => [x + margin.x, y + margin.top]);
  const { near, far } = manifest.volume.poses[pose];
  const hits = { near: moved(near.hit), far: moved(far.hit) };
  const edge = sharedEdge(hits.near, hits.far);
  if (!edge) {
    throw new Error(`the ${manifest.set} manifest's buttons share no edge`);
  }
  return {
    near: moved(near.hull),
    far: moved(far.hull),
    edge,
    nearSide: centroid(hits.near),
  };
};

// the hit areas at a fold, in window px, through project (the stage's chain). a phone at rest has its own rest pose's
// hulls. while it moves, the nearer rest pose's hulls are carried along by how far the pair has travelled between the
// two (the whole body half slides across as the phone closes in landscape), then through the chain at that fold
export const hitAreas = ({ manifest, fold, project }) => {
  const open = poseAreas(manifest, "open");
  const closed = poseAreas(manifest, "closed");
  const t = Math.min(Math.max(fold, 0), 1);
  const base = t < 0.5 ? open : closed;
  const centerOf = (areas) => bounds([...areas.near, ...areas.far]);
  const from = centerOf(open);
  const to = centerOf(closed);
  const here = centerOf(base);
  const shift = [
    from[0] + (to[0] - from[0]) * t - here[0],
    from[1] + (to[1] - from[1]) * t - here[1],
  ];
  const carry = (p) => project([p[0] + shift[0], p[1] + shift[1]]);
  return {
    near: base.near.map(carry),
    far: base.far.map(carry),
    edge: base.edge.map(carry),
    nearSide: carry(base.nearSide),
  };
};

const sideOf = ([a, b], [x, y]) =>
  Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]));

// the button a press at a window point lands on, or null. where the two hulls overlap, the shared edge splits them
export const buttonAt = (areas, x, y) => {
  const inNear = polygonHas(areas.near, [x, y]);
  const inFar = polygonHas(areas.far, [x, y]);
  if (inNear && inFar) {
    return sideOf(areas.edge, [x, y]) === sideOf(areas.edge, areas.nearSide)
      ? "near"
      : "far";
  }
  if (inNear) {
    return "near";
  }
  return inFar ? "far" : null;
};

// where the bar lies on the body's half (open) and on the cover (closed), in each face's own px: BAR.inset in from the
// body's top edge, centered along the buttons, standing in portrait (scene/volume.js)
export const barBoxes = (portrait) => {
  const layout = screenLayout(portrait);
  const sy = DUO.screenH / 2;
  const along = ((BUTTONS_FROM + BUTTONS_TO) / 2 + DUO.halfScreenW) * PX_PER_CM;
  const across = portrait
    ? (DUO.bodyH / 2 - BAR.inset + sy) * PX_PER_CM
    : (sy - (DUO.bodyH / 2 - BAR.inset)) * PX_PER_CM;
  const w = (portrait ? BAR.short : BAR.long) * PX_PER_CM;
  const h = (portrait ? BAR.long : BAR.short) * PX_PER_CM;
  const [cx, cy] = portrait ? [across, along] : [along, across];
  const on = (face) => ({
    x: cx - w / 2 - face.x,
    y: cy - h / 2 - face.y,
    w,
    h,
  });
  return { body: on(layout.body), cover: on(layout.main) };
};

const px = (v) => `${v}px`;

// a clip that cuts boxes out of a frame, in the frame's px
const holesIn = (size, boxes) =>
  `path(evenodd, "M0 0H${size.width}V${size.height}H0Z${boxes
    .map(([x, y, w, h]) => ` M${x} ${y}h${w}v${h}h${-w}Z`)
    .join("")}")`;

// scene holds the phone's state and the mounted parts, and its volumeSet is { manifest, layer } of the volume frames for
// this orientation, or null when they didn't load, which leaves the scene without the buttons as 3d does
export const createVolume = ({
  scene,
  loop,
  music,
  clock = () => performance.now(),
  paint = drawBar,
}) => {
  const pressedAt = { near: -Infinity, far: -Infinity };
  let shownAt = -Infinity;
  let shownLevel = null;
  let fromLevel = 0;
  let toLevel = 0;
  let levelStart = -Infinity;
  let drawnKey = null;
  let opacity = 0;
  let bars = null;
  let awake = null;
  // the rest frame's element with the boxes cut from it, and which pictures show
  let cut = null;
  const sunk = { near: false, far: false };

  const usable = () =>
    Boolean(
      scene.volumeSet &&
      scene.stage &&
      scene.drawing &&
      scene.unlocked &&
      !scene.zoomed,
    );

  const areasNow = () =>
    hitAreas({
      manifest: scene.volumeSet.manifest,
      fold: scene.fold,
      project: (p) => scene.stage.toWindow(p),
    });

  const over = (x, y) => (usable() ? buttonAt(areasNow(), x, y) : null);

  const ensureBars = () => {
    const { screens, portrait } = scene;
    if (bars && bars.screens === screens) {
      return bars;
    }
    const boxes = barBoxes(portrait);
    const make = (face, box) => {
      const canvas = document.createElement("canvas");
      canvas.className = "flat-volume";
      canvas.setAttribute("aria-hidden", "true");
      canvas.width = portrait ? 96 : 544;
      canvas.height = portrait ? 544 : 96;
      Object.assign(canvas.style, {
        left: px(box.x),
        top: px(box.y),
        width: px(box.w),
        height: px(box.h),
      });
      face.append(canvas);
      return canvas;
    };
    bars = {
      screens,
      canvases: [
        make(screens.body, boxes.body),
        make(screens.cover, boxes.cover),
      ],
    };
    drawnKey = null;
    return bars;
  };

  const shownNow = (now) =>
    shownLevel === null
      ? null
      : levelAt({ from: fromLevel, to: toLevel, since: now - levelStart });

  const press = (which, now) => {
    ensureBars();
    const before = shownNow(now) ?? music.level() / LEVEL_STEPS;
    const next = music.stepLevel(which === upButton(scene.portrait) ? 1 : -1);
    pressedAt[which] = now;
    fromLevel = before;
    toLevel = next / LEVEL_STEPS;
    shownLevel = before;
    levelStart = now;
    shownAt = now;
    if (awake === null) {
      awake = loop.add(() => {}, 0);
    }
    loop.wake();
  };

  // a press at a window point, true if it landed on a button
  const pressAt = (x, y, now = clock()) => {
    const which = over(x, y);
    if (which === null) {
      return false;
    }
    press(which, now);
    return true;
  };

  const releaseCut = () => {
    if (cut) {
      cut.style.clipPath = "";
      cut = null;
    }
  };

  // the open phone at rest has the sunk button's picture over its rest frame, which loses the box the picture covers
  const showSink = (now) => {
    const { manifest, layer } = scene.volumeSet;
    // a charger run shows its own frames, which have no rest frame to cut
    const rest =
      scene.drawing &&
      !scene.busy &&
      !scene.charger?.busy() &&
      scene.fold === 0;
    const boxes = [];
    ["near", "far"].forEach((which) => {
      const entry = manifest.volume.poses.open[which];
      const on =
        rest && entry.box !== null && sinkAt(now - pressedAt[which]) >= SUNK_AT;
      if (on !== sunk[which]) {
        sunk[which] = on;
        layer.elements[entry.frame]?.classList.toggle("on", on);
      }
      if (on) {
        boxes.push(entry.box);
      }
    });
    const { frames } = scene.stage;
    const target =
      boxes.length > 0
        ? frames.elements[frames.frameFor(scene.fold, scene.lead)]
        : null;
    if (target !== cut) {
      releaseCut();
    }
    if (target) {
      target.style.clipPath = holesIn(frameSize(manifest), boxes);
      cut = target;
    }
  };

  const showBar = (now) => {
    const next = barOpacityAt(now - shownAt);
    if (next !== opacity) {
      opacity = next;
      bars.canvases.forEach((canvas) => {
        canvas.style.opacity = String(next);
        canvas.style.visibility = next > 0 ? "visible" : "hidden";
      });
    }
    const level = shownNow(now);
    const key = next > 0 && level !== null ? Math.round(level * 400) : null;
    if (key !== null && key !== drawnKey) {
      bars.canvases.forEach((canvas) => paint(canvas, level, scene.portrait));
      drawnKey = key;
    }
  };

  const draw = (now) => {
    if (awake === null && !cut) {
      return;
    }
    if (!scene.volumeSet || !scene.stage || !scene.screens) {
      return;
    }
    showSink(now);
    showBar(now);
    const moving =
      sunk.near ||
      sunk.far ||
      now - shownAt < SHOW_FOR + FADE_OUT ||
      now - levelStart < LEVEL_EASE ||
      now - Math.max(pressedAt.near, pressedAt.far) < PRESS_IN + PRESS_OUT;
    if (!moving && awake !== null) {
      awake();
      awake = null;
    }
  };

  const hover = (event) => {
    if (event.pointerType !== "mouse") {
      return;
    }
    const now = over(event.clientX, event.clientY) !== null;
    if (now !== document.body.classList.contains("over-volume")) {
      document.body.classList.toggle("over-volume", now);
    }
  };

  // the listeners come before the folds' and the look's, so a press on a button takes the pointer from them all
  const install = ({ signal, guard }) => {
    addEventListener(
      "pointerdown",
      guard((event) => {
        if (pressAt(event.clientX, event.clientY)) {
          event.stopImmediatePropagation();
          event.preventDefault();
          blockNextClick();
        }
      }),
      { capture: true, signal },
    );
    addEventListener("pointermove", guard(hover), { signal });
  };

  // a new mount (a turn) has new screens and frames, so the bar, the sink, and the press start over, and the loop can
  // sleep again
  const reset = () => {
    releaseCut();
    sunk.near = false;
    sunk.far = false;
    pressedAt.near = -Infinity;
    pressedAt.far = -Infinity;
    shownAt = -Infinity;
    shownLevel = null;
    levelStart = -Infinity;
    drawnKey = null;
    opacity = 0;
    bars = null;
    if (awake !== null) {
      awake();
      awake = null;
    }
  };

  const state = () => ({
    up: scene.volumeSet?.manifest.volume.up ?? null,
    areas: usable() ? areasNow() : null,
    level: shownNow(clock()),
    opacity,
    sunk: { ...sunk },
    cut: cut !== null,
  });

  return { install, draw, pressAt, over, state, reset };
};
