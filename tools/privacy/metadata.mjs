import { createHash } from "node:crypto";
import { crc32, gunzipSync, inflateRawSync } from "node:zlib";

const latin1 = new TextDecoder("latin1");

function text(bytes, start, end) {
  return latin1.decode(bytes.subarray(start, end));
}

function startsWith(bytes, start, prefix) {
  return text(bytes, start, start + prefix.length) === prefix;
}

function u16be(bytes, at) {
  return (bytes[at] << 8) | bytes[at + 1];
}

function u32be(bytes, at) {
  return (
    ((bytes[at] << 24) >>> 0) +
    ((bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3])
  );
}

function u16le(bytes, at) {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32le(bytes, at) {
  return (
    ((bytes[at + 3] << 24) >>> 0) +
    ((bytes[at + 2] << 16) | (bytes[at + 1] << 8) | bytes[at])
  );
}

function concat(parts) {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function extensionOf(name) {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

const typeNames = {
  jpeg: "JPEG",
  png: "PNG",
  webp: "WebP",
  gif: "GIF",
  avif: "AVIF",
  heif: "HEIF",
  isobmff: "ISO BMFF (such as MOV or MP4)",
  glb: "GLB",
  gltf: "glTF",
  tiff: "TIFF",
  bmp: "BMP",
  jxl: "JPEG XL",
  svg: "SVG",
  svgz: "SVGZ",
  ico: "ICO",
  jp2: "JPEG 2000",
  psd: "PSD",
  raw: "camera raw (such as ORF, RW2, or RAF)",
  riff: "RIFF media (such as AVI or WAV)",
  matroska: "Matroska (such as WebM or MKV)",
  gzimage: "gzip wrapping an image, a PDF, or a ZIP",
  pdf: "PDF",
  zip: "ZIP (or a format built on it, such as DOCX or JAR)",
};

const extensionTypes = {
  jpg: "jpeg",
  jpeg: "jpeg",
  jpe: "jpeg",
  jfif: "jpeg",
  png: "png",
  webp: "webp",
  gif: "gif",
  avif: "avif",
  heic: "heif",
  heif: "heif",
  hif: "heif",
  glb: "glb",
  gltf: "gltf",
  tif: "tiff",
  tiff: "tiff",
  dng: "tiff",
  bmp: "bmp",
  jxl: "jxl",
  svg: "svg",
  svgz: "svgz",
  ico: "ico",
  cur: "ico",
  jp2: "jp2",
  j2k: "jp2",
  j2c: "jp2",
  jpf: "jp2",
  jpx: "jp2",
  jpm: "jp2",
  psd: "psd",
  psb: "psd",
  orf: "raw",
  rw2: "raw",
  raf: "raw",
  avi: "riff",
  webm: "matroska",
  mkv: "matroska",
  pdf: "pdf",
  zip: "zip",
  docx: "zip",
  xlsx: "zip",
  pptx: "zip",
  odt: "zip",
  ods: "zip",
  odp: "zip",
  epub: "zip",
  jar: "zip",
  apk: "zip",
};

// browsers show a bare PNG named .ico, and the scaffold's favicon.ico is one
const extensionAlso = { ico: "png" };

export const unscannableTypes = new Set([
  "isobmff",
  "tiff",
  "bmp",
  "jxl",
  "jp2",
  "psd",
  "raw",
  "riff",
  "matroska",
  "gzimage",
  "pdf",
  "zip",
]);

export function typeName(type) {
  return typeNames[type];
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const jxlContainer = [
  0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
];
const jp2Container = [
  0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
];
const gzipLimit = 64 * 1024 * 1024;
const avifBrands = new Set(["avif", "avis"]);
const heifBrands = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
]);
const bmpHeaderSizes = new Set([12, 16, 40, 52, 56, 64, 108, 124]);

function startsWithBytes(bytes, values) {
  return (
    bytes.length >= values.length &&
    values.every((value, i) => bytes[i] === value)
  );
}

function isoBmffType(bytes) {
  const size = u32be(bytes, 0);
  const end = Math.min(bytes.length, size >= 16 ? size : 16);
  const brands = [text(bytes, 8, 12)];
  for (let at = 16; at + 4 <= end; at += 4)
    brands.push(text(bytes, at, at + 4));
  if (brands.some((brand) => avifBrands.has(brand))) return "avif";
  if (brands.some((brand) => heifBrands.has(brand))) return "heif";
  return "isobmff";
}

// a NUL byte next to the first character means UTF-16 without a BOM
function textEncoding(bytes) {
  if (startsWithBytes(bytes, [0xef, 0xbb, 0xbf])) return "utf-8";
  if (startsWithBytes(bytes, [0xff, 0xfe])) return "utf-16le";
  if (startsWithBytes(bytes, [0xfe, 0xff])) return "utf-16be";
  if (bytes.length >= 2 && bytes[0] !== 0 && bytes[1] === 0) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0 && bytes[1] !== 0) return "utf-16be";
  return "utf-8";
}

// NULs are dropped here so a UTF-32 SVG is still recognized, and the scan then refuses it
function looksLikeSvg(bytes) {
  const decoder = new TextDecoder(textEncoding(bytes));
  const start = decoder.decode(bytes.subarray(0, 256)).replaceAll("\0", "");
  if (!start.trimStart().startsWith("<")) return false;
  const source = decoder.decode(bytes).replaceAll("\0", "");
  const root = prologEnd(source);
  return root !== -1 && /^<svg[\s>]/i.test(source.slice(root, root + 5));
}

// a loop with indexOf instead of one regex, since nested quantifiers there backtracked exponentially on "[][][]..."
function prologEnd(source) {
  let pos = 0;
  while (pos < source.length) {
    if (/\s/.test(source[pos])) {
      pos += 1;
      continue;
    }
    let end = -1;
    if (source.startsWith("<?", pos)) {
      end = source.indexOf("?>", pos + 2);
      if (end !== -1) end += 2;
    } else if (source.startsWith("<!--", pos)) {
      end = source.indexOf("-->", pos + 4);
      if (end !== -1) end += 3;
    } else if (/^<!DOCTYPE/i.test(source.slice(pos, pos + 9))) {
      // the subset bracket is only looked for before this DOCTYPE's own ">", since a search to the end of the file for each one is quadratic
      const close = source.indexOf(">", pos);
      if (close === -1) return -1;
      const subset = source.slice(pos, close).indexOf("[");
      if (subset === -1) {
        end = close + 1;
      } else {
        const bracket = source.indexOf("]", pos + subset);
        end = bracket === -1 ? -1 : source.indexOf(">", bracket);
        if (end !== -1) end += 1;
      }
    } else {
      return pos;
    }
    if (end === -1) return -1;
    pos = end;
  }
  return pos;
}

function gunzip(bytes) {
  try {
    return gunzipSync(bytes, { maxOutputLength: gzipLimit });
  } catch (error) {
    throw new Error(`is gzip data that doesn't decompress (${error.message})`, {
      cause: error,
    });
  }
}

// the SVG scan reads only the unpacked stream, so the gzip wrapper must hold nothing else
function unpackSvgz(bytes) {
  if (bytes.length < 18 || !startsWithBytes(bytes, [0x1f, 0x8b, 0x08])) {
    throw new Error("isn't gzip data");
  }
  if ((bytes[3] & 0xfc) !== 0) {
    throw new Error(
      "has a gzip header with an extra field, a file name, or a comment",
    );
  }
  if (u32le(bytes, 4) !== 0) {
    throw new Error("has a gzip header with a modification time");
  }
  const start = (bytes[3] & 0x02) !== 0 ? 12 : 10;
  let result;
  try {
    result = inflateRawSync(bytes.subarray(start), {
      maxOutputLength: gzipLimit,
      info: true,
    });
  } catch (error) {
    throw new Error(`is gzip data that doesn't decompress (${error.message})`, {
      cause: error,
    });
  }
  const end = start + result.engine.bytesWritten;
  if (end + 8 > bytes.length) {
    throw new Error("is truncated in its gzip trailer");
  }
  if (end + 8 < bytes.length) {
    throw new Error(
      `has ${bytes.length - end - 8} bytes after its gzip stream`,
    );
  }
  const svg = result.buffer;
  if (
    u32le(bytes, end) !== crc32(svg) ||
    u32le(bytes, end + 4) !== svg.length
  ) {
    throw new Error("has a gzip trailer that doesn't match its data");
  }
  return svg;
}

function gzipType(bytes) {
  const inner = sniff(gunzip(bytes), "");
  if (inner === null) return null;
  return inner === "svg" ? "svgz" : "gzimage";
}

function sniff(bytes, extension) {
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWithBytes(bytes, pngSignature)) return "png";
  if (
    bytes.length >= 12 &&
    (startsWith(bytes, 0, "RIFF") ||
      startsWith(bytes, 0, "RIFX") ||
      startsWith(bytes, 0, "RF64"))
  ) {
    return startsWith(bytes, 8, "WEBP") ? "webp" : "riff";
  }
  if (startsWith(bytes, 0, "GIF8")) return "gif";
  if (bytes.length >= 12 && startsWith(bytes, 4, "ftyp")) {
    return isoBmffType(bytes);
  }
  if (bytes.length >= 8 && /^(moov|mdat|wide|pnot)$/.test(text(bytes, 4, 8))) {
    return "isobmff";
  }
  if (startsWith(bytes, 0, "glTF")) return "glb";
  if (startsWith(bytes, 0, "II*\0") || startsWith(bytes, 0, "MM\0*")) {
    return "tiff";
  }
  if (
    bytes.length >= 18 &&
    startsWith(bytes, 0, "BM") &&
    bmpHeaderSizes.has(u32le(bytes, 14))
  ) {
    return "bmp";
  }
  if (
    startsWithBytes(bytes, [0xff, 0x0a]) ||
    startsWithBytes(bytes, jxlContainer)
  ) {
    return "jxl";
  }
  if (
    startsWithBytes(bytes, jp2Container) ||
    startsWithBytes(bytes, [0xff, 0x4f, 0xff, 0x51])
  ) {
    return "jp2";
  }
  if (startsWith(bytes, 0, "8BPS")) return "psd";
  if (
    startsWith(bytes, 0, "IIRO") ||
    startsWith(bytes, 0, "IIRS") ||
    startsWith(bytes, 0, "MMOR") ||
    startsWith(bytes, 0, "IIU\0") ||
    startsWith(bytes, 0, "FUJIFILMCCD-RAW")
  ) {
    return "raw";
  }
  if (startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "matroska";
  // a pdf keeps its author, its software, and often a path on the machine, and a zip can carry any file unread, so
  // both are refused by their first bytes (an empty zip and a spanned one start with their own markers)
  if (startsWith(bytes, 0, "%PDF-")) return "pdf";
  if (
    startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWithBytes(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWithBytes(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return "zip";
  }
  if (
    bytes.length >= 6 &&
    u16le(bytes, 0) === 0 &&
    (u16le(bytes, 2) === 1 || u16le(bytes, 2) === 2) &&
    u16le(bytes, 4) > 0
  ) {
    return "ico";
  }
  if (startsWithBytes(bytes, [0x1f, 0x8b, 0x08])) return gzipType(bytes);
  if (extension === "gltf") return "gltf";
  if (extension === "svg" || looksLikeSvg(bytes)) return "svg";
  return null;
}

// a file's bytes decide its type, and a known image extension must agree with them
export function imageType(bytes, name) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const extension = extensionOf(name);
  let found;
  try {
    found = sniff(view, extension);
  } catch (error) {
    throw new Error(`${name} ${error.message}`, { cause: error });
  }
  if (Object.hasOwn(extensionTypes, extension)) {
    const expected = extensionTypes[extension];
    if (found !== expected && extensionAlso[extension] !== found) {
      const holds = found === null ? "no image data it knows" : typeName(found);
      throw new Error(
        `${name} should hold ${typeName(expected)} data but holds ${holds}`,
      );
    }
  }
  return found;
}

const jpegStructural = new Set([
  0x01, 0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xcb,
  0xcc, 0xcd, 0xce, 0xcf, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8,
  0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf,
]);

function parseJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("isn't a JPEG");
  }
  const segments = [{ marker: 0xd8, start: 0, end: 2 }];
  let pos = 2;
  while (true) {
    if (pos + 1 >= bytes.length) throw new Error("is truncated before EOI");
    if (bytes[pos] !== 0xff) {
      throw new Error(`has a bad marker at byte ${pos}`);
    }
    let markerAt = pos;
    while (bytes[markerAt + 1] === 0xff) {
      markerAt += 1;
      if (markerAt + 1 >= bytes.length) {
        throw new Error("is truncated before EOI");
      }
    }
    const marker = bytes[markerAt + 1];
    if (marker === 0xd9) {
      segments.push({ marker, start: markerAt, end: markerAt + 2 });
      pos = markerAt + 2;
      break;
    }
    if (marker === 0xd8 || marker === 0x00) {
      throw new Error(`has a bad marker at byte ${markerAt}`);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, start: markerAt, end: markerAt + 2 });
      pos = markerAt + 2;
      continue;
    }
    if (markerAt + 4 > bytes.length) {
      throw new Error("is truncated in a segment");
    }
    const length = u16be(bytes, markerAt + 2);
    const end = markerAt + 2 + length;
    if (length < 2 || end > bytes.length) {
      throw new Error("is truncated in a segment");
    }
    segments.push({ marker, start: markerAt, dataStart: markerAt + 4, end });
    pos = end;
    if (marker === 0xda) {
      while (pos < bytes.length) {
        if (bytes[pos] === 0xff && pos + 1 < bytes.length) {
          const next = bytes[pos + 1];
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) break;
          pos += 2;
        } else {
          pos += 1;
        }
      }
      if (pos >= bytes.length) throw new Error("is truncated in scan data");
      segments.push({ marker: null, start: end, end: pos });
    }
  }
  if (pos !== bytes.length) {
    throw new Error(`has ${bytes.length - pos} bytes after EOI`);
  }
  return segments;
}

