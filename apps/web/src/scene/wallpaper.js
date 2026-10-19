import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { SCENES } from "./weather.js";
import { precipitationKind } from "./precipitation.js";

// the animated weather sky behind the home screen, drawn into its own target at the home screen's px (half the icon
// canvas's resolution). it's one shader for all eight scenes, picked by uniforms, so a change of weather doesn't
// compile anything. colors are written as srgb, like the icon canvas, and the composite blends the two. the look
// follows the ios weather backgrounds: the sun as a big glow at the top, clouds hanging from the top of the screen, a
// jagged lightning bolt, blue grey mottled haze for fog, and navy to purple nights. the rain and snow are drawn by the
// screens' glass every frame instead (precipitation.js)
const FPS = 30;
const CROSSFADE = 2;
// the shader gets the clock wrapped at an hour, since a float32 time that grows all visit makes the streaks step
// instead of slide after a few hours. the clouds and streaks jump once an hour where it wraps
export const SHADER_PERIOD = 3600;
const INTENSITY = { light: 0.35, moderate: 0.65, heavy: 1 };
// the most line segments a bolt has, its trunk and two branches
const MAX_BOLT = 24;

const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

// scene indexes follow SCENES: 0 clear, 1 partly cloudy, 2 cloudy, 3 fog, 4 drizzle, 5 rain, 6 snow, 7 thunder.
// positions are in sky units: x runs 0 to aspect and y 0 (bottom) to 1 (top), so circles stay round
const fragmentShader = `
    #define MAX_BOLT ${MAX_BOLT}
    uniform float time;
    uniform float aspect;
    uniform float day;
    uniform float warm;
    uniform float scene;
    uniform float intensity;
    uniform float prevScene;
    uniform float prevIntensity;
    uniform float mixAmount;
    uniform float flash;
    uniform vec2 sunAt;
    uniform float sunUp;
    uniform vec2 moonAt;
    uniform float moonUp;
    uniform float moonPhase;
    uniform vec4 bolt[MAX_BOLT];
    uniform float boltWidth[MAX_BOLT];
    uniform int boltCount;
    varying vec2 vUv;

    float hash11(float p) {
        p = fract(p * 0.1031);
        p *= p + 33.33;
        p *= p + p;
        return fract(p);
    }

    float hash21(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }

    float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x);
        float b = mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x);
        return mix(a, b, u.y);
    }

    float fbm(vec2 p) {
        float sum = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 4; i++) {
            sum += amp * noise(p);
            p = p * 2.03 + vec2(17.1, 9.2);
            amp *= 0.5;
        }
        return sum;
    }

    bool sceneIs(float s, float k) {
        return abs(s - k) < 0.5;
    }

    // what each scene looks like: how much of the cloud band is cloud, where the band fades out at its bottom, how
    // dark the clouds are, how grey the bare sky is, and how much of the sun shows
    struct Look {
        float clouds;
        float bandLow;
        float dark;
        float overcast;
        float sun;
    };

    Look lookFor(float s, float k) {
        if (sceneIs(s, 1.0)) {
            return Look(0.45, 0.6, 0.0, 0.0, 1.0);
        }
        if (sceneIs(s, 2.0)) {
            return Look(0.85, 0.3, 0.2, 0.55, 0.0);
        }
        if (sceneIs(s, 3.0)) {
            return Look(0.0, 1.0, 0.0, 0.0, 0.5);
        }
        if (sceneIs(s, 4.0)) {
            return Look(0.75, 0.5, 0.25, 0.6, 0.35);
        }
        if (sceneIs(s, 5.0)) {
            return Look(0.85, 0.42, 0.45 + 0.2 * k, 0.85, 0.0);
        }
        if (sceneIs(s, 6.0)) {
            return Look(0.7, 0.5, 0.1, 0.55, 0.0);
        }
        if (sceneIs(s, 7.0)) {
            return Look(0.95, 0.3, 0.8, 0.95, 0.0);
        }
        return Look(0.0, 1.0, 0.0, 0.0, 1.0);
    }

    // the bolt: a bright thin core along its segments with a soft glow around it, thinner on the branches
    float boltLight(vec2 p) {
        float core = 0.0;
        float glow = 0.0;
        for (int i = 0; i < MAX_BOLT; i++) {
            if (i >= boltCount) {
                break;
            }
            vec2 a = bolt[i].xy;
            vec2 ba = bolt[i].zw - a;
            vec2 pa = p - a;
            float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
            float d = length(pa - ba * h) / boltWidth[i];
            core = max(core, 1.0 - smoothstep(0.0012, 0.0035, d));
            glow = max(glow, exp(-d * 55.0));
        }
        return core + glow * 0.45;
    }

    vec3 sky(float s, float k, vec2 uv) {
        Look l = lookFor(s, k);
        bool fog = sceneIs(s, 3.0);
        vec2 p = vec2(uv.x * aspect, uv.y);

        // the bare sky, deeper at the top. day is blue, greyer the more overcast, and night is navy at the top to
        // purple low down. fog is a blue grey haze instead, lighter by day
        vec3 dayTop = mix(vec3(0.17, 0.42, 0.80), vec3(0.40, 0.45, 0.52), l.overcast);
        vec3 dayLow = mix(vec3(0.47, 0.70, 0.94), vec3(0.56, 0.61, 0.67), l.overcast);
        vec3 nightTop = mix(vec3(0.05, 0.07, 0.20), vec3(0.08, 0.10, 0.17), l.overcast);
        vec3 nightLow = mix(vec3(0.24, 0.18, 0.42), vec3(0.18, 0.19, 0.27), l.overcast);
        if (fog) {
            dayTop = vec3(0.4, 0.45, 0.53);
            dayLow = vec3(0.42, 0.47, 0.54);
            nightTop = vec3(0.1, 0.11, 0.14);
            nightLow = vec3(0.15, 0.16, 0.19);
        }
        vec3 top = mix(nightTop, dayTop, day) * (1.0 - l.dark * 0.35);
        vec3 low = mix(nightLow, dayLow, day) * (1.0 - l.dark * 0.3);
        // dawn and dusk turn the bottom pink, less so through cloud
        low = mix(low, vec3(0.92, 0.52, 0.55), warm * (1.0 - 0.7 * l.overcast) * 0.75);
        vec3 col = mix(low, top, smoothstep(0.0, 1.0, uv.y));

        // the sun, wherever it is on its arc, the way the ios backgrounds draw it: the sky washes out pale around it,
        // an overexposed white core with a soft uneven edge, a faint rainbow edged halo, lens flare ghosts on the line
        // through the middle of the screen, and soft shafts of light. it fades out as it sinks past the bottom edge,
        // and through fog only the wash shows
        vec2 sun = vec2(sunAt.x * aspect, sunAt.y);
        vec2 toSun = p - sun;
        float d = length(toSun);
        float sunShow = l.sun * sunUp * smoothstep(-0.03, 0.05, sunAt.y);
        if (sunShow > 0.0) {
            vec3 sunColor = mix(vec3(1.0, 0.98, 0.94), vec3(1.0, 0.78, 0.55), warm);
            vec2 around = d > 0.0 ? toSun / d : vec2(1.0, 0.0);
            float wash = min(exp(-d * 3.6) * 0.6 + exp(-d * 13.0) * 0.4, 0.95);
            col = mix(col, mix(vec3(0.86, 0.9, 0.95), sunColor, 0.4), wash * sunShow);
            if (!fog) {
                float wobble = (noise(around * 2.0 + time * 0.2) - 0.5) * 0.025;
                float core = 1.0 - smoothstep(0.04, 0.13 + wobble, d);
                col = mix(col, sunColor, core * sunShow);
                float ring = (d - 0.34) / 0.03;
                vec3 halo = vec3(exp(-pow(ring + 0.6, 2.0)), exp(-ring * ring), exp(-pow(ring - 0.6, 2.0)));
                col += halo * 0.05 * sunShow;
                vec2 mid = vec2(0.5 * aspect, 0.5);
                for (int i = 0; i < 3; i++) {
                    float r = 0.025 + float(i) * 0.015;
                    float g = length(p - mix(sun, mid, 0.55 + float(i) * 0.3));
                    col += vec3(0.85, 0.9, 1.0) * (1.0 - smoothstep(r * 0.6, r, g)) * 0.035 * sunShow;
                }
                float shafts = pow(noise(around * 5.0 + time * 0.03), 4.0) * exp(-d * 2.0) * smoothstep(0.05, 0.25, d);
                col += vec3(0.9, 0.94, 1.0) * shafts * 0.12 * sunShow;
            }
        }

        // thin wisps of cirrus on a clear day
        if (sceneIs(s, 0.0) && day > 0.0) {
            vec2 w = vec2(p.x * 0.8 + p.y * 1.6, p.y * 6.0 - p.x * 1.2) + vec2(time * 0.01, 0.0);
            float wisp = smoothstep(0.55, 0.85, fbm(w)) * smoothstep(0.3, 0.8, uv.y);
            col = mix(col, vec3(0.92, 0.95, 0.98), wisp * 0.18 * day);
        }

        // faint stars on a clear night
        float open = (1.0 - l.overcast) * (fog ? 0.0 : 1.0);
        if (open > 0.0 && day < 1.0) {
            vec2 grid = p * 110.0;
            float r = hash21(floor(grid));
            float twinkle = 0.55 + 0.45 * sin(time * 1.3 + r * 40.0);
            float star = step(0.988, r) * (1.0 - smoothstep(0.0, 0.1, length(fract(grid) - 0.5))) * twinkle;
            col += vec3(star) * 0.8 * (1.0 - day) * open * smoothstep(0.25, 0.7, uv.y);
        }

        // the moon on its own arc with its real phase, lit on the right as it waxes and the left as it wanes. it's
        // pale by day and brighter at night, its dark side shows faintly at night, and cloud covers it
        float moonShow = moonUp * smoothstep(-0.03, 0.05, moonAt.y) * (1.0 - 0.9 * l.overcast) * (fog ? 0.0 : 1.0);
        if (moonShow > 0.0) {
            vec2 mv = (p - vec2(moonAt.x * aspect, moonAt.y)) / 0.045;
            float r = length(mv);
            float k = cos(6.2831853 * moonPhase);
            if (r < 1.0) {
                float s = sqrt(max(1.0 - mv.y * mv.y, 0.0));
                float side = moonPhase < 0.5 ? mv.x : -mv.x;
                float lit = smoothstep(-0.06, 0.06, side - k * s);
                float disk = 1.0 - smoothstep(0.92, 1.0, r);
                float amount = disk * (0.1 * (1.0 - day) + lit * mix(0.6, 1.0, 1.0 - day));
                col = mix(col, vec3(0.93, 0.94, 0.98), amount * moonShow);
            }
            col += vec3(0.6, 0.65, 0.8) * exp(-r * 1.6) * 0.14 * (1.0 - day) * (1.0 - k) * 0.5 * moonShow;
        }

        // clouds hang from the top of the screen in a band, drifting: big warped shapes worn into wisps at their edges
        // by a finer layer, with gaps where the sky shows. each is lit on top and greyer underneath, found by how much
        // more cloud sits just above it. at night they catch the moon and the town, so they read a little lighter than
        // the sky. lightning lights them from inside around where the bolt starts
        if (l.clouds > 0.0) {
            vec2 q = p * vec2(1.1, 2.6) + vec2(time * 0.008, 0.0);
            vec2 warp = vec2(fbm(q * 0.7 + 3.1), fbm(q * 0.7 + 7.4));
            vec2 qw = q + warp * 1.1;
            float n = fbm(qw);
            float m = fbm(qw * vec2(3.4, 2.2) + vec2(time * 0.015, 1.7));
            float shape = n * 0.72 + m * 0.28;
            float above = fbm(qw + vec2(0.0, 0.09)) * 0.72 + m * 0.28;
            float band = smoothstep(l.bandLow - 0.1, l.bandLow + 0.25, uv.y);
            float threshold = 0.6 - 0.22 * l.clouds;
            float dens = smoothstep(threshold, threshold + 0.07, shape) * band;
            float top = clamp((shape - above) * 6.0 + 0.5, 0.0, 1.0);
            // by day an overcast cloud is a light grey, which also keeps the home screen's white text readable on it
            vec3 lit = mix(vec3(0.3, 0.32, 0.43), mix(vec3(0.96, 0.97, 0.99), vec3(0.78, 0.8, 0.84), l.overcast), day);
            lit = mix(lit, vec3(1.0, 0.82, 0.74), warm * 0.35 * (1.0 - l.overcast));
            lit *= 1.0 - l.dark * 0.55;
            // fair weather clouds stay bright white puffs, and only overcast ones go grey underneath
            float floorShade = mix(0.84, 0.6, l.overcast);
            float shade = mix(floorShade, 1.0, smoothstep(0.15, 0.85, top)) * mix(mix(0.95, 0.85, l.overcast), 1.0, smoothstep(l.bandLow, 1.0, uv.y));
            vec3 cloud = lit * shade;
            if (flash > 0.0 && boltCount > 0) {
                cloud += vec3(0.55, 0.6, 0.78) * flash * exp(-length(p - bolt[0].xy) * 3.5);
            }
            col = mix(col, cloud, dens);
        }

        // fog is soft mottled haze in two layers drifting at their own speeds, the near one larger and faster, over a
        // lighter band across the middle of the screen, the way the ios fog background reads
        if (fog) {
            // the palest patch stays a little under where the labels' ink turns dark (composite.js), so they stay white
            vec3 pale = mix(vec3(0.24, 0.25, 0.29), vec3(0.56, 0.59, 0.64), day);
            float band = smoothstep(0.15, 0.55, uv.y) * (1.0 - smoothstep(0.65, 1.0, uv.y));
            col = mix(col, pale, band * 0.3);
            float far = fbm(vec2(p.x * 2.2 + time * 0.006, uv.y * 3.0) + vec2(4.2, 1.3));
            float near = fbm(vec2(p.x * 1.3 - time * 0.011, uv.y * 2.0) + fbm(p * 2.5 + 6.1) * 0.7);
            col = mix(col, pale, smoothstep(0.3, 0.7, far) * 0.55);
            col = mix(col, pale, smoothstep(0.38, 0.75, near) * 0.6);
            col *= mix(0.84, 1.02, smoothstep(0.2, 0.6, near));
        }

        // drizzle by day lets soft shafts of light through
        if (sceneIs(s, 4.0) && day > 0.0) {
            float shafts = pow(noise(vec2(p.x * 6.0 + p.y * 1.5, time * 0.05)), 3.0) * smoothstep(0.1, 0.9, uv.y);
            col += vec3(0.9, 0.92, 0.95) * shafts * 0.18 * day;
        }

        return clamp(col, 0.0, 1.0);
    }

    void main() {
        vec3 col = sky(scene, intensity, vUv);
        if (mixAmount < 1.0) {
            col = mix(sky(prevScene, prevIntensity, vUv), col, mixAmount);
        }
        if (flash > 0.0 && boltCount > 0) {
            col += vec3(0.86, 0.9, 1.0) * boltLight(vec2(vUv.x * aspect, vUv.y)) * flash;
        }
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
`;

