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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "./privacy/allowlist.mjs";
import { scanMetadata } from "./privacy/metadata.mjs";
import { makeProjectMedia } from "./make-project-media.mjs";

function chunk(id, payload) {
  const header = Buffer.alloc(8);
  header.write(id, 0, "latin1");
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([
    header,
    payload,
    payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0),
  ]);
}

// a small webp carrying exif, which the strip has to take out, padded to the size a test needs
function exifWebp(pad = 10) {
  const flags = Buffer.alloc(10);
  flags[0] = 0x08;
  const body = Buffer.concat([
    Buffer.from("WEBP"),
    chunk("VP8X", flags),
    chunk(
      "VP8L",
      Buffer.concat([Buffer.from([0x2f, 0, 0, 0, 0]), Buffer.alloc(pad)]),
    ),
    chunk("EXIF", Buffer.from("MM\0*\0\0\0\x08\0\0", "latin1")),
  ]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

const svgBytes = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>',
);

function makeSite(t, files) {
  const site = mkdtempSync(join(tmpdir(), "make-project-media-"));
  t.after(() => rmSync(site, { recursive: true, force: true }));
  const media = join(site, ".media/demo");
  mkdirSync(media, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(media, name), bytes);
  }
  writeFileSync(join(site, "privacy-allowlist.json"), "{}\n");
  return site;
}

const outDir = (site) => join(site, "apps/web/public/projects/demo");
const outputs = (site) =>
  existsSync(outDir(site)) ? readdirSync(outDir(site)).sort() : [];
const allowlistOf = (site) =>
  JSON.parse(readFileSync(join(site, "privacy-allowlist.json"), "utf8"));

const fakeEncode = (job) => {
  return exifWebp();
};

test("each input makes its output and nothing else", (t) => {
  const site = makeSite(t, {
    "hero.png": "p",
    "hero-loop.mp4": "v",
    "thumb.jpg": "t",
    "fig-first.png": "f",
    "fig-second-2.webp": "w",
    "fig-diagram.svg": svgBytes,
    "notes.txt": "ignored",
  });
  const written = makeProjectMedia({ site, slug: "demo", encode: fakeEncode });
  const expected = [
    "fig-diagram.svg",
    "fig-first.webp",
    "fig-second-2.webp",
    "hero-loop.webp",
    "hero.webp",
    "thumb.webp",
  ];
  assert.deepEqual(outputs(site), expected);
  assert.deepEqual(
    written,
    expected.map((name) => `apps/web/public/projects/demo/${name}`),
  );
  assert.deepEqual(
    readFileSync(join(outDir(site), "fig-diagram.svg")),
    svgBytes,
  );
});

test("the thumb comes from the hero when there is no thumb file", (t) => {
  const site = makeSite(t, { "hero.webp": "p" });
  const sources = [];
  makeProjectMedia({
    site,
    slug: "demo",
    encode: (job) => {
      sources.push([job.kind, job.source.split("/").pop()]);
      return exifWebp();
    },
  });
  assert.deepEqual(sources, [
    ["still", "hero.webp"],
    ["thumb", "hero.webp"],
  ]);
  assert.deepEqual(outputs(site), ["hero.webp", "thumb.webp"]);
});

test("a loop with no still gets a still from its first frame", (t) => {
  const site = makeSite(t, { "hero-loop.gif": "g" });
  const jobs = [];
  makeProjectMedia({
    site,
    slug: "demo",
    encode: (job) => {
      jobs.push(job.kind);
      if (job.kind === "thumb") {
        assert.equal(readFileSync(job.source).length > 0, true);
      }
      return exifWebp();
    },
  });
  assert.deepEqual(jobs, ["loop", "frame", "thumb"]);
  assert.deepEqual(outputs(site), [
    "hero-loop.webp",
    "hero.webp",
    "thumb.webp",
  ]);
});

test("every written image is stripped and on the allowlist", (t) => {
  const site = makeSite(t, {
    "hero.png": "p",
    "hero-loop.webp": "l",
    "fig-a.png": "f",
    "fig-b.svg": svgBytes,
  });
  makeProjectMedia({ site, slug: "demo", encode: fakeEncode });
  const allowlist = allowlistOf(site);
  assert.equal(Object.keys(allowlist).length, 5);
  for (const name of outputs(site)) {
    const bytes = readFileSync(join(outDir(site), name));
    assert.deepEqual(scanMetadata(bytes, name), []);
    assert.equal(
      allowlist[`apps/web/public/projects/demo/${name}`],
      sha256(bytes),
    );
  }
  const keys = Object.keys(allowlist);
  assert.deepEqual(
    keys,
    [...keys].sort((a, b) => a.localeCompare(b)),
  );
});