function jfifHasThumbnail(bytes, segment) {
  if (segment.end - segment.dataStart < 14) return false;
  return (
    bytes[segment.dataStart + 12] !== 0 || bytes[segment.dataStart + 13] !== 0
  );
}

// null means the segment is on the harmless list
function jpegLabel(bytes, segment) {
  const { marker, dataStart } = segment;
  if (marker === null || jpegStructural.has(marker)) return null;
  if (marker === 0xe0) {
    if (startsWith(bytes, dataStart, "JFIF\0")) {
      return jfifHasThumbnail(bytes, segment) ? "jfif:thumbnail" : null;
    }
    if (startsWith(bytes, dataStart, "JFXX\0")) return "jfif:thumbnail";
    return "jpeg:app0";
  }
  if (marker === 0xe1) {
    if (startsWith(bytes, dataStart, "Exif\0")) return "exif";
    if (
      startsWith(bytes, dataStart, "http://ns.adobe.com/xap/1.0/\0") ||
      startsWith(bytes, dataStart, "http://ns.adobe.com/xmp/extension/\0")
    ) {
      return "xmp";
    }
    return "jpeg:app1";
  }
  if (marker === 0xe2 && startsWith(bytes, dataStart, "ICC_PROFILE\0")) {
    return null;
  }
  if (marker === 0xed && startsWith(bytes, dataStart, "Photoshop 3.0\0")) {
    return "iptc";
  }
  if (marker === 0xee && startsWith(bytes, dataStart, "Adobe")) return null;
  if (marker >= 0xe0 && marker <= 0xef) return `jpeg:app${marker - 0xe0}`;
  if (marker === 0xfe) return "jpeg:comment";
  return `jpeg:marker-${marker.toString(16)}`;
}

