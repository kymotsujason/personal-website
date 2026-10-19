// renders apps/web/public/clouds.webp, the cloud layer of the pages' sky, from the same noise the home screen's
// wallpaper shader draws its clouds with (scene/wallpaper.js). run it by hand from site/ (it needs vips):
//   node tools/render-clouds.mjs [--out <FILE>]
// white is a cloud's lit top and grey its underside, the alpha is how much cloud there is, and it fades out toward the
// bottom the way the shader's band does. the page sets its brightness and opacity from the weather (lib/sky.js). the
// privacy allowlist then needs the new file's sha-256, which the last line prints
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./privacy/allowlist.mjs";
import { stripAndVerify } from "./privacy/metadata.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf("--out");
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : path.join(here, "../apps/web/public/clouds.webp"));

const WIDTH = 1600;
const HEIGHT = 720;
// the screen's shape the shader's coordinates assume, and the scene's cloud cover (cloudy)
const ASPECT = 16 / 9;
const CLOUDS = 0.85;
const BAND_LOW = 0.3;

const fract = (v) => v - Math.floor(v);
const smoothstep = (a, b, v) => {
    const t = Math.min(Math.max((v - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
};
const clamp = (v) => Math.min(Math.max(v, 0), 1);

const hash21 = (x, y) => {
    let a = fract(x * 0.1031);
    let b = fract(y * 0.1031);
    let c = fract(x * 0.1031);
    const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
    a += d;
    b += d;
    c += d;
    return fract((a + b) * c);
};

const noise = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash21(ix, iy) + (hash21(ix + 1, iy) - hash21(ix, iy)) * ux;
    const b = hash21(ix, iy + 1) + (hash21(ix + 1, iy + 1) - hash21(ix, iy + 1)) * ux;
    return a + (b - a) * uy;
};

const fbm = (x, y) => {
    let sum = 0;
    let amp = 0.5;
    for (let i = 0; i < 4; i++) {
        sum += amp * noise(x, y);
        x = x * 2.03 + 17.1;
        y = y * 2.03 + 9.2;
        amp *= 0.5;
    }
    return sum;
};

const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
const threshold = 0.6 - 0.22 * CLOUDS;
for (let j = 0; j < HEIGHT; j++) {
    // the shader's uv.y runs up from the bottom
    const v = 1 - j / (HEIGHT - 1);
    for (let i = 0; i < WIDTH; i++) {
        const px = (i / (WIDTH - 1)) * ASPECT;
        const qx = px * 1.1;
        const qy = v * 2.6;
        const wx = fbm(qx * 0.7 + 3.1, qy * 0.7 + 3.1);
        const wy = fbm(qx * 0.7 + 7.4, qy * 0.7 + 7.4);
        const x = qx + wx * 1.1;
        const y = qy + wy * 1.1;
        const n = fbm(x, y);
        const m = fbm(x * 3.4, y * 2.2 + 1.7);
        const shape = n * 0.72 + m * 0.28;
        const above = fbm(x, y + 0.09) * 0.72 + m * 0.28;
        const band = smoothstep(BAND_LOW - 0.1, BAND_LOW + 0.25, v);
        const dens = smoothstep(threshold, threshold + 0.07, shape) * band;
        const top = clamp((shape - above) * 6 + 0.5);
        const shade = (0.6 + 0.4 * smoothstep(0.15, 0.85, top)) * (0.85 + 0.15 * smoothstep(BAND_LOW, 1, v));
        const k = (j * WIDTH + i) * 4;
        rgba[k] = Math.round(255 * shade * 0.97);
        rgba[k + 1] = Math.round(255 * shade * 0.98);
        rgba[k + 2] = Math.round(255 * shade);
        rgba[k + 3] = Math.round(255 * dens * 0.92);
    }
}

const work = mkdtempSync(path.join(tmpdir(), "clouds-"));
try {
    const raw = path.join(work, "clouds.raw");
    const encoded = path.join(work, "clouds.webp");
    writeFileSync(raw, rgba);
    execFileSync("vips", ["rawload", raw, path.join(work, "clouds.v"), String(WIDTH), String(HEIGHT), "4"]);
    execFileSync("vips", ["copy", path.join(work, "clouds.v"), `${encoded}[Q=80,strip]`]);
    const clean = stripAndVerify(readFileSync(encoded), "clouds.webp");
    writeFileSync(out, clean);
    console.log(`wrote ${out} (${clean.length} bytes)`);
    console.log(sha256(clean));
} finally {
    rmSync(work, { recursive: true, force: true });
}
