import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

// lays a home screen's icons over the sky into one texture with mipmaps, which is what the screen's glass material
// maps (its frosted blur reads the mip levels). the sky and the icons are both raw srgb, blended the way the 2d canvas
// blended them when the wallpaper was drawn into it, and the blend is turned to linear on the way out so the srgb
// target stores it back as srgb. the icons are premultiplied, as the canvas keeps them
//
// the white text, buttons, and status bar come on a layer of their own (ink), laid over last. each of its pixels
// takes its color from how bright the sky (or the glass) is right behind it: white over a normal sky, fading to dark
// inside the sun's glare or a bright cloud, so only the letters the glare actually covers turn dark. white pixels on
// that layer take the ink, black ones the opposite (the battery's number on its fill), and colored ones keep their
// color but darken with the rest
//
// the widget cards are frosted glass between the sky and the icons: the blurred sky shows through them, bent a little near their
// edges like a lens, and their rims catch light from the sky's own sun and moon (and lightning), from the direction
// each one is in, turned a little by how the phone is tilted
export const MAX_CARDS = 8;

const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

const fragmentShader = `
    uniform sampler2D sky;
    uniform sampler2D frost;
    uniform sampler2D icons;
    uniform sampler2D ink;
    uniform vec4 skyRect;
    uniform float skyAspect;
    uniform vec2 size;
    uniform vec4 cards[${MAX_CARDS}];
    uniform int cardCount;
    uniform float radius;
    uniform vec2 sunAt;
    uniform float sunUp;
    uniform vec2 moonAt;
    uniform float moonUp;
    uniform float day;
    uniform float warm;
    uniform float flash;
    uniform vec2 tilt;
    uniform vec3 tint;
    uniform float frosted;
    varying vec2 vUv;

    // the brightness at which white ink starts to turn dark, and where it's fully dark
    const float INK_FROM = 0.55;
    const float INK_TO = 0.72;
    const vec3 DARK = vec3(0.07);

    float luma(vec3 c) {
        vec3 l = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
        return dot(l, vec3(0.2126, 0.7152, 0.0722));
    }

    vec3 toLinear(vec3 c) {
        return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
    }

    vec2 skyUvOf(vec2 uv) {
        return vec2(uv.x * skyRect.x + skyRect.z, 1.0 - (1.0 - uv.y) * skyRect.y + skyRect.w);
    }

    // distance to a card's rounded rect in screen px (y down), negative inside
    float card(vec2 p, vec4 r) {
        vec2 c = (r.xy + r.zw) * 0.5;
        vec2 q = abs(p - c) - (r.zw - r.xy) * 0.5 + radius;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    }

    // which way a light in the sky is from here, in screen px with y down, turned by the phone's tilt
    vec2 toward(vec2 at, vec2 skyUv) {
        vec2 d = (at - skyUv) * vec2(skyAspect, 1.0);
        return normalize(vec2(d.x, -d.y) + tilt + 1e-5);
    }

    void main() {
        vec2 skyUv = skyUvOf(vUv);
        vec3 back = texture2D(sky, skyUv).rgb;
        // what the ink reads its brightness from: the blurred sky, so a letter doesn't flicker across the sky's detail.
        // plain glass has no blurred sky kept current, so it reads the sky itself
        vec3 behind = frosted > 0.5 ? texture2D(frost, skyUv).rgb : back;
        vec2 p = vec2(vUv.x, 1.0 - vUv.y) * size;

        float d = 1e5;
        vec4 hit = vec4(0.0);
        for (int i = 0; i < ${MAX_CARDS}; i++) {
            if (i >= cardCount) {
                break;
            }
            float di = card(p, cards[i]);
            if (di < d) {
                d = di;
                hit = cards[i];
            }
        }

        if (d < 1.0) {
            // the edge's outward direction, from how the distance changes across a pixel
            vec2 n = normalize(vec2(card(p + vec2(1.0, 0.0), hit) - card(p - vec2(1.0, 0.0), hit), card(p + vec2(0.0, 1.0), hit) - card(p - vec2(0.0, 1.0), hit)) + 1e-5);
            float inside = max(-d, 0.0);
            float lens = pow(1.0 - smoothstep(0.0, 18.0, inside), 2.0);
            // the sky seen through the glass is pulled in from just inside the edge, so the edge magnifies a little
            vec2 bent = vUv + vec2(-n.x, n.y) * lens * 10.0 / size;
            // the frost lifted toward white, a white with a little of the sky's color in it (tint.js). plain glass, on a
            // slow device, lifts the sky itself a little further instead, with no blur and no lens
            vec3 glass = frosted > 0.5 ? mix(texture2D(frost, skyUvOf(bent)).rgb, tint, 0.14) : mix(back, tint, 0.22);

            float sun = sunUp * smoothstep(-0.05, 0.08, sunAt.y);
            float moon = moonUp * smoothstep(-0.03, 0.05, moonAt.y) * (1.0 - day) * 0.6;
            vec3 sunColor = mix(vec3(1.0, 0.97, 0.92), vec3(1.0, 0.7, 0.42), warm);
            vec3 moonColor = vec3(0.72, 0.82, 1.0);
            vec2 toSun = toward(sunAt, skyUv);
            vec2 toMoon = toward(moonAt, skyUv);
            // the edge facing a light catches it, and the far edge shows a fainter reflection of it, as thick glass does
            vec3 lit = sunColor * sun * (pow(max(dot(n, toSun), 0.0), 2.0) + 0.35 * pow(max(dot(n, -toSun), 0.0), 3.0))
                + moonColor * moon * (pow(max(dot(n, toMoon), 0.0), 2.0) + 0.35 * pow(max(dot(n, -toMoon), 0.0), 3.0));
            float line = 1.0 - smoothstep(0.0, 1.6, inside);
            float glow = pow(1.0 - smoothstep(0.0, 16.0, inside), 2.0);
            vec3 rim = line * (0.2 * tint + 0.85 * lit + vec3(flash)) + glow * 0.3 * lit;

            float cover = clamp(0.5 - d, 0.0, 1.0);
            back = mix(back, min(glass + rim, vec3(1.0)), cover);
            behind = mix(behind, glass, cover);
        }

        vec4 front = texture2D(icons, vUv);
        vec3 color = front.rgb + back * (1.0 - front.a);

        vec4 inkPx = texture2D(ink, vUv);
        if (inkPx.a > 0.0) {
            vec3 c = inkPx.rgb / inkPx.a;
            float dark = smoothstep(INK_FROM, INK_TO, luma(behind));
            float hi = max(c.r, max(c.g, c.b));
            float lo = min(c.r, min(c.g, c.b));
            float colored = smoothstep(0.08, 0.25, hi - lo);
            vec3 light = mix(vec3(1.0), DARK, dark);
            vec3 opposite = mix(DARK, vec3(1.0), dark);
            vec3 neutral = mix(opposite, light, lo);
            vec3 inked = mix(neutral, c * mix(1.0, 0.35, dark), colored);
            color = inked * inkPx.a + color * (1.0 - inkPx.a);
        }
        gl_FragColor = vec4(toLinear(color), 1.0);
    }
`;

