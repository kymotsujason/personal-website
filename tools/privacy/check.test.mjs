import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync, deflateSync, gzipSync } from "node:zlib";
import {
  scanMetadata,
  stripAndVerify,
  stripMetadata,
  walkReadings,
} from "./metadata.mjs";
import { checkFiles } from "./check.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const ascii = (text) => Buffer.from(text, "latin1");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// the scheme is joined at run time, so the pre-commit hook doesn't refuse this file for the inline images its tests build
const scheme = ["data", ""].join(":");

function jpegSegment(marker, payload) {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

const jpegApp0 = jpegSegment(
  0xe0,
  Buffer.concat([ascii("JFIF\0"), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]),
);
const jpegDqt = jpegSegment(
  0xdb,
  Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)]),
);
const jpegSof0 = jpegSegment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
const jpegSos = jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0]));
const jpegScan = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);

function jpeg(...extra) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegApp0,
    ...extra,
    jpegDqt,
    jpegSof0,
    jpegSos,
    jpegScan,
    Buffer.from([0xff, 0xd9]),
  ]);
}

function sosToEoi(bytes) {
  const buffer = Buffer.from(bytes);
  return buffer.subarray(buffer.indexOf(Buffer.from([0xff, 0xda])));
}

const exifApp1 = jpegSegment(
  0xe1,
  Buffer.concat([ascii("Exif\0\0"), ascii("MM\0*\0\0\0\x08\0\0")]),
);
const xmpApp1 = jpegSegment(
  0xe1,
  Buffer.concat([
    ascii("http://ns.adobe.com/xap/1.0/\0"),
    ascii("<x:xmpmeta>GPS</x:xmpmeta>"),
  ]),
);
const iptcApp13 = jpegSegment(
  0xed,
  Buffer.concat([ascii("Photoshop 3.0\0"), ascii("8BIM\x04\x04\0\0\0\0\0\0")]),
);

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([ascii(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const pngIhdr = pngChunk(
  "IHDR",
  Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]),
);
const pngIdat = pngChunk("IDAT", deflateSync(Buffer.from([0, 0x80])));
const pngIend = pngChunk("IEND", Buffer.alloc(0));

function png(...extra) {
  return Buffer.concat([pngSignature, pngIhdr, ...extra, pngIdat, pngIend]);
}

function idatOf(bytes) {
  const buffer = Buffer.from(bytes);
  const start = buffer.indexOf(ascii("IDAT")) - 4;
  return buffer.subarray(start, start + pngIdat.length);
}

function riffChunk(fourcc, data) {
  const header = Buffer.concat([ascii(fourcc), Buffer.alloc(4)]);
  header.writeUInt32LE(data.length, 4);
  const pad = data.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([header, data, pad]);
}

const webpImage = riffChunk("VP8L", Buffer.from([0x2f, 0, 0, 0, 0x10, 0x07]));

function webp(flags, ...extra) {
  const vp8x = riffChunk(
    "VP8X",
    Buffer.from([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  );
  const body = Buffer.concat([ascii("WEBP"), vp8x, webpImage, ...extra]);
  const header = Buffer.concat([ascii("RIFF"), Buffer.alloc(4)]);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function glb(json) {
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += " ";
  const jsonChunk = Buffer.concat([Buffer.alloc(8), ascii(text)]);
  jsonChunk.writeUInt32LE(text.length, 0);
  jsonChunk.writeUInt32LE(0x4e4f534a, 4);
  const header = Buffer.concat([ascii("glTF"), Buffer.alloc(8)]);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + jsonChunk.length, 8);
  return Buffer.concat([header, jsonChunk]);
}

function isoBox(type, payload) {
  const header = Buffer.concat([Buffer.alloc(4), ascii(type)]);
  header.writeUInt32BE(8 + payload.length, 0);
  return Buffer.concat([header, payload]);
}

function avifWithExifItem() {
  const ftyp = isoBox("ftyp", ascii("avif\0\0\0\0avifmif1"));
  const infe = (id, type) =>
    isoBox(
      "infe",
      Buffer.concat([
        Buffer.from([2, 0, 0, 0, 0, id, 0, 0]),
        ascii(type),
        ascii("\0"),
      ]),
    );
  const iinf = isoBox(
    "iinf",
    Buffer.concat([
      Buffer.from([0, 0, 0, 0, 0, 2]),
      infe(1, "av01"),
      infe(2, "Exif"),
    ]),
  );
  const meta = isoBox("meta", Buffer.concat([Buffer.alloc(4), iinf]));
  return Buffer.concat([ftyp, meta]);
}

function gifWithXmp() {
  const header = Buffer.concat([
    ascii("GIF89a"),
    Buffer.from([1, 0, 1, 0, 0, 0, 0]),
  ]);
  const xmp = Buffer.concat([
    Buffer.from([0x21, 0xff, 11]),
    ascii("XMP DataXMP"),
    Buffer.from([4]),
    ascii("<x/>"),
    Buffer.from([0]),
  ]);
  const image = Buffer.from([
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0,
  ]);
  return Buffer.concat([header, xmp, image, Buffer.from([0x3b])]);
}

test("scanMetadata finds JPEG metadata segments", () => {
  assert.deepEqual(scanMetadata(jpeg(exifApp1), "a.jpg"), ["exif"]);
  assert.deepEqual(scanMetadata(jpeg(xmpApp1), "a.jpg"), ["xmp"]);
  assert.deepEqual(scanMetadata(jpeg(iptcApp13), "a.jpeg"), ["iptc"]);
  assert.deepEqual(scanMetadata(jpeg(), "a.JPG"), []);
});

test("scanMetadata finds a JFIF thumbnail", () => {
  const app0 = jpegSegment(
    0xe0,
    Buffer.concat([
      ascii("JFIF\0"),
      Buffer.from([1, 1, 0, 0, 1, 0, 1, 1, 1]),
      Buffer.from([1, 2, 3]),
    ]),
  );
  const bytes = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    jpegDqt,
    jpegSof0,
    jpegSos,
    jpegScan,
    Buffer.from([0xff, 0xd9]),
  ]);
  assert.deepEqual(scanMetadata(bytes, "a.jpg"), ["jfif:thumbnail"]);
  assert.deepEqual(scanMetadata(stripMetadata(bytes, "a.jpg"), "a.jpg"), []);
});

test("scanMetadata finds PNG metadata chunks", () => {
  assert.deepEqual(
    scanMetadata(png(pngChunk("eXIf", ascii("MM\0*"))), "a.png"),
    ["exif"],
  );
  const xmp = pngChunk(
    "iTXt",
    Buffer.concat([
      ascii("XML:com.adobe.xmp\0\0\0\0\0"),
      ascii("<x:xmpmeta/>"),
    ]),
  );
  assert.deepEqual(scanMetadata(png(xmp), "a.png"), ["xmp"]);
  const date = pngChunk(
    "tEXt",
    ascii("date:create\x002026-10-14T10:00:00+00:00"),
  );
  assert.deepEqual(scanMetadata(png(date), "a.png"), ["png:text"]);
  assert.deepEqual(scanMetadata(png(), "a.png"), []);
});

test("scanMetadata finds a WebP EXIF chunk", () => {
  assert.deepEqual(
    scanMetadata(webp(0x08, riffChunk("EXIF", ascii("MM\0*\0"))), "a.webp"),
    ["exif"],
  );
  assert.deepEqual(scanMetadata(webp(0), "a.webp"), []);
});

test("scanMetadata finds an image in a GLB", () => {
  const asset = { asset: { version: "2.0" } };
  assert.deepEqual(
    scanMetadata(glb({ ...asset, images: [{ uri: "x.png" }] }), "m.glb"),
    ["glb:image"],
  );
  assert.deepEqual(scanMetadata(glb(asset), "m.glb"), []);
});

test("scanMetadata finds AVIF EXIF items and GIF XMP", () => {
  assert.deepEqual(scanMetadata(avifWithExifItem(), "a.avif"), ["exif"]);
  assert.deepEqual(scanMetadata(gifWithXmp(), "a.gif"), ["xmp"]);
});

test("scanMetadata throws on a truncated or mislabeled file", () => {
  const whole = png();
  assert.throws(
    () => scanMetadata(whole.subarray(0, whole.length - 6), "a.png"),
    /truncated/,
  );
  assert.throws(
    () => scanMetadata(jpeg().subarray(0, 30), "a.jpg"),
    /truncated/,
  );
  assert.throws(() => scanMetadata(png(), "a.jpg"));
  assert.throws(() => scanMetadata(ascii("hello"), "a.txt"));
});

test("stripMetadata cleans JPEG and keeps the scan bytes", () => {
  for (const dirty of [
    jpeg(exifApp1),
    jpeg(xmpApp1),
    jpeg(iptcApp13),
    jpeg(exifApp1, xmpApp1),
  ]) {
    const clean = stripMetadata(dirty, "a.jpg");
    assert.ok(clean instanceof Uint8Array);
    assert.deepEqual(scanMetadata(clean, "a.jpg"), []);
    assert.deepEqual(sosToEoi(clean), sosToEoi(dirty));
    assert.ok(Buffer.from(clean).includes(jpegApp0));
    assert.ok(Buffer.from(clean).includes(jpegDqt));
  }
});

test("stripMetadata cleans PNG and keeps IDAT", () => {
  const dirty = [
    png(pngChunk("eXIf", ascii("MM\0*"))),
    png(pngChunk("iTXt", ascii("XML:com.adobe.xmp\0\0\0\0\0<x/>"))),
    png(
      pngChunk("tEXt", ascii("date:create\x002026")),
      pngChunk("tIME", Buffer.alloc(7)),
    ),
    png(
      pngChunk(
        "zTXt",
        Buffer.concat([ascii("Comment\0\0"), deflateSync(ascii("hi"))]),
      ),
    ),
  ];
  for (const bytes of dirty) {
    const clean = stripMetadata(bytes, "a.png");
    assert.deepEqual(scanMetadata(clean, "a.png"), []);
    assert.deepEqual(idatOf(clean), idatOf(bytes));
    assert.ok(!Buffer.from(clean).includes(ascii("tIME")));
  }
  assert.deepEqual(Buffer.from(stripMetadata(png(), "a.png")), png());
});

test("stripMetadata cleans WebP and clears the VP8X flags", () => {
  const dirty = webp(
    0x0c,
    riffChunk("EXIF", ascii("MM\0*\0")),
    riffChunk("XMP ", ascii("<x/>")),
  );
  const before = Buffer.from(dirty);
  const clean = stripMetadata(dirty, "a.webp");
  assert.deepEqual(dirty, before);
  assert.deepEqual(Buffer.from(clean), webp(0));
  assert.ok(Buffer.from(clean).includes(webpImage));
});

test("stripAndVerify gives back the stripped bytes, which scan clean", () => {
  const dirty = jpeg(exifApp1, xmpApp1);
  const clean = stripAndVerify(dirty, "a.jpg");
  assert.deepEqual(
    Buffer.from(clean),
    Buffer.from(stripMetadata(dirty, "a.jpg")),
  );
  assert.deepEqual(scanMetadata(clean, "a.jpg"), []);
});

test("stripAndVerify stops on an image the strip doesn't handle", () => {
  assert.throws(
    () =>
      stripAndVerify(Buffer.concat([ascii("BM"), Buffer.alloc(60)]), "a.bmp"),
    /a\.bmp/,
  );
});

const cleanPng = png();
const cleanJpeg = jpeg();

test("checkFiles refuses denied paths even when allowlisted", () => {
  const denied = [
    { path: "apps/web/public/desk-unblurred.jpg", bytes: cleanJpeg },
    { path: "desk-unblurred-2.png", bytes: cleanPng },
    { path: "photos/x.HEIC", bytes: ascii("heic") },
    { path: "x.heic", bytes: ascii("heic") },
    { path: "a.blend1", bytes: ascii("blend") },
    { path: "scene.blend", bytes: ascii("blend") },
    { path: "art/x.png", bytes: cleanPng },
    { path: "spikes/device-3d/art/desk-stitch/notes.txt", bytes: ascii("x") },
    { path: "apps/web/public/models/hands.glb", bytes: glb({ asset: {} }) },
    { path: "apps/web/public/models/phone.glb", bytes: glb({ asset: {} }) },
  ];
  for (const file of denied) {
    const allowlist = { [file.path]: sha256(file.bytes) };
    const result = checkFiles([file], allowlist);
    assert.equal(result.ok, false, file.path);
    assert.match(result.problems.join("\n"), /deny list/, file.path);
  }
});

test("checkFiles refuses an image missing from the allowlist", () => {
  const result = checkFiles(
    [{ path: "apps/web/public/a.png", bytes: cleanPng }],
    {},
  );
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /not on the allowlist/);
  assert.ok(result.problems[0].includes(sha256(cleanPng)));
});

