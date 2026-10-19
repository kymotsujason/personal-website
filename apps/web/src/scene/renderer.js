import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createBackdrop } from "./backdrop.js";
import { createFocusBlur } from "./focus.js";
import { conditionFor, sunHours, moonHours } from "./weather.js";
import { sunPlace, moonPlace, rimAngle } from "./skyPath.js";
import { skyTint } from "./tint.js";
import { daylight, hourNow } from "./daylight.js";
import { state, FOV } from "./state.js";
import { guard } from "./lifetime.js";
import { applySky, skyVars } from "../lib/sky.js";

export let renderer = null;
export let scene = null;
export let pmrem = null;
export let backdrop = null;
export let focusBlur = null;
export let hemiLight = null;
export let keyLight = null;
export let monitorGlow = null;
export let phoneGlow = null;
export let camera = null;
export let MATERIALS = null;
export let holeMaterial = null;

const LIGHT_DAY = { hemi: 1.2, key: 1.6, env: 0.7 };
// how far each light falls at night, as a share of its daytime strength, and the night glows' strength
const LIGHT_NIGHT = { hemi: 0.22, key: 0.12, env: 0.3, monitor: 0.45, phone: 2.5 };
const KEY_WARM = new THREE.Color(0xffc796);
// the visitor's weather once it arrives (null until then, or if it never does), and the test panel's pinned scene
export let weather = null;
export let weatherOverride = null;
export const setWeather = (data) => {
    weather = data;
};
export const setWeatherOverride = (value) => {
    weatherOverride = value;
};
export const currentWeather = () => weatherOverride ?? (weather ? conditionFor(weather.code) : { scene: "clear", intensity: "moderate" });

export const initRenderer = (canvas) => {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    // neutral keeps the hand texture's skin tone, aces washed it out toward white (spike.pixel measured both)
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    // each lighting map is its own render target, so the one it replaces is freed
    let environment = pmrem.fromScene(room, 0.04);
    room.dispose();
    scene.environment = environment.texture;
    // compiled now, while the page is still black, instead of when the desk's lighting map arrives mid intro
    pmrem.compileEquirectangularShader();
    scene.environmentIntensity = 0.7;
    // the desk behind the phone. once its lighting map loads, the phone and hands are lit by the desk instead of the
    // generic room
    backdrop = createBackdrop(renderer, (envTexture) => {
        const previous = environment;
        environment = pmrem.fromEquirectangular(envTexture);
        scene.environment = environment.texture;
        previous.dispose();
    });
    renderer.autoClear = false;
    focusBlur = createFocusBlur(renderer);

    hemiLight = new THREE.HemisphereLight(0xfff6ec, 0x8a7f74, 1.2);
    scene.add(hemiLight);
    keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(-20, 30, 40);
    scene.add(keyLight);
    // at night the room's light comes from the screens: the monitors beyond the phone give the hands a cool rim from
    // behind, and the phone's own screen a faint glow on the thumbs. both are off by day
    monitorGlow = new THREE.DirectionalLight(0x6d84ff, 0);
    monitorGlow.position.set(0, 70, -120);
    monitorGlow.target.position.set(0, 0, -40);
    scene.add(monitorGlow, monitorGlow.target);
    phoneGlow = new THREE.PointLight(0xdbe4ff, 0, 30, 2);

    camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 500);

    MATERIALS = {
        hand: {
            clay: new THREE.MeshStandardMaterial({ color: 0xd8cfc4, roughness: 0.85, metalness: 0 }),
            // no clearcoat: three's coat is a mirror (its roughness defaults to 0), so even a little of it caught the
            // monitors as sharp white streaks, and the skin looked wet
            real: new THREE.MeshPhysicalMaterial({
                color: 0xd9a184, roughness: 0.68, sheen: 0.25,
                sheenColor: new THREE.Color(0xffc8b0)
            })
        },
        // the phone model's material slots (phoneModel.js), per finish. star white and night sky are the iPhone Duo's
        // colors, after apple's images, and the clay look is the softened test finish
        phone: {
            "star-white": {
                frame: new THREE.MeshPhysicalMaterial({ color: 0xdedbd5, metalness: 1, roughness: 0.16 }),
                back: new THREE.MeshPhysicalMaterial({ color: 0xf1eee8, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.6 }),
                glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.08, clearcoat: 1 }),
                hingeCover: new THREE.MeshPhysicalMaterial({ color: 0xc9c5bf, metalness: 1, roughness: 0.5 }),
                plateau: new THREE.MeshPhysicalMaterial({ color: 0xece9e3, roughness: 0.4, clearcoat: 0.4 }),
                lensGlass: new THREE.MeshPhysicalMaterial({ color: 0x07080a, roughness: 0.04, clearcoat: 1 }),
                lensRing: new THREE.MeshPhysicalMaterial({ color: 0xd4d1cb, metalness: 1, roughness: 0.12 }),
                flash: new THREE.MeshPhysicalMaterial({ color: 0xf2ecdc, roughness: 0.3 }),
                logo: new THREE.MeshPhysicalMaterial({ color: 0xd9d6d0, metalness: 0.6, roughness: 0.12 }),
                opening: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 })
            },
            "night-sky": {
                frame: new THREE.MeshPhysicalMaterial({ color: 0x3a4454, metalness: 1, roughness: 0.18 }),
                back: new THREE.MeshPhysicalMaterial({ color: 0x2c3646, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.6 }),
                glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.08, clearcoat: 1 }),
                hingeCover: new THREE.MeshPhysicalMaterial({ color: 0x404a5a, metalness: 1, roughness: 0.5 }),
                plateau: new THREE.MeshPhysicalMaterial({ color: 0x283140, roughness: 0.4, clearcoat: 0.4 }),
                lensGlass: new THREE.MeshPhysicalMaterial({ color: 0x07080a, roughness: 0.04, clearcoat: 1 }),
                lensRing: new THREE.MeshPhysicalMaterial({ color: 0x4a5464, metalness: 1, roughness: 0.12 }),
                flash: new THREE.MeshPhysicalMaterial({ color: 0xf2ecdc, roughness: 0.3 }),
                logo: new THREE.MeshPhysicalMaterial({ color: 0x1c2330, metalness: 0.4, roughness: 0.1, clearcoat: 1 }),
                opening: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 })
            },
            clay: {
                frame: new THREE.MeshStandardMaterial({ color: 0xcfc8be, roughness: 0.7 }),
                back: new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.8 }),
                glass: new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.5 }),
                hingeCover: new THREE.MeshStandardMaterial({ color: 0xbfb8ae, roughness: 0.8 }),
                plateau: new THREE.MeshStandardMaterial({ color: 0xd0cabf, roughness: 0.75 }),
                lensGlass: new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.5 }),
                lensRing: new THREE.MeshStandardMaterial({ color: 0xc4bdb3, roughness: 0.7 }),
                flash: new THREE.MeshStandardMaterial({ color: 0xe0dad0, roughness: 0.7 }),
                logo: new THREE.MeshStandardMaterial({ color: 0xc9c2b8, roughness: 0.6 }),
                opening: new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.9 })
            }
        }
    };

    // writes alpha 0 so the html layer behind the canvas shows through, while fingers in front still draw over it
    holeMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending });
};

