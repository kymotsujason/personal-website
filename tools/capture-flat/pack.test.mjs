import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { sha256 } from "../privacy/allowlist.mjs";
import { OVERLAP, chooseAtlas, cover, packSet, trim } from "./pack.mjs";

const siteDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// a frame is 320 by 200: a 160 by 100 window with 80 px at each side, 40 above, and 60 below
const FRAME_W = 320;
const FRAME_H = 200;

const blank = () => Buffer.alloc(FRAME_W * FRAME_H * 4);

// a gray gradient block, since flat color would hide a misplaced read, and lossy webp holds a gentle gray gradient
// within 4 levels where a hard colored edge against transparent black moves by up to 60
const drawBlock = (pixels, x0, y0, x1, y1, base) => {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * FRAME_W + x) * 4;
      const value = (base + (x - x0) + Math.floor((y - y0) / 2)) % 256;
      pixels[i] = value;
      pixels[i + 1] = value;
      pixels[i + 2] = value;
      pixels[i + 3] = 255;
    }
  }
};

const maskOf = (pixels) => {
  const data = new Uint8Array(FRAME_W * FRAME_H);
  for (let i = 0; i < data.length; i++) {
    data[i] = pixels[i * 4 + 3] > 0 ? 1 : 0;
  }
  return { data, width: FRAME_W, height: FRAME_H };
};

// two blocks with a wide gap, the right one moved by shift
const twoBlocks = (shift) => {
  const pixels = blank();
  drawBlock(pixels, 30, 40, 90, 150, 20);
  drawBlock(pixels, 200 + shift, 50, 250 + shift, 140, 120);
  return pixels;
};

const corners = {
  screens: [
    [
      [10, 10],
      [150, 10],
      [150, 90],
      [10, 90],
    ],
  ],
  depths: [-23.5],
  body: [
    [8, 8],
    [152, 8],
    [152, 92],
    [8, 92],
  ],
  flap: [
    [6, 6],
    [154, 6],
    [154, 94],
    [6, 94],
  ],
};

const meta = {
  set: "test",
  lighting: "day",
  orientation: "landscape",
  window: { width: 160, height: 100 },
  margin: { x: 80, top: 40, bottom: 60 },
  light: { hour: 13, sunrise: 7, sunset: 19, day: 1, warm: 0 },
  screens: ["cover"],
  foldStartTime: 700,
  dragTable: {
    close: {
      axis: "x",
      sign: 1,
      span: 6,
      samples: [
        [0, 40, 50],
        [1, 46, 52],
      ],
      table: [0, 0.2, 0.4, 0.6, 0.8, 0.9, 1],
    },
    open: {
      axis: "x",
      sign: -1,
      span: 4,
      samples: [
        [0, 120, 50],
        [1, 116, 50],
      ],
      table: [0, 0.5, 0.75, 1],
    },
  },
  desk: {
    size: 32,
    fov: 90,
    blur: 1,
    faces: { front: { dir: [0, 0, -1], up: [0, 1, 0] } },
  },
  inputsHash: "0".repeat(64),
};

const png = (pixels, width = FRAME_W, height = FRAME_H) =>
  sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();

// a throwaway site under .media (which git ignores) instead of the RAM disk at /tmp
const makeSite = async (t, frames) => {
  mkdirSync(path.join(siteDir, ".media"), { recursive: true });
  const site = mkdtempSync(path.join(siteDir, ".media", "pack-test-"));
  t.after(() => rmSync(site, { recursive: true, force: true }));
  const raw = path.join(site, ".media/flat/test-day");
  mkdirSync(raw, { recursive: true });
  for (const [i, pixels] of frames.entries()) {
    writeFileSync(
      path.join(raw, `${String(i).padStart(3, "0")}.png`),
      await png(pixels),
    );
  }
  const list = frames.map((_, i) => ({
    fold: 1 - i / Math.max(1, frames.length - 1),
    lead: 0,
    hand: 1,
    t: null,
    corners,
  }));
  writeFileSync(path.join(raw, "frames.json"), JSON.stringify(list));
  writeFileSync(path.join(raw, "meta.json"), JSON.stringify(meta));
  const desk = Buffer.alloc(32 * 32 * 4, 180);
  for (const look of ["sharp", "blur"]) {
    writeFileSync(
      path.join(raw, `desk-front-${look}.png`),
      await png(desk, 32, 32),
    );
  }
  writeFileSync(path.join(site, "privacy-allowlist.json"), "{}\n");
  return site;
};