function scanJpeg(bytes) {
  return parseJpeg(bytes)
    .map((segment) => jpegLabel(bytes, segment))
    .filter((label) => label !== null);
}

function stripJpeg(bytes) {
  const parts = [];
  for (const segment of parseJpeg(bytes)) {
    if (
      segment.marker === 0xe0 &&
      startsWith(bytes, segment.dataStart, "JFIF\0") &&
      jfifHasThumbnail(bytes, segment)
    ) {
      const kept = bytes.slice(segment.start, segment.dataStart + 14);
      kept[2] = 0;
      kept[3] = 16;
      kept[16] = 0;
      kept[17] = 0;
      parts.push(kept);
      continue;
    }
    if (jpegLabel(bytes, segment) === null) {
      parts.push(bytes.subarray(segment.start, segment.end));
    }
  }
  return concat(parts);
}

function parsePng(bytes) {
  if (!startsWithBytes(bytes, pngSignature)) throw new Error("isn't a PNG");
  const chunks = [];
  let pos = 8;
  while (true) {
    if (pos + 12 > bytes.length) throw new Error("is truncated before IEND");
    const length = u32be(bytes, pos);
    const end = pos + 12 + length;
    if (end > bytes.length) throw new Error("is truncated in a chunk");
    const type = text(bytes, pos + 4, pos + 8);
    chunks.push({
      type,
      start: pos,
      dataStart: pos + 8,
      dataEnd: pos + 8 + length,
      end,
    });
    pos = end;
    if (type === "IEND") break;
  }
  if (chunks[0].type !== "IHDR") throw new Error("doesn't start with IHDR");
  if (pos !== bytes.length) {
    throw new Error(`has ${bytes.length - pos} bytes after IEND`);
  }
  return chunks;
}

const pngHarmless = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "pHYs",
  "sBIT",
  "bKGD",
  "cICP",
  "mDCv",
  "cLLi",
]);

const pngTextKinds = {
  "XML:com.adobe.xmp": "xmp",
  "Raw profile type exif": "exif",
  "Raw profile type APP1": "exif",
  "Raw profile type iptc": "iptc",
  "Raw profile type 8bim": "iptc",
  "Raw profile type xmp": "xmp",
};

function pngLabel(bytes, chunk) {
  if (pngHarmless.has(chunk.type)) return null;
  if (chunk.type === "eXIf") return "exif";
  if (chunk.type === "tEXt" || chunk.type === "zTXt" || chunk.type === "iTXt") {
    const data = bytes.subarray(chunk.dataStart, chunk.dataEnd);
    const nul = data.indexOf(0);
    const keyword = text(data, 0, nul === -1 ? data.length : nul);
    return Object.hasOwn(pngTextKinds, keyword)
      ? pngTextKinds[keyword]
      : "png:text";
  }
  return `png:${chunk.type}`;
}

function scanPng(bytes) {
  return parsePng(bytes)
    .map((chunk) => pngLabel(bytes, chunk))
    .filter((label) => label !== null);
}

function stripPng(bytes) {
  const parts = [bytes.subarray(0, 8)];
  for (const chunk of parsePng(bytes)) {
    if (pngLabel(bytes, chunk) === null) {
      parts.push(bytes.subarray(chunk.start, chunk.end));
    }
  }
  return concat(parts);
}

function riffChunks(bytes, start, end) {
  const chunks = [];
  let pos = start;
  while (pos < end) {
    if (pos + 8 > end) throw new Error("is truncated in a chunk");
    const size = u32le(bytes, pos + 4);
    const chunkEnd = pos + 8 + size + (size % 2);
    if (chunkEnd > end) throw new Error("is truncated in a chunk");
    chunks.push({
      type: text(bytes, pos, pos + 4),
      start: pos,
      dataStart: pos + 8,
      dataEnd: pos + 8 + size,
      end: chunkEnd,
    });
    pos = chunkEnd;
  }
  return chunks;
}

function parseWebp(bytes) {
  if (
    bytes.length < 12 ||
    !startsWith(bytes, 0, "RIFF") ||
    !startsWith(bytes, 8, "WEBP")
  ) {
    throw new Error("isn't a WebP");
  }
  const riffEnd = 8 + u32le(bytes, 4);
  if (riffEnd > bytes.length) throw new Error("is truncated");
  if (riffEnd < bytes.length) {
    throw new Error(`has ${bytes.length - riffEnd} bytes after RIFF`);
  }
  return riffChunks(bytes, 12, riffEnd);
}

const webpHarmless = new Set([
  "VP8 ",
  "VP8L",
  "VP8X",
  "ALPH",
  "ICCP",
  "ANIM",
  "ANMF",
]);
const webpFrameHarmless = new Set(["VP8 ", "VP8L", "ALPH"]);

function webpLabel(chunk, harmless) {
  if (harmless.has(chunk.type)) return null;
  if (chunk.type === "EXIF") return "exif";
  if (chunk.type === "XMP ") return "xmp";
  return `webp:${chunk.type.trim()}`;
}

function webpFrameChunks(bytes, chunk) {
  if (chunk.dataEnd - chunk.dataStart < 16) {
    throw new Error("has a truncated ANMF frame");
  }
  return riffChunks(bytes, chunk.dataStart + 16, chunk.dataEnd);
}

function scanWebp(bytes) {
  const found = [];
  for (const chunk of parseWebp(bytes)) {
    const label = webpLabel(chunk, webpHarmless);
    if (label !== null) found.push(label);
    if (chunk.type !== "ANMF") continue;
    for (const inner of webpFrameChunks(bytes, chunk)) {
      const innerLabel = webpLabel(inner, webpFrameHarmless);
      if (innerLabel !== null) found.push(innerLabel);
    }
  }
  return found;
}

function riffChunk(fourcc, body) {
  const header = new Uint8Array(8);
  header.set(fourcc);
  new DataView(header.buffer).setUint32(4, body.length, true);
  const pad = body.length % 2 === 1 ? [new Uint8Array(1)] : [];
  return concat([header, body, ...pad]);
}

function stripWebp(bytes) {
  const parts = [];
  for (const chunk of parseWebp(bytes)) {
    if (webpLabel(chunk, webpHarmless) !== null) continue;
    if (chunk.type === "VP8X") {
      const copy = bytes.slice(chunk.start, chunk.end);
      copy[8] &= ~0x0c;
      parts.push(copy);
    } else if (chunk.type === "ANMF") {
      const inner = webpFrameChunks(bytes, chunk)
        .filter((frame) => webpLabel(frame, webpFrameHarmless) === null)
        .map((frame) => bytes.subarray(frame.start, frame.end));
      const frameHeader = bytes.subarray(chunk.dataStart, chunk.dataStart + 16);
      const fourcc = bytes.subarray(chunk.start, chunk.start + 4);
      parts.push(riffChunk(fourcc, concat([frameHeader, ...inner])));
    } else {
      parts.push(bytes.subarray(chunk.start, chunk.end));
    }
  }
  const body = concat(parts);
  const header = bytes.slice(0, 12);
  new DataView(header.buffer, header.byteOffset).setUint32(
    4,
    body.length + 4,
    true,
  );
  return concat([header, body]);
}

function skipGifSubBlocks(bytes, pos) {
  while (true) {
    if (pos >= bytes.length) throw new Error("is truncated in a block");
    const size = bytes[pos];
    pos += 1 + size;
    if (size === 0) return pos;
  }
}