test("an svg that carries metadata is refused", (t) => {
  const dirty = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><metadata>who</metadata></svg>',
  );
  const site = makeSite(t, { "hero.png": "p", "fig-a.svg": dirty });
  assert.throws(
    () => makeProjectMedia({ site, slug: "demo", encode: fakeEncode }),
    /fig-a\.svg/,
  );
  assert.deepEqual(outputs(site), []);
  assert.deepEqual(allowlistOf(site), {});
});

test("a loop over 3,200,000 bytes is refused and nothing is written", (t) => {
  const site = makeSite(t, { "hero.png": "p", "hero-loop.mp4": "v" });
  const encode = (job) => exifWebp(job.kind === "loop" ? 3_200_000 : 10);
  assert.throws(
    () => makeProjectMedia({ site, slug: "demo", encode }),
    /hero-loop\.webp.*3200000/,
  );
  assert.deepEqual(outputs(site), []);
  assert.deepEqual(allowlistOf(site), {});
});

test("a name outside lowercase letters, digits, and hyphens is refused", (t) => {
  for (const name of [
    "fig-Bad.png",
    "fig-two_words.png",
    "fig-.png",
    "fig-a b.png",
  ]) {
    const site = makeSite(t, { "hero.png": "p", [name]: "f" });
    assert.throws(
      () => makeProjectMedia({ site, slug: "demo", encode: fakeEncode }),
      /lowercase letters, digits, and hyphens/,
      name,
    );
    assert.deepEqual(outputs(site), [], name);
    assert.deepEqual(allowlistOf(site), {}, name);
  }
});

test("nothing is written and the allowlist is untouched when one input fails", (t) => {
  const site = makeSite(t, {
    "hero.png": "p",
    "fig-a.png": "a",
    "fig-b.png": "b",
  });
  const encode = (job) => {
    if (job.source.endsWith("fig-b.png")) {
      throw new Error("vips failed on fig-b");
    }
    return exifWebp();
  };
  assert.throws(
    () => makeProjectMedia({ site, slug: "demo", encode }),
    /vips failed on fig-b/,
  );
  assert.deepEqual(outputs(site), []);
  assert.deepEqual(allowlistOf(site), {});
});

test("a folder with no hero and no loop is refused", (t) => {
  const site = makeSite(t, { "fig-a.png": "a" });
  assert.throws(
    () => makeProjectMedia({ site, slug: "demo", encode: fakeEncode }),
    /hero/,
  );
  assert.deepEqual(outputs(site), []);
});

test("the allowlist is written before any image", (t) => {
  const site = makeSite(t, { "hero.png": "p", "fig-a.svg": svgBytes });
  const seen = [];
  makeProjectMedia({
    site,
    slug: "demo",
    encode: fakeEncode,
    onWrite: (path) => {
      seen.push([path, Object.keys(allowlistOf(site)).length]);
    },
  });
  assert.equal(seen.length, 3);
  for (const [, listed] of seen) {
    assert.equal(listed, 3);
  }
});

test("a .jpeg hero, thumb, and figure are each used", (t) => {
  const site = makeSite(t, {
    "hero.jpeg": "p",
    "thumb.jpeg": "t",
    "fig-demo.jpeg": "f",
  });
  const sources = [];
  makeProjectMedia({
    site,
    slug: "demo",
    encode: (job) => {
      sources.push([job.kind, job.source.split("/").pop()]);
      return exifWebp();
    },
  });
  assert.deepEqual(sources, [
    ["still", "hero.jpeg"],
    ["thumb", "thumb.jpeg"],
    ["still", "fig-demo.jpeg"],
  ]);
  assert.deepEqual(outputs(site), ["fig-demo.webp", "hero.webp", "thumb.webp"]);
});

