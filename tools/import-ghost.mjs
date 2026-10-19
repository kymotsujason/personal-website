// one time import: node tools/import-ghost.mjs <export-dir> [--out <dir>] [--sheet <file>]
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripAndVerify } from "./privacy/metadata.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// thrown while converting a block that Markdown would render differently, so the block stays HTML
class KeepHtml extends Error {}

const keep = () => {
  throw new KeepHtml();
};

const voidTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

const blockTags = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "script",
  "section",
  "style",
  "table",
  "textarea",
  "ul",
  "iframe",
  "video",
  "audio",
]);

const namedEntities = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  bull: "\u2022",
  middot: "\u00b7",
  times: "\u00d7",
  laquo: "\u00ab",
  raquo: "\u00bb",
};

function decodeEntities(text) {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi,
    (match, body) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        if (code === 0 || code > 0x10ffff) return keep();
        return String.fromCodePoint(code);
      }
      return Object.hasOwn(namedEntities, body) ? namedEntities[body] : keep();
    },
  );
}

// the site's pages serve images from /blog/content/images/, which is where the old blog's addresses redirect to
const imageUrlPattern =
  /(?<![\w./-])(?:(?:https?:)?\/\/blog\.jasonyue\.ca|__GHOST_URL__)?\/content\/images\//g;

export function rewriteImageUrls(text) {
  return text.replace(imageUrlPattern, "/blog/content/images/");
}

const tokenPattern =
  /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:"[^"]*"|'[^']*'|[^>"'])*>/g;

function parseHtml(html) {
  const root = { children: [] };
  const stack = [root];
  let last = 0;
  const top = () => stack[stack.length - 1];
  const addText = (end) => {
    if (end > last)
      top().children.push({ type: "text", raw: html.slice(last, end) });
  };
  for (const match of html.matchAll(tokenPattern)) {
    addText(match.index);
    last = match.index + match[0].length;
    if (match[0].startsWith("<!--")) {
      top().children.push({ type: "comment", start: match.index, end: last });
      continue;
    }
    const name = match[2].toLowerCase();
    if (match[1] === "/") {
      if (stack.length === 1 || top().name !== name) return keep();
      const element = stack.pop();
      element.innerEnd = match.index;
      element.end = last;
      continue;
    }
    const element = {
      type: "el",
      name,
      open: match[0],
      start: match.index,
      innerStart: last,
      children: [],
    };
    top().children.push(element);
    if (voidTags.has(name) || match[0].endsWith("/>")) {
      element.innerEnd = last;
      element.end = last;
    } else {
      stack.push(element);
    }
  }
  addText(html.length);
  if (stack.length > 1) return keep();
  return root;
}

// bare addresses would turn into links in Markdown, which the old page didn't have
const autolinkPattern = /(?:https?:\/\/|ftp:\/\/|www\.|[\w.+-]+@[\w-]+\.)/i;

function escapeText(text) {
  return text
    .replace(/[\\`*[\]<>#~]/g, "\\$&")
    .replace(/_/g, (match, at) =>
      /\w/.test(text[at - 1] ?? "") && /\w/.test(text[at + 1] ?? "")
        ? match
        : "\\_",
    )
    .replace(/&(?=#?\w+;)/g, "\\&");
}

function plainText(nodes) {
  return nodes
    .map((node) =>
      node.type === "text"
        ? decodeEntities(node.raw)
        : node.type === "el"
          ? plainText(node.children)
          : "",
    )
    .join("");
}

const bareTag = (name) => new RegExp(`^<${name}\\s*>$`, "i");

function renderInline(nodes, html) {
  let out = "";
  for (const node of nodes) {
    if (node.type === "comment") {
      out += html.slice(node.start, node.end);
      continue;
    }
    if (node.type === "text") {
      const text = decodeEntities(node.raw).replace(/[ \t\r\n\f]+/g, " ");
      if (autolinkPattern.test(text)) keep();
      out += escapeText(text);
      continue;
    }
    if (blockTags.has(node.name)) keep();
    if (node.name === "code") {
      const text = plainText(node.children);
      if (!bareTag("code").test(node.open)) keep();
      if (node.children.some((child) => child.type !== "text")) keep();
      if (/[`\n]/.test(text) || text !== text.trim() || text === "") keep();
      if (autolinkPattern.test(text)) keep();
      out += `\`${text}\``;
      continue;
    }
    const inner = renderInline(node.children, html);
    const closing = html.slice(node.innerEnd, node.end);
    const edges = /^[\p{L}\p{N}]/u.test(inner) && /[\p{L}\p{N}]$/u.test(inner);
    const strong = node.name === "strong" || node.name === "b";
    const emphasis = node.name === "em" || node.name === "i";
    if ((strong || emphasis) && bareTag(node.name).test(node.open) && edges) {
      out += strong ? `**${inner}**` : `*${inner}*`;
      continue;
    }
    const link = /^<a\s+href="([^"\s()<>\\]*)"\s*>$/i.exec(node.open);
    if (node.name === "a" && link && inner !== "") {
      out += `[${inner}](${link[1]})`;
      continue;
    }
    if (voidTags.has(node.name)) {
      out += node.open;
      continue;
    }
    out += node.open + inner + closing;
  }
  return out;
}