// a new jagged bolt for each strike, in sky units: a trunk zigzagging from up in the clouds to below the bottom edge,
// and two thin branches that split off partway down and trail away to the side
const makeBolt = (aspect) => {
    const segs = [];
    const widths = [];
    let x = (0.25 + Math.random() * 0.5) * aspect;
    let y = 0.78 + Math.random() * 0.1;
    const trunk = [[x, y]];
    while (y > -0.02 && trunk.length < 17) {
        y -= 0.045 + Math.random() * 0.03;
        x += (Math.random() - 0.5) * 0.07;
        trunk.push([x, y]);
    }
    for (let i = 1; i < trunk.length; i++) {
        segs.push([...trunk[i - 1], ...trunk[i]]);
        widths.push(1);
    }
    for (let b = 0; b < 2 && segs.length < MAX_BOLT; b++) {
        let [bx, by] = trunk[2 + Math.floor(Math.random() * Math.max(1, trunk.length - 6))];
        const side = Math.random() < 0.5 ? -1 : 1;
        for (let i = 0; i < 4 && segs.length < MAX_BOLT; i++) {
            const nx = bx + side * (0.02 + Math.random() * 0.04);
            const ny = by - (0.03 + Math.random() * 0.03);
            segs.push([bx, by, nx, ny]);
            widths.push(0.5 - i * 0.08);
            bx = nx;
            by = ny;
        }
    }
    return { segs, widths };
};

