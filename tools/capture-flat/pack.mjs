// packs a captured 2D scene set for the web: each frame is split into a few large pieces around its empty areas and
// those are packed into one webp atlas per frame, with a manifest saying where each piece goes. a piece that's the
// same as the same rectangle in the previous frame is stored once and listed in shared. reads
// .media/flat/<SET>-<LIGHTING>/ (capture.mjs writes it) and writes apps/web/public/flat/<SET>-<LIGHTING>-<SIZE>/,
// each image put on the privacy allowlist. run it from site/:
//   node tools/capture-flat/pack.mjs --set <SET> --lighting <LIGHTING> [--size full|half]
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { sha256 } from "../privacy/allowlist.mjs";
import { stripAndVerify } from "../privacy/metadata.mjs";

// real pixels from the frame kept around each piece in the atlas, and how far each piece reaches into its neighbors
// when shown, so scaling never leaves a pixel row half covered where two pieces meet
export const PAD = 4;
export const OVERLAP = 1;
// piece sizes are whole 4 px blocks, so no block of the lossy webp holds two pieces
export const GRID = 4;
// the empty areas are found on a grid of BLOCK px, and a piece is split again while an empty area is at least
// SPLIT_SHARE of it, DEPTH times
export const BLOCK = 8;
export const SPLIT_SHARE = 0.08;
export const DEPTH = 6;
export const WIDTH_STEP = 64;
export const WIDTH_TRIES = 40;
export const SHARE_TOLERANCE = 6;
export const SIZES = { full: 1, half: 0.5 };
const ATLAS_WEBP = { quality: 80, alphaQuality: 90, effort: 6 };
const DESK_WEBP = { quality: 80, effort: 6 };
const NAME = /^[a-z0-9-]+$/;
const FRAME_FILE = /^\d+\.png$/;
const DESK_FILE = /^desk-([a-z]+)-(sharp|blur)\.png$/;
const OUTPUT_NAME =
  /^(?:a\d{3,}\.webp|desk-[a-z]+-(?:sharp|blur)\.webp|manifest\.json)$/;

// the drawn area of a rectangle of the mask, as [x0, y0, x1, y1], or null when nothing is drawn there
export const trim = (mask, x0, y0, x1, y1) => {
  const { data, width } = mask;
  let top = -1;
  let bottom = -1;
  let left = x1;
  let right = x0 - 1;
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    let first = -1;
    let last = -1;
    for (let x = x0; x < x1; x++) {
      if (data[row + x]) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first < 0) continue;
    if (top < 0) top = y;
    bottom = y;
    left = Math.min(left, first);
    right = Math.max(right, last);
  }
  if (top < 0) return null;
  return [left, top, right + 1, bottom + 1];
};

// the largest rectangle of empty blocks, as block coordinates [x0, y0, x1, y1], by the histogram method
export const largestEmpty = (empty, cols, rows) => {
  const heights = new Int32Array(cols);
  let bestArea = 0;
  let best = null;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      heights[c] = empty[r * cols + c] ? heights[c] + 1 : 0;
    }
    const stack = [];
    for (let c = 0; c <= cols; c++) {
      const h = c < cols ? heights[c] : 0;
      let start = c;
      while (stack.length > 0 && stack[stack.length - 1][1] >= h) {
        const [from, sh] = stack.pop();
        start = from;
        const area = sh * (c - from);
        if (area > bestArea) {
          bestArea = area;
          best = [from, r - sh + 1, c, r + 1];
        }
      }
      stack.push([start, h]);
    }
  }
  return best;
};