test("an input in a format the tool doesn't handle is refused by name", (t) => {
  for (const name of [
    "fig-demo.gif",
    "fig-demo.heic",
    "hero.gif",
    "hero-loop.png",
    "thumb.gif",
    "thumb",
    "HERO.png",
    "Fig-demo.png",
  ]) {
    const site = makeSite(t, { "hero.png": "p", [name]: "x" });
    assert.throws(
      () => makeProjectMedia({ site, slug: "demo", encode: fakeEncode }),
      (error) => error.message.includes(name),
      name,
    );
    assert.deepEqual(outputs(site), [], name);
    assert.deepEqual(allowlistOf(site), {}, name);
  }
});

test("two inputs that make the same output are refused by name", (t) => {
  for (const [first, second, extra] of [
    ["hero.jpg", "hero.png", {}],
    ["hero-loop.gif", "hero-loop.mp4", { "hero.png": "p" }],
    ["thumb.jpg", "thumb.webp", { "hero.png": "p" }],
    ["fig-demo.jpg", "fig-demo.png", { "hero.png": "p" }],
    ["fig-demo.PNG", "fig-demo.png", { "hero.png": "p" }],
  ]) {
    const site = makeSite(t, { ...extra, [first]: "a", [second]: "b" });
    assert.throws(
      () => makeProjectMedia({ site, slug: "demo", encode: fakeEncode }),
      (error) =>
        error.message.includes(first) && error.message.includes(second),
      `${first} and ${second}`,
    );
    assert.deepEqual(outputs(site), [], first);
    assert.deepEqual(allowlistOf(site), {}, first);
  }
});

test("a second run after inputs are removed leaves no stale output or allowlist key", (t) => {
  const site = makeSite(t, {
    "hero.png": "p",
    "hero-loop.mp4": "v",
    "thumb.png": "t",
    "fig-keep.png": "k",
    "fig-old.png": "o",
    "fig-chart.svg": svgBytes,
  });
  makeProjectMedia({ site, slug: "demo", encode: fakeEncode });
  writeFileSync(join(outDir(site), "notes.txt"), "kept");
  mkdirSync(join(outDir(site), "fig-folder.webp"));
  const others = {
    "apps/web/public/projects/demo-two/fig-old.webp": "a",
    "apps/web/public/projects/demo/notes.txt": "b",
    "apps/web/public/elsewhere.webp": "c",
  };
  writeFileSync(
    join(site, "privacy-allowlist.json"),
    JSON.stringify({ ...allowlistOf(site), ...others }),
  );
  for (const name of ["hero-loop.mp4", "fig-old.png", "fig-chart.svg"]) {
    rmSync(join(site, ".media/demo", name));
  }
  const removed = [];
  makeProjectMedia({
    site,
    slug: "demo",
    encode: fakeEncode,
    onRemove: (path) => removed.push(path.split("/").pop()),
  });
  assert.deepEqual(removed, [
    "fig-chart.svg",
    "fig-old.webp",
    "hero-loop.webp",
  ]);
  assert.deepEqual(outputs(site), [
    "fig-folder.webp",
    "fig-keep.webp",
    "hero.webp",
    "notes.txt",
    "thumb.webp",
  ]);
  assert.deepEqual(Object.keys(allowlistOf(site)).sort(), [
    "apps/web/public/elsewhere.webp",
    "apps/web/public/projects/demo-two/fig-old.webp",
    "apps/web/public/projects/demo/fig-keep.webp",
    "apps/web/public/projects/demo/hero.webp",
    "apps/web/public/projects/demo/notes.txt",
    "apps/web/public/projects/demo/thumb.webp",
  ]);
});

test("a stale output is off the allowlist and the new outputs are written before it's removed", (t) => {
  const site = makeSite(t, { "hero.png": "p", "fig-old.png": "o" });
  makeProjectMedia({ site, slug: "demo", encode: fakeEncode });
  rmSync(join(site, ".media/demo/fig-old.png"));
  writeFileSync(join(site, ".media/demo/fig-new.png"), "n");
  const seen = [];
  makeProjectMedia({
    site,
    slug: "demo",
    encode: fakeEncode,
    onRemove: (path) => {
      seen.push([
        path.split("/").pop(),
        Object.hasOwn(
          allowlistOf(site),
          "apps/web/public/projects/demo/fig-old.webp",
        ),
        existsSync(join(outDir(site), "fig-new.webp")),
      ]);
    },
  });
  assert.deepEqual(seen, [["fig-old.webp", false, true]]);
});
