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
import {
  OVERLAP,
  chooseAtlas,
  cover,
  halfMask,
  packSet,
  trim,
} from "./pack.mjs";

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
  desk: null,
  inputsHash: "0".repeat(64),
};

const deskMeta = {
  set: "desk",
  lighting: "day",
  window: { width: 160, height: 100 },
  light: meta.light,
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

// a throwaway site under .media (which git ignores) instead of the RAM disk at /tmp, with a set captured as test-day
// and the desk's faces captured as desk-day
const makeSite = async (t, frames, extra = {}) => {
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
  writeFileSync(
    path.join(raw, "meta.json"),
    JSON.stringify({ ...meta, ...extra }),
  );
  const deskRaw = path.join(site, ".media/flat/desk-day");
  mkdirSync(deskRaw, { recursive: true });
  writeFileSync(path.join(deskRaw, "meta.json"), JSON.stringify(deskMeta));
  const desk = Buffer.alloc(32 * 32 * 4, 180);
  for (const look of ["sharp", "blur"]) {
    writeFileSync(
      path.join(deskRaw, `desk-front-${look}.png`),
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
  for (const frame of manifest.frames) {
    for (const [x, y, w, h] of frame.pieces) {
      assert.ok(x + w <= FRAME_W / 2 && y + h <= FRAME_H / 2);
    }
  }
});

// the bounding box of every piece a frame shows, as [x0, y0, x1, y1]
const piecesBox = (manifest, frame) => {
  const shown = [
    ...frame.pieces,
    ...frame.shared.map((k) => manifest.shared[k].piece),
  ];
  return [
    Math.min(...shown.map(([x]) => x)),
    Math.min(...shown.map(([, y]) => y)),
    Math.max(...shown.map(([x, , w]) => x + w)),
    Math.max(...shown.map(([, y, , h]) => y + h)),
  ];
};

test("halfMask marks each half pixel whose 2 by 2 block has any drawn pixel", () => {
  // a 5 by 3 alpha plane with drawn pixels at (1, 0), (4, 2), and nothing else
  const alpha = new Uint8Array(15);
  alpha[1] = 255;
  alpha[2 * 5 + 4] = 3;
  const half = halfMask(alpha, 5, 3);
  assert.equal(half.width, 3);
  assert.equal(half.height, 2);
  assert.deepEqual([...half.data], [1, 0, 0, 0, 0, 1]);
});

test("half size pieces stop at the 2 by 2 blocks of the full size drawing", async (t) => {
  // blocks on odd px, so a resize's soft edge would reach a half pixel past the blocks they touch
  const pixels = blank();
  drawBlock(pixels, 31, 41, 89, 149, 20);
  const site = await makeSite(t, [pixels]);
  await packSet({ site, set: "test", lighting: "day", size: "half" });
  const out = path.join(site, "apps/web/public/flat/test-day-half");
  const manifest = JSON.parse(
    readFileSync(path.join(out, "manifest.json"), "utf8"),
  );
  assert.deepEqual(piecesBox(manifest, manifest.frames[0]), [15, 20, 45, 75]);
  // and nothing drawn in the atlas past those blocks, where the resize left a faint ring
  const [x, y, w, h, sx, sy] = manifest.frames[0].pieces[0];
  const image = await decode(path.join(out, manifest.frames[0].atlas));
  for (let dy = -OVERLAP; dy < h + OVERLAP; dy++) {
    for (let dx = -OVERLAP; dx < w + OVERLAP; dx++) {
      const inside = dx >= 0 && dx < w && dy >= 0 && dy < h;
      const a = image.data[((sy + dy) * image.width + sx + dx) * 4 + 3];
      if (!inside) {
        assert.equal(a, 0, `alpha past the blocks at ${x + dx},${y + dy}`);
      }
    }
  }
});

test("a run removes a manifest.json.tmp left by an earlier run", async (t) => {
  const site = await makeSite(t, [twoBlocks(0)]);
  const out = path.join(site, "apps/web/public/flat/test-day-full");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "manifest.json.tmp"), "{");
  // the capture is gone, so the run stops early, after the stale file is cleared
  rmSync(path.join(site, ".media/flat/test-day/meta.json"));
  await assert.rejects(
    packSet({ site, set: "test", lighting: "day", size: "full" }),
    /capture the set first/,
  );
  assert.ok(!existsSync(path.join(out, "manifest.json.tmp")));
});