function githubSlug(text, seen) {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
  let slug = base;
  while (seen.has(slug)) {
    seen.set(base, seen.get(base) + 1);
    slug = `${base}-${seen.get(base)}`;
  }
  seen.set(slug, 0);
  return slug;
}

function convertBlock(element, html, seen) {
  const paragraph = element.name === "p";
  const level = /^h([1-6])$/.exec(element.name)?.[1];
  if (!paragraph && !level) return keep();
  const attributes = element.open.replace(/^<\w+\s*|\s*>$/g, "");
  const id = /^id="([^"]*)"$/.exec(attributes)?.[1];
  if (paragraph ? attributes !== "" : attributes !== "" && id === undefined) {
    return keep();
  }
  const inner = renderInline(element.children, html).trim();
  if (inner === "") return keep();
  if (paragraph) {
    return inner
      .replace(/^([-+])(?=\s)/, "\\$1")
      .replace(/^(\d+)([.)])(?=\s|$)/, "$1\\$2");
  }
  const text = plainText(element.children)
    .replace(/[ \t\r\n\f]+/g, " ")
    .trim();
  if (id !== undefined && githubSlug(text, new Map(seen)) !== id) keep();
  githubSlug(text, seen);
  return `${"#".repeat(Number(level))} ${inner}`;
}

// a block that opens with one of these tags ends at its closing tag, and any other block ends at its first blank line
const opensVerbatim = /^<(?:pre|script|style|textarea)(?=[\s>/])/i;
const verbatimRegion = /<(pre|script|style|textarea)\b[\s\S]*?<\/\1\s*>/gi;

// a blank line inside pre or textarea text is written as a newline entity, which renders the same newline
function joinLinesSafely(region) {
  const lines = region.split("\n");
  let out = lines[0];
  for (let i = 1; i < lines.length; i++) {
    const blank = lines[i].trim() === "" || lines[i - 1].trim() === "";
    out += (blank ? "&#10;" : "\n") + lines[i];
  }
  return out;
}

function rawBlock(raw) {
  const text = raw.trim();
  if (opensVerbatim.test(text)) return text;
  const parts = [];
  let last = 0;
  const collapse = (part) => part.replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n");
  for (const match of text.matchAll(verbatimRegion)) {
    parts.push(collapse(text.slice(last, match.index)));
    const keepsLines = /^(?:script|style)$/i.test(match[1]);
    parts.push(keepsLines ? match[0] : joinLinesSafely(match[0]));
    last = match.index + match[0].length;
  }
  parts.push(collapse(text.slice(last)));
  return parts.join("");
}

export function htmlToMarkdown(html) {
  let root;
  try {
    root = parseHtml(html);
  } catch (error) {
    if (error instanceof KeepHtml) return rawBlock(html);
    throw error;
  }
  const seen = new Map();
  const blocks = [];
  for (const node of root.children) {
    if (node.type === "text") {
      if (node.raw.trim() === "") continue;
      try {
        blocks.push(
          convertBlock(
            { name: "p", open: "<p>", children: [node] },
            html,
            seen,
          ),
        );
      } catch (error) {
        if (!(error instanceof KeepHtml)) throw error;
        blocks.push(`<p>${node.raw.trim()}</p>`);
      }
      continue;
    }
    const raw = rawBlock(html.slice(node.start, node.end));
    if (node.type === "comment") {
      blocks.push(raw);
      continue;
    }
    try {
      blocks.push(convertBlock(node, html, seen));
    } catch (error) {
      if (!(error instanceof KeepHtml)) throw error;
      blocks.push(raw);
    }
  }
  return blocks.join("\n\n");
}

// json strings are valid yaml, except for these two line separators
const yamlString = (value) =>
  JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

// ghost's tags are left out: the export's are its own import markers and the old theme's colors, and the site has
// no use for them
function postToMarkdown(post) {
  const lines = [
    "---",
    `title: ${yamlString(post.title)}`,
    `date: ${yamlString(post.published_at)}`,
    `slug: ${yamlString(post.slug)}`,
  ];
  if (post.feature_image) {
    lines.push(
      `feature_image: ${yamlString(rewriteImageUrls(post.feature_image))}`,
    );
  }
  lines.push("---", "");
  return `${lines.join("\n")}\n${htmlToMarkdown(rewriteImageUrls(post.html ?? ""))}\n`;
}