test("checkFiles refuses a hash mismatch", () => {
  const result = checkFiles(
    [{ path: "apps/web/public/a.png", bytes: cleanPng }],
    {
      "apps/web/public/a.png": sha256(png(pngChunk("tIME", Buffer.alloc(7)))),
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /doesn't match/);
});

test("checkFiles refuses an allowlisted image with metadata", () => {
  const bytes = jpeg(exifApp1);
  const result = checkFiles([{ path: "a.jpg", bytes }], {
    "a.jpg": sha256(bytes),
  });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /exif/);
});

test("checkFiles passes clean allowlisted images and ordinary files", () => {
  const files = [
    { path: "apps/web/public/a.png", bytes: cleanPng },
    { path: "apps/web/public/b.jpg", bytes: cleanJpeg },
    { path: "README.md", bytes: ascii("# hi") },
    { path: "apps/web/src/components/chart/index.js", bytes: ascii("x") },
    {
      path: "apps/web/public/models/phone.packed.glb",
      bytes: glb({ asset: {} }),
    },
  ];
  const allowlist = {
    "apps/web/public/a.png": sha256(cleanPng),
    "apps/web/public/b.jpg": sha256(cleanJpeg),
    "apps/web/public/models/phone.packed.glb": sha256(glb({ asset: {} })),
  };
  assert.deepEqual(checkFiles(files, allowlist), { ok: true, problems: [] });
});

const iccApp2 = jpegSegment(
  0xe2,
  Buffer.concat([ascii("ICC_PROFILE\0"), Buffer.from([1, 1]), ascii("prof")]),
);
const adobeApp14 = jpegSegment(
  0xee,
  Buffer.concat([ascii("Adobe"), Buffer.from([0, 100, 0, 0, 0, 0, 1])]),
);

const craftedJpegs = {
  "APP3 Meta": jpeg(jpegSegment(0xe3, ascii("Meta\0\0MM\0*GPS"))),
  "APP11 JUMBF": jpeg(
    jpegSegment(
      0xeb,
      Buffer.concat([
        ascii("JP"),
        Buffer.from([0, 0, 0, 0, 0, 1]),
        ascii("jumb"),
      ]),
    ),
  ),
  "APP1 raw JPEG": jpeg(
    jpegSegment(
      0xe1,
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), ascii("thumb")]),
    ),
  ),
  "APP2 MPF": jpeg(jpegSegment(0xe2, ascii("MPF\0MM\0*"))),
  COM: jpeg(jpegSegment(0xfe, ascii("taken at home"))),
  JFXX: jpeg(jpegSegment(0xe0, ascii("JFXX\0\x13thumb"))),
  "JPG marker": jpeg(jpegSegment(0xf1, ascii("data"))),
};

const craftedPngs = {
  zxIf: png(pngChunk("zxIf", ascii("MM\0*"))),
  exIf: png(pngChunk("exIf", ascii("MM\0*"))),
  caBX: png(pngChunk("caBX", ascii("jumb"))),
  tIME: png(pngChunk("tIME", Buffer.alloc(7))),
};