function gifTableSize(packed) {
  return packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0;
}

function parseGif(bytes) {
  if (
    bytes.length < 13 ||
    (!startsWith(bytes, 0, "GIF87a") && !startsWith(bytes, 0, "GIF89a"))
  ) {
    throw new Error("isn't a GIF");
  }
  const headerEnd = 13 + gifTableSize(bytes[10]);
  const blocks = [{ label: null, start: 0, end: headerEnd }];
  let pos = headerEnd;
  while (true) {
    if (pos >= bytes.length) throw new Error("is truncated before the trailer");
    const start = pos;
    const block = bytes[pos];
    if (block === 0x3b) {
      blocks.push({ label: null, start, end: pos + 1 });
      pos += 1;
      break;
    }
    if (block === 0x21) {
      if (pos + 2 > bytes.length) throw new Error("is truncated in a block");
      const kind = bytes[pos + 1];
      let label = `gif:extension-${kind.toString(16)}`;
      if (kind === 0xf9) label = null;
      if (kind === 0xfe) label = "gif:comment";
      if (kind === 0x01) label = "gif:text";
      if (kind === 0xff) {
        const id = bytes[pos + 2] === 11 ? text(bytes, pos + 3, pos + 14) : "";
        if (id === "NETSCAPE2.0" || id.startsWith("ICCRGBG1")) label = null;
        else if (id === "XMP DataXMP") label = "xmp";
        else label = `gif:app-${id.replace(/[^\x20-\x7e]/g, "?")}`;
      }
      pos = skipGifSubBlocks(bytes, pos + 2);
      blocks.push({ label, start, end: pos });
      continue;
    }
    if (block === 0x2c) {
      if (pos + 11 > bytes.length) throw new Error("is truncated in an image");
      pos += 10 + gifTableSize(bytes[pos + 9]);
      pos = skipGifSubBlocks(bytes, pos + 1);
      blocks.push({ label: null, start, end: pos });
      continue;
    }
    throw new Error(`has a bad block at byte ${pos}`);
  }
  if (pos !== bytes.length) {
    throw new Error(`has ${bytes.length - pos} bytes after the trailer`);
  }
  return blocks;
}

function scanGif(bytes) {
  return parseGif(bytes)
    .map((block) => block.label)
    .filter((label) => label !== null);
}

function stripGif(bytes) {
  return concat(
    parseGif(bytes)
      .filter((block) => block.label === null)
      .map((block) => bytes.subarray(block.start, block.end)),
  );
}

function parseIco(bytes) {
  if (bytes.length < 6 || u16le(bytes, 0) !== 0) {
    throw new Error("isn't an ICO");
  }
  const count = u16le(bytes, 4);
  const dataStart = 6 + 16 * count;
  if (count === 0) throw new Error("has no images");
  if (dataStart > bytes.length) {
    throw new Error("is truncated in its directory");
  }
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const at = 6 + 16 * i;
    const start = u32le(bytes, at + 12);
    const end = start + u32le(bytes, at + 8);
    if (end > bytes.length) throw new Error("is truncated in an image");
    entries.push({ start, end });
  }
  let pos = dataStart;
  for (const entry of [...entries].sort((a, b) => a.start - b.start)) {
    if (entry.start < pos) throw new Error("has images that overlap");
    if (entry.start > pos) {
      throw new Error(`has ${entry.start - pos} bytes between its images`);
    }
    pos = entry.end;
  }
  if (pos !== bytes.length) {
    throw new Error(`has ${bytes.length - pos} bytes after its images`);
  }
  return entries;
}

// a BITMAPINFOHEADER has no text fields, so an entry of exactly header, palette, pixels, and mask holds no metadata
function checkIcoBmp(bytes) {
  if (bytes.length < 40 || u32le(bytes, 0) !== 40) {
    throw new Error("has a BMP image whose header the check can't read");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const width = view.getInt32(4, true);
  const height = view.getInt32(8, true);
  const bits = view.getUint16(14, true);
  const compression = view.getUint32(16, true);
  const colors = view.getUint32(32, true);
  if (width <= 0 || height <= 0 || height % 2 !== 0 || compression !== 0) {
    throw new Error("has a BMP image the check can't read");
  }
  if (![1, 4, 8, 16, 24, 32].includes(bits)) {
    throw new Error("has a BMP image the check can't read");
  }
  if (bits > 8 ? colors !== 0 : colors > 2 ** bits) {
    throw new Error("has a BMP image whose palette its bit depth can't use");
  }
  const rows = height / 2;
  const palette = bits <= 8 ? colors || 2 ** bits : 0;
  const pixels = Math.floor((width * bits + 31) / 32) * 4 * rows;
  const mask = Math.floor((width + 31) / 32) * 4 * rows;
  const expected = 40 + 4 * palette + pixels + mask;
  if (bytes.length !== expected) {
    throw new Error(
      `has a BMP image of ${bytes.length} bytes where its header explains ${expected}`,
    );
  }
}

// the ICO sniff is four bytes, so a refusal says why the file was read as one
function icoImages(bytes) {
  try {
    return parseIco(bytes).map((entry) => {
      const image = bytes.subarray(entry.start, entry.end);
      if (startsWithBytes(image, pngSignature)) return { png: true, image };
      checkIcoBmp(image);
      return { png: false, image };
    });
  } catch (error) {
    throw new Error(
      `looks like an ICO by its first bytes but ${error.message}`,
      { cause: error },
    );
  }
}

function scanIco(bytes) {
  const found = [];
  for (const { png, image } of icoImages(bytes)) {
    if (!png) continue;
    try {
      found.push(...scanPng(image));
    } catch (error) {
      throw new Error(`has a PNG image that ${error.message}`, {
        cause: error,
      });
    }
  }
  return found;
}

function stripIco(bytes) {
  const images = icoImages(bytes).map(({ png, image }) =>
    png ? stripPng(image) : image,
  );
  const directory = bytes.slice(0, 6 + 16 * images.length);
  const view = new DataView(directory.buffer);
  let offset = directory.length;
  images.forEach((image, i) => {
    view.setUint32(6 + 16 * i + 8, image.length, true);
    view.setUint32(6 + 16 * i + 12, offset, true);
    offset += image.length;
  });
  return concat([directory, ...images]);
}

function isoBoxes(bytes, start, end) {
  const boxes = [];
  let pos = start;
  while (pos < end) {
    if (pos + 8 > end) throw new Error("is truncated in a box");
    let size = u32be(bytes, pos);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) throw new Error("is truncated in a box");
      size = u32be(bytes, pos + 8) * 2 ** 32 + u32be(bytes, pos + 12);
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) {
      throw new Error("is truncated in a box");
    }
    boxes.push({
      type: text(bytes, pos + 4, pos + 8),
      dataStart: pos + header,
      end: pos + size,
    });
    pos += size;
  }
  return boxes;
}

function cString(bytes, start, end) {
  const nul = bytes.subarray(start, end).indexOf(0);
  const stop = nul === -1 ? end : start + nul;
  return { value: text(bytes, start, stop), next: stop + 1 };
}

const isoTopHarmless = new Set(["ftyp", "meta", "mdat", "free", "skip"]);
const isoMetaHarmless = new Set([
  "hdlr",
  "pitm",
  "iloc",
  "iinf",
  "iprp",
  "iref",
  "idat",
  "dinf",
  "grpl",
]);
const isoPropertyHarmless = new Set([
  "ispe",
  "pixi",
  "av1C",
  "hvcC",
  "colr",
  "irot",
  "imir",
  "clap",
  "pasp",
  "auxC",
  "a1op",
  "a1lx",
  "lsel",
  "clli",
  "mdcv",
  "cclv",
  "amve",
  "rloc",
]);
const isoItemHarmless = new Set([
  "av01",
  "hvc1",
  "hev1",
  "grid",
  "iden",
  "iovl",
]);