function referencedImages(post) {
  const text = rewriteImageUrls(
    `${post.feature_image ?? ""}\n${post.html ?? ""}`,
  );
  const found = new Set();
  for (const match of text.matchAll(
    /\/blog\/content\/images\/([^\s"'<>(),?#]+)/g,
  )) {
    try {
      found.add(decodeURIComponent(match[1]));
    } catch {
      found.add(match[1]);
    }
  }
  return found;
}

export async function importGhost({ exportDir, outDir }) {
  const data = JSON.parse(readFileSync(join(exportDir, "posts.json"), "utf8"));
  if (!Array.isArray(data.posts)) {
    throw new Error("posts.json has no posts array");
  }
  const published = data.posts.filter(
    (post) =>
      (post.status ?? "published") === "published" &&
      (post.type ?? "post") === "post",
  );
  const slugs = new Set();
  for (const post of published) {
    if (
      typeof post.slug !== "string" ||
      !/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(post.slug)
    ) {
      throw new Error(
        `The post "${post.title}" has a slug that can't be a file name: ${post.slug}`,
      );
    }
    if (slugs.has(post.slug))
      throw new Error(`Two posts share the slug ${post.slug}`);
    slugs.add(post.slug);
  }

  const imagesDir = join(exportDir, "images");
  const used = new Set();
  for (const post of published) {
    for (const name of referencedImages(post)) used.add(name);
  }
  const missing = [...used]
    .filter((name) => {
      if (name.split("/").includes("..")) return true;
      const path = join(imagesDir, name);
      return !existsSync(path) || !statSync(path).isFile();
    })
    .sort();
  if (missing.length > 0) {
    throw new Error(
      `A post uses images the export lacks: ${missing.join(", ")}`,
    );
  }
  const unused = (
    existsSync(imagesDir) ? readdirSync(imagesDir, { recursive: true }) : []
  )
    .filter((name) => statSync(join(imagesDir, name)).isFile())
    .filter((name) => !used.has(name))
    .sort();
  const images = [];
  for (const name of [...used].sort()) {
    const bytes = stripAndVerify(readFileSync(join(imagesDir, name)), name);
    images.push({ name, bytes });
  }

  const files = published.map((post) => ({
    slug: post.slug,
    markdown: postToMarkdown(post),
  }));

  rmSync(join(outDir, "blog"), { recursive: true, force: true });
  rmSync(join(outDir, "blog-images"), { recursive: true, force: true });
  mkdirSync(join(outDir, "blog"), { recursive: true });
  for (const file of files) {
    writeFileSync(join(outDir, "blog", `${file.slug}.md`), file.markdown);
  }
  for (const image of images) {
    const path = join(outDir, "blog-images", image.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, image.bytes);
  }

  return {
    posts: files.map((file) => file.slug),
    images: images.map((image) => image.name),
    unused,
  };
}

const mimeTypes = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const escapeHtml = (text) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

// an html grid of every image, photographed by the same Chromium the browser tests use
export async function writeContactSheet(images, sheetPath) {
  const { chromium } = createRequire(join(here, "../apps/web/package.json"))(
    "@playwright/test",
  );
  const cells = images.map((image) => {
    const type =
      mimeTypes[
        image.name.slice(image.name.lastIndexOf(".") + 1).toLowerCase()
      ];
    const uri = `data:${type};base64,${Buffer.from(image.bytes).toString("base64")}`;
    const name = escapeHtml(image.name);
    return `<figure><div><img src="${uri}" alt="${name}"></div><figcaption>${name}<br><span></span></figcaption></figure>`;
  });
  const page = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:16px;background:#151515;color:#ddd;font:12px monospace}
main{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
figure{margin:0}
div{height:300px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000}
img{max-width:100%;max-height:300px}
figcaption{padding-top:6px;word-break:break-all}
</style><main>${cells.join("")}</main>`;
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage({
      viewport: { width: 1600, height: 900 },
    });
    await tab.setContent(page, { waitUntil: "load" });
    const broken = await tab.evaluate(() => {
      const failed = [];
      for (const img of document.images) {
        if (img.naturalWidth === 0) failed.push(img.alt);
        else
          img.closest("figure").querySelector("span").textContent =
            `${img.naturalWidth} x ${img.naturalHeight}`;
      }
      return failed;
    });
    if (broken.length > 0) {
      throw new Error(`The contact sheet couldn't draw ${broken.join(", ")}`);
    }
    mkdirSync(dirname(sheetPath), { recursive: true });
    await tab.screenshot({
      path: sheetPath,
      type: "jpeg",
      quality: 85,
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
  return images.length;
}

async function main(args) {
  const options = { out: resolve(here, "../.import"), sheet: null };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") options.out = resolve(args[++i]);
    else if (args[i] === "--sheet") options.sheet = resolve(args[++i]);
    else positional.push(args[i]);
  }
  if (positional.length !== 1) {
    console.error(
      "Usage: node tools/import-ghost.mjs <export-dir> [--out <dir>] [--sheet <file>]",
    );
    process.exit(1);
  }
  const exportDir = resolve(positional[0]);
  const sheetPath = options.sheet ?? join(exportDir, "contact-sheet.jpg");
  const result = await importGhost({ exportDir, outDir: options.out });
  console.log(
    `${result.posts.length} posts written to ${join(options.out, "blog")}`,
  );
  console.log(
    `${result.images.length} images stripped and scanned into ${join(options.out, "blog-images")}`,
  );
  for (const name of result.unused)
    console.warn(`Not copied, since no post uses it: ${name}`);
  const sheetImages = result.images.map((name) => ({
    name,
    bytes: readFileSync(join(options.out, "blog-images", name)),
  }));
  const count = await writeContactSheet(sheetImages, sheetPath);
  console.log(`Contact sheet of ${count} images at ${sheetPath}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