// scene and intensity are what the sky starts on, with no crossfade, so a rebuilt phone shows the same weather at
// once. sun is where the sun's center sits, in the sky's uv (y 1 is the top edge)
const PROBE_WIDTH = 96;

export const createWallpaper = (renderer, { width, height, scene = "clear", intensity = "moderate", sun = [0.5, 1.02] }) => {
    const startIndex = Math.max(SCENES.indexOf(scene), 0);
    const startIntensity = INTENSITY[intensity] ?? INTENSITY.moderate;
    const aspect = width / height;
    const target = new THREE.WebGLRenderTarget(Math.round(width), Math.round(height), {
        colorSpace: THREE.NoColorSpace,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false
    });
    const uniforms = {
        time: { value: 0 },
        aspect: { value: aspect },
        day: { value: 1 },
        warm: { value: 0 },
        scene: { value: startIndex },
        intensity: { value: startIntensity },
        prevScene: { value: startIndex },
        prevIntensity: { value: startIntensity },
        mixAmount: { value: 1 },
        flash: { value: 0 },
        sunAt: { value: new THREE.Vector2(sun[0], sun[1]) },
        sunUp: { value: 1 },
        moonAt: { value: new THREE.Vector2(0.5, -1) },
        moonUp: { value: 0 },
        moonPhase: { value: 0 },
        bolt: { value: Array.from({ length: MAX_BOLT }, () => new THREE.Vector4()) },
        boltWidth: { value: new Array(MAX_BOLT).fill(1) },
        boltCount: { value: 0 }
    };
    const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    const quad = new FullScreenQuad(material);
    // a small copy of the sky for ink.js to read back. the shader works in uv, so it draws the same sky at any size
    const probe = new THREE.WebGLRenderTarget(PROBE_WIDTH, Math.max(Math.round(PROBE_WIDTH / aspect), 1), {
        colorSpace: THREE.NoColorSpace,
        generateMipmaps: false,
        depthBuffer: false
    });

    let current = { scene: SCENES[startIndex], intensity: INTENSITY[intensity] ? intensity : "moderate" };
    let still = false;
    let rate = FPS;
    let dirty = true;
    // the sky's own seconds, which stop while it's still
    let clock = 0;
    let lastSeconds = null;
    let lastDraw = -Infinity;
    let fadeStart = -Infinity;
    let nextStrike = 2;
    let strike = [];

    const newBolt = () => {
        const { segs, widths } = makeBolt(aspect);
        segs.forEach((s, i) => uniforms.bolt.value[i].set(...s));
        widths.forEach((w, i) => {
            uniforms.boltWidth.value[i] = w;
        });
        uniforms.boltCount.value = segs.length;
    };

    // lightning is one or two pulses within 300 ms, then 4 to 12 s of nothing, so it never flashes more than twice in
    // a second (wcag 2.3.1 allows three). each strike gets its own bolt, and the bolt lights up instead of the sky
    const flashAt = (t) => {
        if (current.scene !== "thunder" || still) {
            return 0;
        }
        if (t >= nextStrike) {
            strike = Math.random() < 0.5 ? [t] : [t, t + 0.15 + Math.random() * 0.1];
            nextStrike = t + 4 + Math.random() * 8;
            newBolt();
        }
        return strike.reduce((brightest, start) => (t >= start ? Math.max(brightest, Math.exp(-(t - start) / 0.08)) : brightest), 0);
    };

    const setWeather = (scene, intensity) => {
        const index = SCENES.indexOf(scene);
        if (index < 0 || (scene === current.scene && intensity === current.intensity)) {
            return;
        }
        uniforms.prevScene.value = uniforms.scene.value;
        uniforms.prevIntensity.value = uniforms.intensity.value;
        uniforms.scene.value = index;
        uniforms.intensity.value = INTENSITY[intensity] ?? INTENSITY.moderate;
        current = { scene, intensity };
        fadeStart = still ? -Infinity : clock;
        if (scene === "thunder") {
            nextStrike = clock + 2;
        }
        dirty = true;
    };

    // sun is { x, y, up } and moon { x, y, up, phase } from skyPath.js. a still sky draws again only if one moved
    const setBodies = ({ sun, moon }) => {
        const next = [sun.x, sun.y, sun.up, moon.x, moon.y, moon.up, moon.phase];
        const now = [uniforms.sunAt.value.x, uniforms.sunAt.value.y, uniforms.sunUp.value, uniforms.moonAt.value.x, uniforms.moonAt.value.y, uniforms.moonUp.value, uniforms.moonPhase.value];
        if (next.every((v, i) => Math.abs(v - now[i]) < 1e-4)) {
            return;
        }
        uniforms.sunAt.value.set(sun.x, sun.y);
        uniforms.sunUp.value = sun.up;
        uniforms.moonAt.value.set(moon.x, moon.y);
        uniforms.moonUp.value = moon.up;
        uniforms.moonPhase.value = moon.phase;
        dirty = true;
    };

    const setDaylight = (day, warm) => {
        if (Math.abs(day - uniforms.day.value) < 0.001 && Math.abs(warm - uniforms.warm.value) < 0.001) {
            return;
        }
        uniforms.day.value = day;
        uniforms.warm.value = warm;
        dirty = true;
    };

    // a still sky finishes any crossfade at once and draws one more frame
    const setStill = (value) => {
        if (value === still) {
            return;
        }
        still = value;
        if (still) {
            fadeStart = -Infinity;
        }
        dirty = true;
    };

    const update = (seconds) => {
        const dt = lastSeconds === null ? 0 : Math.min(seconds - lastSeconds, 0.1);
        lastSeconds = seconds;
        if (!still) {
            clock += dt;
        }
        // the 2 ms of slack lets a 60 hz display draw every other frame instead of every third
        const due = !still && seconds - lastDraw >= 1 / rate - 0.002;
        if (!due && !dirty) {
            return false;
        }
        uniforms.time.value = clock % SHADER_PERIOD;
        uniforms.mixAmount.value = Math.min((clock - fadeStart) / CROSSFADE, 1);
        uniforms.flash.value = flashAt(clock);
        const previous = renderer.getRenderTarget();
        renderer.setRenderTarget(target);
        quad.render(renderer);
        renderer.setRenderTarget(previous);
        lastDraw = seconds;
        dirty = false;
        return true;
    };

    // the sky as it is now, read back small. a lightning flash is left out, so a strike doesn't turn the text dark
    const measure = () => {
        const flash = uniforms.flash.value;
        uniforms.flash.value = 0;
        const previous = renderer.getRenderTarget();
        renderer.setRenderTarget(probe);
        quad.render(renderer);
        renderer.setRenderTarget(previous);
        uniforms.flash.value = flash;
        const pixels = new Uint8Array(probe.width * probe.height * 4);
        renderer.readRenderTargetPixels(probe, 0, 0, probe.width, probe.height, pixels);
        return { width: probe.width, height: probe.height, pixels };
    };

    return {
        texture: target.texture,
        // the uniforms the sky is drawn with, which the composite's glass reads its light from
        uniforms,
        measure,
        weather: () => ({ ...current }),
        setWeather,
        setDaylight,
        setBodies,
        setStill,
        setRate: (fps) => {
            rate = fps;
        },
        update,
        drawn: () => lastDraw > -Infinity,
        still: () => still,
        // what's falling, for the glass to draw: its kind (precipitation.js), the intensity, how far the crossfade
        // into this weather has come, and the daylight
        precipitation: () => ({
            kind: precipitationKind(uniforms.scene.value),
            intensity: uniforms.intensity.value,
            fade: uniforms.mixAmount.value,
            day: uniforms.day.value
        }),
        dispose: () => {
            target.dispose();
            probe.dispose();
            material.dispose();
        }
    };
};