const decode = async (file) => {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width };
};

test("cover leaves no drawn pixel uncovered", () => {
  const pixels = blank();
  drawBlock(pixels, 10, 10, 60, 30, 0);
  drawBlock(pixels, 20, 120, 300, 130, 40);
  drawBlock(pixels, 250, 20, 270, 110, 80);
  drawBlock(pixels, 140, 70, 141, 71, 90);
  const mask = maskOf(pixels);
  const box = trim(mask, 0, 0, FRAME_W, FRAME_H);
  const rects = cover(mask, box);
  assert.ok(rects.length > 1, "the frame was split");
  const area = rects.reduce(
    (sum, [x0, y0, x1, y1]) => sum + (x1 - x0) * (y1 - y0),
    0,
  );
  assert.ok(
    area < ((box[2] - box[0]) * (box[3] - box[1])) / 2,
    "the pieces skip the empty areas",
  );
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      if (!mask.data[y * FRAME_W + x]) continue;
      const inside = rects.some(
        ([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1,
      );
      assert.ok(inside, `drawn pixel ${x},${y} is in a piece`);
    }
  }
});

test("packed pieces don't overlap", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const sizes = Array.from({ length: 40 }, () => [
    4 * Math.ceil(random() * 80),
    4 * Math.ceil(random() * 60),
  ]);
  const { width, height, spots } = chooseAtlas(sizes);
  assert.equal(spots.length, sizes.length);
  for (const [i, [x, y]] of spots.entries()) {
    const [w, h] = sizes[i];
    assert.ok(x >= 0 && y >= 0 && x + w <= width && y + h <= height);
    assert.equal(x % 4, 0);
    assert.equal(y % 4, 0);
    for (let j = 0; j < i; j++) {
      const [ox, oy] = spots[j];
      const [ow, oh] = sizes[j];
      const apart = x + w <= ox || ox + ow <= x || y + h <= oy || oy + oh <= y;
      assert.ok(apart, `pieces ${i} and ${j} overlap`);
    }
  }
});

test("a shown piece reads the same pixels as the frame", async (t) => {
  const frames = [twoBlocks(0), twoBlocks(8)];
  const site = await makeSite(t, frames);
  await packSet({ site, set: "test", lighting: "day", size: "full" });
  const out = path.join(site, "apps/web/public/flat/test-day-full");
  const manifest = JSON.parse(
    readFileSync(path.join(out, "manifest.json"), "utf8"),
  );
  let checked = 0;
  for (const [i, frame] of manifest.frames.entries()) {
    const shown = [
      ...frame.pieces.map((piece) => ({ atlas: frame.atlas, piece })),
      ...frame.shared.map((k) => manifest.shared[k]),
    ];
    for (const { atlas, piece } of shown) {
      const [x, y, w, h, sx, sy] = piece;
      const image = await decode(path.join(out, atlas));
      for (let dy = -OVERLAP; dy < h + OVERLAP; dy++) {
        for (let dx = -OVERLAP; dx < w + OVERLAP; dx++) {
          const s = ((y + dy) * FRAME_W + x + dx) * 4;
          const a = ((sy + dy) * image.width + sx + dx) * 4;
          const alpha = frames[i][s + 3];
          assert.ok(
            Math.abs(image.data[a + 3] - alpha) <= 12,
            `alpha at ${x + dx},${y + dy}`,
          );
          if (alpha === 0) continue;
          for (let c = 0; c < 3; c++) {
            assert.ok(
              Math.abs(image.data[a + c] - frames[i][s + c]) <= 12,
              `channel ${c} at ${x + dx},${y + dy} in frame ${i}`,
            );
          }
          checked++;
        }
      }
    }
  }
  assert.equal(
    checked,
    2 * (60 * 110 + 50 * 90),
    "every drawn pixel was compared",
  );
});

