import * as THREE from "three";
import { PRECIPITATION_GLSL } from "./precipitation.js";
import { EXTRA_HOLES } from "./shared/motion.js";
import { roundedRect } from "./shared/homeDraw.js";

// snapshotCards.js reads EXTRA_HOLES from here
export { EXTRA_HOLES };

export { glyphRect, elementRect, drawGradient, drawHome, redrawStatus } from "./shared/homeDraw.js";

// the duo's unfold effect: the content stays put on a fixed plane (where the screen lies flat, or where the cover
// lies closed), and the moving screen acts as frosted glass lifting off it. each pixel looks from the eye through the
// glass to that plane, and is blurred and dimmed by how far the glass has lifted off the content there. a pixel whose
// whole blur misses the content is black. so the frost grows with the angle and with distance from the hinge, and
// the part lying flat stays sharp
const GLASS_SPREAD = 0.3;
const GLASS_DARKEN = 0.006;
const GLASS_MAX_DARKEN = 0.5;
const GLASS_TAPS = 16;
// the most a point blurs, in px, so steep angles still show soft shapes of color instead of one even wash
const GLASS_MAX_RADIUS = 60;

// shared by both screens' glass: where the body and the eye are, and what's falling (precipitation.js), which the loop
// sets each frame
export const glassUniforms = () => ({
    toBody: { value: new THREE.Matrix4() },
    eye: { value: new THREE.Vector3() },
    precipKind: { value: 0 },
    precipK: { value: 0 },
    precipFade: { value: 0 },
    precipDay: { value: 1 },
    precipTime: { value: 0 }
});

export const glassMaterial = (shared, pxPerCm) => {
    const uniforms = {
        ...shared,
        planeOrigin: { value: new THREE.Vector3() },
        planeU: { value: new THREE.Vector3(1, 0, 0) },
        planeV: { value: new THREE.Vector3(0, -1, 0) },
        texSize: { value: new THREE.Vector2(1, 1) }
    };
    const material = new THREE.MeshBasicMaterial({ toneMapped: false });
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace("void main() {", "varying vec3 vWorldPos;\nvoid main() {")
            .replace("#include <project_vertex>", "#include <project_vertex>\n    vWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
        shader.fragmentShader = shader.fragmentShader
            .replace("void main() {", `uniform mat4 toBody;
uniform vec3 eye;
uniform vec3 planeOrigin;
uniform vec3 planeU;
uniform vec3 planeV;
uniform vec2 texSize;
uniform float precipKind;
uniform float precipK;
uniform float precipFade;
uniform float precipDay;
uniform float precipTime;
varying vec3 vWorldPos;
${PRECIPITATION_GLSL}
void main() {`)
            .replace("#include <map_fragment>", `#ifdef USE_MAP
    vec3 p = ( toBody * vec4( vWorldPos, 1.0 ) ).xyz;
    float gap = abs( p.z - planeOrigin.z );
    vec4 sampledDiffuseColor = texture2D( map, vMapUv );
    if ( gap > 0.01 ) {
        vec3 dir = p - eye;
        float t = ( planeOrigin.z - eye.z ) / dir.z;
        vec3 hit = eye + dir * t;
        vec3 rel = hit - planeOrigin;
        vec2 uv = vec2( dot( rel, planeU ) / dot( planeU, planeU ), 1.0 - dot( rel, planeV ) / dot( planeV, planeV ) );
        float radiusPx = min( ${GLASS_SPREAD.toFixed(3)} * gap * ${pxPerCm.toFixed(3)}, ${GLASS_MAX_RADIUS.toFixed(1)} );
        vec2 radiusUv = radiusPx / texSize;
        if ( abs( dir.z ) < 1e-4 || t < 0.0 || any( lessThan( uv, -radiusUv ) ) || any( greaterThan( uv, 1.0 + radiusUv ) ) ) {
            sampledDiffuseColor = vec4( 0.0, 0.0, 0.0, 1.0 );
        } else {
            // a vogel disk turned by per pixel noise, so the blur reads as frosted grain instead of banding, read
            // from a mip level coarse enough that the taps don't leave gaps. a slow device reads that level once
            float lod = max( 0.0, log2( radiusPx * 0.9 ) );
#ifdef GLASS_SIMPLE
            vec3 sum = textureLod( map, clamp( uv, 0.0, 1.0 ), lod ).rgb * ${GLASS_TAPS.toFixed(1)};
#else
            float turn = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2831853;
            vec3 sum = vec3( 0.0 );
            for ( int i = 0; i < ${GLASS_TAPS}; i++ ) {
                float fi = float( i );
                float r = sqrt( ( fi + 0.5 ) / ${GLASS_TAPS.toFixed(1)} );
                float a = fi * 2.39996 + turn;
                vec2 q = uv + radiusUv * r * vec2( cos( a ), sin( a ) );
                float inside = step( 0.0, q.x ) * step( q.x, 1.0 ) * step( 0.0, q.y ) * step( q.y, 1.0 );
                sum += textureLod( map, q, lod ).rgb * inside;
            }
#endif
            float dim = max( 1.0 - ${GLASS_DARKEN.toFixed(4)} * radiusPx, ${(1 - GLASS_MAX_DARKEN).toFixed(3)} );
            sampledDiffuseColor = vec4( sum / ${GLASS_TAPS.toFixed(1)} * dim, 1.0 );
        }
    }
    // the rain or snow, over the bare sky only (the composite keeps how much shows in its alpha), at the screen's
    // own shape
    if ( precipKind > 0.5 && precipFade > 0.0 ) {
        float skyShows = texture2D( map, vMapUv ).a;
        if ( skyShows > 0.0 ) {
            vec4 fall = precipitation( vMapUv, texSize.x / texSize.y, precipTime, precipKind, precipK, precipDay );
            sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, pow( fall.rgb, vec3( 2.2 ) ), fall.a * skyShows * precipFade );
        }
    }
    diffuseColor *= sampledDiffuseColor;
#endif`);
    };
    material.customProgramCacheKey = () => (isGlassSimple(material) ? "glass simple" : "glass");
    material.userData.glass = uniforms;
    return material;
};

