// the stage: the frames and the screens, each in a layer laid out in the frames' own px, moved together through one
// css transform that copies the 3d camera, and #page placed from the screen's corners through that same transform.
// the frames were captured at the capture window's rest pose, so the chain takes that pose to the identity and moves
// the frames by how the asked for pose differs from it, as a flat card at the phone's front face
import { cornerPin, facing } from "../scene/pin.js";
import { APP_BACKGROUND } from "../scene/shared/motion.js";
import { SCREEN_FRONT, centerShift, place } from "../scene/shared/placement.js";
import { DUO, FOV } from "../scene/state.js";
import { createFrameLayer, frameSize } from "./frames.js";
import { homography, mapPoint } from "./warp.js";

const TAN_HALF = Math.tan((FOV / 2) * (Math.PI / 180));
// how much farther forward the closed slab's front (the cover) is than the open screen (device.js setFold: the hinged
// group goes back by this while the flap comes over in front)
const CLOSED_FRONT = DUO.depth / 2 + DUO.gap / 2;
const WHOLE = { x0: 0, y0: 0, x1: 1, y1: 1 };

const clampFold = (fold) => Math.min(Math.max(fold, 0), 1);

// the plane the card lies on, in front of the phone's center: the open screen, moving out to the cover as it closes
export const cardFront = (fold) =>
  SCREEN_FRONT + CLOSED_FRONT * clampFold(fold);

// what the chain needs about the window and the set: the window's camera, the capture's camera and pose, and where
// the capture window's center is in the frames' px
export const stageGeometry = ({ width, height, manifest }) => {
  const portrait = manifest.orientation === "portrait";
  const placed = place({ width, height, portrait });
  const focal = height / (2 * TAN_HALF);
  return {
    width,
    height,
    portrait,
    placed,
    focal,
    captureFocal: manifest.window.height / (2 * TAN_HALF),
    capturePose: place({
      width: manifest.window.width,
      height: manifest.window.height,
      portrait,
    }).rest,
    center: [
      manifest.margin.x + manifest.window.width / 2,
      manifest.margin.top + manifest.window.height / 2,
    ],
    // css px per cm on the plane the perspective leaves unscaled, which is where the zoom pose puts the screen
    unit: focal / placed.zoomDist,
  };
};

// the chain as css transform functions, applied right to left to a point in the frames' px: into the capture's
// camera on the card, into the phone's own frame at the capture pose, turned and moved to the pose, then seen through
// the window's camera. three's y points up and css's down, so the x and z turns change sign. a pose may carry tx and
// ty, a turn about the phone's own x and then y after its pose's turn (the charger's tilt, charging.js chargeMove),
// which the chain only has while one is set
const chainSteps = (geometry, pose, fold) => {
  const { width, height, focal, captureFocal, capturePose, center } = geometry;
  const k = geometry.unit;
  const shift = centerShift(fold, geometry.portrait);
  const front = cardFront(fold);
  const scale = (k * (-capturePose.z - front)) / captureFocal;
  const tilt =
    pose.tx || pose.ty
      ? [
          ["rotateX", -(pose.tx ?? 0)],
          ["rotateY", pose.ty ?? 0],
        ]
      : [];
  return [
    ["translate", width / 2, height / 2, 0],
    ["perspective", focal],
    ["translate", k * pose.x, -k * (pose.y + shift), focal + k * pose.z],
    ["rotateX", -pose.rx],
    ["rotateY", pose.ry],
    ["rotateZ", -pose.rz],
    ...tilt,
    ["translate", -k * capturePose.x, k * (capturePose.y + shift), k * front],
    ["scale", scale],
    ["translate", -center[0], -center[1], 0],
  ];
};

// 4 by 4 matrices row by row, acting on column vectors
const multiply = (a, b) =>
  Array.from({ length: 16 }, (_, n) => {
    const i = n >> 2;
    const j = n & 3;
    return (
      a[4 * i] * b[j] +
      a[4 * i + 1] * b[4 + j] +
      a[4 * i + 2] * b[8 + j] +
      a[4 * i + 3] * b[12 + j]
    );
  });

