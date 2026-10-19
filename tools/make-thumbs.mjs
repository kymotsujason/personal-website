// makes the blog list's thumbnails: for each post with a feature_image, a 112 px square cut from the image's middle,
// written to apps/web/public/blog/thumbs/<SLUG>.jpg with its metadata stripped, put on the privacy allowlist, and
// named in the post's thumb field. it can run again after new posts, and a post that already has a thumb gets a
// new one. run it from site/ (it needs vips):
//   node tools/make-thumbs.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./privacy/allowlist.mjs";
import { scanMetadata, stripMetadata } from "./privacy/metadata.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, "..");
const web = path.join(site, "apps/web");
const posts = path.join(web, "src/content/blog");
const thumbs = path.join(web, "public/blog/thumbs");
const allowlistPath = path.join(site, "privacy-allowlist.json");

const SIZE = 112;
// a transparent image is laid on the blog panel's dark color before it becomes a jpeg
const BACKGROUND = "20 22 30";

const field = (text, name) => {
    const found = text.match(new RegExp(`^${name}: (.+)$`, "m"));
    if (!found) {
        return null;
    }
    // the importer writes json strings, and a post written by hand may leave a plain value unquoted
    return found[1].startsWith('"') ? JSON.parse(found[1]) : found[1];
};

const setThumb = (text, thumb) => {
    const line = `thumb: ${JSON.stringify(thumb)}`;
    if (/^thumb: .+$/m.test(text)) {
        return text.replace(/^thumb: .+$/m, line);
    }
    return text.replace(/^(feature_image: .+)$/m, `$1\n${line}`);
};

const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
mkdirSync(thumbs, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), "thumbs-"));
let made = 0;
try {
    for (const name of readdirSync(posts).filter((f) => f.endsWith(".md")).sort()) {
        const file = path.join(posts, name);
        const text = readFileSync(file, "utf8");
        const feature = field(text, "feature_image");
        const slug = field(text, "slug");
        if (!feature || !slug) {
            continue;
        }
        const source = path.join(web, "public", feature);
        const cut = path.join(work, `${slug}.v`);
        const flat = path.join(work, `${slug}-flat.v`);
        const encoded = path.join(work, `${slug}.jpg`);
        execFileSync("vips", ["thumbnail", source, cut, String(SIZE), "--height", String(SIZE), "--crop", "centre"]);
        const bands = Number(execFileSync("vipsheader", ["-f", "bands", cut]).toString().trim());
        let ready = cut;
        if (bands === 2 || bands === 4) {
            execFileSync("vips", ["flatten", cut, flat, "--background", BACKGROUND]);
            ready = flat;
        }
        execFileSync("vips", ["copy", ready, `${encoded}[Q=85,strip]`]);
        const stripped = stripMetadata(readFileSync(encoded), `${slug}.jpg`);
        const bytes = Buffer.from(stripped.bytes ?? stripped);
        const left = scanMetadata(bytes, `${slug}.jpg`);
        if (left.length > 0) {
            throw new Error(`metadata left in ${slug}.jpg: ${left.join(", ")}`);
        }
        const out = path.join(thumbs, `${slug}.jpg`);
        writeFileSync(out, bytes);
        allowlist[path.relative(site, out)] = sha256(bytes);
        writeFileSync(file, setThumb(text, `/blog/thumbs/${slug}.jpg`));
        made += 1;
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}
const sorted = Object.fromEntries(Object.entries(allowlist).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(allowlistPath, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`${made} thumbnails in ${thumbs}`);
