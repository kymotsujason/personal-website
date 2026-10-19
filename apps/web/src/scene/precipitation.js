// drizzle, rain, and snow, drawn by the screens' glass every frame instead of baked into the sky, which only redraws
// at 30 or 15 fps since each of its frames lays the home screen out again. falling streaks at that rate stuttered.
// the composite keeps how much bare sky shows in its alpha, so the drops fall behind the widgets, icons, and text.
// colors are srgb like the sky's, and the glass turns them linear before it mixes them in

// what falls in each scene, by its index in SCENES (wallpaper.js): 0 nothing, 1 drizzle, 2 rain, 3 snow
const KINDS = [0, 0, 0, 0, 1, 2, 3, 2];
export const precipitationKind = (sceneIndex) => KINDS[Math.round(sceneIndex)] ?? 0;

export const PRECIPITATION_GLSL = `
    float precipHash11(float p) {
        p = fract(p * 0.1031);
        p *= p + 33.33;
        p *= p + p;
        return fract(p);
    }

    float precipHash21(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }

    // one layer of rain: a thin vertical streak in some columns, looping down the screen
    float rainLayer(vec2 uv, float aspect, float time, float cols, float speed, float len, float width, float seed, float density) {
        float column = floor(uv.x * aspect * cols);
        if (precipHash11(column + seed) > density) {
            return 0.0;
        }
        float r = precipHash11(column + seed + 1.7);
        float x = fract(uv.x * aspect * cols) - 0.5;
        float y = fract(uv.y * 0.9 + time * speed * (0.85 + 0.3 * r) + r * 7.0);
        return smoothstep(0.0, 0.015, y) * (1.0 - smoothstep(0.0, len, y)) * (1.0 - smoothstep(0.0, width, abs(x)));
    }

    // one layer of snow: a flake in some cells of a grid that falls and sways. soft blurs it, for the near flakes
    float snowLayer(vec2 uv, float aspect, float time, float scale, float speed, float seed, float density, float radius, float soft) {
        vec2 p = vec2(uv.x * aspect, uv.y) * scale;
        p.y += time * speed;
        p.x += sin(time * 0.6 + p.y * 0.7 + seed) * 0.3;
        vec2 cell = floor(p);
        if (precipHash21(cell + seed) > density) {
            return 0.0;
        }
        vec2 jitter = vec2(precipHash21(cell + seed + 3.1), precipHash21(cell + seed + 7.7)) - 0.5;
        return 1.0 - smoothstep(radius - soft, radius, length(fract(p) - 0.5 - jitter * 0.5));
    }

    // what falls over this point of the sky, as an srgb color and how much of it covers the point. kind is 1 for
    // drizzle, 2 for rain, and 3 for snow, k the intensity (0 to 1), and uv runs up from the bottom
    vec4 precipitation(vec2 uv, float aspect, float time, float kind, float k, float day) {
        if (kind > 2.5) {
            float density = 0.4 + 0.3 * k;
            float flakes = snowLayer(uv, aspect, time, 24.0, 1.6, 9.0, density, 0.07, 0.03) * 0.6
                + snowLayer(uv, aspect, time, 11.0, 1.1, 5.0, density, 0.08, 0.04) * 0.8
                + snowLayer(uv, aspect, time, 5.0, 0.7, 1.0, density * 0.6, 0.14, 0.11) * 0.4;
            return vec4(vec3(0.97, 0.98, 1.0) * mix(0.75, 1.0, day), clamp(flakes, 0.0, 1.0) * 0.85);
        }
        // rain falls straight down in three depths: far streaks thin and faint, near ones longer and stronger
        bool fine = kind < 1.5;
        float density = fine ? 0.06 + 0.06 * k : 0.08 + 0.14 * k;
        float len = fine ? 0.6 : 1.0;
        float speed = fine ? 1.3 : 1.9;
        float streaks = rainLayer(uv, aspect, time, 140.0, speed, 0.05 * len, 0.12, 1.0, density) * 0.6
            + rainLayer(uv, aspect, time, 90.0, speed * 1.15, 0.08 * len, 0.14, 11.0, density) * 0.8
            + rainLayer(uv, aspect, time, 50.0, speed * 1.35, 0.13 * len, 0.16, 23.0, density * 0.8);
        return vec4(mix(vec3(0.55, 0.58, 0.7), vec3(0.88, 0.91, 0.96), day), clamp(streaks, 0.0, 1.0) * 0.32);
    }
`;