const stepMatrix = ([kind, a, b, c]) => {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  switch (kind) {
    case "translate":
      return [1, 0, 0, a, 0, 1, 0, b, 0, 0, 1, c, 0, 0, 0, 1];
    case "perspective":
      return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1 / a, 1];
    case "rotateX":
      return [1, 0, 0, 0, 0, cos, -sin, 0, 0, sin, cos, 0, 0, 0, 0, 1];
    case "rotateY":
      return [cos, 0, sin, 0, 0, 1, 0, 0, -sin, 0, cos, 0, 0, 0, 0, 1];
    case "rotateZ":
      return [cos, -sin, 0, 0, sin, cos, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    default:
      return [a, 0, 0, 0, 0, a, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }
};

const stepCss = ([kind, a, b, c]) => {
  switch (kind) {
    case "translate":
      return c === 0
        ? `translate(${a}px, ${b}px)`
        : `translate3d(${a}px, ${b}px, ${c}px)`;
    case "perspective":
      return `perspective(${a}px)`;
    case "scale":
      return `scale(${a})`;
    default:
      return `${kind}(${a}rad)`;
  }
};

export const chainMatrix = (geometry, pose, fold = 0) =>
  chainSteps(geometry, pose, fold).map(stepMatrix).reduce(multiply);

// a point in the frames' px to where the chain draws it in the window
export const projectPoint = (m, [x, y]) => {
  const w = m[12] * x + m[13] * y + m[15];
  return [(m[0] * x + m[1] * y + m[3]) / w, (m[4] * x + m[5] * y + m[7]) / w];
};

// the css transform for the layers. a pose facing the camera squarely is a plain scale and move, written as a 2d
// matrix so the browser draws the screens' text sharp; any turn gets the chain itself, so animations between poses
// interpolate it function by function. keyframes ask for the chain every time (functions), since a keyframe list
// mixing the two is interpolated by decomposing matrices instead
export const chainTransform = (
  geometry,
  pose,
  fold = 0,
  { functions = false } = {},
) => {
  const steps = chainSteps(geometry, pose, fold);
  if (functions) {
    return steps.map(stepCss).join(" ");
  }
  const m = steps.map(stepMatrix).reduce(multiply);
  if (Math.abs(m[12]) < 1e-12 && Math.abs(m[13]) < 1e-12) {
    const w = m[15];
    return `matrix(${m[0] / w}, ${m[4] / w}, ${m[1] / w}, ${m[5] / w}, ${m[3] / w}, ${m[7] / w})`;
  }
  return steps.map(stepCss).join(" ");
};

// the open screen across both halves, in the frames' px, in order around the edge from the top left as the window
// sees it (the halves' own corner order turns with the orientation)
const openScreenQuad = (manifest, frame) => {
  const points = [...frame.corners.screens[1], ...frame.corners.screens[2]].map(
    ([x, y]) => [x + manifest.margin.x, y + manifest.margin.top],
  );
  const most = (score) =>
    points.reduce((best, p) => (score(p) > score(best) ? p : best));
  return [
    most(([x, y]) => -x - y),
    most(([x, y]) => x - y),
    most(([x, y]) => x + y),
    most(([x, y]) => y - x),
  ];
};

export const createStage = ({ stageEl, pageEl, manifest }) => {
  const size = frameSize(manifest);
  const makeLayer = (name) => {
    const el = document.createElement("div");
    el.className = `flat-layer ${name}`;
    el.style.width = `${size.width}px`;
    el.style.height = `${size.height}px`;
    return el;
  };
  const screensEl = makeLayer("flat-screens");
  const framesEl = makeLayer("flat-frames");
  // the switcher's cards go over #page and under the hands, the way the 3d cards are drawn over the window's hole. the
  // layer is hidden while there are none (src/flat/cards.js)
  const cardsEl = makeLayer("flat-cards");
  cardsEl.hidden = true;
  stageEl.insertBefore(screensEl, pageEl);
  pageEl.after(cardsEl, framesEl);
  const frameLayer = createFrameLayer(manifest, framesEl);
  let frames = frameLayer;

  // #page is pinned on the open screen, so its corners come from the frame nearest flat
  const openFrame = manifest.frames[frameLayer.frameFor(0)];
  const openQuad = openFrame ? openScreenQuad(manifest, openFrame) : null;
  const unitSquare = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const fromScreen = openQuad ? homography(unitSquare, openQuad) : null;

  let geometry = null;
  let pose = null;
  let fold = 0;
  let matrix = null;
  let shownTransform = null;
  const page = {
    mode: null,
    shown: null,
    pinned: null,
    opacity: null,
    live: null,
  };

  const apply = () => {
    if (!geometry || !pose) {
      return;
    }
    matrix = chainMatrix(geometry, pose, fold);
    const transform = chainTransform(geometry, pose, fold);
    if (transform !== shownTransform) {
      shownTransform = transform;
      screensEl.style.transform = transform;
      cardsEl.style.transform = transform;
      framesEl.style.transform = transform;
    }
  };

  const setPose = (next) => {
    pose = { ...next };
    apply();
  };

  // the phone's fold picks the frame, and moves the card's plane and portrait's hinge shift with it. index picks the
  // frame instead, for a set played by time (the charger's)
  const setFold = (nextFold, lead = 0, index = null) => {
    fold = clampFold(nextFold);
    frames.show(index ?? frames.frameFor(fold, lead));
    apply();
  };

  // another set's frames in the same layer (portrait's closing path), which shows once useFrames picks it
  const extra = [];
  const addFrames = (other) => {
    const layer = createFrameLayer(other, framesEl);
    extra.push(layer);
    return layer;
  };
  const useFrames = (layer) => {
    if (layer === frames) {
      return;
    }
    frames.hide();
    frames = layer;
  };
  // a set let go for the rest of the visit, with its images, so the browser can drop what it decoded
  const dropFrames = (layer) => {
    layer.release();
    const at = extra.indexOf(layer);
    if (at >= 0) {
      extra.splice(at, 1);
    }
  };

  // a point in the frames' px to where the chain draws it in the window now, or at another pose and fold
  const toWindow = (p, at = null, atFold = 0) =>
    projectPoint(at ? chainMatrix(geometry, at, atFold) : matrix, p);

  // a point on the open screen, as its share across and down, to the frames' px
  const screenPoint = (p) => mapPoint(fromScreen, p);

  // how many window px one frame px covers at a pose, at the phone's center
  const scaleAt = (at, atFold = 0) => {
    const m = chainMatrix(geometry, at, atFold);
    const [cx, cy] = geometry.center;
    const a = projectPoint(m, [cx, cy]);
    const b = projectPoint(m, [cx + 1, cy]);
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };

  const setPageShown = (shown) => {
    if (page.shown !== shown) {
      page.shown = shown;
      pageEl.style.visibility = shown ? "visible" : "hidden";
    }
  };

  // #page laid out at the window's size and centered in the app window, which is laid out at appW by appH and covers
  // box, a share of the open screen, as scene/appWindow.js pageBox does
  const pageCorners = (box) => {
    const { width, height, placed } = geometry;
    const u = (placed.appW - width) / (2 * placed.appW);
    const v = (placed.appH - height) / (2 * placed.appH);
    const x0 = box.x0 + u * (box.x1 - box.x0);
    const x1 = box.x1 - u * (box.x1 - box.x0);
    const y0 = box.y0 + v * (box.y1 - box.y0);
    const y1 = box.y1 - v * (box.y1 - box.y0);
    return [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ].map((p) => projectPoint(matrix, mapPoint(fromScreen, p)));
  };

  // as scene/loop.js pin: hidden while turned away or nearly edge on, and pinned again only once a corner has moved a
  // quarter px
  const pinPage = (box) => {
    if (!matrix || !fromScreen) {
      setPageShown(false);
      return;
    }
    const corners = pageCorners(box);
    if (facing(corners) < 4) {
      setPageShown(false);
      return;
    }
    setPageShown(true);
    const last = page.pinned;
    if (
      last &&
      corners.every(
        (c, i) =>
          Math.abs(c[0] - last[i][0]) < 0.25 &&
          Math.abs(c[1] - last[i][1]) < 0.25,
      )
    ) {
      return;
    }
    page.pinned = corners;
    pageEl.style.transform = cornerPin(
      geometry.width,
      geometry.height,
      corners,
    );
  };

  // #page as scene/loop.js placePage has it: hidden under the home screen, pinned onto the app window (box, a share
  // of the open screen) while it opens, closes, or is swiped, the flat page with every transform cleared at full zoom
  // with the frames dropped behind it, or fading over the phone on the apps' background. it takes pointer input only
  // when live, which the 3d scene gives it while an app is zoomed and nothing moves
  const placePage = (
    mode,
    { box = WHOLE, opacity = 1, live = mode === "flat" } = {},
  ) => {
    if (mode !== page.mode) {
      page.mode = mode;
      page.pinned = null;
      page.opacity = null;
      const fading = mode === "fading";
      Object.assign(pageEl.style, {
        transform: "",
        opacity: "",
        willChange: mode === "pinned" ? "transform" : "",
        zIndex: fading ? "1" : "",
        background: fading ? APP_BACKGROUND : "",
      });
      framesEl.style.zIndex = mode === "flat" ? "-1" : "";
    }
    if (live !== page.live) {
      page.live = live;
      pageEl.style.pointerEvents = live ? "" : "none";
    }
    if (mode === "flat" || mode === "fading") {
      setPageShown(true);
    } else if (mode === "pinned") {
      pinPage(box);
    } else {
      setPageShown(false);
    }
    if (mode === "flat" || mode === "hidden") {
      return;
    }
    const shown = String(opacity);
    if (shown !== page.opacity) {
      page.opacity = shown;
      pageEl.style.opacity = shown;
    }
  };

  // the window's size from the browser, with the pose and #page placed again for it. the caller gives the pose for
  // the new size, since place's poses move with it (see placed)
  const fit = () => {
    geometry = stageGeometry({
      width: innerWidth,
      height: innerHeight,
      manifest,
    });
    page.pinned = null;
    apply();
  };

  const destroy = () => {
    frameLayer.release();
    extra.forEach((layer) => layer.release());
    screensEl.remove();
    cardsEl.remove();
    framesEl.remove();
    for (const name of [
      "transform",
      "opacity",
      "willChange",
      "zIndex",
      "background",
      "visibility",
      "pointerEvents",
      "clipPath",
    ]) {
      pageEl.style[name] = "";
    }
  };

  fit();

  return {
    setPose,
    setFold,
    placePage,
    fit,
    destroy,
    addFrames,
    useFrames,
    dropFrames,
    toWindow,
    screenPoint,
    scaleAt,
    layers: { screens: screensEl, cards: cardsEl, frames: framesEl },
    frameLayer,
    get frames() {
      return frames;
    },
    get placed() {
      return geometry.placed;
    },
    get geometry() {
      return geometry;
    },
  };
};
