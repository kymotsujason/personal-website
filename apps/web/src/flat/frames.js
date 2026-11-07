// the frame player: shows the captured frames of the hands and phone, one at a time, from a set's manifest
import { daylight } from "../scene/daylight.js";
import { LEAD } from "../scene/shared/motion.js";
import { place } from "../scene/shared/placement.js";
import { DUO, FOV } from "../scene/state.js";
import { manifestFolder } from "./manifest.js";

// the open phone's height on screen in device pixels from which the full size frames are used. the full frames show it
// 688 px tall at a window of 800 px and a device pixel ratio of 1, and the half frames 344 px (docs/flat-scene-probes.md
// has the measurements)
export const PHONE_PX_FULL = 600;

// above this phone fold a portrait opening's hands are still leading, with the phone not yet moving
const LEAD_TOP = 1 - LEAD.fold;
const INVERSE_STEPS = 40;

// how tall the open phone is on screen in css px at its home pose, from the same place() that sets the pose. in
// landscape the open phone's long side runs across, so its height is the body's, and in portrait it's the two halves.
// the caller multiplies by the device pixel ratio
export const phoneHeightPx = ({ width, height, portrait }) => {
  const tanHalf = Math.tan((FOV / 2) * (Math.PI / 180));
  const { homeDist } = place({ width, height, portrait });
  const phoneCm = portrait ? 2 * DUO.halfW : DUO.bodyH;
  return (phoneCm / (2 * homeDist * tanHalf)) * height;
};

// decided once per page load, so a toolbar showing and hiding can't flip it
export const sizeFor = ({ phonePx } = {}) =>
  Number.isFinite(phonePx) && phonePx >= PHONE_PX_FULL ? "full" : "half";

export const chooseLighting = (hour) => {
  const { day } = daylight(hour, 7, 19);
  if (day >= 1) {
    return "day";
  }
  if (day <= 0) {
    return "night";
  }
  return "dusk";
};

export const frameSize = (manifest) => ({
  width: manifest.window.width + 2 * manifest.margin.x,
  height: manifest.window.height + manifest.margin.top + manifest.margin.bottom,
});

// the frames that pass keep, sorted by key, keeping the earliest frame where several share a key
const sortedBy = (frames, keyOf, keep) => {
  const list = frames
    .map((frame, index) => ({ frame, index }))
    .filter(({ frame }) => keep(frame))
    .map(({ frame, index }) => ({ key: keyOf(frame), index }))
    .sort((a, b) => a.key - b.key || a.index - b.index);
  return list.filter((entry, i) => i === 0 || entry.key !== list[i - 1].key);
};

const nearest = (list, value) => {
  if (list.length === 0 || !Number.isFinite(value)) {
    return null;
  }
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].key < value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  if (lo === 0) {
    return list[0].index;
  }
  if (lo === list.length) {
    return list[lo - 1].index;
  }
  const below = list[lo - 1];
  const above = list[lo];
  return value - below.key <= above.key - value ? below.index : above.index;
};

// only a lead's frames have the hands away from the phone's fold
const isLeadSet = (frames) => frames.some((frame) => frame.hand !== frame.fold);

export const createFrameIndex = (manifest) => {
  const { frames } = manifest;
  const leadSet = isLeadSet(frames);
  const byHand = sortedBy(
    frames,
    (frame) => frame.hand,
    (frame) => leadSet && frame.fold > LEAD_TOP,
  );
  // in a lead set the hands wait at LEAD_TOP while the phone's last bit of travel isn't drawn, so below it the lead's
  // last frame stands for that fold, the same fold frameTimes counts the unfold from
  const byFold = sortedBy(
    frames,
    (frame) => frame.fold,
    (frame) => !leadSet || frame.fold <= LEAD_TOP,
  );
  if (leadSet && byHand.length > 0) {
    byFold.push({ key: LEAD_TOP, index: byHand[0].index });
    byFold.sort((a, b) => a.key - b.key);
  }
  const byTime = sortedBy(
    frames,
    (frame) => frame.t,
    (frame) => Number.isFinite(frame.t),
  );

  // with no hand fold given it's worked out from the lead as handFold does in scene/device.js
  const frameFor = (fold, lead = 0, hand = null) => {
    if (fold > LEAD_TOP && byHand.length > 0) {
      return nearest(byHand, hand ?? Math.min(fold, 1 - LEAD.fold * lead));
    }
    return nearest(byFold, fold);
  };

  // the timed frame (charger runs and the lead) nearest t ms, or null in a set with none
  const indexAt = (t) => nearest(byTime, t);

  return { frameFor, indexAt };
};

