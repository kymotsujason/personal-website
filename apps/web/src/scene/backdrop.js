import * as THREE from "three";
import { wallpaperAt, NIGHT } from "./monitors.js";
import { loadingManager } from "./lifetime.js";

// jason's desk behind the phone: a partial photo sphere stitched from 21 photos taken from his chair (hugin, with the
// matches filtered against the shooting grid since every monitor shows the same wallpaper). it's drawn by its own
// camera with a wider view than the phone's, so the desk looks the way it does from the chair instead of through a
// telephoto lens. the extents say what part of the sphere the image covers, in degrees, lon to the right
export const DESK = {
    src: "/desk.jpg",
    env: "/desk-env.jpg",
    lonMin: -100.72,
    lonMax: 83.16,
    latMin: -62.6,
    latMax: 78.48,
    // the stitch's lon that counts as straight ahead (the keyboard), and the highest the view's top edge may go: just
    // above the top monitors' frames (their highest point is about 44), past that it's only ceiling
    forward: -14,
    topLat: 50,
    // where the view rests, as the lat of its center. halfway between how far it could look up and down before the
    // photo grew 220 rows at its bottom (art/desk-stitch/desk/extend.py)
    restPitch: -0.9,
    // the monitors for the other times of day (art/desk-stitch/monitors/bake.py): the photo's band of rows that holds
    // the screens, baked for each other wallpaper image, with a mask of where the screens are in that band and a
    // lighting map for each. rows count from the photo's top, out of its 3143
    wall: {
        rows: [775, 1996, 3143],
        src: (i) => `/desk-wall-${i}.jpg`,
        env: (i) => `/desk-env-${i}.jpg`,
        mask: "/desk-wall-mask.png",
        small: (i) => `/desk-wall-${i}-small.jpg`,
        maskSmall: "/desk-wall-mask-small.png"
    },
    // 1024 wide copies (tools/smallImages.sh), loaded first so the desk shows in about a tenth of the download, then
    // swapped for the full images as they arrive
    small: "/desk-small.jpg"
};

const BG_FOV = 75;
const RADIUS = 100;
// keeps the view's edge a little inside the photo's edge
const MARGIN = 2;

// whether image bitmaps decode the way loadPhoto needs, by the same test three's GLTFLoader uses
const browserVersion = (pattern) => {
    const match = navigator.userAgent.match(pattern);
    return match ? parseInt(match[1], 10) : -1;
};
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const isFirefox = navigator.userAgent.includes("Firefox");
// chrome and the other browsers on ios are webkit too, and say the ios version instead of safari's (CriOS has no
// Version/), which is the webkit they run
const webkitVersion = browserVersion(/Version\/(\d+)/) >= 0 ? browserVersion(/Version\/(\d+)/) : browserVersion(/ OS (\d+)_/);
const bitmapsWork = typeof createImageBitmap !== "undefined" && !(isSafari && webkitVersion < 17) && !(isFirefox && browserVersion(/Firefox\/(\d+)\./) < 98);

