import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { scanMetadata } from "./privacy/metadata.mjs";
import {
  htmlToMarkdown,
  importGhost,
  rewriteImageUrls,
  writeContactSheet,
} from "./import-ghost.mjs";

const ascii = (text) => Buffer.from(text, "latin1");

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([ascii(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// a 1x1 gray png, with a text chunk when asked
function png(withText) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
    ...(withText ? [pngChunk("tEXt", ascii("Comment\0made at home"))] : []),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 0x80]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function jpegSegment(marker, payload) {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

// not a picture anyone could view, but the strip and the scan read its segments
function jpegWithExif() {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(
      0xe0,
      Buffer.concat([
        ascii("JFIF\0"),
        Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0]),
      ]),
    ),
    jpegSegment(
      0xe1,
      Buffer.concat([ascii("Exif\0\0"), ascii("MM\0*\0\0\0\x08\0\0")]),
    ),
    jpegSegment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
    jpegSegment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
    jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd9]),
  ]);
}

function makeExport(posts, images = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ghost-export-"));
  writeFileSync(join(dir, "posts.json"), JSON.stringify({ posts }));
  for (const [name, bytes] of Object.entries(images)) {
    const path = join(dir, "images", name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  return dir;
}

function post(fields) {
  return {
    title: "A post",
    slug: "a-post",
    html: "<p>Hello</p>",
    feature_image: null,
    published_at: "2019-10-01T00:00:00.000-07:00",
    tags: [],
    ...fields,
  };
}

function frontmatterOf(markdown) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  assert.ok(match, "the file opens with frontmatter");
  const fields = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(": ");
    fields[line.slice(0, colon)] = JSON.parse(line.slice(colon + 2));
  }
  return fields;
}