function isoItemLabel(bytes, infe) {
  const version = bytes[infe.dataStart];
  if (version < 2) return "isobmff:item";
  let pos = infe.dataStart + 4 + (version === 2 ? 2 : 4) + 2;
  const itemType = text(bytes, pos, pos + 4);
  pos += 4;
  if (isoItemHarmless.has(itemType)) return null;
  if (itemType === "Exif") return "exif";
  if (itemType === "mime") {
    const name = cString(bytes, pos, infe.end);
    const contentType = cString(bytes, name.next, infe.end).value;
    if (/rdf\+xml|xmp/i.test(contentType)) return "xmp";
  }
  return `isobmff:item-${itemType.trim()}`;
}

function isoPropertyLabels(bytes, iprp) {
  const found = [];
  for (const child of isoBoxes(bytes, iprp.dataStart, iprp.end)) {
    if (child.type === "ipma") continue;
    if (child.type !== "ipco") {
      found.push(`isobmff:iprp-${child.type.trim()}`);
      continue;
    }
    for (const property of isoBoxes(bytes, child.dataStart, child.end)) {
      if (!isoPropertyHarmless.has(property.type)) {
        found.push(`isobmff:property-${property.type.trim()}`);
      }
    }
  }
  return found;
}

// a data reference that isn't flagged self contained names another file, which can be a local path
function isoReferenceLabels(bytes, dinf) {
  const found = [];
  for (const child of isoBoxes(bytes, dinf.dataStart, dinf.end)) {
    if (child.type !== "dref") {
      found.push(`isobmff:dinf-${child.type.trim()}`);
      continue;
    }
    for (const entry of isoBoxes(bytes, child.dataStart + 8, child.end)) {
      const selfContained =
        entry.type === "url " &&
        entry.end - entry.dataStart === 4 &&
        (bytes[entry.dataStart + 3] & 1) === 1;
      if (!selfContained) found.push("isobmff:data-reference");
    }
  }
  return found;
}

function scanIsoBmff(bytes) {
  const top = isoBoxes(bytes, 0, bytes.length);
  if (top.length === 0 || top[0].type !== "ftyp") {
    throw new Error("isn't an ISO BMFF image");
  }
  const found = [];
  for (const box of top) {
    if (!isoTopHarmless.has(box.type)) {
      found.push(box.type === "uuid" ? "isobmff:uuid" : `isobmff:${box.type}`);
    }
    if (box.type !== "meta") continue;
    for (const child of isoBoxes(bytes, box.dataStart + 4, box.end)) {
      if (!isoMetaHarmless.has(child.type)) {
        found.push(`isobmff:meta-${child.type.trim()}`);
      }
      if (child.type === "iprp") found.push(...isoPropertyLabels(bytes, child));
      if (child.type === "dinf") {
        found.push(...isoReferenceLabels(bytes, child));
      }
      if (child.type !== "iinf") continue;
      const version = bytes[child.dataStart];
      const entriesStart = child.dataStart + 4 + (version === 0 ? 2 : 4);
      for (const infe of isoBoxes(bytes, entriesStart, child.end)) {
        const label =
          infe.type === "infe"
            ? isoItemLabel(bytes, infe)
            : `isobmff:${infe.type}`;
        if (label !== null) found.push(label);
      }
    }
  }
  return found;
}

function gltfImages(json) {
  const images =
    json === null || typeof json !== "object" ? undefined : json.images;
  if (images === undefined) return [];
  if (!Array.isArray(images)) {
    throw new Error("has an images field that isn't a list");
  }
  return images.length > 0 ? ["glb:image"] : [];
}

function scanGlb(bytes) {
  if (bytes.length < 20 || !startsWith(bytes, 0, "glTF")) {
    throw new Error("isn't a GLB");
  }
  if (u32le(bytes, 4) !== 2) throw new Error("isn't a version 2 GLB");
  const length = u32le(bytes, 8);
  if (length > bytes.length) throw new Error("is truncated");
  if (length < bytes.length) {
    throw new Error(`has ${bytes.length - length} bytes after the GLB`);
  }
  const chunks = [];
  let pos = 12;
  while (pos < length) {
    if (pos + 8 > length) throw new Error("is truncated in a chunk");
    const size = u32le(bytes, pos);
    const end = pos + 8 + size;
    if (end > length) throw new Error("is truncated in a chunk");
    chunks.push({ type: u32le(bytes, pos + 4), dataStart: pos + 8, end });
    pos = end;
  }
  if (chunks.length === 0 || chunks[0].type !== 0x4e4f534a) {
    throw new Error("doesn't start with a JSON chunk");
  }
  const json = JSON.parse(
    new TextDecoder().decode(
      bytes.subarray(chunks[0].dataStart, chunks[0].end),
    ),
  );
  return gltfImages(json);
}

function scanGltf(bytes) {
  return gltfImages(JSON.parse(new TextDecoder().decode(bytes)));
}

// the start of an href or src value, a CSS url(), or an @import string
const svgReference =
  /(?:(?:^|[\s:])(?:href|src)\s*=\s*["']|url\((?:\s*["'])?|@import\s+["'])\s*/
    .source;