test("an unchanged piece is shared", async (t) => {
  const site = await makeSite(t, [twoBlocks(0), twoBlocks(8), twoBlocks(16)]);
  await packSet({ site, set: "test", lighting: "day", size: "full" });
  const out = path.join(site, "apps/web/public/flat/test-day-full");
  const manifest = JSON.parse(
    readFileSync(path.join(out, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.shared.length, 1);
  const [x, y, w, h] = manifest.shared[0].piece;
  assert.deepEqual([x, y, w, h], [30, 40, 60, 110]);
  assert.equal(manifest.shared[0].atlas, "a000.webp");
  for (const frame of manifest.frames) {
    assert.deepEqual(frame.shared, [0]);
    assert.equal(frame.pieces.length, 1);
  }
});

test("a changed piece isn't shared", async (t) => {
  const moved = twoBlocks(8);
  drawBlock(moved, 30, 40, 90, 150, 60);
  const site = await makeSite(t, [twoBlocks(0), moved]);
  await packSet({ site, set: "test", lighting: "day", size: "full" });
  const out = path.join(site, "apps/web/public/flat/test-day-full");
  const manifest = JSON.parse(
    readFileSync(path.join(out, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.shared.length, 0);
});

test("the allowlist lists every written file", async (t) => {
  const site = await makeSite(t, [twoBlocks(0), twoBlocks(8), twoBlocks(16)]);
  await packSet({ site, set: "test", lighting: "day", size: "full" });
  const prefix = "apps/web/public/flat/test-day-full/";
  const out = path.join(site, prefix);
  const check = () => {
    const allowlist = JSON.parse(
      readFileSync(path.join(site, "privacy-allowlist.json"), "utf8"),
    );
    const images = readdirSync(out).filter((name) => name.endsWith(".webp"));
    assert.ok(images.includes("desk-front-sharp.webp"));
    for (const name of images) {
      assert.equal(
        allowlist[prefix + name],
        sha256(readFileSync(path.join(out, name))),
        `${name} is on the allowlist`,
      );
    }
    const listed = Object.keys(allowlist).filter((key) =>
      key.startsWith(prefix),
    );
    assert.deepEqual(listed.sort(), images.map((name) => prefix + name).sort());
    return images;
  };
  assert.ok(check().includes("a002.webp"));
  // a repack with fewer frames takes the old atlas off the allowlist and deletes it
  const raw = path.join(site, ".media/flat/test-day");
  rmSync(path.join(raw, "002.png"));
  const list = JSON.parse(readFileSync(path.join(raw, "frames.json"), "utf8"));
  writeFileSync(
    path.join(raw, "frames.json"),
    JSON.stringify(list.slice(0, 2)),
  );
  await packSet({ site, set: "test", lighting: "day", size: "full" });
  assert.ok(!check().includes("a002.webp"));
  assert.ok(!existsSync(path.join(out, "a002.webp")));
});

test("half size halves the frame and its coordinates", async (t) => {
  const site = await makeSite(t, [twoBlocks(0), twoBlocks(8)]);
  await packSet({ site, set: "test", lighting: "day", size: "half" });
  const out = path.join(site, "apps/web/public/flat/test-day-half");
  const manifest = JSON.parse(
    readFileSync(path.join(out, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.size, "half");
  assert.equal(manifest.scale, 0.5);
  assert.deepEqual(manifest.window, { width: 80, height: 50 });
  assert.deepEqual(manifest.margin, { x: 40, top: 20, bottom: 30 });
  assert.deepEqual(manifest.frames[0].corners.body[1], [76, 4]);
  assert.deepEqual(manifest.frames[0].corners.depths, [-23.5]);
  assert.equal(manifest.dragTable.close.span, 3);
  assert.deepEqual(manifest.dragTable.close.samples[1], [1, 23, 26]);
  // the table is read at each half px, which is every second full px
  assert.deepEqual(manifest.dragTable.close.table, [0, 0.4, 0.8, 1]);
  assert.deepEqual(manifest.dragTable.open.table, [0, 0.75, 1]);
  assert.equal(manifest.foldStartTime, 700);
  assert.equal(manifest.inputsHash, meta.inputsHash);
  const desk = await sharp(path.join(out, "desk-front-blur.webp")).metadata();
  assert.equal(desk.width, 16);
  for (const frame of manifest.frames) {
    for (const [x, y, w, h] of frame.pieces) {
      assert.ok(x + w <= FRAME_W / 2 && y + h <= FRAME_H / 2);
    }
  }
});