function bodyOf(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

async function run(posts, images) {
  const exportDir = makeExport(posts, images);
  const outDir = mkdtempSync(join(tmpdir(), "ghost-out-"));
  const result = await importGhost({ exportDir, outDir });
  return { exportDir, outDir, result };
}

const imageUrl = (name) => `https://blog.jasonyue.ca/content/images/${name}`;
const usesImages = (...names) =>
  names.map((name) => `<img src="${imageUrl(name)}">`).join("");

const read = (outDir, slug) =>
  readFileSync(join(outDir, "blog", `${slug}.md`), "utf8");

test("a post's title, slug, and date come through unchanged, and its tags are left out", async () => {
  const title = 'Fun with "VMs": part 2 \u2013 caf\u00e9';
  const { outDir } = await run([
    post({
      title,
      slug: "fun-with-vms",
      published_at: "2019-07-28T00:00:00.000-07:00",
      tags: [{ name: "#green" }, "plain", { name: "Two Words" }],
    }),
  ]);
  const fields = frontmatterOf(read(outDir, "fun-with-vms"));
  assert.equal(fields.title, title);
  assert.equal(fields.slug, "fun-with-vms");
  assert.equal(fields.date, "2019-07-28T00:00:00.000-07:00");
  assert.equal("tags" in fields, false);
  assert.equal("feature_image" in fields, false);
});

test("a paragraph's characters come through the same", () => {
  assert.equal(
    htmlToMarkdown("<p>It&#39;s a caf\u00e9 &amp; a &quot;test&quot;.</p>"),
    'It\'s a caf\u00e9 & a "test".',
  );
  assert.equal(
    htmlToMarkdown("<p>Two</p><p>paragraphs</p>"),
    "Two\n\nparagraphs",
  );
});

test("characters that Markdown would read as markup are escaped", () => {
  assert.equal(
    htmlToMarkdown(
      "<p>5 &lt; 6 *not bold* _x_ [a] `c` #1 AT&amp;T &amp;amp;</p>",
    ),
    "5 \\< 6 \\*not bold\\* \\_x\\_ \\[a\\] \\`c\\` \\#1 AT&T \\&amp;",
  );
  assert.equal(htmlToMarkdown("<p>- not a list</p>"), "\\- not a list");
  assert.equal(htmlToMarkdown("<p>1. not a list</p>"), "1\\. not a list");
});

test("headings and links convert, and inline tags keep their markup", () => {
  assert.equal(
    htmlToMarkdown('<h2 id="gaming-analytics">Gaming analytics</h2>'),
    "## Gaming analytics",
  );
  assert.equal(
    htmlToMarkdown(
      '<p>See <a href="https://x.test/a?ref=b">GitHub</a> now</p>',
    ),
    "See [GitHub](https://x.test/a?ref=b) now",
  );
  assert.equal(
    htmlToMarkdown("<p>Some <strong>bold</strong> and <em>soft</em> words</p>"),
    "Some **bold** and *soft* words",
  );
  assert.equal(
    htmlToMarkdown("<p>Use <code>a*b</code> here</p>"),
    "Use `a*b` here",
  );
});

test("markup that Markdown would render differently stays as HTML", () => {
  const mismatched = '<h2 id="custom-id">Gaming analytics</h2>';
  assert.equal(htmlToMarkdown(mismatched), mismatched);
  const bareUrl = "<p>Go to https://example.test now</p>";
  assert.equal(htmlToMarkdown(bareUrl), bareUrl);
  const trailing = "<p>Odd <strong>bold.</strong>text</p>";
  assert.equal(htmlToMarkdown(trailing), "Odd <strong>bold.</strong>text");
  const list = "<ul><li>one</li><li>two</li></ul>";
  assert.equal(htmlToMarkdown(list), list);
});

test("a kg-gallery-card figure stays as the same HTML", () => {
  const gallery =
    '<figure class="kg-card kg-gallery-card kg-width-wide"><div class="kg-gallery-container"><div class="kg-gallery-row">' +
    '<div class="kg-gallery-image"><img src="https://elsewhere.test/a.jpg" width="600" height="400" alt=""></div>' +
    '<div class="kg-gallery-image"><img src="https://elsewhere.test/b.jpg" width="600" height="400" alt=""></div>' +
    "</div></div><figcaption>Two shots</figcaption></figure>";
  const html = `<p>Before</p>${gallery}<p>After</p>`;
  assert.equal(htmlToMarkdown(html), `Before\n\n${gallery}\n\nAfter`);
});

test("comments between blocks stay where they are", () => {
  const html =
    '<!--kg-card-begin: html--><div class="embed">x</div><!--kg-card-end: html-->';
  assert.equal(
    htmlToMarkdown(html),
    '<!--kg-card-begin: html-->\n\n<div class="embed">x</div>\n\n<!--kg-card-end: html-->',
  );
});

test("image URLs are rewritten under /blog/content/images/", () => {
  assert.equal(
    rewriteImageUrls(
      "https://blog.jasonyue.ca/content/images/2019/10/Setup-1.jpg",
    ),
    "/blog/content/images/2019/10/Setup-1.jpg",
  );
  const html =
    '<img src="http://blog.jasonyue.ca/content/images/a.png" srcset="/content/images/size/w600/a.png 600w, //blog.jasonyue.ca/content/images/size/w1000/a.png 1000w">' +
    '<a href="__GHOST_URL__/content/images/b.png">b</a>' +
    '<img src="/blog/content/images/c.png"><img src="https://elsewhere.test/content/images/d.png">';
  assert.equal(
    rewriteImageUrls(html),
    '<img src="/blog/content/images/a.png" srcset="/blog/content/images/size/w600/a.png 600w, /blog/content/images/size/w1000/a.png 1000w">' +
      '<a href="/blog/content/images/b.png">b</a>' +
      '<img src="/blog/content/images/c.png"><img src="https://elsewhere.test/content/images/d.png">',
  );
});

test("the feature image and the post's HTML are rewritten in the file", async () => {
  const { outDir } = await run(
    [
      post({
        feature_image:
          "https://blog.jasonyue.ca/content/images/2019/10/Setup-1.jpg",
        html: '<figure class="kg-card"><img src="https://blog.jasonyue.ca/content/images/2019/10/Setup-1.jpg"></figure>',
      }),
    ],
    { "2019/10/Setup-1.jpg": jpegWithExif() },
  );
  const markdown = read(outDir, "a-post");
  assert.equal(
    frontmatterOf(markdown).feature_image,
    "/blog/content/images/2019/10/Setup-1.jpg",
  );
  assert.equal(
    bodyOf(markdown),
    '<figure class="kg-card"><img src="/blog/content/images/2019/10/Setup-1.jpg"></figure>',
  );
});

test("every written image has its metadata stripped and passes the scan", async () => {
  const withText = png(true);
  const withExif = jpegWithExif();
  assert.notDeepEqual(scanMetadata(withText, "a.png"), []);
  assert.notDeepEqual(scanMetadata(withExif, "b.jpg"), []);
  const html = usesImages("2019/12/a.png", "2020/01/b.jpg");
  const { outDir, result } = await run([post({ html })], {
    "2019/12/a.png": withText,
    "2020/01/b.jpg": withExif,
  });
  assert.deepEqual(result.images.sort(), ["2019/12/a.png", "2020/01/b.jpg"]);
  for (const name of result.images) {
    const bytes = readFileSync(join(outDir, "blog-images", name));
    assert.deepEqual(scanMetadata(bytes, name), []);
  }
});

test("an image that the strip can't handle stops the import with nothing written", async () => {
  const html = usesImages("2019/12/a.png", "2019/12/b.bmp");
  const exportDir = makeExport([post({ html })], {
    "2019/12/a.png": png(false),
    "2019/12/b.bmp": Buffer.concat([ascii("BM"), Buffer.alloc(60)]),
  });
  const outDir = mkdtempSync(join(tmpdir(), "ghost-out-"));
  await assert.rejects(importGhost({ exportDir, outDir }), /b\.bmp/);
  assert.equal(existsSync(join(outDir, "blog")), false);
  assert.equal(existsSync(join(outDir, "blog-images")), false);
});

test("only published posts come over, and a bad slug stops the import", async () => {
  const { outDir, result } = await run([
    post({ slug: "kept", status: "published" }),
    post({ slug: "draft-one", status: "draft" }),
    post({ slug: "a-page", type: "page" }),
  ]);
  assert.deepEqual(result.posts, ["kept"]);
  assert.equal(existsSync(join(outDir, "blog", "draft-one.md")), false);
  assert.equal(existsSync(join(outDir, "blog", "a-page.md")), false);
  await assert.rejects(run([post({ slug: "../escape" })]), /slug/);
});

test("html that could run script on the site stops the import with nothing written", async () => {
  const active = [
    "<script>alert(1)</script>",
    '<p>a</p><script src="https://x.test/a.js"></script>',
    "<SCRIPT>1</SCRIPT>",
    "<div><p>a</div><script src=x",
    '<iframe src="https://www.youtube.com/embed/x"></iframe>',
    '<figure class="kg-card kg-embed-card"><iframe src="https://x.test"></iframe></figure>',
    '<object data="x.swf"></object>',
    '<embed src="x.swf">',
    '<img src="a.png" onerror="alert(1)">',
    "<p onclick=alert(1)>hi</p>",
    "<p>a <b onmouseover='x()'>b</b></p>",
    '<p><a href="javascript:alert(1)">x</a></p>',
    '<p><a href=" JaVaScRiPt:alert(1)">x</a></p>',
    '<p><a href="java&#x09;script:alert(1)">x</a></p>',
    '<p><a href="&#106;avascript:alert(1)">x</a></p>',
    '<p><a href="&#106avascript:alert(1)">x</a></p>',
    '<p><a href="java&Tab;script:alert(1)">x</a></p>',
    '<svg><a xlink:href="javascript:alert(1)">x</a></svg>',
    '<form action="vbscript:x"><p>a</p></form>',
  ];
  for (const html of active) {
    assert.throws(() => htmlToMarkdown(html), /could run script/, html);
  }
  const exportDir = makeExport([post({ html: active[4] })]);
  const outDir = mkdtempSync(join(tmpdir(), "ghost-out-"));
  await assert.rejects(
    importGhost({ exportDir, outDir }),
    /"A post" has <iframe>, which could run script/,
  );
  assert.equal(existsSync(join(outDir, "blog")), false);
});

test("text and code that only name script, handlers, or javascript: come through", () => {
  assert.equal(
    htmlToMarkdown(
      "<p>Use &lt;script&gt; tags, onclick= and javascript: here</p>",
    ),
    "Use \\<script\\> tags, onclick= and javascript: here",
  );
  const code = "<pre><code>&lt;iframe src=x onload=y&gt;</code></pre>";
  assert.equal(htmlToMarkdown(code), code);
  const link = '<a href="https://x.test/javascript:a" title="on">x</a>';
  assert.equal(htmlToMarkdown(`<p>${link}</p>`), link);
});

test("an image a post uses but the export lacks stops the import with nothing written", async () => {
  const exportDir = makeExport(
    [post({ feature_image: imageUrl("2019/12/missing.png") })],
    { "2019/12/a.png": png(false) },
  );
  const outDir = mkdtempSync(join(tmpdir(), "ghost-out-"));
  await assert.rejects(
    importGhost({ exportDir, outDir }),
    /2019\/12\/missing\.png/,
  );
  assert.equal(existsSync(join(outDir, "blog")), false);
  assert.equal(existsSync(join(outDir, "blog-images")), false);
});

test("an image path that climbs out of images/ counts as missing", async () => {
  const exportDir = makeExport(
    [post({ html: '<img src="/content/images/../posts.json">' })],
    {},
  );
  const outDir = mkdtempSync(join(tmpdir(), "ghost-out-"));
  await assert.rejects(importGhost({ exportDir, outDir }), /lacks/);
});

test("only the images a published post uses are written", async () => {
  const { outDir, result } = await run(
    [
      post({ slug: "kept", html: usesImages("2019/12/used.png") }),
      post({
        slug: "draft-one",
        status: "draft",
        html: usesImages("2019/12/draft.png"),
      }),
    ],
    {
      "2019/12/used.png": png(false),
      "2019/12/draft.png": png(false),
      "2019/12/orphan.png": png(false),
    },
  );
  assert.deepEqual(result.images, ["2019/12/used.png"]);
  assert.deepEqual(result.unused, ["2019/12/draft.png", "2019/12/orphan.png"]);
  assert.equal(
    existsSync(join(outDir, "blog-images", "2019/12/used.png")),
    true,
  );
  assert.equal(
    existsSync(join(outDir, "blog-images", "2019/12/draft.png")),
    false,
  );
  assert.equal(
    existsSync(join(outDir, "blog-images", "2019/12/orphan.png")),
    false,
  );
});

test("blank lines inside a captioned code card can't end its HTML block", () => {
  const card =
    '<figure class="kg-card kg-code-card"><pre><code>a\n\nb\n  \n\nc</code></pre><figcaption>Two</figcaption></figure>';
  const out = htmlToMarkdown(card);
  assert.equal(/\n[ \t]*\n/.test(out), false);
  assert.equal(out.replaceAll("&#10;", "\n"), card);
  const bare = "<pre><code>a\n\nb</code></pre>";
  assert.equal(htmlToMarkdown(bare), bare);
  assert.equal(
    htmlToMarkdown("<p>x</p><div>one\n\ntwo</div>"),
    "x\n\n<div>one\ntwo</div>",
  );
});

test("text between top level blocks is escaped like a paragraph", () => {
  assert.equal(htmlToMarkdown("text at top <p>p</p>"), "text at top\n\np");
  assert.equal(htmlToMarkdown("*x* #1 &amp; <p>p</p>"), "\\*x\\* \\#1 &\n\np");
  assert.equal(
    htmlToMarkdown("see https://a.test <p>p</p>"),
    "<p>see https://a.test</p>\n\np",
  );
});

test("the contact sheet is a JPEG with one cell per image", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghost-sheet-"));
  const sheet = join(dir, "contact-sheet.jpg");
  const count = await writeContactSheet(
    [
      { name: "2019/12/a.png", bytes: png(false) },
      { name: "2020/01/b.png", bytes: png(false) },
    ],
    sheet,
  );
  assert.equal(count, 2);
  const bytes = readFileSync(sheet);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  rmSync(dir, { recursive: true });
});