// the pieces of one frame: its drawn area, split around its largest empty rectangle into the bands above and below
// it and the pieces left and right of it, again for each piece, each trimmed to what it really holds
export const cover = (mask, box, depth = DEPTH) => {
  const [x0, y0, x1, y1] = box;
  if (depth === 0) return [box];
  const bx0 = Math.floor(x0 / BLOCK);
  const by0 = Math.floor(y0 / BLOCK);
  const cols = Math.ceil(x1 / BLOCK) - bx0;
  const rows = Math.ceil(y1 / BLOCK) - by0;
  const empty = new Uint8Array(cols * rows).fill(1);
  const xEnd = Math.min((bx0 + cols) * BLOCK, mask.width);
  const yEnd = Math.min((by0 + rows) * BLOCK, mask.height);
  for (let y = by0 * BLOCK; y < yEnd; y++) {
    const row = y * mask.width;
    const blockRow = (Math.floor(y / BLOCK) - by0) * cols;
    for (let x = bx0 * BLOCK; x < xEnd; x++) {
      if (mask.data[row + x]) {
        empty[blockRow + Math.floor(x / BLOCK) - bx0] = 0;
      }
    }
  }
  const found = largestEmpty(empty, cols, rows);
  if (found === null) return [box];
  const ex0 = Math.max((found[0] + bx0) * BLOCK, x0);
  const ey0 = Math.max((found[1] + by0) * BLOCK, y0);
  const ex1 = Math.min((found[2] + bx0) * BLOCK, x1);
  const ey1 = Math.min((found[3] + by0) * BLOCK, y1);
  if ((ex1 - ex0) * (ey1 - ey0) < SPLIT_SHARE * (x1 - x0) * (y1 - y0)) {
    return [box];
  }
  const pieces = [];
  const parts = [
    [x0, y0, x1, ey0],
    [x0, ey1, x1, y1],
    [x0, ey0, ex0, ey1],
    [ex1, ey0, x1, ey1],
  ];
  for (const part of parts) {
    if (part[2] <= part[0] || part[3] <= part[1]) continue;
    const trimmed = trim(mask, ...part);
    if (trimmed !== null) pieces.push(...cover(mask, trimmed, depth - 1));
  }
  return pieces;
};

// a piece's size in the atlas: its padding on each side, rounded up to whole blocks
export const pieceSize = ([x0, y0, x1, y1]) => [
  Math.ceil((x1 - x0 + 2 * PAD) / GRID) * GRID,
  Math.ceil((y1 - y0 + 2 * PAD) / GRID) * GRID,
];

// skyline packing: the atlas's top edge is kept as a list of steps [x, y, width], and each piece (tallest first)
// goes where it ends lowest, at its leftmost such spot
export const skyline = (sizes, width) => {
  const order = sizes
    .map((_, i) => i)
    .sort(
      (a, b) => sizes[b][1] - sizes[a][1] || sizes[b][0] - sizes[a][0] || a - b,
    );
  let sky = [[0, 0, width]];
  const spots = new Array(sizes.length);
  for (const i of order) {
    const [w, h] = sizes[i];
    let best = null;
    for (const [x] of sky) {
      if (x + w > width) break;
      let top = 0;
      for (const [sx, sy, sw] of sky) {
        if (sx >= x + w) break;
        if (sx + sw > x) top = Math.max(top, sy);
      }
      if (best === null || top < best[1]) best = [x, top];
    }
    const [x, top] = best;
    spots[i] = [x, top];
    // the piece's span becomes one step at its new height
    const next = [];
    let placed = false;
    for (const [sx, sy, sw] of sky) {
      if (sx + sw <= x || sx >= x + w) {
        next.push([sx, sy, sw]);
        continue;
      }
      if (sx < x) next.push([sx, sy, x - sx]);
      if (!placed) {
        next.push([x, top + h, w]);
        placed = true;
      }
      if (sx + sw > x + w) next.push([x + w, sy, sx + sw - x - w]);
    }
    next.sort((a, b) => a[0] - b[0]);
    sky = [];
    for (const step of next) {
      const last = sky[sky.length - 1];
      if (last && last[1] === step[1] && last[0] + last[2] === step[0]) {
        last[2] += step[2];
      } else {
        sky.push(step);
      }
    }
  }
  const height = Math.max(0, ...spots.map(([, y], i) => y + sizes[i][1]));
  return { spots, height };
};

// the atlas width that packs smallest, tried from the widest piece up
export const chooseAtlas = (sizes) => {
  const widest = Math.max(...sizes.map(([w]) => w));
  let best = null;
  for (let step = 0; step < WIDTH_TRIES; step++) {
    const width = widest + step * WIDTH_STEP;
    const { spots, height } = skyline(sizes, width);
    if (best === null || width * height < best.width * best.height) {
      best = { width, height, spots };
    }
  }
  return best;
};

// a rectangle of an RGBA frame, transparent where it reaches past the frame's edge
const crop = (image, x, y, w, h) => {
  const out = Buffer.alloc(w * h * 4);
  const fromX = Math.max(x, 0);
  const toX = Math.min(x + w, image.width);
  if (toX <= fromX) return out;
  for (let row = 0; row < h; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= image.height) continue;
    image.data.copy(
      out,
      (row * w + fromX - x) * 4,
      (sy * image.width + fromX) * 4,
      (sy * image.width + toX) * 4,
    );
  }
  return out;
};

const alike = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > SHARE_TOLERANCE) return false;
  }
  return true;
};