const isGlassSimple = (material) => Boolean(material.defines && "GLASS_SIMPLE" in material.defines);

// the glass's one tap blur in place of its sixteen, for a device the quality ladder has stepped down (quality.js)
export const setGlassSimple = (material, on) => {
    if (isGlassSimple(material) === on) {
        return;
    }
    const defines = { ...(material.defines || {}) };
    if (on) {
        defines.GLASS_SIMPLE = "";
    } else {
        delete defines.GLASS_SIMPLE;
    }
    material.defines = defines;
    material.needsUpdate = true;
};

// where a glass material's content plane is: three corners (top left, top right, bottom left) in the body's own
// frame, and the content's size in px
export const setGlassPlane = (material, corners, w, h) => {
    const [tl, tr, bl] = corners;
    const g = material.userData.glass;
    g.planeOrigin.value.copy(tl);
    g.planeU.value.copy(tr).sub(tl);
    g.planeV.value.copy(bl).sub(tl);
    g.texSize.value.set(w, h);
};

// a home screen's icons, widgets, and status bar over a clear background, for the composite to lay over the sky.
// it's kept raw (no color space) and premultiplied, since the composite blends in srgb the way the canvas did, and
// it's read at its own size, so it needs no mipmaps
export const iconTexture = (canvas) => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.premultiplyAlpha = true;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    return texture;
};

// uvs from where each vertex sits in device space against a surface's top left corner, so the same mapping works for
// both orientations and keeps the two halves' textures continuous across the hinge
export const mapScreenUV = (mesh, rootInverse, surface) => {
    const pos = mesh.geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    const m = new THREE.Matrix4().copy(rootInverse).multiply(mesh.matrixWorld);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        uv[i * 2] = (v.x - surface.origin.dx) / surface.width;
        uv[i * 2 + 1] = 1 - (surface.origin.dy - v.y) / surface.height;
    }
    mesh.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
};