function gifExtension(kind, ...subBlocks) {
  const parts = [Buffer.from([0x21, kind])];
  for (const block of subBlocks) {
    parts.push(Buffer.from([block.length]), block);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function gif(...extensions) {
  const header = Buffer.concat([
    ascii("GIF89a"),
    Buffer.from([1, 0, 1, 0, 0, 0, 0]),
  ]);
  const image = Buffer.from([
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0,
  ]);
  return Buffer.concat([header, ...extensions, image, Buffer.from([0x3b])]);
}

const netscape = gifExtension(
  0xff,
  ascii("NETSCAPE2.0"),
  Buffer.from([1, 0, 0]),
);
const graphicControl = gifExtension(0xf9, Buffer.from([0, 0, 0, 0]));

const craftedGifs = {
  MGK8BIM0000: gif(gifExtension(0xff, ascii("MGK8BIM0000"), ascii("8BIM"))),
  comment: gif(gifExtension(0xfe, ascii("taken at home"))),
  "plain text": gif(gifExtension(0x01, Buffer.alloc(12), ascii("hi"))),
};

function anmf(...inner) {
  return riffChunk("ANMF", Buffer.concat([Buffer.alloc(16), ...inner]));
}

const craftedWebps = {
  "unknown chunk": webp(0, riffChunk("ABCD", ascii("secret"))),
  "unknown frame chunk": webp(
    0x02,
    anmf(webpImage, riffChunk("ABCD", ascii("secret"))),
  ),
};

test("scanMetadata flags every JPEG piece off the harmless list", () => {
  for (const [label, bytes] of Object.entries(craftedJpegs)) {
    assert.notDeepEqual(scanMetadata(bytes, "a.jpg"), [], label);
    const clean = stripMetadata(bytes, "a.jpg");
    assert.deepEqual(scanMetadata(clean, "a.jpg"), [], label);
    assert.deepEqual(sosToEoi(clean), sosToEoi(bytes), label);
  }
  const kept = jpeg(iccApp2, adobeApp14);
  assert.deepEqual(scanMetadata(kept, "a.jpg"), []);
  const stripped = Buffer.from(
    stripMetadata(jpeg(iccApp2, exifApp1, adobeApp14), "a.jpg"),
  );
  assert.deepEqual(stripped, kept);
});

test("scanMetadata flags every PNG chunk off the harmless list", () => {
  for (const [label, bytes] of Object.entries(craftedPngs)) {
    assert.notDeepEqual(scanMetadata(bytes, "a.png"), [], label);
    const clean = stripMetadata(bytes, "a.png");
    assert.deepEqual(scanMetadata(clean, "a.png"), [], label);
    assert.deepEqual(idatOf(clean), idatOf(bytes), label);
  }
  const harmless = [
    pngChunk("gAMA", Buffer.from([0, 0, 0xb1, 0x8f])),
    pngChunk("pHYs", Buffer.alloc(9)),
    pngChunk("iCCP", ascii("icc\0\0data")),
  ];
  const kept = png(...harmless);
  assert.deepEqual(scanMetadata(kept, "a.png"), []);
  const dirty = png(...harmless, pngChunk("caBX", ascii("jumb")));
  assert.deepEqual(Buffer.from(stripMetadata(dirty, "a.png")), kept);
});

test("scanMetadata flags every GIF extension off the harmless list", () => {
  for (const [label, bytes] of Object.entries(craftedGifs)) {
    assert.notDeepEqual(scanMetadata(bytes, "a.gif"), [], label);
    const clean = stripMetadata(bytes, "a.gif");
    assert.deepEqual(scanMetadata(clean, "a.gif"), [], label);
  }
  const kept = gif(netscape, graphicControl);
  assert.deepEqual(scanMetadata(kept, "a.gif"), []);
  const dirty = gif(netscape, gifExtension(0xfe, ascii("hi")), graphicControl);
  assert.deepEqual(Buffer.from(stripMetadata(dirty, "a.gif")), kept);
  assert.deepEqual(
    scanMetadata(stripMetadata(gifWithXmp(), "a.gif"), "a.gif"),
    [],
  );
});

test("scanMetadata flags every WebP chunk off the harmless list", () => {
  for (const [label, bytes] of Object.entries(craftedWebps)) {
    assert.notDeepEqual(scanMetadata(bytes, "a.webp"), [], label);
    const clean = stripMetadata(bytes, "a.webp");
    assert.deepEqual(scanMetadata(clean, "a.webp"), [], label);
    assert.ok(Buffer.from(clean).includes(webpImage), label);
  }
  const animated = webp(0x02, anmf(webpImage));
  assert.deepEqual(scanMetadata(animated, "a.webp"), []);
  assert.deepEqual(
    Buffer.from(stripMetadata(craftedWebps["unknown frame chunk"], "a.webp")),
    animated,
  );
});

test("scanMetadata flags AVIF pieces off the harmless list", () => {
  const ftyp = isoBox("ftyp", ascii("avif\0\0\0\0avifmif1"));
  const meta = (...children) =>
    isoBox("meta", Buffer.concat([Buffer.alloc(4), ...children]));
  assert.deepEqual(scanMetadata(Buffer.concat([ftyp, meta()]), "a.avif"), []);
  const xmlBox = isoBox("xml ", ascii("<x:xmpmeta/>"));
  assert.notDeepEqual(
    scanMetadata(Buffer.concat([ftyp, meta(xmlBox)]), "a.avif"),
    [],
  );
  const uuid = isoBox("uuid", Buffer.alloc(16, 7));
  assert.notDeepEqual(scanMetadata(Buffer.concat([ftyp, uuid]), "a.avif"), []);
});

test("checkFiles finds images by their bytes whatever the name", () => {
  const dirty = jpeg(exifApp1);
  const expected = {
    "a.heif": /deny list/,
    "a.HIF": /deny list/,
    "a.jfif": /carries exif/,
    "a.jpe": /carries exif/,
    "a.MOV": /carries exif/,
    "a.txt": /carries exif/,
    noext: /carries exif/,
    "a.tif": /should hold TIFF data but holds JPEG/,
    "a.tiff": /should hold TIFF data/,
    "a.dng": /should hold TIFF data/,
    "a.jxl": /should hold JPEG XL data/,
    "a.bmp": /should hold BMP data/,
    "a.svg": /should hold SVG data/,
  };
  for (const [name, reason] of Object.entries(expected)) {
    const path = `apps/web/public/${name}`;
    const result = checkFiles([{ path, bytes: dirty }], {
      [path]: sha256(dirty),
    });
    assert.equal(result.ok, false, name);
    assert.match(result.problems.join("\n"), reason, name);
  }
  const unlisted = checkFiles([{ path: "notes.txt", bytes: cleanJpeg }], {});
  assert.match(
    unlisted.problems.join("\n"),
    /notes\.txt is not on the allowlist/,
  );
});

test("checkFiles refuses image containers it can't scan", () => {
  const containers = {
    tiff: Buffer.concat([ascii("II*\0"), Buffer.alloc(12)]),
    "big endian tiff": Buffer.concat([ascii("MM\0*"), Buffer.alloc(12)]),
    bmp: Buffer.concat([
      ascii("BM"),
      Buffer.alloc(12),
      Buffer.from([40, 0, 0, 0]),
      Buffer.alloc(36),
    ]),
    mov: isoBox("ftyp", ascii("qt  \0\0\0\0qt  ")),
    mp4: isoBox("ftyp", ascii("isom\0\0\0\0isomiso2mp41")),
    "jpeg xl": Buffer.from([0xff, 0x0a, 1, 2]),
  };
  for (const [label, bytes] of Object.entries(containers)) {
    const result = checkFiles([{ path: "x.dat", bytes }], {
      "x.dat": sha256(bytes),
    });
    assert.equal(result.ok, false, label);
    assert.match(result.problems[0], /can't scan/, label);
  }
  const text = checkFiles(
    [{ path: "notes.txt", bytes: ascii("BMW notes") }],
    {},
  );
  assert.deepEqual(text, { ok: true, problems: [] });
});

const embeddedPng = `<image href="${scheme}image/png;base64,${cleanPng.toString("base64")}"/>`;

function svg(body, prefix = "") {
  return ascii(
    `${prefix}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${body}</svg>`,
  );
}

test("checkFiles refuses SVGs that embed or point at private data", () => {
  const favicon = readFileSync(
    join(here, "..", "..", "apps", "web", "public", "favicon.svg"),
  );
  const clean = [
    { path: "apps/web/public/favicon.svg", bytes: favicon },
    { path: "apps/web/public/x.svg", bytes: svg('<path d="M0 0h1v1z"/>') },
  ];
  assert.deepEqual(checkFiles(clean, {}), { ok: true, problems: [] });
  const dirty = [
    embeddedPng,
    '<image href="data:;base64,AAAA"/>',
    "<metadata><rdf:RDF/></metadata>",
    '<sodipodi:namedview sodipodi:docname="desk.svg"/>',
    '<g inkscape:export-filename="/home/jason/desk.png"/>',
    '<image xlink:href="file:///home/jason/desk.jpg"/>',
    '<image href="file:desk.jpg"/>',
  ];
  for (const body of dirty) {
    const result = checkFiles([{ path: "x.svg", bytes: svg(body) }], {});
    assert.equal(result.ok, false, body);
    assert.match(result.problems[0], /x\.svg carries svg:/, body);
  }
  const hidden = svg(embeddedPng, '<?xml version="1.0"?>\n');
  const result = checkFiles([{ path: "notes.txt", bytes: hidden }], {});
  assert.match(result.problems.join("\n"), /notes\.txt carries svg:data-image/);
});

const dirtyPng = png(pngChunk("eXIf", ascii("MM\0*")));
const publicFile = (name) =>
  readFileSync(join(here, "..", "..", "apps", "web", "public", name));

function refusedAs(path, bytes, reason) {
  const result = checkFiles([{ path, bytes }], { [path]: sha256(bytes) });
  assert.equal(result.ok, false, path);
  assert.match(result.problems.join("\n"), reason, path);
}

function ico(...images) {
  const directory = Buffer.alloc(6 + 16 * images.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach((image, i) => {
    const at = 6 + 16 * i;
    directory[at] = 1;
    directory[at + 1] = 1;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(image.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.length;
  });
  return Buffer.concat([directory, ...images]);
}

function icoBmp(headerSize = 40, extra = Buffer.alloc(0)) {
  const header = Buffer.alloc(headerSize);
  header.writeUInt32LE(headerSize, 0);
  header.writeInt32LE(1, 4);
  header.writeInt32LE(2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  return Buffer.concat([header, Buffer.alloc(8), extra]);
}

test("checkFiles scans the images inside an ICO", () => {
  const clean = [
    { path: "apps/web/public/favicon.ico", bytes: publicFile("favicon.ico") },
    { path: "apps/web/public/a.ico", bytes: ico(cleanPng, icoBmp()) },
  ];
  const allowlist = Object.fromEntries(
    clean.map((file) => [file.path, sha256(file.bytes)]),
  );
  assert.deepEqual(checkFiles(clean, allowlist), { ok: true, problems: [] });
  refusedAs("a.ico", ico(icoBmp(), dirtyPng), /a\.ico carries exif/);
  refusedAs("x.dat", ico(dirtyPng), /x\.dat carries exif/);
  refusedAs("b.ico", ico(icoBmp(108)), /b\.ico .*has a BMP image/);
  refusedAs("c.ico", ico(icoBmp(40, ascii("GPS"))), /c\.ico .*has a BMP image/);
  refusedAs(
    "d.ico",
    Buffer.concat([ico(cleanPng), ascii("GPS")]),
    /d\.ico .*has 3 bytes after its images/,
  );
  refusedAs("e.ico", cleanJpeg, /should hold ICO data but holds JPEG/);
});

test("stripMetadata cleans the PNG images inside an ICO", () => {
  const dirty = ico(icoBmp(), dirtyPng);
  const before = Buffer.from(dirty);
  const clean = stripMetadata(dirty, "a.ico");
  assert.deepEqual(dirty, before);
  assert.deepEqual(Buffer.from(clean), ico(icoBmp(), cleanPng));
});

test("checkFiles refuses image and media containers it doesn't parse", () => {
  const riff = (form) =>
    Buffer.concat([ascii("RIFF"), Buffer.from([4, 0, 0, 0]), ascii(form)]);
  const containers = {
    "a.jp2": Buffer.concat([
      Buffer.from([0, 0, 0, 0x0c]),
      ascii("jP  \r\n\x87\n"),
      isoBox("ftyp", ascii("jp2 \0\0\0\0jp2 ")),
    ]),
    "a.j2k": Buffer.from([0xff, 0x4f, 0xff, 0x51, 0, 0x29]),
    "a.psd": Buffer.concat([
      ascii("8BPS"),
      Buffer.from([0, 1]),
      Buffer.alloc(20),
    ]),
    "a.orf": ascii("IIRO\x08\0\0\0"),
    "a.rw2": ascii("IIU\0\x18\0\0\0"),
    "a.raf": ascii("FUJIFILMCCD-RAW 0201"),
    "a.avi": riff("AVI "),
    "a.wav": riff("WAVE"),
    "a.webm": Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]),
  };
  for (const [name, bytes] of Object.entries(containers)) {
    refusedAs(name, bytes, /can't scan/);
    refusedAs(`${name}.dat`, bytes, /can't scan/);
  }
  refusedAs("b.jp2", ascii("notes"), /should hold JPEG 2000 data/);
});

test("checkFiles refuses PDF and ZIP files by their first bytes", () => {
  const zip = (kind) => Buffer.concat([ascii("PK"), Buffer.from(kind)]);
  const files = {
    "a.pdf": ascii("%PDF-1.7\n1 0 obj\n<< /Author (someone) >>\nendobj"),
    "a.zip": Buffer.concat([zip([3, 4]), Buffer.from([20, 0, 0, 0])]),
    "empty.zip": Buffer.concat([zip([5, 6]), Buffer.alloc(18)]),
    "spanned.zip": Buffer.concat([zip([7, 8]), zip([3, 4])]),
    "a.docx": Buffer.concat([zip([3, 4]), Buffer.from([20, 0])]),
    "a.jar": Buffer.concat([zip([3, 4]), Buffer.from([10, 0])]),
  };
  for (const [name, bytes] of Object.entries(files)) {
    refusedAs(name, bytes, /can't scan/);
    refusedAs(`${name}.dat`, bytes, /can't scan/);
  }
  refusedAs("b.pdf", ascii("notes"), /should hold PDF data/);
  refusedAs("b.zip", ascii("notes"), /should hold ZIP .* data/);
  refusedAs("b.docx", ascii("notes"), /should hold ZIP .* data/);
  refusedAs(
    "a.pdf.gz",
    gzipSync(files["a.pdf"]),
    /gzip wrapping an image, a PDF/,
  );
  // text that only names the formats isn't either of them
  const notes = [
    { path: "a.md", bytes: ascii("%PDF files and PK zips are refused") },
    { path: "b.md", bytes: ascii("PKCE is an OAuth flow") },
  ];
  assert.deepEqual(checkFiles(notes, {}), { ok: true, problems: [] });
});

test("checkFiles reads gzipped SVG and refuses other gzipped images", () => {
  const cleanSvg = svg('<path d="M0 0h1v1z"/>');
  const dirtySvgz = gzipSync(svg(embeddedPng));
  const clean = [
    { path: "a.svgz", bytes: gzipSync(cleanSvg) },
    { path: "poses.json.gz", bytes: gzipSync(ascii('{"a":1}')) },
  ];
  assert.deepEqual(checkFiles(clean, {}), { ok: true, problems: [] });
  refusedAs("a.svgz", dirtySvgz, /a\.svgz carries svg:data-image/);
  refusedAs("a.svg.gz", dirtySvgz, /a\.svg\.gz carries svg:data-image/);
  refusedAs("b.svgz", cleanSvg, /should hold SVGZ data but holds SVG/);
  refusedAs("a.png.gz", gzipSync(cleanPng), /gzip wrapping an image/);
  refusedAs(
    "c.svgz",
    gzipSync(cleanSvg).subarray(0, 14),
    /c\.svgz is gzip data that doesn't decompress/,
  );
});

test("checkFiles refuses SVGs that point at local paths", () => {
  const dirty = [
    '<sodipodi:namedview sodipodi:absref="/home/jason/desk.png"/>',
    '<image href="/home/jason/desk.jpg"/>',
    '<image xlink:href="C:\\Users\\jason\\desk.jpg"/>',
    "<image href='~/desk.jpg'/>",
    '<image href="&#x2F;home/jason/desk.jpg"/>',
    '<image href="&#102;ile:///home/jason/desk.jpg"/>',
    '<rect style="fill:url(file:///home/jason/p.png)"/>',
    "<style>rect { fill: url('/home/jason/p.png') }</style>",
    '<style>@import "file:///home/jason/a.css";</style>',
  ];
  for (const body of dirty) {
    const result = checkFiles([{ path: "x.svg", bytes: svg(body) }], {});
    assert.equal(result.ok, false, body);
    assert.match(result.problems[0], /x\.svg carries svg:/, body);
  }
  const entity = svg(
    '<image href="&p;"/>',
    '<!DOCTYPE svg [<!ENTITY p "file:///home/jason/desk.jpg">]>\n',
  );
  refusedAs("x.svg", entity, /x\.svg carries svg:entity/);
  const links = svg(
    '<a href="https://jasonyue.ca/"><use href="#a"/></a><rect style="fill:url(#g)"/>',
  );
  assert.deepEqual(checkFiles([{ path: "x.svg", bytes: links }], {}), {
    ok: true,
    problems: [],
  });
});

function utf16le(bytes) {
  return Buffer.from(Buffer.from(bytes).toString("latin1"), "utf16le");
}

test("checkFiles reads SVG in UTF-16 and after a long prolog", () => {
  const dirty = svg(embeddedPng);
  const sources = {
    "utf-16le with a BOM": Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      utf16le(dirty),
    ]),
    "utf-16be": Buffer.from(utf16le(dirty)).swap16(),
    "a stylesheet PI": svg(
      embeddedPng,
      '<?xml-stylesheet href="a.css" title="a>b"?>\n',
    ),
    "an internal subset": svg(
      embeddedPng,
      '<!DOCTYPE svg [<!ATTLIST svg x CDATA "a>b">]>\n',
    ),
    "a long comment": svg(embeddedPng, `<!--${"x".repeat(5000)}-->\n`),
  };
  for (const [label, bytes] of Object.entries(sources)) {
    for (const path of ["x.svg", "notes.txt"]) {
      const result = checkFiles([{ path, bytes }], {});
      assert.equal(result.ok, false, `${label} in ${path}`);
      assert.match(
        result.problems.join("\n"),
        /carries svg:data-image/,
        `${label} in ${path}`,
      );
    }
  }
  const utf32 = Buffer.concat([
    Buffer.from([0xff, 0xfe, 0, 0]),
    ...[...svg(embeddedPng)].map((byte) => Buffer.from([byte, 0, 0, 0])),
  ]);
  refusedAs("x.svg", utf32, /x\.svg holds a NUL/);
  refusedAs("notes.txt", utf32, /notes\.txt holds a NUL/);
});

test("scanMetadata checks AVIF item properties and data references", () => {
  const ftyp = isoBox("ftyp", ascii("avif\0\0\0\0avifmif1"));
  const fullBox = (type, payload) =>
    isoBox(type, Buffer.concat([Buffer.alloc(4), payload]));
  const avif = (...children) =>
    Buffer.concat([ftyp, fullBox("meta", Buffer.concat(children))]);
  const iprp = (...properties) =>
    isoBox(
      "iprp",
      Buffer.concat([
        isoBox("ipco", Buffer.concat(properties)),
        fullBox("ipma", Buffer.alloc(4)),
      ]),
    );
  const dinf = (url) =>
    isoBox(
      "dinf",
      fullBox("dref", Buffer.concat([Buffer.from([0, 0, 0, 1]), url])),
    );
  const ispe = fullBox("ispe", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1]));
  const pixi = fullBox("pixi", Buffer.from([3, 8, 8, 8]));
  const selfContained = isoBox("url ", Buffer.from([0, 0, 0, 1]));
  assert.deepEqual(
    scanMetadata(avif(iprp(ispe, pixi), dinf(selfContained)), "a.avif"),
    [],
  );
  const dirty = {
    udes: avif(iprp(ispe, fullBox("udes", ascii("en\0desk at home\0\0\0")))),
    uuid: avif(iprp(isoBox("uuid", Buffer.alloc(16, 7)))),
    "iprp child": avif(isoBox("iprp", isoBox("xml ", ascii("<x/>")))),
    "url location": avif(
      dinf(
        isoBox(
          "url ",
          Buffer.concat([Buffer.alloc(4), ascii("file:///home/jason/a.jpg\0")]),
        ),
      ),
    ),
    "urn entry": avif(dinf(fullBox("urn ", ascii("desk\0\0")))),
  };
  for (const [label, bytes] of Object.entries(dirty)) {
    assert.notDeepEqual(scanMetadata(bytes, "a.avif"), [], label);
  }
});

const base64 = (bytes) => Buffer.from(bytes).toString("base64");

function gzipWith(flags, fields, body, mtime = 0) {
  const header = Buffer.from([0x1f, 0x8b, 8, flags, 0, 0, 0, 0, 0, 3]);
  header.writeUInt32LE(mtime, 4);
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(crc32(body), 0);
  trailer.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, fields, deflateRawSync(body), trailer]);
}

test("checkFiles refuses SVGZ gzip header fields and trailing bytes", () => {
  const cleanSvg = svg('<path d="M0 0h1v1z"/>');
  const exif = jpeg(exifApp1);
  const extra = Buffer.concat([Buffer.alloc(2), exif]);
  extra.writeUInt16LE(exif.length, 0);
  assert.deepEqual(
    checkFiles(
      [{ path: "a.svgz", bytes: gzipWith(0, Buffer.alloc(0), cleanSvg) }],
      {},
    ),
    { ok: true, problems: [] },
  );
  const dirty = {
    "extra.svgz": gzipWith(4, extra, cleanSvg),
    "name.svgz": gzipWith(
      8,
      ascii("/home/jason/Pictures/desk.svg\0"),
      cleanSvg,
    ),
    "comment.svgz": gzipWith(16, ascii("GPS 49.28N 123.12W\0"), cleanSvg),
    "time.svgz": gzipWith(0, Buffer.alloc(0), cleanSvg, 1792000000),
    "trailing.svgz": Buffer.concat([
      gzipSync(cleanSvg),
      Buffer.from([0]),
      exif,
    ]),
    "member.svgz": Buffer.concat([
      gzipSync(cleanSvg),
      gzipWith(8, ascii("desk.jpg\0"), cleanSvg),
    ]),
  };
  for (const [path, bytes] of Object.entries(dirty)) {
    refusedAs(path, bytes, /gzip/);
  }
});

const percentEncoded = (bytes) =>
  [...bytes].map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join("");

test("checkFiles refuses SVG local paths in any quoted value and bare XMP", () => {
  const dirty = {
    "svg:path-string": svg(
      '<sodipodi:namedview sodipodi:docbase="/home/jason/Pictures"/>',
    ),
    "svg:path-string ": svg(
      '<path d="M0 0"/>',
      '<!DOCTYPE svg SYSTEM "/home/jason/x.dtd">\n',
    ),
    "svg:xmp": svg(
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>',
    ),
  };
  for (const [label, bytes] of Object.entries(dirty)) {
    refusedAs("x.svg", bytes, new RegExp(`x\\.svg carries .*${label.trim()}`));
  }
  const favicon = publicFile("favicon.svg");
  assert.deepEqual(
    checkFiles([{ path: "apps/web/public/favicon.svg", bytes: favicon }], {}),
    { ok: true, problems: [] },
  );
});

function icoPalettedBmp(bits, colors, paletteEntries) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(1, 4);
  header.writeInt32LE(2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(bits, 14);
  header.writeUInt32LE(colors, 32);
  const stride = Math.floor((bits + 31) / 32) * 4;
  return Buffer.concat([
    header,
    Buffer.alloc(4 * paletteEntries),
    Buffer.alloc(stride + 4),
  ]);
}

test("checkFiles refuses an ICO BMP palette its bit depth can't use", () => {
  const allowed = ico(icoPalettedBmp(8, 2, 2), icoPalettedBmp(24, 0, 0));
  assert.deepEqual(
    checkFiles([{ path: "a.ico", bytes: allowed }], {
      "a.ico": sha256(allowed),
    }),
    { ok: true, problems: [] },
  );
  refusedAs("b.ico", ico(icoPalettedBmp(32, 1, 1)), /b\.ico .*palette/);
  refusedAs("c.ico", ico(icoPalettedBmp(8, 300, 300)), /c\.ico .*palette/);
});

test("checkFiles says when a file is refused for looking like an ICO", () => {
  const indices = Buffer.alloc(128);
  for (let i = 0; i < 64; i += 1) indices.writeUInt16LE(i, 2 * i);
  refusedAs(
    "mesh.bin",
    indices,
    /mesh\.bin looks like an ICO by its first bytes but /,
  );
});

function refusedInline(path, source) {
  const bytes = typeof source === "string" ? ascii(source) : source;
  const result = checkFiles([{ path, bytes }], {});
  const label = bytes.toString("latin1").slice(0, 90);
  assert.equal(result.ok, false, label);
  assert.match(
    result.problems.join("\n"),
    new RegExp(
      `${path.replaceAll(".", "\\.")} holds an inline image .*aren't allowed.*public/`,
    ),
    label,
  );
}

function passesInline(path, source) {
  assert.deepEqual(
    checkFiles([{ path, bytes: ascii(source) }], {}),
    { ok: true, problems: [] },
    source.slice(0, 90),
  );
}

test("checkFiles refuses a data: URI with an image type in every spelling a browser reads", () => {
  const head = `${scheme}image/png;base64,`;
  const dirty = {
    "a.html": [
      `<img src="${head}${base64(cleanPng)}">`,
      `<img src="${head}QUJD">`,
      `<img src="${head.replace("ta", "\nt\ta")}x">`,
      `<img src=" ${scheme.toUpperCase()} IMAGE/PNG ; base64 ,x">`,
      `<img src="${head.replace(":", "&#58;")}x">`,
      `<img src="${head.replace(":", "&colon;")}x">`,
      `<img src="${head.replace("d", "&#100")}x">`,
      `<img src="${head.replace("/", "&sol;")}x">`,
      `<img src="${head.replace(",", "&comma;")}x">`,
      `<img src='${scheme}image/jpeg;name="x";base64,x'>`,
      `<img src="${scheme}image/jpeg;name='a,b';base64,x">`,
      `<img src="${scheme}image/jpeg;x=<;base64,x">`,
      `<iframe srcdoc="&lt;img src=&quot;${head.replace(":", "&amp;#58;")}x&quot;&gt;">`,
    ],
    "a.js": [
      `x="${head}"+y`,
      "x=`" + head + "${y}`",
      `x="${head.replace("d", "\\x64")}x"`,
      `x="${head.replace("d", "\\u0064")}x"`,
      `x="${head.replace("d", "\\u{64}")}x"`,
      `x="${head.replace("d", "\\144")}x"`,
      `x="${head.replace("/", "\\/")}x"`,
      `x="${head.replace("ta", "t\\\na")}x"`,
      `el.innerHTML="<img src=\\"${head.replace(":", "\\x26#58;")}x\\">"`,
    ],
    "a.css": [
      `.a{background:url(${head})}`,
      `.a{background:url("${head.replace("d", "\\64 ")}x")}`,
      `.a{background:url(${head.replace(":", "\\:")}x)}`,
      `.a{background:url("${scheme}image/svg+xml,<svg/>")}`,
      `.a{background:url("${scheme}image/svg+xml;utf8,<svg/>")}`,
      `.a{background:url("${scheme}application/svg+xml,x")}`,
    ],
    "a.md": [
      `[x](${scheme}text/html,${encodeURIComponent(`<img src="${head}x">`)})`,
    ],
  };
  for (const [path, sources] of Object.entries(dirty)) {
    for (const source of sources) refusedInline(path, source);
  }
  const clean = [
    "typeof o.uri==`string`&&o.uri.startsWith(`data:image/`)===!1&&(t.name=o.uri);",
    'x="data:text/plain,hello"',
    "x={data:e/t,y:1}",
    "x={data:svgIcon,y:1}",
    "the data: image/png is fine, really",
    "const uri = `data:${type};base64,${body}`;",
    "/^data:.*,.*$/i.test(e)",
    '`<script type="module" src="data:application/javascript,"/>`',
    "metadata: image/png, svg",
  ];
  for (const source of clean) passesInline("a.js", source);
});

test("checkFiles refuses encoded image data whatever header sits in front", () => {
  const exifJpeg = jpeg(exifApp1);
  const exif = base64(exifJpeg);
  const svgText =
    '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><metadata/></svg>';
  const quoteByte = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(
      0xe1,
      Buffer.concat([
        ascii("Exif\0\0MM\0*\0\0\0\x08\0\0"),
        Buffer.alloc(0x25 - 16, 0x78),
      ]),
    ),
    jpegDqt,
    jpegSof0,
    jpegSos,
    jpegScan,
    Buffer.from([0xff, 0xd9]),
  ]);
  assert.equal(quoteByte[5], 0x27);
  const dirty = {
    "a.js": [
      `x="${scheme}application/octet-stream;base64,${base64(dirtyPng)}"`,
      "x=`" + scheme.toUpperCase() + ";base64," + exif + "`",
      `x=atob("${exif}")`,
      `x=Uint8Array.fromBase64("${exifJpeg.toString("base64url")}",{alphabet:"base64url"})`,
      `x="${base64(Buffer.alloc(3000, 0x41))} ${exif}"`,
      `x=decodeURIComponent("${percentEncoded(exifJpeg)}")`,
      `x=atob("${base64(ascii(`   \n${svgText}`))}")`,
      `x=atob("${base64(Buffer.from(`\ufeff${svgText}`, "utf16le"))}")`,
      `x=decodeURIComponent("${encodeURIComponent(svgText)}")`,
      `x="${base64(ico(icoBmp(), dirtyPng))}"`,
      `x="${base64(Buffer.concat([ascii("II*\0\x08\0\0\0"), Buffer.alloc(8)]))}"`,
      JSON.stringify({ img: exif }).replaceAll("/", "\\/"),
    ],
    "a.html": [
      `<img src="${scheme};base64,%20${exif}">`,
      `<img src="${scheme};base64,%0A${exif}">`,
      `<img src="${scheme};base64,%2F${exif.slice(1)}">`,
      `<img src="${scheme},${percentEncoded(exifJpeg)}">`,
      `<img src="${scheme},${[...quoteByte].map((byte) => (byte === 0x27 ? "'" : `%${byte.toString(16).padStart(2, "0")}`)).join("")}">`,
      `<img src="${scheme};base64,${exif.replaceAll("/", "&#47;")}">`,
      `<img src="${scheme};base64,${exif.slice(0, 8)}\n${exif.slice(8)}">`,
    ],
  };
  for (const [path, sources] of Object.entries(dirty)) {
    for (const source of sources) refusedInline(path, source);
  }
  const clean = [
    `"integrity": "sha512-${base64(Buffer.alloc(64, 0x5a))}=="`,
    'import "/workspace/wordpress/content/notes"',
    `x="${base64(gzipSync(ascii("hello there, a gzipped note")))}"`,
    "the quick brown fox jumps over the lazy dog again and again",
    'x="AAAAAAAAAIAAAABAAD_AAABAP8AAgABAAAAAAAAAAAAAAEAAAAAAAAB"',
    'x="AAAAAAAAAIAAAABAAD AAABAP8AAgABAAAAAAAAAAAAAAEAAAAAAAAB"',
    `x="${scheme}text/plain;base64,${base64(ascii("hello world, this is text"))}"`,
    'fetch("https://example.test/a%20b%20c/d%2Fe?q=%E2%9C%93")',
    `x=atob("${base64(ascii("<div>not an svg at all</div>"))}")`,
    '<p><svg viewBox="0 0 1 1"><a href="a%20b%2Fc">x</a></svg></p>',
  ];
  for (const source of clean) passesInline("a.js", source);
});

