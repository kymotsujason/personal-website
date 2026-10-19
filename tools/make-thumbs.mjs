// makes the blog list's thumbnails: for each post with a feature_image, a 112 px square cut from the image's middle,
// written to apps/web/public/blog/thumbs/<SLUG>.jpg with its metadata stripped, put on the privacy allowlist, and
// named in the post's thumb field. it can run again after new posts, and a post that already has a thumb gets a
// new one. run it from site/ (it needs vips):
//   node tools/make-thumbs.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./privacy/allowlist.mjs";
import { stripAndVerify } from "./privacy/metadata.mjs";

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

const encodeWithVips = (source, slug, work) => {
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
    return readFileSync(encoded);
};

export const makeThumbs = ({ site, encode = encodeWithVips }) => {
    const web = path.join(site, "apps/web");
    const posts = path.join(web, "src/content/blog");
    const thumbs = path.join(web, "public/blog/thumbs");
    const allowlistPath = path.join(site, "privacy-allowlist.json");
    const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
    const made = [];
    const work = mkdtempSync(path.join(tmpdir(), "thumbs-"));
    try {
        for (const name of readdirSync(posts).filter((f) => f.endsWith(".md")).sort()) {
            const file = path.join(posts, name);
            const text = readFileSync(file, "utf8");
            const feature = field(text, "feature_image");
            const slug = field(text, "slug");
            if (!feature || !slug) {
                continue;
            }
            const bytes = stripAndVerify(encode(path.join(web, "public", feature), slug, work), `${slug}.jpg`);
            made.push({ file, text, slug, bytes, out: path.join(thumbs, `${slug}.jpg`) });
        }
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
    // nothing is written until every thumb is made, and the allowlist goes first, so a crash part way never leaves a
    // written image off it
    for (const { bytes, out } of made) {
        allowlist[path.relative(site, out)] = sha256(bytes);
    }
    const sorted = Object.fromEntries(Object.entries(allowlist).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(`${allowlistPath}.tmp`, `${JSON.stringify(sorted, null, 2)}\n`);
    renameSync(`${allowlistPath}.tmp`, allowlistPath);
    mkdirSync(thumbs, { recursive: true });
    for (const { file, text, slug, bytes, out } of made) {
        writeFileSync(out, bytes);
        writeFileSync(file, setThumb(text, `/blog/thumbs/${slug}.jpg`));
    }
    return made.length;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const site = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const made = makeThumbs({ site });
    console.log(`${made} thumbnails in ${path.join(site, "apps/web/public/blog/thumbs")}`);
}