const readImage = async (file, scale) => {
  let image = sharp(file).ensureAlpha();
  if (scale !== 1) {
    const { width, height } = await sharp(file).metadata();
    image = image.resize(Math.round(width * scale), Math.round(height * scale));
  }
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

const round = (value, places) => Number(value.toFixed(places));

const scalePoint = ([x, y], scale) => [
  round(x * scale, 2),
  round(y * scale, 2),
];

const scaleCorners = (corners, scale) => ({
  ...corners,
  screens: corners.screens.map((quad) => quad.map((p) => scalePoint(p, scale))),
  body: corners.body.map((p) => scalePoint(p, scale)),
  flap: corners.flap.map((p) => scalePoint(p, scale)),
});

// fold.js reads the table at each px the pointer has moved, so a half size table is the full one read every 2 px
const progressAt = (table, d) => {
  if (d <= 0) return 0;
  const k = Math.floor(d);
  if (k >= table.length - 1) return 1;
  return table[k] + (table[k + 1] - table[k]) * (d - k);
};

const scaleDrag = (drag, scale) => {
  const steps = Math.ceil((drag.table.length - 1) * scale);
  return {
    ...drag,
    span: round(drag.span * scale, 2),
    samples: drag.samples.map(([fold, x, y]) => [
      fold,
      round(x * scale, 2),
      round(y * scale, 2),
    ]),
    table: Array.from({ length: steps + 1 }, (_, k) =>
      round(progressAt(drag.table, k / scale), 6),
    ),
  };
};

// meta.json's fields carried over, with every px value in the packed set's own px
const scaleMeta = (meta, scale) => {
  if (scale === 1) return meta;
  const scaled = {
    ...meta,
    window: {
      width: round(meta.window.width * scale, 2),
      height: round(meta.window.height * scale, 2),
    },
    margin: {
      x: round(meta.margin.x * scale, 2),
      top: round(meta.margin.top * scale, 2),
      bottom: round(meta.margin.bottom * scale, 2),
    },
    dragTable: Object.fromEntries(
      Object.entries(meta.dragTable).map(([key, drag]) => [
        key,
        scaleDrag(drag, scale),
      ]),
    ),
  };
  if (meta.desk) {
    scaled.desk = { ...meta.desk, size: Math.round(meta.desk.size * scale) };
  }
  return scaled;
};

const listInputs = (raw, meta, frameCount) => {
  const frames = readdirSync(raw)
    .filter((name) => FRAME_FILE.test(name))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  if (frames.length !== frameCount) {
    throw new Error(
      `${raw} has ${frames.length} frame images but frames.json lists ${frameCount}, so capture the set again`,
    );
  }
  for (const [i, name] of frames.entries()) {
    if (parseInt(name, 10) !== i) {
      throw new Error(`${raw} is missing frame ${i}, so capture the set again`);
    }
  }
  const desks = readdirSync(raw)
    .filter((name) => DESK_FILE.test(name))
    .sort();
  for (const face of Object.keys(meta.desk?.faces ?? {})) {
    for (const look of ["sharp", "blur"]) {
      if (!desks.includes(`desk-${face}-${look}.png`)) {
        throw new Error(
          `${raw} has no desk-${face}-${look}.png, so capture the set again`,
        );
      }
    }
  }
  return { frames, desks };
};

const encodeAtlas = (pieces, size) => {
  const atlas = Buffer.alloc(size.width * size.height * 4);
  for (const piece of pieces) {
    const [w, h] = piece.size;
    const [ax, ay] = piece.spot;
    for (let row = 0; row < h; row++) {
      piece.pixels.copy(
        atlas,
        ((ay + row) * size.width + ax) * 4,
        row * w * 4,
        (row + 1) * w * 4,
      );
    }
  }
  return sharp(atlas, {
    raw: { width: size.width, height: size.height, channels: 4 },
  })
    .webp(ATLAS_WEBP)
    .toBuffer();
};

const encodeDesk = async (file, scale) => {
  let image = sharp(file);
  const { width, height } = await image.metadata();
  if (scale !== 1) {
    image = image.resize(Math.round(width * scale), Math.round(height * scale));
  }
  const { isOpaque } = await sharp(file).stats();
  if (isOpaque) image = image.removeAlpha();
  const bytes = await image.webp(DESK_WEBP).toBuffer();
  const info = await sharp(bytes).metadata();
  return { bytes, width: info.width, height: info.height };
};

export const packSet = async ({
  site,
  set,
  lighting,
  size,
  onWrite,
  onRemove,
}) => {
  if (!NAME.test(set) || !NAME.test(lighting)) {
    throw new Error(
      "the set and the lighting must use lowercase letters, digits, and hyphens",
    );
  }
  if (!Object.hasOwn(SIZES, size)) {
    throw new Error(
      `the size must be one of ${Object.keys(SIZES).join(", ")}, not ${size}`,
    );
  }
  const scale = SIZES[size];
  const raw = path.join(site, ".media/flat", `${set}-${lighting}`);
  if (!existsSync(path.join(raw, "meta.json"))) {
    throw new Error(
      `${raw} has no meta.json, so capture the set first (tools/capture-flat/capture.mjs)`,
    );
  }
  const meta = JSON.parse(readFileSync(path.join(raw, "meta.json"), "utf8"));
  const list = JSON.parse(readFileSync(path.join(raw, "frames.json"), "utf8"));
  const inputs = listInputs(raw, meta, list.length);
  const out = path.join(
    site,
    "apps/web/public/flat",
    `${set}-${lighting}-${size}`,
  );
  const allowlistPath = path.join(site, "privacy-allowlist.json");
  const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));

  const made = [];
  const stored = [];
  const frames = [];
  let previous = new Map();
  let atlasDecoded = 0;
  const digits = Math.max(3, String(list.length - 1).length);
  for (const [i, entry] of list.entries()) {
    const image = await readImage(path.join(raw, inputs.frames[i]), scale);
    const mask = {
      data: new Uint8Array(image.width * image.height),
      width: image.width,
      height: image.height,
    };
    for (let p = 0; p < mask.data.length; p++) {
      mask.data[p] = image.data[p * 4 + 3] > 0 ? 1 : 0;
    }
    const box = trim(mask, 0, 0, mask.width, mask.height);
    const rects = box === null ? [] : cover(mask, box);
    const shown = new Map();
    const fresh = [];
    for (const rect of rects) {
      const key = rect.join(",");
      const [w, h] = pieceSize(rect);
      const pixels = crop(image, rect[0] - PAD, rect[1] - PAD, w, h);
      const before = previous.get(key);
      // compared with the stored copy, not the previous frame, so small changes can't add up along a run
      if (before !== undefined && alike(before.pixels, pixels)) {
        before.frames.push(i);
        shown.set(key, before);
        continue;
      }
      const piece = { rect, size: [w, h], pixels, frames: [i] };
      fresh.push(piece);
      stored.push(piece);
      shown.set(key, piece);
    }
    for (const [key, piece] of previous) {
      if (shown.get(key) !== piece) piece.pixels = null;
    }
    previous = shown;
    let atlas = null;
    if (fresh.length > 0) {
      const packed = chooseAtlas(fresh.map((piece) => piece.size));
      atlas = `a${String(i).padStart(digits, "0")}.webp`;
      for (const [k, piece] of fresh.entries()) {
        piece.spot = packed.spots[k];
        piece.atlas = atlas;
      }
      const bytes = await encodeAtlas(fresh, packed);
      made.push({ name: atlas, bytes: stripAndVerify(bytes, atlas) });
      atlasDecoded += packed.width * packed.height * 4;
    }
    frames.push({ ...entry, atlas, shown: [...shown.values()] });
  }

  const sharedIndex = new Map();
  const shared = [];
  const placement = (piece) => {
    const [x0, y0, x1, y1] = piece.rect;
    return [x0, y0, x1 - x0, y1 - y0, piece.spot[0] + PAD, piece.spot[1] + PAD];
  };
  for (const piece of stored) {
    if (piece.frames.length < 2) continue;
    sharedIndex.set(piece, shared.length);
    shared.push({ atlas: piece.atlas, piece: placement(piece) });
  }
  const manifestFrames = frames.map(({ shown, corners, ...entry }) => ({
    ...entry,
    pieces: shown.filter((piece) => !sharedIndex.has(piece)).map(placement),
    shared: shown
      .filter((piece) => sharedIndex.has(piece))
      .map((piece) => sharedIndex.get(piece)),
    corners: scale === 1 ? corners : scaleCorners(corners, scale),
  }));

  let deskDecoded = 0;
  for (const name of inputs.desks) {
    const desk = await encodeDesk(path.join(raw, name), scale);
    const output = name.replace(/\.png$/, ".webp");
    made.push({ name: output, bytes: stripAndVerify(desk.bytes, output) });
    deskDecoded += desk.width * desk.height * 4;
  }

  const manifest = {
    ...scaleMeta(meta, scale),
    size,
    scale,
    pad: PAD,
    overlap: OVERLAP,
    frames: manifestFrames,
    shared,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);

  made.sort((a, b) => a.name.localeCompare(b.name));
  const keep = new Set([...made.map(({ name }) => name), "manifest.json"]);
  const stale = (name) => OUTPUT_NAME.test(name) && !keep.has(name);
  const prefix = `${path.relative(site, out)}/`;
  // nothing is written until every image is made, and the allowlist goes first, so a crash part way never leaves a
  // written image off it
  for (const key of Object.keys(allowlist)) {
    if (key.startsWith(prefix) && stale(key.slice(prefix.length))) {
      delete allowlist[key];
    }
  }
  for (const { bytes, name } of made) {
    allowlist[prefix + name] = sha256(bytes);
  }
  const sorted = Object.fromEntries(
    Object.entries(allowlist).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(`${allowlistPath}.tmp`, `${JSON.stringify(sorted, null, 2)}\n`);
  renameSync(`${allowlistPath}.tmp`, allowlistPath);
  mkdirSync(out, { recursive: true });
  for (const { bytes, name } of made) {
    onWrite?.(path.join(out, name));
    writeFileSync(path.join(out, name), bytes);
  }
  // the manifest goes last, so a page never reads one that names atlases not yet written
  writeFileSync(path.join(out, "manifest.json.tmp"), manifestBytes);
  renameSync(
    path.join(out, "manifest.json.tmp"),
    path.join(out, "manifest.json"),
  );
  // stale outputs leave the allowlist in the write above and are deleted last, so a crash between leaves an unlisted
  // file that the privacy check refuses
  const leftover = readdirSync(out, { withFileTypes: true })
    .filter((entry) => entry.isFile() && stale(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const name of leftover) {
    onRemove?.(path.join(out, name));
    rmSync(path.join(out, name));
  }

  const atlasBytes = made
    .filter(({ name }) => name.startsWith("a"))
    .reduce((sum, { bytes }) => sum + bytes.length, 0);
  const deskBytes = made
    .filter(({ name }) => name.startsWith("desk-"))
    .reduce((sum, { bytes }) => sum + bytes.length, 0);
  const pieceCount = frames.reduce((sum, frame) => sum + frame.shown.length, 0);
  return {
    out,
    frames: frames.length,
    pieces: pieceCount,
    stored: stored.length,
    shared: shared.length,
    atlases: made.filter(({ name }) => name.startsWith("a")).length,
    atlasDecoded,
    deskDecoded,
    atlasBytes,
    deskBytes,
    manifestBytes: manifestBytes.length,
  };
};

const usage =
  "usage: node tools/capture-flat/pack.mjs --set <SET> --lighting <LIGHTING> [--size full|half]";

const parseArgs = (args) => {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (
      !["--set", "--lighting", "--size"].includes(key) ||
      value === undefined
    ) {
      throw new Error(usage);
    }
    options[key.slice(2)] = value;
  }
  if (!options.set || !options.lighting) throw new Error(usage);
  return options;
};