test("checkFiles refuses an SVG that holds an inline image", () => {
  const hidden = svg(
    `<image href="${scheme},${percentEncoded(jpeg(exifApp1))}"/>`,
  );
  refusedInline("x.svg", hidden);
  refusedInline("x.svgz", gzipSync(hidden));
  const named = svg(`<image href="da&#10;ta:x;base64,${base64(dirtyPng)}"/>`);
  refusedInline("y.svg", named);
});

test("checkFiles still refuses an image inside another URI's payload", () => {
  refusedInline("a.js", `x = ${scheme},${scheme}image/jpeg;base64,QUJD`);
  refusedInline(
    "b.js",
    `x = ${scheme},${scheme};base64,${base64(jpeg(exifApp1))}`,
  );
});

test("the inline check stays linear on back to back data: headers", () => {
  for (const unit of ["data:,", "(data:,", "'data:,", `${scheme}image/a;x="`]) {
    const source = unit.repeat(50000);
    const start = performance.now();
    const result = checkFiles([{ path: "a.js", bytes: ascii(source) }], {});
    const ms = performance.now() - start;
    assert.deepEqual(result, { ok: true, problems: [] }, unit);
    assert.ok(ms < 2000, `${unit} x50000 took ${Math.round(ms)} ms`);
  }
});

const inkscapeSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" sodipodi:docname="drawing.svg" inkscape:export-filename="/home/jason/Pictures/desk.png"><metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></metadata><path d="M0 0"/></svg>';

test("checkFiles finds a data: URI that starts a new line", () => {
  const svgUri = `${scheme}image/svg+xml,${inkscapeSvg.replaceAll('"', "'")}`;
  const dirty = {
    "a.md": [
      `Hard wrapped prose that ends in a word\n${svgUri}\n`,
      "```css\n" + svgUri + "\n```\n",
      "```text\r\n" + svgUri + "\r\n```\r\n",
    ],
    "a.txt": [`see\n${svgUri}`, `see\t${scheme}image/png;base64,x`],
  };
  for (const [path, sources] of Object.entries(dirty)) {
    for (const source of sources) refusedInline(path, source);
  }
  passesInline("a.md", "metadata:\nimage/png, the old field");
});

test("checkFiles runs the SVG rules on inline <svg> markup in a text file", () => {
  const dirty = {
    "a.astro": `---\n---\n<div>${inkscapeSvg}</div>`,
    "a.jsx": `export const Icon = () => (${inkscapeSvg});`,
    "b.astro": `<div><svg viewBox="0 0 1 1"><metadata>${"x".repeat(10)}`,
  };
  for (const [path, source] of Object.entries(dirty)) {
    const result = checkFiles([{ path, bytes: ascii(source) }], {});
    assert.equal(result.ok, false, path);
    assert.match(
      result.problems.join("\n"),
      new RegExp(
        `${path.replace(".", "\\.")} has inline <svg> markup that carries .*svg:`,
      ),
      path,
    );
  }
  const clean = [
    '<button><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z"/></svg></button><a href="/about">About</a>',
    '<p><svg class="a"/><a href="/about">About</a></p>',
    "An `<svg>` root in prose, then a link to `/about`.",
  ];
  for (const source of clean) passesInline("a.astro", source);
  passesInline("a.js", '// reads an <svg> root\nconst home = "/about";');
});