// the u at which a rising curve reaches p
export const curveInverse = (curve, p) => {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < INVERSE_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (curve(mid) < p) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
};

// when each frame starts to show while the fold runs from the first frame's to the last's on curve over durationMs.
// each one starts halfway between its fold and the previous one's, so the frames at the slow ends of the curve aren't
// held longer than the rest, and each time is rounded once so a frame ends on the same ms the next one starts
export const frameTimes = (manifest, curve, startMs, durationMs) => {
  const { frames } = manifest;
  // a lead set's frames above LEAD_TOP count as LEAD_TOP, as in frameFor
  const top = isLeadSet(frames) ? LEAD_TOP : Infinity;
  const folds = frames.map((frame) => Math.min(frame.fold, top));
  const first = folds[0];
  const span = folds[folds.length - 1] - first;
  const progress = folds.map((fold) =>
    span === 0 ? 0 : Math.min(Math.max((fold - first) / span, 0), 1),
  );
  return progress.map((p, i) => {
    if (i === 0) {
      return Math.round(startMs);
    }
    const mid = (progress[i - 1] + p) / 2;
    return Math.round(startMs + durationMs * curveInverse(curve, mid));
  });
};

// each frame is a .flat-frame of <i> pieces cut from its atlas through var(--atlas). the atlases decode up front
// through images kept for the visit, so the browser has a reason to keep them decoded, and the frames join hostEl
// once they all have
export const createFrameLayer = (manifest, hostEl) => {
  const { frameFor, indexAt } = createFrameIndex(manifest);
  const base =
    manifest.base ??
    manifestFolder(manifest.set, manifest.lighting, manifest.size);
  const overlap = manifest.overlap ?? 0;
  const { width, height } = frameSize(manifest);
  const atlases = new Set();
  const atlasUrl = (atlas) => {
    atlases.add(atlas);
    return `url("${base}${atlas}")`;
  };

  // a piece reaches overlap px into its neighbors, so scaling never leaves a seam where two meet
  const pieceEl = ([x, y, w, h, atlasX, atlasY], atlas = null) => {
    const el = document.createElement("i");
    Object.assign(el.style, {
      left: `${x - overlap}px`,
      top: `${y - overlap}px`,
      width: `${w + 2 * overlap}px`,
      height: `${h + 2 * overlap}px`,
      backgroundPosition: `${overlap - atlasX}px ${overlap - atlasY}px`,
    });
    if (atlas !== null) {
      el.style.setProperty("--atlas", atlasUrl(atlas));
    }
    return el;
  };

  const elements = manifest.frames.map((frame) => {
    const el = document.createElement("div");
    el.className = "flat-frame";
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    if (frame.pieces.length > 0) {
      el.style.setProperty("--atlas", atlasUrl(frame.atlas));
    }
    frame.pieces.forEach((piece) => el.append(pieceEl(piece)));
    frame.shared.forEach((k) => {
      const { atlas, piece } = manifest.shared[k];
      el.append(pieceEl(piece, atlas));
    });
    return el;
  });
  const images = [...atlases].map((atlas) => ({
    image: new Image(),
    src: `${base}${atlas}`,
  }));

  let decoding = null;
  let released = false;
  let shown = -1;

  const decode = () => {
    if (released) {
      return Promise.reject(new Error("the frame layer was released"));
    }
    if (decoding === null) {
      decoding = Promise.all(
        images.map(({ image, src }) => {
          image.src = src;
          return image.decode();
        }),
      )
        .catch((error) => {
          throw new Error(`the ${manifest.set} frames didn't decode`, {
            cause: error,
          });
        })
        .then(() => {
          if (released) {
            throw new Error("the frame layer was released while decoding");
          }
          hostEl.append(...elements);
        });
    }
    return decoding;
  };

  const show = (index) => {
    if (
      released ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= elements.length ||
      index === shown
    ) {
      return;
    }
    if (shown >= 0) {
      elements[shown].classList.remove("on");
    }
    elements[index].classList.add("on");
    shown = index;
  };

  // no frame shows until the next show(), so the intro's animations alone pick the frame
  const hide = () => {
    if (shown >= 0 && elements[shown]) {
      elements[shown].classList.remove("on");
    }
    shown = -1;
  };

  const release = () => {
    released = true;
    shown = -1;
    elements.forEach((el) => el.remove());
    images.forEach(({ image }) => image.removeAttribute("src"));
    elements.length = 0;
    images.length = 0;
  };

  return { show, hide, frameFor, decode, release, indexAt, elements };
};