const megabytes = (bytes) => (bytes / 1e6).toFixed(2);

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const site = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
  // libvips takes every core by default, and a long run at 100% CPU has crashed the dev PC
  sharp.concurrency(Math.max(1, Math.floor(availableParallelism() / 2)));
  try {
    const options = parseArgs(process.argv.slice(2));
    const sizes = options.size ? [options.size] : Object.keys(SIZES);
    for (const size of sizes) {
      const result = await packSet({
        site,
        set: options.set,
        lighting: options.lighting,
        size,
        onRemove: (removed) => {
          console.log(`removed ${path.relative(site, removed)}`);
        },
      });
      const decoded = result.atlasDecoded + result.deskDecoded;
      const download =
        result.atlasBytes + result.deskBytes + result.manifestBytes;
      console.log(
        [
          `${path.relative(site, result.out)}: ${result.frames} frames, ${result.pieces} pieces shown (${(result.pieces / result.frames).toFixed(1)} a frame), ${result.stored} stored, ${result.shared} shared, ${result.atlases} atlases`,
          `  decoded ${megabytes(decoded)} MB (atlases ${megabytes(result.atlasDecoded)}, desk ${megabytes(result.deskDecoded)})`,
          `  download ${megabytes(download)} MB (atlases ${megabytes(result.atlasBytes)}, desk ${megabytes(result.deskBytes)}, manifest ${megabytes(result.manifestBytes)})`,
        ].join("\n"),
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