// components a site writes, each of which the reader once took for an SVG export with a local path
test("checkFiles passes inline <svg> in the components a site writes", () => {
  const after =
    '\n<nav><a href="/about">About</a> <a href="/blog/">Blog</a></nav>\n';
  const fm =
    '---\nimport Base from "../layout/Base.astro";\nconst { size = 24, active = false, ...props } = Astro.props;\nconst count = 3;\n---\n';
  const p =
    '<path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2"/>';
  const clean = {
    "a.astro": [
      `${fm}<svg width={size > 16 ? size : 16} height={size} />${after}`,
      `${fm}<svg class:list={["icon", { big: size > 20 }]} />${after}`,
      `${fm}<svg class="icon"><use href="/icons.svg#arrow"/></svg>${after}`,
      `${fm}<!-- the <svg> icons come from lucide -->${after}`,
      `---\n// renders an <svg> for each key\nconst keys = [];\n---\n${after}`,
    ],
    "a.jsx": [
      'export const Dot = ({ on }) => <svg width={on > 0 ? 8 : 4} height={8} />;\nexport const link = "/about";\n',
      'export const B = ({ t }) => <svg onClick={() => t()} />;\nexport const link = "/about";\n',
      '// wraps the <svg> in a button\nexport const link = "/about";\n',
    ],
    "a.tsx": [
      'export const B = () => <svg ref={r as Ref<SVGSVGElement>} />;\nexport const link = "/about";\n',
    ],
    "a.svelte": [
      '<script>let n = 2;</script>\n<svg class:big={n > 1} />\n<a href="/about">x</a>\n',
    ],
    "a.vue": [
      '<template><svg :width="size > 10 ? 24 : 16" /><a href="/about">x</a></template>\n',
    ],
    "a.md": [
      'The `<svg>` icons are inline.\n\nThe about page lives at "/about".\n',
      'Inline <svg> icons are fine.\n\n<a href="/about">About</a>\n',
    ],
  };
  for (const [path, sources] of Object.entries(clean)) {
    for (const source of sources) passesInline(path, source);
  }
  passesInline(
    "b.astro",
    `${fm}<svg viewBox="0 0 24 24" {...props}>${p}</svg>${after}`,
  );
});