const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
`;

// blur is a spiral of samples from a coarser mip level, dimmed a bit so the phone stands out against it
const fragmentShader = `
    uniform sampler2D map;
    uniform float blur;
    uniform float day;
    uniform float warm;
    uniform sampler2D wallMask;
    uniform sampler2D wallFrom;
    uniform sampler2D wallTo;
    uniform float fromPhoto;
    uniform float toPhoto;
    uniform float wallT;
    uniform vec2 band;
    varying vec2 vUv;

    // the photo with its monitors showing the time of day's wallpaper, blended in by the screen mask, which also says
    // how much of this point is a screen. the band's images are read everywhere and only count inside the band,
    // since reading a texture inside a branch that changes across the image can leave seams
    // the photos are uploaded top row first (see loadPhoto), so a point is read from the other end of the image
    vec2 photo( vec2 p ) {
        return vec2( p.x, 1.0 - p.y );
    }

    vec3 deskAt( vec2 uv, float lod, out float screen ) {
        vec3 base = textureLod( map, photo( uv ), lod ).rgb;
        vec2 b = vec2( uv.x, clamp( ( uv.y - band.x ) / ( band.y - band.x ), 0.0, 1.0 ) );
        float inBand = step( band.x, uv.y ) * step( uv.y, band.y );
        screen = textureLod( wallMask, photo( b ), lod ).r * inBand;
        vec3 from = mix( textureLod( wallFrom, photo( b ), lod ).rgb, base, fromPhoto );
        vec3 to = mix( textureLod( wallTo, photo( b ), lod ).rgb, base, toPhoto );
        return mix( base, mix( from, to, wallT ), screen );
    }

    vec3 deskAt( vec2 uv, out float screen ) {
        vec3 base = texture2D( map, photo( uv ) ).rgb;
        vec2 b = vec2( uv.x, clamp( ( uv.y - band.x ) / ( band.y - band.x ), 0.0, 1.0 ) );
        float inBand = step( band.x, uv.y ) * step( uv.y, band.y );
        screen = texture2D( wallMask, photo( b ) ).r * inBand;
        vec3 from = mix( texture2D( wallFrom, photo( b ) ).rgb, base, fromPhoto );
        vec3 to = mix( texture2D( wallTo, photo( b ) ).rgb, base, toPhoto );
        return mix( base, mix( from, to, wallT ), screen );
    }

    void main() {
        float screen;
        vec4 color = vec4( deskAt( vUv, screen ), 1.0 );
        if ( blur > 0.01 ) {
            float lod = blur * 4.5;
            vec2 spread = blur * vec2( 0.012, 0.016 );
            float turn = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2831853;
            vec3 sum = vec3( 0.0 );
            float screens = 0.0;
            for ( int i = 0; i < 12; i++ ) {
                float fi = float( i );
                float r = sqrt( ( fi + 0.5 ) / 12.0 );
                float a = fi * 2.39996 + turn;
                float tap;
                sum += deskAt( vUv + spread * r * vec2( cos( a ), sin( a ) ), lod, tap );
                screens += tap;
            }
            color = vec4( sum / 12.0 * ( 1.0 - 0.25 * blur ), 1.0 );
            screen = screens / 12.0;
        }
        // the time of day. the room darkens and cools toward night and warms a little at dawn and dusk, while the
        // monitors (the screen mask) keep their glow, since a screen lights itself
        vec3 c = color.rgb;
        vec3 lit = mix( c, c * vec3( 1.06, 0.9, 0.74 ), warm );
        vec3 night = c * vec3( 0.13, 0.15, 0.22 );
        vec3 graded = mix( night, lit, day );
        color.rgb = mix( graded, c, screen * ( 1.0 - day ) );
        gl_FragColor = color;
        #include <colorspace_fragment>
    }