// punches an ios style app window (a rounded rect in the home screen's own px) through the screen, so the html app
// behind the canvas shows there. tl, u, v map screen px to the mesh's local plane
export const appWindowMaterial = () => new THREE.ShaderMaterial({
    uniforms: {
        tl: { value: new THREE.Vector2() },
        u: { value: new THREE.Vector2(1, 0) },
        v: { value: new THREE.Vector2(0, 1) },
        rect: { value: new THREE.Vector4(0, 0, 0, 0) },
        radius: { value: 0 },
        opacity: { value: 1 },
        // the app switcher's kept pages (see snapshotCards.js), each through a hole of its own with its own opacity
        extras: { value: Array.from({ length: EXTRA_HOLES }, () => new THREE.Vector4()) },
        extraOpacity: { value: new Array(EXTRA_HOLES).fill(0) },
        extraRadius: { value: 0 }
    },
    vertexShader: `
        varying vec2 vLocal;
        void main() {
            vLocal = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec2 tl;
        uniform vec2 u;
        uniform vec2 v;
        uniform vec4 rect;
        uniform float radius;
        uniform float opacity;
        uniform vec4 extras[${EXTRA_HOLES}];
        uniform float extraOpacity[${EXTRA_HOLES}];
        uniform float extraRadius;
        varying vec2 vLocal;

        // how open the cutout of a rounded rect is at px
        float hole(vec2 px, vec4 box, float corner) {
            vec2 center = (box.xy + box.zw) * 0.5;
            vec2 halfSize = (box.zw - box.xy) * 0.5;
            // css caps a corner at half the shorter side, so the cutout does too, or a short window's cutout ran past
            // its top and bottom and showed the page behind the canvas
            float r = min(corner, min(halfSize.x, halfSize.y));
            vec2 q = abs(px - center) - halfSize + r;
            float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
            // the cutout's edge is softened over a pixel and sits a pixel inside the window's, so the window's own
            // softened edge, which lets the black stage behind it through, stays under the canvas
            float aa = fwidth(dist);
            return 1.0 - smoothstep(-2.0 * aa, -aa, dist);
        }

        void main() {
            vec2 d = vLocal - tl;
            float det = u.x * v.y - u.y * v.x;
            vec2 px = vec2((d.x * v.y - d.y * v.x) / det, (u.x * d.y - u.y * d.x) / det);
            // opacity lets the window fade in over a widget it grows out of, instead of covering it at once
            float open = hole(px, rect, radius) * opacity;
            for (int i = 0; i < ${EXTRA_HOLES}; i++) {
                if (extraOpacity[i] > 0.0) {
                    open = max(open, hole(px, extras[i], extraRadius) * extraOpacity[i]);
                }
            }
            if (open <= 0.0) {
                discard;
            }
            gl_FragColor = vec4(0.0, 0.0, 0.0, open);
        }
    `,
    // what's drawn is kept by how much of the pixel the cutout leaves, color and alpha alike, since the canvas is
    // premultiplied
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false
});

