import assert from "node:assert/strict";
import { mock, test } from "node:test";
import fs, { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bodyScripts, checkDist, injectedCss } from "./html-rules.mjs";

const page = (body, head = "") =>
  `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

test("a script in the head or inside #page passes", () => {
  const html = page(
    `<div id="stage"><main id="page" data-app="home"><div><script>1</script></div></main></div>`,
    `<script type="module" src="/a.js"></script><script>2</script>`,
  );
  assert.deepEqual(bodyScripts(html), []);
});

test("a script in the body outside #page is found", () => {
  const html = page(
    `<div id="stage"><main id="page"><p>hi</p></main><script src="/late.js"></script></div>`,
  );
  assert.deepEqual(bodyScripts(html), [`<script src="/late.js">`]);
});

test("a script after the page element closes is found, and one before it too", () => {
  const html = page(
    `<script>1</script><main id="page"><img src="x"><br/><script>2</script></main><script>3</script>`,
  );
  assert.deepEqual(bodyScripts(html), ["<script>", "<script>"]);
});

test("script text that looks like markup is skipped", () => {
  const html = page(
    `<main id="page"><script>const s = "<script>"; const t = "</main>";</script></main>`,
  );
  assert.deepEqual(bodyScripts(html), []);
});

test("a comment holding a script is skipped", () => {
  assert.deepEqual(bodyScripts(page(`<!-- <script>1</script> -->`)), []);
});

test("an id that only contains page isn't the page", () => {
  const html = page(`<main id="pages"><script>1</script></main>`);
  assert.deepEqual(bodyScripts(html), ["<script>"]);
});

test("a script that makes a style element is found", () => {
  assert.deepEqual(injectedCss('document.createElement("style")'), [
    'createElement("style")',
  ]);
  assert.deepEqual(injectedCss("document.createElement(`style`)"), [
    'createElement("style")',
  ]);
});

test("a script that makes a stylesheet link is found, and a prefetch link isn't", () => {
  assert.deepEqual(
    injectedCss('const l=document.createElement("link");l.rel="stylesheet"'),
    ['createElement("link") with rel stylesheet'],
  );
  assert.deepEqual(
    injectedCss('const l=document.createElement("link");l.rel="prefetch"'),
    [],
  );
});

test("a script that names a css file is found", () => {
  assert.deepEqual(injectedCss('const deps=["_astro/lazy.abc.css"]'), [
    'the stylesheet "_astro/lazy.abc.css"',
  ]);
});

test("an unreferenced client chunk may build elements, and a referenced one may not", () => {
  const js = 'createElement("style");createElement("link");rel:"stylesheet"';
  assert.deepEqual(injectedCss(js, "client.abc.js", false), []);
  assert.deepEqual(injectedCss(js, "client.abc.js", true), [
    'createElement("style")',
    'createElement("link") with rel stylesheet',
  ]);
});

const distWith = (files) => {
  const dist = mkdtempSync(join(tmpdir(), "html-rules-"));
  mkdirSync(join(dist, "_astro"));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dist, name), text);
  }
  return dist;
};

test("a dist's client chunk is exempt only when nothing refers to it", () => {
  const react = 'createElement("style")';
  const alone = distWith({
    "index.html": page("", '<script src="/_astro/site.js"></script>'),
    "_astro/site.js": "1",
    "_astro/client.react.js": react,
  });
  assert.deepEqual(checkDist(alone), []);
  const loaded = distWith({
    "index.html": page(
      "",
      '<script type="module" src="/_astro/client.router.js"></script>',
    ),
    "_astro/client.router.js": react,
  });
  assert.equal(checkDist(loaded).length, 1);
  const imported = distWith({
    "index.html": page("", '<script src="/_astro/site.js"></script>'),
    "_astro/site.js": 'import"./client.router.js"',
    "_astro/client.router.js": react,
  });
  assert.equal(checkDist(imported).length, 1);
});

test("an image that happens to hold a chunk's name isn't a reference to it", () => {
  const dist = distWith({
    "index.html": page("", '<script src="/_astro/site.js"></script>'),
    "_astro/site.js": "1",
    "_astro/client.react.js": 'createElement("style")',
    "_astro/photo.png": Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]),
      Buffer.from("client.react.js", "latin1"),
    ]),
  });
  assert.deepEqual(checkDist(dist), []);
});

test("the check reads only the files that can refer to a script as text", (t) => {
  const dist = distWith({
    "index.html": page("", '<script src="/_astro/site.js"></script>'),
    "_astro/site.js": "1",
    "_astro/model.glb": Buffer.alloc(64),
    "_astro/photo.jpg": Buffer.alloc(64),
  });
  const reads = mock.method(fs, "readFileSync");
  syncBuiltinESMExports();
  t.after(() => {
    reads.mock.restore();
    syncBuiltinESMExports();
  });
  assert.deepEqual(checkDist(dist), []);
  const read = reads.mock.calls.map((call) => String(call.arguments[0]));
  assert.ok(
    read.some((file) => file.endsWith("index.html")),
    read.join("\n"),
  );
  assert.ok(!read.some((file) => /\.(glb|jpg)$/.test(file)), read.join("\n"));
});

test("a .mjs file or a capitalized name in the dist gets the same checks", () => {
  const dist = distWith({
    "index.html": page("", '<script src="/_astro/site.mjs"></script>'),
    "_astro/site.mjs": 'document.createElement("style")',
    "_astro/LOUD.JS": 'document.createElement("style")',
    "OTHER.HTML": page('<script src="/_astro/LOUD.JS"></script>'),
  });
  assert.deepEqual(checkDist(dist).sort(), [
    'OTHER.HTML has <script src="/_astro/LOUD.JS"> in the body outside #page',
    `${join("_astro", "LOUD.JS")} adds css with createElement("style")`,
    `${join("_astro", "site.mjs")} adds css with createElement("style")`,
  ]);
});
