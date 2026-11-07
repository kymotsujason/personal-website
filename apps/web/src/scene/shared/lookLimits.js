import { DESK_FOV } from "./motion.js";

// what part of the stitched photo sphere the desk covers, in degrees, lon to the right (see DESK in backdrop.js, which
// takes its extents from here). nothing in this file may reach three.js, since the 2d scene turns its view by the same
// limits
export const DESK_EXTENT = {
    lonMin: -100.72,
    lonMax: 83.16,
    latMin: -62.6,
    latMax: 78.48,
    // the stitch's lon that counts as straight ahead (the keyboard), and the highest the view's top edge may go: just
    // above the top monitors' frames (their highest point is about 44), past that it's only ceiling
    forward: -14,
    topLat: 50
};

// keeps the view's edge a little inside the photo's edge
export const LOOK_MARGIN = 2;

const HALF_V = DESK_FOV / 2;
const toRad = (deg) => deg * (Math.PI / 180);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const PITCH_LIMITS = [DESK_EXTENT.latMin + HALF_V + LOOK_MARGIN, Math.min(DESK_EXTENT.latMax - LOOK_MARGIN, DESK_EXTENT.topLat) - HALF_V];

// the pitch the view rests at, kept inside the limits
export const restPitchFor = (restPitch) => clamp(restPitch, PITCH_LIMITS[0], PITCH_LIMITS[1]);

// the lowest and highest lon the view's border reaches, for a yaw and pitch in degrees. the camera turns by yaw and
// then tilts by pitch about the world's sideways axis (three's XYZ order), and a view tilted down fans out wider at its
// bottom corners than at the horizon, so the border is sampled instead of taking the horizon's half width
export const lonSpan = (yaw, pitch, aspect) => {
    const tanV = Math.tan(toRad(HALF_V));
    const tanH = tanV * aspect;
    const a = toRad(-yaw);
    const p = toRad(pitch);
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
        const lon = (Math.atan2(x1, -z2) * 180) / Math.PI;
        lo = Math.min(lo, lon);
        hi = Math.max(hi, lon);
    }
    return [lo, hi];
};

// the yaw range and pitch range the view may turn through at a pitch and a window shape. a window wider than the photo
// can't turn at all, so it stays centered on the photo
export const workOutLimits = (pitch, aspect, rest) => {
    const [pitchMin, pitchMax] = PITCH_LIMITS;
    const lonLo = DESK_EXTENT.lonMin - DESK_EXTENT.forward + LOOK_MARGIN;
    const lonHi = DESK_EXTENT.lonMax - DESK_EXTENT.forward - LOOK_MARGIN;
    // the yaw where the border's left (or right) end just meets the photo's edge, found by halving the range
    const solve = (side, bound) => {
        let a = -180;
        let b = 180;
        for (let i = 0; i < 30; i++) {
            const m = (a + b) / 2;
            const reach = lonSpan(m, pitch, aspect)[side];
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
    const center = (DESK_EXTENT.lonMin + DESK_EXTENT.lonMax) / 2 - DESK_EXTENT.forward;
    return {
        yaw: yawMin <= yawMax ? [yawMin, yawMax] : [center, center],
        pitch: pitchMin <= pitchMax ? [pitchMin, pitchMax] : [rest, rest]
    };
};

// the limits only change with the pitch and the window's shape, and working them out is 60 border samplings, about 40%
// of a frame's script on a slowed phone cpu, so the last answer is kept
export const createLimits = (rest) => {
    const cache = { pitch: null, aspect: null, value: null };
    return (pitch, aspect) => {
        if (cache.pitch === pitch && cache.aspect === aspect) {
            return cache.value;
        }
        cache.pitch = pitch;
        cache.aspect = aspect;
        cache.value = workOutLimits(pitch, aspect, rest);
        return cache.value;
    };
};

// a target view moved to the nearest one the photo covers, as the desk's camera clamps its own
export const clampLook = (limits, target, aspect) => {
    const [pitchMin, pitchMax] = limits(target.pitch, aspect).pitch;
    const pitch = clamp(target.pitch, pitchMin, pitchMax);
    const l = limits(pitch, aspect);
    return { yaw: clamp(target.yaw, l.yaw[0], l.yaw[1]), pitch };
};