// up to four cards drawn over the screen in the same px as the app window's cutout, for an app switch and the app
// switcher. each card's kind is 0 (none), 1 (only its label, over the live window), 2 (a stand in in the page's sky
// with the app's icon in the middle), or 3 (a stand in with nothing on it). a label is the app's icon and name above
// its card, from the atlas (see cardAtlas), and slot is the app's column there. the sky is srgb, as css gives it
export const CARD_SLOTS = 4;
export const appCardMaterial = () => new THREE.ShaderMaterial({
    uniforms: {
        tl: { value: new THREE.Vector2() },
        u: { value: new THREE.Vector2(1, 0) },
        v: { value: new THREE.Vector2(0, 1) },
        bodies: { value: Array.from({ length: CARD_SLOTS }, () => new THREE.Vector4()) },
        labels: { value: Array.from({ length: CARD_SLOTS }, () => new THREE.Vector4()) },
        kinds: { value: new Array(CARD_SLOTS).fill(0) },
        // each card's own opacity, so one being opened stays solid while the rest fade (fade takes the labels and the
        // backdrop)
        alphas: { value: new Array(CARD_SLOTS).fill(1) },
        slots: { value: new Array(CARD_SLOTS).fill(0) },
        radius: { value: 0 },
        top: { value: new THREE.Vector3() },
        low: { value: new THREE.Vector3() },
        fade: { value: 1 },
        // the switcher's backdrop: the sky, darkened, over the whole screen behind the cards (0 for none), with the
        // top and bottom of the page in the screen's px for its gradient
        backdrop: { value: 0 },
        span: { value: new THREE.Vector2(0, 1) },
        atlas: { value: null }
    },
    vertexShader: `
        varying vec2 vLocal;
        void main() {
            vLocal = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec2 tl;
        uniform vec2 u;
        uniform vec2 v;
        uniform vec4 bodies[${CARD_SLOTS}];
        uniform vec4 labels[${CARD_SLOTS}];
        uniform float kinds[${CARD_SLOTS}];
        uniform float alphas[${CARD_SLOTS}];
        uniform float slots[${CARD_SLOTS}];
        uniform float radius;
        uniform vec3 top;
        uniform vec3 low;
        uniform float fade;
        uniform float backdrop;
        uniform vec2 span;
        uniform sampler2D atlas;
        varying vec2 vLocal;

        float roundedDistance(vec2 px, vec4 rect) {
            vec2 center = (rect.xy + rect.zw) * 0.5;
            vec2 halfSize = (rect.zw - rect.xy) * 0.5;
            float r = min(radius, min(halfSize.x, halfSize.y));
            vec2 q = abs(px - center) - halfSize + r;
            return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        }

        void main() {
            vec2 d = vLocal - tl;
            float det = u.x * v.y - u.y * v.x;
            vec2 px = vec2((d.x * v.y - d.y * v.x) / det, (u.x * d.y - u.y * d.x) / det);
            float sy = clamp((px.y - span.x) / max(span.y - span.x, 1.0), 0.0, 1.0);
            vec4 color = vec4(mix(top, low, sy) * 0.55, backdrop * fade);
            for (int i = 0; i < ${CARD_SLOTS}; i++) {
                float kind = kinds[i];
                if (kind < 0.5) {
                    continue;
                }
                vec4 body = bodies[i];
                // the live window shows through the backdrop
                if (kind < 1.5) {
                    float liveDist = roundedDistance(px, body);
                    color.a *= smoothstep(-fwidth(liveDist), 0.0, liveDist);
                }
                if (kind > 1.5) {
                    float dist = roundedDistance(px, body);
                    float inside = (1.0 - smoothstep(-fwidth(dist), 0.0, dist)) * alphas[i];
                    if (inside > 0.0) {
                        float y = clamp((px.y - body.y) / max(body.w - body.y, 1.0), 0.0, 1.0);
                        vec3 c = mix(top, low, y);
                        if (kind < 2.5) {
                            float side = min(body.z - body.x, body.w - body.y) * 0.3;
                            vec2 q = (px - ((body.xy + body.zw) * 0.5 - side * 0.5)) / side;
                            if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) {
                                vec4 icon = texture2D(atlas, vec2((slots[i] * 256.0 + 32.0 + q.x * 192.0) / 1024.0, (64.0 + q.y * 192.0) / 256.0));
                                c = mix(c, icon.rgb, icon.a);
                            }
                        }
                        color = vec4(mix(color.rgb, c, inside), max(color.a, inside));
                    }
                }
                vec4 label = labels[i];
                if (label.z > label.x) {
                    vec2 q = (px - label.xy) / (label.zw - label.xy);
                    if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) {
                        vec4 t = texture2D(atlas, vec2((slots[i] * 256.0 + q.x * 256.0) / 1024.0, (q.y * 64.0) / 256.0));
                        color = vec4(mix(color.rgb, t.rgb, t.a * fade), max(color.a, t.a * fade));
                    }
                }
            }
            if (color.a <= 0.0) {
                discard;
            }
            gl_FragColor = color;
        }
    `,
    transparent: true,
    depthWrite: false
});

// each app's label (its icon and name, 256 by 64 at the top of its column) and its large icon (192 square below
// that), for the cards above. the icons are drawn the way the home screen draws its own, in the glyph's font
export const cardAtlas = (apps, fontFamily) => {
    const canvas = document.createElement("canvas");
    canvas.width = 256 * CARD_SLOTS;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "middle";
    apps.slice(0, CARD_SLOTS).forEach((app, i) => {
        const x = i * 256;
        roundedRect(ctx, x + 8, 10, 44, 44, 11);
        ctx.fillStyle = app.color;
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.font = `700 24px ${fontFamily}`;
        ctx.fillText(app.glyph, x + 30, 33);
        ctx.textAlign = "left";
        ctx.font = `600 26px ${fontFamily}`;
        ctx.fillText(app.name, x + 62, 33);
        roundedRect(ctx, x + 48, 80, 160, 160, 38);
        ctx.fillStyle = app.color;
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.font = `700 88px ${fontFamily}`;
        ctx.fillText(app.glyph, x + 128, 162);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    return texture;
};
