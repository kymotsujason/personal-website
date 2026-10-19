// checks the two rules that keep Astro's head swap safe. a page's scripts sit in the head or inside #page, since the
// swap leaves the rest of the body alone, and no script adds a stylesheet or a style element, since the swap removes
// head elements a script added. all css ships in the layout's stylesheets instead
import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const usage = "usage: html-rules.mjs --dist <DIR>";

const VOID = new Set([
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
const RAW = new Set(["script", "style", "textarea", "title"]);
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ID_PAGE = /\sid\s*=\s*(?:"page"|'page'|page(?=[\s/>]|$))/;
const CREATES_LINK = /\bcreateElement\(\s*(["'`])link\1\s*\)/;
const CREATES_STYLE = /\bcreateElement\(\s*(["'`])style\1\s*\)/;
// a rel set straight to stylesheet. vite's preload helper picks its rel at run time, so it never matches this
const STYLESHEET_REL =
  /(?:\.rel\s*=|\brel["'`]\s*,|\brel\s*:)\s*["'`]stylesheet["'`]/;
// a stylesheet a chunk names, which vite's preload helper adds to the head when the chunk loads
const CSS_FILE = /["'`][^"'`\s]+\.css["'`]/;
// react's client runtime builds link and style elements for its own hoisting. it's named client like astro's own
// client chunk, so it's exempt only while no page and no other chunk refers to it
const RUNTIME_CHUNK = /^client\./;
// the files that can name a script. images, models, and fonts can't, so they're never read
const TEXT_FILES = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".xml",
  ".txt",
  ".svg",
  ".webmanifest",
]);

// the scripts in a page's body that sit outside the element with id page
export function bodyScripts(html) {
  const text = html.replace(/<!--[\s\S]*?-->/g, "");
  const found = [];
  const stack = [];
  let inBody = false;
  TAG.lastIndex = 0;
  let match;
  while ((match = TAG.exec(text)) !== null) {
    const [, closing, rawName, attributes] = match;
    const name = rawName.toLowerCase();
    if (closing) {
      if (name === "body") {
        inBody = false;
      }
      const at = stack.map((entry) => entry.name).lastIndexOf(name);
      if (at !== -1) {
        stack.length = at;
      }
      continue;
    }
    if (name === "body") {
      inBody = true;
    }
    if (name === "script" && inBody && !stack.some((entry) => entry.page)) {
      found.push(match[0]);
    }
    if (RAW.has(name)) {
      const end = text.toLowerCase().indexOf(`</${name}`, TAG.lastIndex);
      TAG.lastIndex = end === -1 ? text.length : end;
      continue;
    }
    if (!VOID.has(name) && !attributes.endsWith("/")) {
      stack.push({ name, page: ID_PAGE.test(` ${attributes}`) });
    }
  }
  return found;
}

// the ways a built script's text adds css to the page
export function injectedCss(js, name = "", referenced = true) {
  const found = [];
  const runtime = RUNTIME_CHUNK.test(name) && !referenced;
  if (CREATES_STYLE.test(js) && !runtime) {
    found.push('createElement("style")');
  }
  if (CREATES_LINK.test(js) && STYLESHEET_REL.test(js) && !runtime) {
    found.push('createElement("link") with rel stylesheet');
  }
  const file = CSS_FILE.exec(js);
  if (file) {
    found.push(`the stylesheet ${file[0]}`);
  }
  return found;
}

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

export function checkDist(dist) {
  const problems = [];
  const files = filesUnder(dist)
    .filter((file) => TEXT_FILES.has(extname(file).toLowerCase()))
    .map((file) => ({
      file,
      name: relative(dist, file),
      text: readFileSync(file, "utf8"),
    }));
  for (const { file, name, text } of files) {
    if (/\.html$/i.test(file)) {
      for (const tag of bodyScripts(text)) {
        problems.push(`${name} has ${tag} in the body outside #page`);
      }
    } else if (/\.m?js$/i.test(file)) {
      const chunk = basename(file);
      // only a runtime chunk's exemption turns on whether anything names it, so only that one searches the rest
      const referenced =
        !RUNTIME_CHUNK.test(chunk) ||
        files.some(
          (other) => other.file !== file && other.text.includes(chunk),
        );
      for (const way of injectedCss(text, chunk, referenced)) {
        problems.push(`${name} adds css with ${way}`);
      }
    }
  }
  return problems;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--dist") {
    console.error(usage);
    process.exit(2);
  }
  const problems = checkDist(resolve(args[1]));
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(`html rules failed (${problems.length} problems)`);
    process.exit(1);
  }
  console.log("html rules passed");
}