`;

// a grid over the photo's lon and lat, placed on a sphere around the camera, so the image maps on with no stretching
const skyGeometry = () => {
    const cols = 96;
    const rows = 64;
    const positions = [];
    const uvs = [];
    const index = [];
    for (let j = 0; j <= rows; j++) {
        const lat = THREE.MathUtils.degToRad(DESK.latMin + ((DESK.latMax - DESK.latMin) * j) / rows);
        for (let i = 0; i <= cols; i++) {
            const lon = THREE.MathUtils.degToRad(DESK.lonMin + ((DESK.lonMax - DESK.lonMin) * i) / cols - DESK.forward);
            positions.push(RADIUS * Math.sin(lon) * Math.cos(lat), RADIUS * Math.sin(lat), -RADIUS * Math.cos(lon) * Math.cos(lat));
            uvs.push(i / cols, j / rows);
        }
    }
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            const a = j * (cols + 1) + i;
            const b = a + cols + 1;
            index.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    return geometry;
};

export const createBackdrop = (renderer, onEnvironment) => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(BG_FOV, 1, 1, RADIUS * 4);
    camera.rotation.order = "YXZ";
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    blank.needsUpdate = true;
    const [bandTop, bandBottom, rows] = DESK.wall.rows;
    const uniforms = {
        map: { value: null },
        blur: { value: 0 },
        day: { value: 1 },
        warm: { value: 0 },
        wallMask: { value: blank },
        wallFrom: { value: blank },
        wallTo: { value: blank },
        fromPhoto: { value: 1 },
        toPhoto: { value: 1 },
        wallT: { value: 1 },
        band: { value: new THREE.Vector2(1 - bandBottom / rows, 1 - bandTop / rows) }
    };
    const sky = new THREE.Mesh(skyGeometry(), new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide, depthWrite: false }));
    sky.visible = false;
    scene.add(sky);

    const loader = new THREE.TextureLoader(loadingManager);
    // a texture, or null if it doesn't load, so a missing time of day leaves the photo's own screens
    const loadTexture = (url, colorSpace) => new Promise((resolve) => {
        loader.load(url, (texture) => {
            texture.colorSpace = colorSpace;
            resolve(texture);
        }, undefined, () => resolve(null));
    });
    // the desk's photos, up to 4096 wide, are decoded off the main thread as image bitmaps, since an image element is
    // decoded inside its upload, which held a frame for hundreds of ms on a slowed phone. a bitmap can't be flipped on
    // upload, and asking for it flipped isn't safe on every browser, so both ways upload it top row first and the
    // shader reads it from the other end. the browsers left out are the ones three's GLTFLoader leaves out
    const bitmapLoaders = new Map();
    const loadBitmap = (url, colorSpace) => {
        if (!bitmapLoaders.has(colorSpace)) {
            const bitmapLoader = new THREE.ImageBitmapLoader(loadingManager);
            bitmapLoader.setOptions({ imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: colorSpace === THREE.NoColorSpace ? "none" : "default" });
            bitmapLoaders.set(colorSpace, bitmapLoader);
        }
        return new Promise((resolve) => {
            bitmapLoaders.get(colorSpace).load(url, resolve, undefined, () => resolve(null));
        });
    };
    const bitmapTexture = (bitmap, colorSpace) => {
        const texture = new THREE.Texture(bitmap);
        texture.colorSpace = colorSpace;
        texture.flipY = false;
        texture.needsUpdate = true;
        return texture;
    };
    const loadPhoto = (url, colorSpace) => {
        if (!bitmapsWork) {
            return loadTexture(url, colorSpace).then((texture) => {
                if (texture) {
                    texture.flipY = false;
                }
                return texture;
            });
        }
        return loadBitmap(url, colorSpace).then((bitmap) => (bitmap ? bitmapTexture(bitmap, colorSpace) : null));
    };

    // the full photos go to the gpu a strip at a time, one strip a frame (see draw), since even as a bitmap the desk's
    // 4096 by 3143 photo held a frame for 136 ms in one upload on an iphone. a worker decodes each one and cuts it into
    // strips (photoWorker.js), since on an iphone the page's own decode held a frame for about 190 ms, and a strip read
    // out of the whole bitmap took 20 ms to upload where the wall's 1221 row bitmap took 8. a browser whose worker can't
    // do that reads each strip out of a whole bitmap decoded on the page. the texture's storage is made empty and its
    // mipmaps are made once, after the last strip, and its anisotropy is set before, since three only sets that when
    // it uploads a texture
    const STRIP_ROWS = 128;
    const strips = [];
    let photoWorker = null;
    const cutting = new Map();
    let cutId = 0;
    // a failed scene ends the worker and starts no more full images, and a slow device keeps the small ones
    let stopped = false;
    let smallOnly = false;
    // a worker that errored (its script didn't load, say) is ended, and the photos after it are cut on the page, since
    // a browser can drop what's posted to it without a word
    let workerBroken = false;
    const cutInWorker = (url) => {
        if (typeof Worker === "undefined" || stopped || workerBroken) {
            return Promise.resolve(null);
        }
        if (!photoWorker) {
            photoWorker = new Worker(new URL("./photoWorker.js", import.meta.url));
            photoWorker.onmessage = ({ data }) => {
                const resolve = cutting.get(data.id);
                cutting.delete(data.id);
                if (data.error) {
                    console.warn(`the photo worker couldn't cut a photo: ${data.error}`);
                }
                resolve(data.error ? null : data);
            };
            const worker = photoWorker;
            photoWorker.onerror = () => {
                workerBroken = true;
                worker.terminate();
                if (photoWorker === worker) {
                    photoWorker = null;
                }
                cutting.forEach((resolve) => resolve(null));
                cutting.clear();
            };
        }
        return new Promise((resolve) => {
            const id = cutId++;
            cutting.set(id, resolve);
            const options = { imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "none" };
            photoWorker.postMessage({ id, url: new URL(url, location.href).href, options, rows: STRIP_ROWS });
        });
    };
    // the texture is filled from each strip's source, and its bitmaps are closed after the last
    const fillInStrips = (width, height, colorSpace, stripAt, bitmaps) => {
        if (smallOnly || stopped) {
            bitmaps.forEach((bitmap) => bitmap.close());
            return Promise.resolve(null);
        }
        const texture = new THREE.DataTexture(null, width, height);
        texture.colorSpace = colorSpace;
        texture.flipY = false;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps = true;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.source.dataReady = false;
        texture.needsUpdate = true;
        const at = new THREE.Vector2();
        return new Promise((resolve) => {
            for (let y = 0; y < height; y += STRIP_ROWS) {
                strips.push(() => {
                    if (y === 0) {
                        renderer.initTexture(texture);
                    }
                    const last = y + STRIP_ROWS >= height;
                    texture.generateMipmaps = last;
                    const { source, region } = stripAt(y);
                    renderer.copyTextureToTexture(source, texture, region, at.set(0, y));
                    if (last) {
                        texture.generateMipmaps = true;
                        bitmaps.forEach((bitmap) => bitmap.close());
                        resolve(texture);
                    }
                });
            }
        });
    };
    const fillFromBitmap = (bitmap, colorSpace) => {
        const { width, height } = bitmap;
        const source = new THREE.Texture(bitmap);
        const region = new THREE.Box2();
        const stripAt = (y) => {
            region.min.set(0, y);
            region.max.set(width, Math.min(y + STRIP_ROWS, height));
            return { source, region };
        };
        return fillInStrips(width, height, colorSpace, stripAt, [bitmap]);
    };
    const loadPhotoInStrips = (url, colorSpace) => {
        if (!bitmapsWork) {
            return loadPhoto(url, colorSpace);
        }
        return cutInWorker(url).then((cut) => {
            if (cut) {
                const stripAt = (y) => ({ source: new THREE.Texture(cut.strips[y / STRIP_ROWS]), region: null });
                return fillInStrips(cut.width, cut.height, colorSpace, stripAt, cut.strips);
            }
            return loadBitmap(url, colorSpace).then((bitmap) => (bitmap ? fillFromBitmap(bitmap, colorSpace) : null));
        });
    };

    // an image that didn't load isn't kept, so it's asked for again the next time it's wanted
    const textures = new Map();
    const once = (key, load) => {
        if (!textures.has(key)) {
            textures.set(key, load().then((texture) => {
                if (!texture) {
                    textures.delete(key);
                }
                return texture;
            }));
        }
        return textures.get(key);
    };
    const wallImage = (i) => (i === NIGHT ? Promise.resolve(null) : once(`wall ${i}`, () => loadPhoto(DESK.wall.small(i), THREE.SRGBColorSpace)));
    const wallFull = (i) => (i === NIGHT ? Promise.resolve(null) : once(`full ${i}`, () => loadPhotoInStrips(DESK.wall.src(i), THREE.SRGBColorSpace)));
    const sharp = (texture) => {
        if (texture) {
            texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
        return texture;
    };
    // what waits until the page has shown its first frame (main.js calls loadRest), so it doesn't take bandwidth from
    // what that frame needs, the phone and hands included
    const afterShown = [];
    let restLoading = false;
    const whenShown = (load) => {
        if (restLoading) {
            load();
        } else {
            afterShown.push(load);
        }
    };
    // the small copy first and the full image once the desk shows, each given to `apply` as it arrives. a small copy
    // that fails goes straight to the full one, and when that fails too `apply` gets null, so whatever waits on the
    // image hears that it isn't coming
    const smallThenFull = (smallUrl, fullUrl, colorSpace, apply) => {
        const full = (orNull) => (smallOnly ? Promise.resolve(null) : loadPhotoInStrips(fullUrl, colorSpace)).then((texture) => {
            if (texture) {
                apply(sharp(texture));
            } else if (orNull) {
                apply(null);
            }
        });
        loadPhoto(smallUrl, colorSpace).then((texture) => {
            if (texture) {
                apply(sharp(texture));
                whenShown(() => full(false));
            } else {
                full(true);
            }
        });
    };
    const wallEnv = (i) => once(`env ${i}`, () => loadTexture(i === NIGHT ? DESK.env : DESK.wall.env(i), THREE.SRGBColorSpace).then((texture) => {
        if (texture) {
            texture.mapping = THREE.EquirectangularReflectionMapping;
        }
        return texture;
    }));

    // the desk shows once the photo, the screen mask, and the current time of day's screens are in, so it never shows
    // night screens at noon while the rest loads
    const ready = { photo: false, mask: false, wall: false };
    const showWhenReady = () => {
        sky.visible = ready.photo && ready.mask && ready.wall;
    };
    smallThenFull(DESK.small, DESK.src, THREE.SRGBColorSpace, (texture) => {
        if (texture) {
            uniforms.map.value = texture;
            ready.photo = true;
            showWhenReady();
        }
    });
    smallThenFull(DESK.wall.maskSmall, DESK.wall.mask, THREE.NoColorSpace, (texture) => {
        if (texture) {
            uniforms.wallMask.value = texture;
        }
        ready.mask = true;
        showWhenReady();
    });

    // which wallpaper images the monitors show (see monitors.js). the images load as they're needed, and the rest
    // load after the first, so a later change is ready when it comes. the lighting map follows whichever image is
    // more than half way in
    let wallKey = null;
    let envIndex = null;
    const setWallpaper = (hour) => {
        const { from, to, t } = wallpaperAt(hour);
        uniforms.wallT.value = t;
        const key = `${from} ${to}`;
        if (key !== wallKey) {
            wallKey = key;
            Promise.all([wallImage(from), wallImage(to)]).then(([a, b]) => {
                if (wallKey !== key) {
                    return;
                }
                [[a, "wallFrom", "fromPhoto"], [b, "wallTo", "toPhoto"]].forEach(([texture, image, photo]) => {
                    if (texture) {
                        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
                    }
                    uniforms[image].value = texture || blank;
                    uniforms[photo].value = texture ? 0 : 1;
                });
                if (!ready.wall) {
                    ready.wall = true;
                    showWhenReady();
                    whenShown(() => [0, 1, 3].forEach((i) => wallImage(i)));
                }
                // then the full images for the pair, put in if the pair is still the one showing
                whenShown(() => [[from, "wallFrom"], [to, "wallTo"]].forEach(([i, image]) => {
                    if (smallOnly) {
                        return;
                    }
                    wallFull(i).then((texture) => {
                        if (texture && wallKey === key) {
                            uniforms[image].value = sharp(texture);
                        }
                    });
                }));
            });
        }
        const wanted = t < 0.5 ? from : to;
        if (wanted !== envIndex) {
            envIndex = wanted;
            wallEnv(wanted).then((texture) => {
                if (texture && envIndex === wanted) {
                    onEnvironment(texture);
                }
            });
        }
    };

    // the blurred desk, kept as an image and laid over the screen on a quad (see draw)
    const bufferSize = new THREE.Vector2();
    const cache = {
        target: null,
        key: null,
        scene: new THREE.Scene(),
        camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
        quad: new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, toneMapped: false }))
    };
    cache.scene.add(cache.quad);
    // the image at half the drawing size, made again when that size changes. gives back the size
    const fitCache = (renderer) => {
        renderer.getDrawingBufferSize(bufferSize);
        const w = Math.max(1, Math.round(bufferSize.x / 2));
        const h = Math.max(1, Math.round(bufferSize.y / 2));
        if (!cache.target || cache.target.width !== w || cache.target.height !== h) {
            if (cache.target) {
                cache.target.dispose();
            }
            cache.target = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace, depthBuffer: false });
            cache.quad.material.map = cache.target.texture;
            cache.key = null;
        }
        return { w, h };
    };

    // look is where the view points, in degrees: yaw from straight ahead, pitch as the lat of the view's center
    const halfV = BG_FOV / 2;
    const pitchLimits = [DESK.latMin + halfV + MARGIN, Math.min(DESK.latMax - MARGIN, DESK.topLat) - halfV];
    // the view rests where it did before the photo grew at its bottom, halfway between the old limits, so the extra
    // rows only show when looking down
    const rest = Math.max(pitchLimits[0], Math.min(pitchLimits[1], DESK.restPitch));
    const look = { yaw: 0, pitch: rest, targetYaw: 0, targetPitch: rest };

    // the lowest and highest lon the view's border reaches, for a yaw and pitch in degrees. the camera turns by yaw and
    // then tilts by pitch about the world's sideways axis (three's XYZ order), and a view tilted down fans out wider at
    // its bottom corners than at the horizon, so the border is sampled instead of taking the horizon's half width
    const lonSpan = (yaw, pitch) => {
        const tanV = Math.tan(THREE.MathUtils.degToRad(halfV));
        const tanH = tanV * camera.aspect;
        const a = THREE.MathUtils.degToRad(-yaw);
        const p = THREE.MathUtils.degToRad(pitch);
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i <= 32; i++) {
            const t = (i / 32) * 4;
            const side = Math.floor(Math.min(t, 3.999));
            const f = t - side;
            const u = [-1 + 2 * f, 1, 1 - 2 * f, -1][side];
            const v = [1, 1 - 2 * f, -1, -1 + 2 * f][side];
            const x = u * tanH;
            const y = v * tanV;
            const x1 = x * Math.cos(a) - Math.sin(a);
            const z1 = -x * Math.sin(a) - Math.cos(a);
            const z2 = y * Math.sin(p) + z1 * Math.cos(p);
            const lon = THREE.MathUtils.radToDeg(Math.atan2(x1, -z2));
            lo = Math.min(lo, lon);
            hi = Math.max(hi, lon);
        }
        return [lo, hi];
    };

    // the limits only change with the pitch and the window's shape, and working them out is 60 border samplings, about
    // 40% of a frame's script on a slowed phone cpu, so the last answer is kept
    const limitsCache = { pitch: null, aspect: null, value: null };
    const limits = (pitch) => {
        if (limitsCache.pitch === pitch && limitsCache.aspect === camera.aspect) {
            return limitsCache.value;
        }
        limitsCache.pitch = pitch;
        limitsCache.aspect = camera.aspect;
        limitsCache.value = workOutLimits(pitch);
        return limitsCache.value;
    };
    const workOutLimits = (pitch) => {
        const [pitchMin, pitchMax] = pitchLimits;
        const lonLo = DESK.lonMin - DESK.forward + MARGIN;
        const lonHi = DESK.lonMax - DESK.forward - MARGIN;
        // the yaw where the border's left (or right) end just meets the photo's edge, found by halving the range
        const solve = (side, bound) => {
            let a = -180;
            let b = 180;
            for (let i = 0; i < 30; i++) {
                const m = (a + b) / 2;
                const reach = lonSpan(m, pitch)[side];
                if (side === 0 ? reach < bound : reach <= bound) {
                    a = m;
                } else {
                    b = m;
                }
            }
            return side === 0 ? b : a;
        };
        const yawMin = solve(0, lonLo);
        const yawMax = solve(1, lonHi);
        // a window wider than the photo can't turn at all, so it stays centered on the photo
        const center = (DESK.lonMin + DESK.lonMax) / 2 - DESK.forward;
        return {
            yaw: yawMin <= yawMax ? [yawMin, yawMax] : [center, center],
            pitch: pitchMin <= pitchMax ? [pitchMin, pitchMax] : [rest, rest]
        };
    };

    const clampTarget = () => {
        const [pitchMin, pitchMax] = limits(look.targetPitch).pitch;
        look.targetPitch = THREE.MathUtils.clamp(look.targetPitch, pitchMin, pitchMax);
        const l = limits(look.targetPitch);
        look.targetYaw = THREE.MathUtils.clamp(look.targetYaw, l.yaw[0], l.yaw[1]);
    };

    return {
        scene,
        camera,
        look,
        // whether the desk shows yet (see showWhenReady)
        ready: () => sky.visible,
        stop: () => {
            stopped = true;
            strips.length = 0;
            if (photoWorker) {
                photoWorker.terminate();
                photoWorker = null;
            }
            cutting.forEach((resolve) => resolve(null));
            cutting.clear();
        },
        // the full images that haven't started stay unloaded, and the strips not yet uploaded are dropped. a full image
        // already showing stays
        keepSmall: () => {
            smallOnly = true;
            strips.length = 0;
        },
        loadRest: () => {
            if (stopped) {
                return;
            }
            restLoading = true;
            afterShown.splice(0).forEach((load) => load());
        },
        lookBy: (dYaw, dPitch) => {
            look.targetYaw += dYaw;
            look.targetPitch += dPitch;
            clampTarget();
        },
        lookAhead: () => {
            look.targetYaw = 0;
            look.targetPitch = rest;
            clampTarget();
        },
        // draws the desk. while it's blurred (the phone open), it's drawn at half size into its own image only when the
        // view, the blur, or the size changed, and that image is reused, since the blur's 12 taps on every pixel were
        // the costliest thing a frame did on a gpu, and with the phone open the desk sits still
        // makes the blurred desk's image and compiles the desk's shaders, for that image and for the screen, and the
        // image's own, so their first use doesn't, since that was early in the intro. the desk is hidden until its
        // photos arrive, and three only compiles what shows, so it shows for this
        prewarm: (renderer) => {
            fitCache(renderer);
            const shown = sky.visible;
            sky.visible = true;
            const previous = renderer.getRenderTarget();
            renderer.setRenderTarget(cache.target);
            renderer.compile(scene, camera);
            renderer.setRenderTarget(previous);
            renderer.compile(scene, camera);
            renderer.compile(cache.scene, cache.camera);
            sky.visible = shown;
        },
        // still is whether the phone and any app are at rest. the full photos' strips only upload then, since each one
        // cost an iphone about 20 ms of a frame, which an app opening or the intro can't spare
        draw: (renderer, still = true) => {
            if (still && strips.length) {
                strips.shift()();
            }
            if (uniforms.blur.value <= 0.01) {
                renderer.render(scene, camera);
                return;
            }
            const { w, h } = fitCache(renderer);
            const key = `${w} ${h} ${look.yaw.toFixed(3)} ${look.pitch.toFixed(3)} ${uniforms.blur.value.toFixed(3)} ${camera.aspect.toFixed(4)} ${uniforms.day.value.toFixed(3)} ${uniforms.warm.value.toFixed(3)} ${wallKey} ${uniforms.wallT.value.toFixed(3)} ${uniforms.wallFrom.value.id} ${uniforms.wallTo.value.id} ${uniforms.map.value ? uniforms.map.value.id : 0} ${uniforms.wallMask.value.id}`;
            if (key !== cache.key) {
                const previous = renderer.getRenderTarget();
                renderer.setRenderTarget(cache.target);
                renderer.clear();
                renderer.render(scene, camera);
                renderer.setRenderTarget(previous);
                cache.key = key;
            }
            renderer.render(cache.scene, cache.camera);
        },
        setWallpaper,
        // how much daylight the room has (see daylight.js)
        setDaylight: (day, warm) => {
            uniforms.day.value = day;
            uniforms.warm.value = warm;
        },
        // dt in seconds. the view eases toward where the drag put it, which reads as a head turning rather than a
        // picture sliding
        update: (dt, aspect, blur) => {
            camera.aspect = aspect;
            camera.updateProjectionMatrix();
            clampTarget();
            const k = 1 - Math.exp(-dt * 12);
            look.yaw += (look.targetYaw - look.yaw) * k;
            look.pitch += (look.targetPitch - look.pitch) * k;
            camera.rotation.set(THREE.MathUtils.degToRad(look.pitch), THREE.MathUtils.degToRad(-look.yaw), 0);
            uniforms.blur.value = blur;
        }
    };
};