// the glass leans toward the sky's color (see tint.js): the widgets' glass, and the apps' panes and bar. the sky is
// read back when the sun, the moon, or the weather moves, so about once a minute
export const applyTint = () => {
    if (!state.wallpaper || !state.screen) {
        return;
    }
    const [r, g, b] = skyTint(state.wallpaper.measure());
    const color = new THREE.Color(r, g, b);
    state.screen.composite.setTint(color);
    state.cover.composite.setTint(color);
    const byte = (v, scale) => Math.round(v * scale);
    document.documentElement.style.setProperty("--glass-fill", `rgba(${byte(r, 255)}, ${byte(g, 255)}, ${byte(b, 255)}, 0.08)`);
    document.documentElement.style.setProperty("--bar-fill", `rgba(${byte(r, 36)}, ${byte(g, 36)}, ${byte(b, 36)}, 0.5)`);
};

export const applyWeather = () => {
    if (state.wallpaper) {
        const { scene, intensity } = currentWeather();
        state.wallpaper.setWeather(scene, intensity);
        // once the sky's two second crossfade to the new weather is done
        setTimeout(guard(applyTint), 2200);
    }
};

export let hourOverride = null;
export const setHourOverride = (hour) => {
    hourOverride = hour;
};
export const applyDaylight = () => {
    // sunrise and sunset come from the weather when it's known, and default to 7 and 19 when it isn't
    const sun = weather ? sunHours(weather) : {};
    const { day, warm } = daylight(hourOverride ?? hourNow(), sun.sunrise, sun.sunset, weather ? weather.polar : null);
    backdrop.setDaylight(day, warm);
    backdrop.setWallpaper(hourOverride ?? hourNow());
    const at =(night) => night + (1 - night) * day;
    hemiLight.intensity = LIGHT_DAY.hemi * at(LIGHT_NIGHT.hemi);
    keyLight.intensity = LIGHT_DAY.key * at(LIGHT_NIGHT.key);
    keyLight.color.set(0xffffff).lerp(KEY_WARM, warm * 0.6);
    scene.environmentIntensity = LIGHT_DAY.env * at(LIGHT_NIGHT.env);
    monitorGlow.intensity = LIGHT_NIGHT.monitor * (1 - day);
    phoneGlow.intensity = LIGHT_NIGHT.phone * (1 - day);
    if (state.wallpaper) {
        state.wallpaper.setDaylight(day, warm);
        // the sun and moon cross on their arcs by the real times. without weather the sun keeps the 7 and 19
        // schedule, and there's no moon
        const hour = hourOverride ?? hourNow();
        const sunAt = sunPlace(hour, { sunrise: sun.sunrise ?? 7, sunset: sun.sunset ?? 19, polar: weather ? weather.polar : null });
        const moonAt = moonPlace(hour, weather ? moonHours(weather) : null);
        state.wallpaper.setBodies({ sun: sunAt, moon: moonAt });
        // the apps' glass panes light their rims from the same side the widgets' rims are lit from
        document.documentElement.style.setProperty("--rim-angle", `${Math.round(rimAngle(sunAt, moonAt, state.screen.fullW / state.screen.fullH))}deg`);
        const { scene, intensity } = currentWeather();
        applySky(document.documentElement, skyVars({
            day, warm, scene, intensity,
            sun: [sunAt.x, sunAt.y], sunUp: sunAt.up,
            moon: [moonAt.x, moonAt.y], moonUp: moonAt.up,
        }));
        applyTint();
    }
    return { hour: hourOverride ?? hourNow(), day, warm };
};
