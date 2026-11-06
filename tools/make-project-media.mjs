// makes a project's pictures: reads the raw captures in .media/<SLUG>/ and writes web sized, metadata stripped copies
// to apps/web/public/projects/<SLUG>/, each one put on the privacy allowlist. it can run again, and an output that
// already exists gets a new one. run it from site/ (it needs vips, and ffmpeg for a video loop):
//   node tools/make-project-media.mjs <SLUG>
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./privacy/allowlist.mjs";
import { scanMetadata, stripAndVerify } from "./privacy/metadata.mjs";

const STILL_WIDTH = 1200;
const LOOP_WIDTH = 800;
const THUMB_SIZE = 124;
const LOOP_LIMIT = 3_200_000;
const STILL_EXTENSIONS = ["png", "jpg", "webp"];
const LOOP_EXTENSIONS = ["webp", "gif", "mp4", "webm", "mkv"];
const NAME = /^[a-z0-9-]+$/;
const NAME_RULE = "lowercase letters, digits, and hyphens";

const encodeWithTools = ({ kind, source, output }) => {
  const extension = path.extname(source).slice(1).toLowerCase();
  const video = ["mp4", "webm", "mkv"].includes(extension);
  if (kind === "thumb") {
    execFileSync("vips", [
      "thumbnail",
      source,
      `${output}[Q=82,strip]`,
      String(THUMB_SIZE),
      "--height",
      String(THUMB_SIZE),
      "--crop",
      "centre",
    ]);
  } else if (kind === "still" || (kind === "frame" && !video)) {
    execFileSync("vips", [
      "thumbnail",
      source,
      `${output}[Q=82,strip]`,
      String(STILL_WIDTH),
      "--size",
      "down",
    ]);
  } else if (kind === "frame") {
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      source,
      "-frames:v",
      "1",
      "-vf",
      `scale='min(${STILL_WIDTH},iw)':-2`,
      "-c:v",
      "libwebp",
      "-q:v",
      "82",
      output,
    ]);
  } else if (video) {
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      source,
      "-vf",
      `fps=20,scale='min(${LOOP_WIDTH},iw)':-2`,
      "-an",
      "-c:v",
      "libwebp_anim",
      "-q:v",
      "70",
      "-loop",
      "0",
      output,
    ]);
  } else {
    // n=-1 reads every frame, and ffmpeg can't decode an animated webp
    execFileSync("vips", [
      "thumbnail",
      `${source}[n=-1]`,
      `${output}[Q=70,strip]`,
      String(LOOP_WIDTH),
      "--size",
      "down",
    ]);
  }
  return readFileSync(output);
};

const sortInputs = (media) => {
  const inputs = { figures: [] };
  for (const file of readdirSync(media).sort()) {
    const extension = path.extname(file).slice(1).toLowerCase();
    const base = path.basename(file, path.extname(file));
    const source = path.join(media, file);
    if (base === "hero" && STILL_EXTENSIONS.includes(extension)) {
      inputs.hero = source;
    } else if (base === "hero-loop" && LOOP_EXTENSIONS.includes(extension)) {
      inputs.loop = source;
    } else if (base === "thumb" && STILL_EXTENSIONS.includes(extension)) {
      inputs.thumb = source;
    } else if (base.startsWith("fig-")) {
      const name = base.slice(4);
      if (!NAME.test(name)) {
        throw new Error(`${file}: the name after fig- must use ${NAME_RULE}`);
      }
      if (extension === "svg" || STILL_EXTENSIONS.includes(extension)) {
        inputs.figures.push({ name, source, svg: extension === "svg" });
      }
    }
  }
  return inputs;
};

export const makeProjectMedia = ({
  site,
  slug,
  encode = encodeWithTools,
  onWrite,
}) => {
  if (!NAME.test(slug)) {
    throw new Error(`the slug "${slug}" must use ${NAME_RULE}`);
  }
  const media = path.join(site, ".media", slug);
  if (!existsSync(media)) {
    throw new Error(`${media} doesn't exist`);
  }
  const out = path.join(site, "apps/web/public/projects", slug);
  const allowlistPath = path.join(site, "privacy-allowlist.json");
  const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
  const inputs = sortInputs(media);
  if (!inputs.hero && !inputs.loop) {
    throw new Error(`${media} needs a hero or a hero-loop`);
  }
  const made = [];
  const work = mkdtempSync(path.join(tmpdir(), "project-media-"));
  let count = 0;
  const run = (kind, source, name) => {
    count += 1;
    const output = path.join(work, `${count}.webp`);
    const bytes = stripAndVerify(encode({ kind, source, output }), name);
    return { bytes, name };
  };
  try {
    let heroSource = inputs.hero;
    if (inputs.loop) {
      const loop = run("loop", inputs.loop, "hero-loop.webp");
      if (loop.bytes.length > LOOP_LIMIT) {
        throw new Error(
          `hero-loop.webp is ${loop.bytes.length} bytes, over the ${LOOP_LIMIT} byte limit`,
        );
      }
      made.push(loop);
    }
    if (inputs.hero) {
      made.push(run("still", inputs.hero, "hero.webp"));
    } else {
      const frame = run("frame", inputs.loop, "hero.webp");
      made.push(frame);
      heroSource = path.join(work, "hero-frame.webp");
      writeFileSync(heroSource, frame.bytes);
    }
    made.push(run("thumb", inputs.thumb ?? heroSource, "thumb.webp"));
    for (const { name, source, svg } of inputs.figures) {
      if (svg) {
        const bytes = readFileSync(source);
        const found = scanMetadata(bytes, `fig-${name}.svg`);
        if (found.length > 0) {
          throw new Error(`fig-${name}.svg carries ${found.join(", ")}`);
        }
        made.push({ bytes, name: `fig-${name}.svg` });
      } else {
        made.push(run("still", source, `fig-${name}.webp`));
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  made.sort((a, b) => a.name.localeCompare(b.name));
  // nothing is written until every image is made, and the allowlist goes first, so a crash part way never leaves a
  // written image off it
  for (const { bytes, name } of made) {
    allowlist[path.relative(site, path.join(out, name))] = sha256(bytes);
  }
  const sorted = Object.fromEntries(
    Object.entries(allowlist).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(`${allowlistPath}.tmp`, `${JSON.stringify(sorted, null, 2)}\n`);
  renameSync(`${allowlistPath}.tmp`, allowlistPath);
  mkdirSync(out, { recursive: true });
  for (const { bytes, name } of made) {
    onWrite?.(path.join(out, name));
    writeFileSync(path.join(out, name), bytes);
  }
  return made.map(({ name }) => path.relative(site, path.join(out, name)));
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const slug = process.argv[2];
  if (!slug) {
    console.error("usage: node tools/make-project-media.mjs <SLUG>");
    process.exit(1);
  }
  const site = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    for (const written of makeProjectMedia({ site, slug })) {
      console.log(written);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