test("checkFiles refuses a machine path in inline <svg> and keeps the other rules on an unclosed one", () => {
  const dirty = [
    [
      "a.astro",
      '<p>x</p><svg><image href="/home/jason/Pictures/desk.png"/></svg>',
    ],
    [
      "b.astro",
      '<p>x</p><svg><image href="C:\\Users\\jason\\desk.png"/></svg>',
    ],
    ["c.jsx", 'export const I = () => <svg><use href="~/icons.svg#a"/></svg>;'],
    [
      "d.tsx",
      'export const I = () => <svg data-src={"/Users/jason/a.png"} />;',
    ],
    [
      "e.astro",
      '<p>x</p><svg width={a > b ? 1 : 2}><image href="/tmp/x/a.png"/></svg>',
    ],
    ["f.md", "Some <svg> prose\n<svg><metadata>left open"],
  ];
  for (const [path, source] of dirty) {
    const result = checkFiles([{ path, bytes: ascii(source) }], {});
    assert.equal(result.ok, false, path);
    assert.match(
      result.problems.join("\n"),
      new RegExp(
        `${path.replace(".", "\\.")} has inline <svg> markup that carries`,
      ),
      path,
    );
  }
  // the .svg file rule still refuses a site path, since an exported file has no reason to hold one
  const file = checkFiles(
    [{ path: "x.svg", bytes: ascii('<svg><use href="/icons.svg#a"/></svg>') }],
    {},
  );
  assert.equal(file.ok, false);
});