test("the desk's faces are packed once per lighting, and a set points at them", async (t) => {
  const site = await makeSite(t, [twoBlocks(0), twoBlocks(8)]);
  for (const size of ["full", "half"]) {
    await packSet({ site, set: "desk", lighting: "day", size });
    await packSet({ site, set: "test", lighting: "day", size });
    const deskOut = path.join(site, `apps/web/public/flat/desk-day-${size}`);
    assert.deepEqual(readdirSync(deskOut).sort(), [
      "desk-front-blur.webp",
      "desk-front-sharp.webp",
      "manifest.json",
    ]);
    const desk = JSON.parse(
      readFileSync(path.join(deskOut, "manifest.json"), "utf8"),
    );
    assert.equal(desk.desk.size, size === "full" ? 32 : 16);
    assert.deepEqual(Object.keys(desk.desk.faces), ["front"]);
    const face = await sharp(
      path.join(deskOut, "desk-front-blur.webp"),
    ).metadata();
    assert.equal(face.width, desk.desk.size);
    const setOut = path.join(site, `apps/web/public/flat/test-day-${size}`);
    assert.ok(!readdirSync(setOut).some((name) => name.startsWith("desk-")));
    const manifest = JSON.parse(
      readFileSync(path.join(setOut, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.desk, `desk-day-${size}`);
  }
  const allowlist = JSON.parse(
    readFileSync(path.join(site, "privacy-allowlist.json"), "utf8"),
  );
  assert.ok(
    allowlist["apps/web/public/flat/desk-day-half/desk-front-sharp.webp"],
  );
});

test("a repack drops the desk faces an older pack put in the set's folder", async (t) => {
  const site = await makeSite(t, [twoBlocks(0)]);
  const prefix = "apps/web/public/flat/test-day-full/";
  const out = path.join(site, prefix);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "desk-front-sharp.webp"), "old");
  writeFileSync(
    path.join(site, "privacy-allowlist.json"),
    `${JSON.stringify({ [`${prefix}desk-front-sharp.webp`]: "0".repeat(64) })}\n`,
  );
  await packSet({ site, set: "test", lighting: "day", size: "full" });
  assert.ok(!existsSync(path.join(out, "desk-front-sharp.webp")));
  const allowlist = JSON.parse(
    readFileSync(path.join(site, "privacy-allowlist.json"), "utf8"),
  );
  assert.equal(allowlist[`${prefix}desk-front-sharp.webp`], undefined);
});

test("sizes.json has each packed folder's decoded and download bytes", async (t) => {
  const site = await makeSite(t, [twoBlocks(0), twoBlocks(8)]);
  const result = await packSet({
    site,
    set: "test",
    lighting: "day",
    size: "full",
  });
  await packSet({ site, set: "desk", lighting: "day", size: "half" });
  const flat = path.join(site, "apps/web/public/flat");
  const sizes = JSON.parse(readFileSync(path.join(flat, "sizes.json"), "utf8"));
  assert.deepEqual(Object.keys(sizes).sort(), [
    "desk-day-half",
    "test-day-full",
  ]);
  const files = readdirSync(path.join(flat, "test-day-full"));
  const download = files.reduce(
    (sum, name) =>
      sum + readFileSync(path.join(flat, "test-day-full", name)).length,
    0,
  );
  assert.equal(sizes["test-day-full"].downloadBytes, download);
  assert.equal(sizes["test-day-full"].decodedBytes, result.decodedBytes);
  // each atlas decodes to 4 bytes a px
  let decoded = 0;
  for (const name of files.filter((n) => n.endsWith(".webp"))) {
    const { width, height } = await sharp(
      path.join(flat, "test-day-full", name),
    ).metadata();
    decoded += width * height * 4;
  }
  assert.equal(sizes["test-day-full"].decodedBytes, decoded);
  assert.equal(sizes["desk-day-half"].decodedBytes, 2 * 16 * 16 * 4);
});

test("half size scales the volume buttons' boxes and hit areas", async (t) => {
  const volume = {
    up: "far",
    poses: {
      open: {
        near: {
          box: [101, 51, 9, 5],
          hit: [
            [10, 20],
            [30, 20],
            [30, 24],
            [10, 24],
          ],
          hull: [
            [10, 20],
            [30, 20],
            [30, 24],
            [12, 28],
          ],
        },
        far: null,
      },
    },
  };
  const site = await makeSite(t, [twoBlocks(0)], { volume });
  await packSet({ site, set: "test", lighting: "day", size: "half" });
  const manifest = JSON.parse(
    readFileSync(
      path.join(site, "apps/web/public/flat/test-day-half/manifest.json"),
      "utf8",
    ),
  );
  // the box grows outward to whole half px, so it still covers the whole press
  assert.deepEqual(manifest.volume.poses.open.near.box, [50, 25, 5, 3]);
  assert.deepEqual(manifest.volume.poses.open.near.hit[2], [15, 12]);
  assert.deepEqual(manifest.volume.poses.open.near.hull[3], [6, 14]);
  assert.equal(manifest.volume.poses.open.far, null);
  assert.equal(manifest.volume.up, "far");
});