const svgRules = [
  ["svg:data-image", /data:image/i],
  // the header stops at a colon, so a run of "data:x" can't make each match rescan the rest of the file
  ["svg:data-uri", /data:[^"'()\s:,]*;base64/i],
  ["svg:metadata", /<([\w-]+:)?metadata[\s>/]/i],
  ["svg:xmp", /<\?xpacket|xmpmeta|<rdf:RDF/i],
  ["svg:docname", /sodipodi:docname/i],
  ["svg:absref", /sodipodi:absref/i],
  ["svg:export-filename", /inkscape:export-filename/i],
  ["svg:entity", /<!ENTITY/i],
  ["svg:file-link", new RegExp(`${svgReference}file:`, "i")],
  [
    "svg:local-path",
    new RegExp(`${svgReference}(?:/(?!/)|~[\\\\/]|[a-z]:[\\\\/]|\\\\)`, "i"),
  ],
  [
    "svg:path-string",
    /(?:^|[=\s(:,])["']\s*(?:\/(?![/>])|~[\\/]|[a-z]:[\\/]|\\\\|file:)/i,
  ],
];

const xmlNamedRefs = {
  quot: '"',
  apos: "'",
  amp: "&",
  lt: "<",
  gt: ">",
  colon: ":",
  sol: "/",
  plus: "+",
  equals: "=",
  tab: "\t",
  newline: "\n",
};

// a character reference such as &#x2F; is decoded by the browser, so the rules see it decoded
function decodeXmlRefs(source) {
  return source.replace(
    /&#x([0-9a-f]+);|&#(\d+);|&(quot|apos|amp|lt|gt|colon|sol|plus|equals|tab|newline);/gi,
    (whole, hex, decimal, named) => {
      if (named !== undefined) return xmlNamedRefs[named.toLowerCase()];
      const code = hex !== undefined ? parseInt(hex, 16) : Number(decimal);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    },
  );
}

function svgText(bytes) {
  return new TextDecoder(textEncoding(bytes)).decode(bytes);
}

function scanSvg(bytes) {
  const source = svgText(bytes);
  if (source.includes("\0")) {
    throw new Error(
      "holds a NUL, which XML can't, so it's in an encoding the check doesn't read",
    );
  }
  const decoded = decodeXmlRefs(source);
  return svgRules
    .filter(([, rule]) => rule.test(decoded))
    .map(([label]) => label);
}

function scanSvgz(bytes) {
  return scanSvg(unpackSvgz(bytes));
}

const scanners = {
  jpeg: scanJpeg,
  png: scanPng,
  webp: scanWebp,
  gif: scanGif,
  avif: scanIsoBmff,
  heif: scanIsoBmff,
  glb: scanGlb,
  gltf: scanGltf,
  svg: scanSvg,
  svgz: scanSvgz,
  ico: scanIco,
};

const strippers = {
  jpeg: stripJpeg,
  png: stripPng,
  webp: stripWebp,
  gif: stripGif,
  ico: stripIco,
};

// a browser undoes these before it reads a URL, and they nest (JS that writes HTML, HTML that holds CSS), so the inline check reads every order of them up to three deep
const inlineDecodeDepth = 3;
const encodedMinimum = 12;
const markupSkipLimit = 1024;

const htmlNamedRefs = {
  tab: "\t",
  newline: "\n",
  excl: "!",
  quot: '"',
  num: "#",
  dollar: "$",
  percnt: "%",
  amp: "&",
  apos: "'",
  lpar: "(",
  rpar: ")",
  ast: "*",
  midast: "*",
  plus: "+",
  comma: ",",
  period: ".",
  sol: "/",
  colon: ":",
  semi: ";",
  lt: "<",
  equals: "=",
  gt: ">",
  quest: "?",
  commat: "@",
  lsqb: "[",
  lbrack: "[",
  bsol: "\\",
  rsqb: "]",
  rbrack: "]",
  hat: "^",
  lowbar: "_",
  underbar: "_",
  grave: "`",
  diacriticalgrave: "`",
  lcub: "{",
  lbrace: "{",
  verbar: "|",
  vert: "|",
  verticalline: "|",
  rcub: "}",
  rbrace: "}",
  fjlig: "fj",
};

function codePoint(code) {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : "\ufffd";
}

function decodeHtml(source) {
  return source.replace(
    /&#x([0-9a-f]+);?|&#(\d+);?|&([a-z]+);?/gi,
    (whole, hex, decimal, name) => {
      if (name !== undefined) {
        const key = name.toLowerCase();
        return Object.hasOwn(htmlNamedRefs, key) ? htmlNamedRefs[key] : whole;
      }
      return codePoint(hex !== undefined ? parseInt(hex, 16) : Number(decimal));
    },
  );
}

const jsEscapes = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };

function decodeJs(source) {
  return source.replace(
    /\\(?:u\{([0-9a-f]+)\}|u([0-9a-f]{4})|x([0-9a-f]{2})|([0-3][0-7]{0,2}|[4-7][0-7]?)|(\r\n|[\n\r\u2028\u2029])|([^]))/gi,
    (whole, braced, unicode, hex, octal, line, other) => {
      if (braced !== undefined) return codePoint(parseInt(braced, 16));
      if (unicode !== undefined) {
        return String.fromCharCode(parseInt(unicode, 16));
      }
      if (hex !== undefined) return String.fromCharCode(parseInt(hex, 16));
      if (octal !== undefined) return String.fromCharCode(parseInt(octal, 8));
      if (line !== undefined) return "";
      return Object.hasOwn(jsEscapes, other) ? jsEscapes[other] : other;
    },
  );
}

function decodeCss(source) {
  return source.replace(
    /\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\n\r\f])?|(\r\n|[\n\r\f])|([^]))/gi,
    (whole, hex, line, other) => {
      if (hex !== undefined) return codePoint(parseInt(hex, 16));
      if (line !== undefined) return "";
      return other;
    },
  );
}