// where this screen's uv lands on the sky, as scale and offset. frame is where the screen's px sit in the sky's px,
// the same box drawHome took for the gradient: the inner screen's frame is the whole sky, and the cover's is the
// part it lies over when closed
export const skyRectFor = (w, h, frame) => [w / frame.w, h / frame.h, -frame.x / frame.w, frame.y / frame.h];

// light is the sky's own uniforms (wallpaper.js), shared so the rims always match the sun, moon, and lightning drawn
export const createComposite = (renderer, { width, height, sky, frost, icons, ink, skyRect, skyAspect, size, light }) => {
    const target = new THREE.WebGLRenderTarget(width, height, {
        colorSpace: THREE.SRGBColorSpace,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false
    });
    target.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const material = new THREE.ShaderMaterial({
        uniforms: {
            sky: { value: sky },
            frost: { value: frost },
            icons: { value: icons },
            ink: { value: ink },
            skyRect: { value: new THREE.Vector4(...skyRect) },
            skyAspect: { value: skyAspect },
            size: { value: new THREE.Vector2(size.w, size.h) },
            cards: { value: Array.from({ length: MAX_CARDS }, () => new THREE.Vector4()) },
            cardCount: { value: 0 },
            radius: { value: 22 },
            sunAt: light.sunAt,
            sunUp: light.sunUp,
            moonAt: light.moonAt,
            moonUp: light.moonUp,
            day: light.day,
            warm: light.warm,
            flash: light.flash,
            tilt: { value: new THREE.Vector2() },
            tint: { value: new THREE.Color(1, 1, 1) },
            frosted: { value: 1 }
        },
        vertexShader,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending
    });
    const quad = new FullScreenQuad(material);
    const { uniforms } = material;
    let dirty = true;
    return {
        texture: target.texture,
        target,
        sky: () => uniforms.sky.value,
        setSky: (texture) => {
            uniforms.sky.value = texture;
            dirty = true;
        },
        // the widget cards, as { x0, y0, x1, y1 } boxes in the screen's px, and their corner radius
        setCards: (boxes, radius) => {
            boxes.slice(0, MAX_CARDS).forEach((b, i) => uniforms.cards.value[i].set(b.x0, b.y0, b.x1, b.y1));
            uniforms.cardCount.value = Math.min(boxes.length, MAX_CARDS);
            uniforms.radius.value = radius;
            dirty = true;
        },
        // the phone's tilt, which turns where the rims catch the light. it redraws only on a visible change
        setTilt: (x, y) => {
            if (Math.abs(x - uniforms.tilt.value.x) + Math.abs(y - uniforms.tilt.value.y) < 0.02) {
                return;
            }
            uniforms.tilt.value.set(x, y);
            dirty = uniforms.cardCount.value > 0 || dirty;
        },
        // frosted glass, or plain glass for a slow device (see skyLevel.js glassFor)
        setFrosted: (on) => {
            uniforms.frosted.value = on ? 1 : 0;
            dirty = true;
        },
        setTint: (color) => {
            uniforms.tint.value.copy(color);
            dirty = true;
        },
        invalidate: () => {
            dirty = true;
        },
        render: () => {
            if (!dirty) {
                return false;
            }
            const previous = renderer.getRenderTarget();
            renderer.setRenderTarget(target);
            quad.render(renderer);
            renderer.setRenderTarget(previous);
            dirty = false;
            return true;
        },
        dispose: () => {
            target.dispose();
            material.dispose();
        }
    };
};
