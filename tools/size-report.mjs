// prints each built script's minified and gzip size, then the totals before the first frame: the scripts the home page
// loads on its own (its head scripts, the scene's entry chunk, and what each imports) and the files the head preloads
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const usage = "usage: size-report.mjs [--dist <DIR>]";

// a chunk whose name starts with scene is the scene's entry, which the layout script imports when the page can run it
const SCENE_ENTRY = /^scene[.-]/;
const STATIC_IMPORT = /(?:\bfrom|\bimport)\s*["'`]\.\/([^"'`]+\.js)["'`]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["'`]\.\/([^"'`]+\.js)["'`]\s*\)/g;

const matches = (pattern, text) =>
  [...text.matchAll(pattern)].map((match) => match[1]);

export function readChunks(astroDir) {
  const chunks = new Map();
  for (const name of readdirSync(astroDir).filter((n) => n.endsWith(".js"))) {
    const bytes = readFileSync(join(astroDir, name));
    const text = bytes.toString("utf8");
    chunks.set(name, {
      name,
      minified: bytes.length,
      gzip: gzipSync(bytes).length,
      statics: matches(STATIC_IMPORT, text),
      dynamics: matches(DYNAMIC_IMPORT, text),
    });
  }
  return chunks;
}

export function headRefs(html) {
  const scripts = [
    ...html.matchAll(/<script[^>]*\ssrc="\/_astro\/([^"]+\.js)"/g),
  ].map((match) => match[1]);
  const preloads = [...html.matchAll(/<link[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => /rel="preload"/.test(tag))
    .map((tag) => /href="([^"]+)"/.exec(tag)?.[1])
    .filter(Boolean);
  return { scripts, preloads };
}

// every chunk the first frame needs: the head scripts and what they import, plus the scene entry chunk when a script
// reaches it with a dynamic import, and what it imports in turn
export function firstFrameChunks(chunks, scripts) {
  const needed = new Set();
  const visit = (name) => {
    const chunk = chunks.get(name);
    if (!chunk || needed.has(name)) {
      return;
    }
    needed.add(name);
    chunk.statics.forEach(visit);
  };
  scripts.forEach(visit);
  for (const name of [...needed]) {
    chunks
      .get(name)
      .dynamics.filter((d) => SCENE_ENTRY.test(d))
      .forEach(visit);
  }
  return needed;
}

const kb = (bytes) => (bytes / 1000).toFixed(1).padStart(8);

export function report(dist) {
  const chunks = readChunks(join(dist, "_astro"));
  const { scripts, preloads } = headRefs(
    readFileSync(join(dist, "index.html"), "utf8"),
  );
  const needed = firstFrameChunks(chunks, scripts);
  const lines = [
    `${"file".padEnd(58)} ${"min kB".padStart(8)} ${"gzip kB".padStart(8)}`,
  ];
  const sorted = [...chunks.values()].sort((a, b) => b.minified - a.minified);
  for (const chunk of sorted) {
    const mark = needed.has(chunk.name) ? " *" : "";
    lines.push(
      `${(chunk.name + mark).padEnd(58)} ${kb(chunk.minified)} ${kb(chunk.gzip)}`,
    );
  }
  const total = (list) => ({
    minified: list.reduce((sum, c) => sum + c.minified, 0),
    gzip: list.reduce((sum, c) => sum + c.gzip, 0),
  });
  const all = total(sorted);
  const first = total([...needed].map((name) => chunks.get(name)));
  lines.push(`${"all scripts".padEnd(58)} ${kb(all.minified)} ${kb(all.gzip)}`);
  lines.push(
    `${"scripts before the first frame (*)".padEnd(58)} ${kb(first.minified)} ${kb(first.gzip)}`,
  );
  const preloaded = preloads.map((href) => {
    const size = statSync(join(dist, href.replace(/^\//, ""))).size;
    return { href, size };
  });
  lines.push("");
  lines.push(`head preloads (file bytes, ${preloaded.length} files)`);
  for (const { href, size } of preloaded) {
    lines.push(`${href.padEnd(58)} ${kb(size)}`);
  }
  const preloadBytes = preloaded.reduce((sum, p) => sum + p.size, 0);
  lines.push(`${"head preloads total".padEnd(58)} ${kb(preloadBytes)}`);
  lines.push("");
  lines.push(
    `${"first frame total (scripts gzip + preloads raw)".padEnd(58)} ${kb(first.gzip + preloadBytes)}`,
  );
  return lines.join("\n");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--dist");
  if (args.length > 0 && !(args.length === 2 && flag === 0)) {
    console.error(usage);
    process.exit(2);
  }
  const dist =
    flag === 0 ? resolve(args[1]) : resolve(here, "../apps/web/dist");
  console.log(report(dist));
}