function decodePercent(source) {
  return source.replace(/%([0-9a-f]{2})/gi, (whole, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

const inlineDecoders = [decodeHtml, decodeJs, decodeCss, decodePercent];

function charTable(chars) {
  const table = new Uint8Array(128);
  for (const char of chars) table[char.charCodeAt(0)] = 1;
  return table;
}

function inTable(table, code) {
  return code < 128 && table[code] === 1;
}

// the type and subtype of a data: header, as the MIME parser reads them
const dataHeaderType =
  /[ \f]*([!#$%&*+.^_|~0-9a-z-]+)[ \f]*\/[ \f]*([!#$%&*+.^_|~0-9a-z-]+)[ \f]*/iy;
const headerStops = charTable("\"'`()\t\n\r:");

function sortedPositions(source, char) {
  const found = [];
  for (
    let at = source.indexOf(char);
    at !== -1;
    at = source.indexOf(char, at + 1)
  ) {
    found.push(at);
  }
  return found;
}

// the first position in a sorted list at or after the given one, or -1
function nextPosition(positions, at) {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (positions[middle] < at) low = middle + 1;
    else high = middle;
  }
  return low < positions.length ? positions[low] : -1;
}

// the image or SVG type of the data: header at this point when its comma follows, with only header characters between
function imageHeaderAt(source, at, positions) {
  dataHeaderType.lastIndex = at;
  const type = dataHeaderType.exec(source);
  if (type === null) return null;
  const essence = `${type[1]}/${type[2]}`.toLowerCase();
  if (type[1].toLowerCase() !== "image" && !essence.includes("svg")) {
    return null;
  }
  let pos = dataHeaderType.lastIndex;
  if (source[pos] === ",") return essence;
  if (source[pos] !== ";") return null;
  let previous = ";";
  while (pos < source.length) {
    const char = source[pos];
    if (char === ",") return essence;
    if ((char === '"' || char === "'") && previous === "=") {
      // a comma inside a quoted parameter still ends the header for a browser
      const close = nextPosition(positions.get(char), pos + 1);
      const comma = nextPosition(positions.get(","), pos + 1);
      if (comma !== -1 && (close === -1 || comma < close)) return essence;
      if (close === -1) return null;
      pos = close + 1;
      previous = char;
      continue;
    }
    if (inTable(headerStops, char.charCodeAt(0))) return null;
    if (char !== " " && char !== "\f") previous = char;
    pos += 1;
  }
  return null;
}

// tabs and newlines are dropped the way the URL parser drops them, and each break is kept so a scheme on a new line still counts
function withoutBreaks(source) {
  const parts = [];
  const breaks = [];
  let from = 0;
  let length = 0;
  for (const match of source.matchAll(/[\t\n\r]+/g)) {
    parts.push(source.slice(from, match.index));
    length += match.index - from;
    breaks.push(length);
    from = match.index + match[0].length;
  }
  parts.push(source.slice(from));
  return { flat: parts.join(""), breaks };
}

// a scheme can't start after a scheme character, so "metadata:" isn't one, but one after a newline or tab is
const schemeChars = charTable(
  "+.-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
);

function imageHeaderIn(source) {
  const { flat, breaks } = withoutBreaks(source);
  let positions = null;
  for (const match of flat.matchAll(/data:/gi)) {
    const at = match.index;
    if (
      at > 0 &&
      nextPosition(breaks, at) !== at &&
      inTable(schemeChars, flat.charCodeAt(at - 1))
    ) {
      continue;
    }
    if (positions === null) {
      positions = new Map(
        ['"', "'", ","].map((char) => [char, sortedPositions(flat, char)]),
      );
    }
    const essence = imageHeaderAt(flat, at + match[0].length, positions);
    if (essence !== null) return `a data: URI of type ${essence}`;
  }
  return null;
}

const base64Values = new Int8Array(128).fill(-1);
for (const [i, char] of [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
].entries()) {
  base64Values[char.charCodeAt(0)] = i;
}
base64Values["-".charCodeAt(0)] = 62;
base64Values["_".charCodeAt(0)] = 63;

function hexAt(source, at) {
  const pair = source.slice(at, at + 2);
  return /^[0-9a-f]{2}$/i.test(pair) ? parseInt(pair, 16) : -1;
}

function isAsciiSpace(code) {
  return (
    code === 0x20 ||
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0c ||
    code === 0x0d
  );
}

// the first bytes of every image the check knows, plus the BOM and whitespace that can come before SVG markup
const imageFirstBytes = new Set([
  0xff, 0x89, 0x47, 0x52, 0x67, 0x49, 0x4d, 0x42, 0x38, 0x46, 0x00, 0x1a, 0x3c,
  0x09, 0x0a, 0x0c, 0x0d, 0x20, 0xef, 0xfe,
]);
const markupSpaceBytes = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);

// decoded bytes with, for each position, the end of the readable bytes and the next byte that isn't whitespace or NUL, so every start reads its first bytes without decoding again
function byteStream(bytes, readable) {
  const end = new Int32Array(bytes.length + 1);
  const mark = new Int32Array(bytes.length + 1);
  end[bytes.length] = bytes.length;
  mark[bytes.length] = bytes.length;
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    end[i] = readable === null || readable[i] === 1 ? end[i + 1] : i;
    mark[i] = markupSpaceBytes.has(bytes[i]) ? mark[i + 1] : i;
  }
  return { bytes, end, mark };
}

function markupAt(stream, at, end) {
  const { bytes } = stream;
  let from = at;
  if (startsWithBytes(bytes.subarray(at, end), [0xef, 0xbb, 0xbf])) from += 3;
  else if (
    startsWithBytes(bytes.subarray(at, end), [0xff, 0xfe]) ||
    startsWithBytes(bytes.subarray(at, end), [0xfe, 0xff])
  ) {
    from += 2;
  }
  const first = stream.mark[Math.min(from, bytes.length)];
  if (first >= end || first - from > markupSkipLimit) return false;
  const text = latin1
    .decode(bytes.subarray(first, Math.min(end, first + 64)))
    .replaceAll("\0", "");
  return /^(?:<\?xml|<!--|<!doctype|<(?:[\w.-]+:)?svg[\s>/])/i.test(text);
}

// the ICO magic is four bytes, which runs of A in base64 tables decode to, so a run is only an ICO when its directory holds together
function icoDirectoryHolds(bytes) {
  const count = u16le(bytes, 4);
  if (count > 256) return true;
  const dataStart = 6 + 16 * count;
  if (bytes.length < dataStart) return false;
  let first = Infinity;
  for (let i = 0; i < count; i += 1) {
    const at = 6 + 16 * i;
    if (bytes[at + 3] !== 0) return false;
    first = Math.min(first, u32le(bytes, at + 12));
  }
  return first === dataStart;
}

// what the bytes from this start hold, or null. a browser doesn't unpack gzip in a URL, and a bare JPEG XL codestream's two byte magic turns up in ordinary paths
function encodedStart(stream, at) {
  const end = stream.end[at];
  if (end - at < encodedMinimum) return null;
  const readable = stream.bytes.subarray(at, end);
  if (!imageFirstBytes.has(readable[0])) return null;
  const head = readable.subarray(0, 32);
  if (startsWithBytes(head, [0xff, 0x0a])) return null;
  let type;
  try {
    type = sniff(head, "");
  } catch {
    return "an image the check can't read";
  }
  if (type === "ico") {
    return icoDirectoryHolds(readable) ? typeName(type) : null;
  }
  if (type !== null) return typeName(type);
  return markupAt(stream, at, end) ? "SVG markup" : null;
}

const base64Stop = -1;

// a run's base64 values with whitespace and escaped whitespace dropped, and the value index of each start: the run start, and the first value after each gap, "=", or other stop
function base64RunValues(run) {
  const values = new Int8Array(run.length);
  const starts = [];
  let count = 0;
  let gap = true;
  for (let i = 0; i < run.length; i += 1) {
    let code = run.charCodeAt(i);
    if (code === 0x25) {
      code = hexAt(run, i + 1);
      i += 2;
    }
    if (isAsciiSpace(code)) {
      gap = true;
      continue;
    }
    const value = code >= 0 && code < 128 ? base64Values[code] : -1;
    if (value === -1) {
      values[count] = base64Stop;
      count += 1;
      gap = true;
      continue;
    }
    if (gap) starts.push(count);
    values[count] = value;
    count += 1;
    gap = false;
  }
  return { values: values.subarray(0, count), starts };
}

// the bytes of every start in one alignment, three slots per group of four values, with the slots after a stop unreadable
function base64Stream(values, offset) {
  const groups = Math.max(0, Math.ceil((values.length - offset) / 4));
  const bytes = new Uint8Array(groups * 3);
  const readable = new Uint8Array(groups * 3);
  for (let g = 0; g < groups; g += 1) {
    const quad = [0, 0, 0, 0];
    let filled = 0;
    while (filled < 4) {
      const at = offset + 4 * g + filled;
      if (at >= values.length || values[at] === base64Stop) break;
      quad[filled] = values[at];
      filled += 1;
    }
    const bits = (quad[0] << 18) | (quad[1] << 12) | (quad[2] << 6) | quad[3];
    bytes[3 * g] = (bits >> 16) & 0xff;
    bytes[3 * g + 1] = (bits >> 8) & 0xff;
    bytes[3 * g + 2] = bits & 0xff;
    const valid = filled === 4 ? 3 : Math.max(0, filled - 1);
    for (let i = 0; i < valid; i += 1) readable[3 * g + i] = 1;
  }
  return byteStream(bytes, readable);
}

function base64ImageIn(run) {
  const { values, starts } = base64RunValues(run);
  const streams = [null, null, null, null];
  for (const start of starts) {
    if (start + 1 >= values.length || values[start + 1] === base64Stop)
      continue;
    const first = (values[start] << 2) | (values[start + 1] >> 4);
    if (!imageFirstBytes.has(first)) continue;
    const offset = start % 4;
    streams[offset] ??= base64Stream(values, offset);
    const found = encodedStart(streams[offset], ((start - offset) / 4) * 3);
    if (found !== null) return found;
  }
  return null;
}

function pushUtf8(out, code) {
  if (code < 0x80) out.push(code);
  else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
  else if (code < 0x10000) {
    out.push(
      0xe0 | (code >> 12),
      0x80 | ((code >> 6) & 0x3f),
      0x80 | (code & 0x3f),
    );
  } else {
    out.push(
      0xf0 | (code >> 18),
      0x80 | ((code >> 12) & 0x3f),
      0x80 | ((code >> 6) & 0x3f),
      0x80 | (code & 0x3f),
    );
  }
}

// the whole text as a URL payload reads it (escapes undone, tabs and newlines dropped, other text as UTF-8), with the byte offset of each start
function percentStream(source, starts) {
  const out = [];
  const offsets = [];
  let next = 0;
  for (let pos = 0; pos < source.length;) {
    while (next < starts.length && starts[next] === pos) {
      offsets.push(out.length);
      next += 1;
    }
    const code = source.codePointAt(pos);
    if (code === 0x25) {
      const value = hexAt(source, pos + 1);
      if (value !== -1) {
        out.push(value);
        pos += 3;
        continue;
      }
    }
    pos += code > 0xffff ? 2 : 1;
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    pushUtf8(out, code);
  }
  return { stream: byteStream(Uint8Array.from(out), null), offsets };
}

const base64Runs =
  /(?:[A-Za-z0-9+/_-]|%[0-9a-f]{2})(?:[A-Za-z0-9+/=_\s-]|%[0-9a-f]{2})*/gi;
// a payload starts after its comma, a quote, or a paren, so a run starts after one of these. a run needs an escape of its own, so raw <svg> markup next to an escaped URL isn't one
const percentRuns = /[^\s"'`,()=:;>[\]{}+]+/g;

function percentFirstByte(source, at) {
  const code = source.codePointAt(at);
  if (code === 0x25) {
    const value = hexAt(source, at + 1);
    if (value !== -1) return value;
  }
  const first = [];
  pushUtf8(first, code);
  return first[0];
}

function encodedImageIn(source) {
  for (const match of source.matchAll(base64Runs)) {
    // twelve bytes take sixteen base64 characters, so a shorter run can't hold an image's start
    if (match[0].length < 16) continue;
    const found = base64ImageIn(match[0]);
    if (found !== null) return `base64 that decodes to ${found}`;
  }
  const starts = [];
  for (const match of source.matchAll(percentRuns)) {
    if (!/%[0-9a-f]{2}/i.test(match[0])) continue;
    if (!imageFirstBytes.has(percentFirstByte(source, match.index))) continue;
    starts.push(match.index);
  }
  if (starts.length === 0) return null;
  const { stream, offsets } = percentStream(source, starts);
  for (const offset of offsets) {
    const found = encodedStart(stream, offset);
    if (found !== null) return `percent escapes that decode to ${found}`;
  }
  return null;
}

function inlineImageIn(source) {
  return imageHeaderIn(source) ?? encodedImageIn(source);
}

// the text a browser would read from a file, with an SVGZ or a gzipped text file unpacked and UTF-16 decoded
function inlineText(bytes, type) {
  let view = plainView(bytes);
  if (type === "svgz") view = unpackSvgz(view);
  else if (type === null && startsWithBytes(view, [0x1f, 0x8b, 0x08])) {
    view = gunzip(view);
  }
  return new TextDecoder(textEncoding(view)).decode(view).replaceAll("\0", "");
}

// every reading of the text, depth first, until visit finds something. a reading is kept with the shallowest depth it was reached at, since one reached deeper first has fewer layers left to undo
export function walkReadings(
  source,
  visit,
  decoders = inlineDecoders,
  depthLimit = inlineDecodeDepth,
) {
  const seen = new Map();
  const walk = (text, depth) => {
    const found = visit(text, depth);
    if (found !== null) return found;
    if (depth === depthLimit) return null;
    for (const decode of decoders) {
      const next = decode(text);
      if (next === text) continue;
      const key = createHash("sha256").update(next, "utf16le").digest("hex");
      if (seen.has(key) && seen.get(key) <= depth + 1) continue;
      seen.set(key, depth + 1);
      const result = walk(next, depth + 1);
      if (result !== null) return result;
    }
    return null;
  };
  return walk(source, 0);
}

// markup and component files, where an editor's SVG export gets pasted. code and prose files only mention <svg> in comments and strings
const markupExtensions = new Set([
  "astro",
  "html",
  "htm",
  "xhtml",
  "jsx",
  "tsx",
  "md",
  "mdx",
  "svelte",
  "vue",
]);

const inlineSvgTag = /<(\/)?(?:[\w.-]+:)?svg(?=[\s>/])/gi;

function isTagSpace(char) {
  return (
    char === " " ||
    char === "\t" ||
    char === "\n" ||
    char === "\r" ||
    char === "\f"
  );
}

// where the tag whose name ends at from ends. a quoted value or a {...} expression is skipped, since a ">" inside one
// doesn't end the tag. a "<" outside them ends a tag left open, and so does the end of the file. one pass, so an
// unclosed quote or brace costs one read to the end and no more
function tagEnd(source, from) {
  let quote = null;
  let depth = 0;
  let last = "";
  for (let at = from; at < source.length; at += 1) {
    const char = source[at];
    if (quote !== null) {
      if (char === "\\" && depth > 0) at += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || (char === "`" && depth > 0)) {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      if (depth > 0) depth -= 1;
    } else if (depth > 0) {
      continue;
    } else if (char === ">") {
      return { end: at + 1, selfClosing: last === "/" };
    } else if (char === "<") {
      return { end: at, selfClosing: false };
    } else if (!isTagSpace(char)) {
      last = char;
    }
  }
  return { end: source.length, selfClosing: false };
}

// each top level <svg> element in a text file as [start, end, closed], up to its matching </svg>, or to the end of the
// file when it isn't closed
function inlineSvgSpans(source) {
  const spans = [];
  const tags = new RegExp(inlineSvgTag.source, "gi");
  let depth = 0;
  let start = 0;
  let match;
  while ((match = tags.exec(source)) !== null) {
    const tag = tagEnd(source, tags.lastIndex);
    tags.lastIndex = Math.max(tag.end, tags.lastIndex);
    if (match[1] === undefined) {
      if (tag.selfClosing) {
        if (depth === 0) spans.push([match.index, tag.end, true]);
        continue;
      }
      if (depth === 0) start = match.index;
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) spans.push([start, tag.end, true]);
    }
  }
  if (depth > 0) spans.push([start, source.length, false]);
  return spans;
}

// a site path such as /about or /icons.svg#arrow is normal in a page's own markup, so there the path rules refuse
// only a path shaped like one on a machine: a drive letter, file:, ~/, a backslash, or a root folder that holds files
const machineRoot =
  "/(?:home|Users|root|mnt|media|Volumes|tmp|var|private|opt)/";
const machinePath = `(?:~[\\\\/]|[a-z]:[\\\\/]|\\\\|${machineRoot})`;
const pathLabels = new Set(["svg:local-path", "svg:path-string"]);
const inlineSvgRules = svgRules.map(([label, rule]) => {
  if (label === "svg:local-path") {
    return [label, new RegExp(`${svgReference}${machinePath}`, "i")];
  }
  if (label === "svg:path-string") {
    return [
      label,
      new RegExp(`(?:^|[=\\s(:,{])["'\`]\\s*(?:${machinePath}|file:)`, "i"),
    ];
  }
  return [label, rule];
});

// what inline image the file holds, and the SVG rules its inline <svg> markup breaks. a refusal only has to detect an image, so no payload is decoded past the first bytes a sniff needs
export function inlineFindings(bytes, type, name) {
  const source = inlineText(bytes, type);
  const image = walkReadings(source, (text, depth) => {
    const found = inlineImageIn(text);
    if (found === null || depth === 0) return found;
    return `${found}, after undoing escapes`;
  });
  const labels = new Set();
  if (type === null && markupExtensions.has(extensionOf(name))) {
    for (const [start, end, closed] of inlineSvgSpans(source)) {
      const decoded = decodeXmlRefs(source.slice(start, end));
      for (const [label, rule] of inlineSvgRules) {
        // an unclosed <svg> is most often one named in prose or a comment, and runs on over the rest of the file
        if (!closed && pathLabels.has(label)) continue;
        if (rule.test(decoded)) labels.add(label);
      }
    }
  }
  return { image, svgLabels: [...labels] };
}

// a plain Uint8Array view, since Buffer.slice shares memory and would let a strip edit its input
function plainView(bytes) {
  if (bytes instanceof Uint8Array) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  }
  return new Uint8Array(bytes);
}

function run(table, bytes, name, missing) {
  const view = plainView(bytes);
  const type = imageType(view, name);
  if (type === null) throw new Error(`${name} isn't an image the check knows`);
  if (!Object.hasOwn(table, type)) {
    throw new Error(`${name} is ${typeName(type)}, ${missing}`);
  }
  try {
    return table[type](view);
  } catch (error) {
    throw new Error(`${name} ${error.message}`, { cause: error });
  }
}

export function scanMetadata(bytes, name) {
  return [...new Set(run(scanners, bytes, name, "which the check can't scan"))];
}

export function stripMetadata(bytes, name) {
  return run(strippers, bytes, name, "which the strip doesn't handle");
}

// the tools that write an image strip it and then scan the result, so a strip that missed a piece stops the write
export function stripAndVerify(bytes, name) {
  const clean = stripMetadata(bytes, name);
  const found = scanMetadata(clean, name);
  if (found.length > 0) {
    throw new Error(
      `${name} still carries ${found.join(", ")} after the strip`,
    );
  }
  return clean;
}