test("checkFiles finds base64 that starts after an equals sign", () => {
  const exif = base64(jpeg(exifApp1));
  const sources = [
    `IMAGE=${exif}\n`,
    `[x](https://example.test/render?png=${exif})`,
    `<meta name=x content=${exif}>`,
    `${base64(ascii("hi!"))}==${exif}`,
  ];
  for (const source of sources) refusedInline("a.txt", source);
});

test("checkFiles reads a gzipped text file for inline images", () => {
  refusedInline(
    "a.json.gz",
    gzipSync(ascii(JSON.stringify({ img: base64(jpeg(exifApp1)) }))),
  );
  assert.deepEqual(
    checkFiles(
      [{ path: "a.json.gz", bytes: gzipSync(ascii('{"pose":[1,2,3]}')) }],
      {},
    ),
    { ok: true, problems: [] },
  );
});

test("checkFiles finds SVG markup after a form feed or a BOM", () => {
  refusedInline("a.js", `x=atob("${base64(ascii(`\f${inkscapeSvg}`))}")`);
  refusedInline(
    "b.js",
    `x=atob("${base64(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), ascii(inkscapeSvg)]))}")`,
  );
});

test("walkReadings walks a reading again when it's reached at a shallower depth", () => {
  const step = (map) => (text) => map[text] ?? text;
  const slow = step({ a: "b", b: "c", c: "d", d: "e", e: "f" });
  const fast = step({ a: "d" });
  const seen = [];
  const found = walkReadings(
    "a",
    (text, depth) => {
      seen.push(`${text}${depth}`);
      return text === "f" ? depth : null;
    },
    [slow, fast],
    3,
  );
  assert.equal(found, 3);
  assert.deepEqual(seen, ["a0", "b1", "c2", "d3", "d1", "e2", "f3"]);
});

test("the SVG sniff finishes fast on a long unclosed DOCTYPE subset", () => {
  const source = `<!DOCTYPE x ${"[]".repeat(5000)}`;
  const start = performance.now();
  checkFiles([{ path: "a.txt", bytes: ascii(source) }], {});
  checkFiles(
    [{ path: "a.js", bytes: ascii(`x="${base64(ascii(source))}"`) }],
    {},
  );
  assert.ok(performance.now() - start < 1000);
});

function runCli(args) {
  return spawnSync(process.execPath, [join(here, "check.mjs"), ...args], {
    encoding: "utf8",
  });
}

test("the CLI exits 1 on a truncated PNG and 0 on a clean folder", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "privacy-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "clean"));
  writeFileSync(join(dir, "clean", "index.html"), "<p>hi</p>");
  const clean = runCli(["--dist", join(dir, "clean")]);
  assert.equal(clean.status, 0, clean.stderr);

  mkdirSync(join(dir, "broken"));
  writeFileSync(join(dir, "broken", "index.html"), "<p>hi</p>");
  writeFileSync(
    join(dir, "broken", "a.png"),
    cleanPng.subarray(0, cleanPng.length - 6),
  );
  const broken = runCli(["--dist", join(dir, "broken")]);
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /a\.png.*truncated/);
});

test("the CLI exits 1 on an inline image in dist", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "privacy-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "_astro"), { recursive: true });
  writeFileSync(
    join(dir, "_astro", "site.css"),
    `.a{background:url(${scheme}image/jpeg;base64,${base64(jpeg(exifApp1))})}`,
  );
  const result = runCli(["--dist", dir]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /apps\/web\/public\/_astro\/site\.css holds an inline image/,
  );
});

test("the CLI exits 1 on a bad mode", () => {
  assert.equal(runCli([]).status, 1);
  assert.equal(runCli(["--nope"]).status, 1);
  assert.equal(runCli(["--range", "HEAD"]).status, 1);
});

// label, path, then the text as a head, a unit repeated, and a tail, so the child builds it instead of taking megabytes of argv
const repeatedInputs = [
  ["data:, x200k", "a.js", "", "data:,", 200000, ""],
  ["(data:, x200k", "a.js", "", "(data:,", 200000, ""],
  ["data: no comma x200k", "a.js", "", "data:", 200000, ""],
  ["one URI then 1M dots", "a.js", "data:,", ".", 1000000, "x"],
  ["<!DOCTYPE a> to 3M", "a.txt", "", "<!DOCTYPE a>", 250000, ""],
  [
    "SVG data URI then data:x to 1M",
    "a.js",
    `x="${scheme}image/svg+xml,<svg>"`,
    "data:x",
    170000,
    "",
  ],
  ["SVG file of data:x to 1M", "x.svg", "<svg>", "data:x", 170000, "</svg>"],
  [
    "unclosed quoted parameters",
    "a.js",
    "",
    `${scheme}image/a;x="`,
    100000,
    "",
  ],
  ["percent escapes to 3M", "a.js", "", "%41", 1000000, ""],
  ["%20 and a space to 1M", "a.txt", "", "%20 ", 250000, ""],
  ["%0A and a newline to 1M", "a.txt", "", "%0A\n", 250000, ""],
  ["A and a space to 1M", "a.txt", "", "A ", 500000, ""],
  ["A and a newline to 1M", "a.txt", "", "A\n", 500000, ""],
  ["A= to 1M", "a.txt", "", "A=", 500000, ""],
  ["unclosed <svg> x200k", "a.astro", "", "<svg>", 200000, ""],
  ["<svg without > x200k", "a.astro", "", "<svg ", 200000, ""],
  ["<svg with an open quote x200k", "a.astro", "", '<svg a="', 200000, ""],
  ["<svg with an open brace x200k", "a.jsx", "", "<svg a={", 200000, ""],
  ["<svg/> x200k", "a.astro", "", "<svg/>", 200000, ""],
];

// a regression here once grew one node process to about 45 GB, so the input runs in a child under a memory cap
test("checkFiles stays small and fast on long repeated inputs", (t) => {
  const probe = spawnSync("systemd-run", ["--user", "--scope", "-q", "true"]);
  if (probe.status !== 0) {
    t.skip("needs systemd-run --user for a memory cap");
    return;
  }
  const script = `import(${JSON.stringify(join(here, "check.mjs"))}).then(({ checkFiles }) => {
    const cases = ${JSON.stringify(repeatedInputs)};
    for (const [label, path, head, unit, count, tail] of cases) {
      const text = head + unit.repeat(count) + tail;
      const start = performance.now();
      checkFiles([{ path, bytes: Buffer.from(text) }], {});
      console.log(JSON.stringify({ label, ms: Math.round(performance.now() - start), rss: process.memoryUsage().rss }));
    }
  });`;
  const result = spawnSync(
    "systemd-run",
    [
      "--user",
      "--scope",
      "-q",
      "-p",
      "MemoryMax=1G",
      "-p",
      "MemorySwapMax=0",
      process.execPath,
      "--max-old-space-size=512",
      "-e",
      script,
    ],
    { encoding: "utf8", timeout: 60000, killSignal: "SIGKILL" },
  );
  assert.equal(
    result.status,
    0,
    `child exited ${result.status} (${result.signal ?? result.error?.message ?? "no signal"}): ${result.stderr}`,
  );
  const lines = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(lines.length, repeatedInputs.length);
  for (const { label, ms, rss } of lines) {
    assert.ok(rss < 1e9, `${label} reached ${Math.round(rss / 1e6)} MB`);
    assert.ok(ms < 5000, `${label} took ${ms} ms`);
  }
});
