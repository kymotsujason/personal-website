import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "./privacy/allowlist.mjs";
import { scanMetadata } from "./privacy/metadata.mjs";
import { makeThumbs } from "./make-thumbs.mjs";

function jpegSegment(marker, payload) {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

// a 1x1 jpeg carrying exif, which the strip has to take out
const exifJpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  jpegSegment(0xe1, Buffer.from("Exif\0\0MM\0*\0\0\0\x08\0\0", "latin1")),
  jpegSegment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
  jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
  Buffer.from([0x12, 0x34, 0xff, 0xd9]),
]);

function makeSite(t, slugs) {
  const site = mkdtempSync(join(tmpdir(), "make-thumbs-"));
  t.after(() => rmSync(site, { recursive: true, force: true }));
  const posts = join(site, "apps/web/src/content/blog");
  mkdirSync(posts, { recursive: true });
  for (const slug of slugs) {
    writeFileSync(
      join(posts, `${slug}.md`),
      `---\ntitle: "${slug}"\nslug: "${slug}"\nfeature_image: "/blog/${slug}.jpg"\n---\n\nhi\n`,
    );
  }
  writeFileSync(join(site, "privacy-allowlist.json"), "{}\n");
  return site;
}

const thumbPath = (site, slug) =>
  join(site, "apps/web/public/blog/thumbs", `${slug}.jpg`);
const allowlistOf = (site) =>
  JSON.parse(readFileSync(join(site, "privacy-allowlist.json"), "utf8"));

test("every thumb is stripped, on the allowlist, and named in its post", (t) => {
  const site = makeSite(t, ["a", "b"]);
  assert.equal(makeThumbs({ site, encode: () => exifJpeg }), 2);
  const allowlist = allowlistOf(site);
  for (const slug of ["a", "b"]) {
    const bytes = readFileSync(thumbPath(site, slug));
    assert.deepEqual(scanMetadata(bytes, `${slug}.jpg`), []);
    assert.equal(
      allowlist[`apps/web/public/blog/thumbs/${slug}.jpg`],
      sha256(bytes),
    );
    const post = readFileSync(
      join(site, "apps/web/src/content/blog", `${slug}.md`),
      "utf8",
    );
    assert.match(
      post,
      new RegExp(`^thumb: "/blog/thumbs/${slug}\\.jpg"$`, "m"),
    );
  }
});

test("a failure on a later post leaves no written thumb off the allowlist", (t) => {
  const site = makeSite(t, ["a", "b"]);
  const encode = (source) => {
    if (source.endsWith("b.jpg")) {
      throw new Error("vips failed on b");
    }
    return exifJpeg;
  };
  assert.throws(() => makeThumbs({ site, encode }), /vips failed on b/);
  const allowlist = allowlistOf(site);
  for (const slug of ["a", "b"]) {
    const file = thumbPath(site, slug);
    if (existsSync(file)) {
      assert.equal(
        allowlist[`apps/web/public/blog/thumbs/${slug}.jpg`],
        sha256(readFileSync(file)),
        `${slug}.jpg was written but isn't on the allowlist`,
      );
    }
  }
});
