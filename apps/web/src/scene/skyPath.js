// where the sun and moon sit on the sky at an hour on the visitor's clock. each crosses on an arc: it rises at the
// left edge, climbs to its peak halfway through its time up, and sets at the right edge. positions are in the sky's
// uv, x across the whole inner screen and y from the bottom edge (0) to the top (1). it's a drawn path, not true
// astronomy, but the times are the real ones for the visitor's area
const LEFT = 0.06;
const SPAN = 0.88;
const DOWN = { x: 0.5, y: -1, up: 0 };

// longer days climb higher: an 8 hour day peaks half way up and a 16 hour one nearly at the top
export const peakFor = (hoursUp) => Math.min(Math.max(0.45 + (hoursUp - 8) / 16, 0.45), 0.95);

// null when the body is down. a stretch can run past midnight, so the hour is also tried a day either side
export const arcPoint = (hour, rise, set, peak) => {
    for (const h of [hour - 24, hour, hour + 24]) {
        if (h >= rise && h <= set) {
            const t = (h - rise) / (set - rise);
            return { x: LEFT + SPAN * t, y: peak * Math.sin(Math.PI * t) };
        }
    }
    return null;
};

// sun is { sunrise, sunset, polar } on the visitor's clock. polar night has no sun, and polar day keeps it low,
// crossing once a day
export const sunPlace = (hour, sun) => {
    if (sun.polar === "night") {
        return DOWN;
    }
    if (sun.polar === "day") {
        const t = (((hour % 24) + 24) % 24) / 24;
        return { x: LEFT + SPAN * t, y: 0.3, up: 1 };
    }
    const set = sun.sunset > sun.sunrise ? sun.sunset : sun.sunset + 24;
    const at = arcPoint(hour, sun.sunrise, set, peakFor(set - sun.sunrise));
    return at ? { ...at, up: 1 } : DOWN;
};

// moon is { phase, ups } from moonHours, or null when there's no moon data
export const moonPlace = (hour, moon) => {
    if (!moon) {
        return { ...DOWN, phase: 0 };
    }
    for (const [rise, set] of moon.ups) {
        const at = arcPoint(hour, rise, set, peakFor(set - rise));
        if (at) {
            return { ...at, up: 1, phase: moon.phase };
        }
    }
    return { ...DOWN, phase: moon.phase };
};

// the angle for a css gradient across a glass rim that starts bright on the side facing the sky's light and runs away
// from it. the light is the sun while it's up, else the moon, else straight above. sun and moon are from sunPlace and
// moonPlace, and aspect is the sky's width over its height, since their x and y are shares of each
export const rimAngle = (sun, moon, aspect) => {
    const light = sun.up > 0 && sun.y > 0 ? sun : moon.up > 0 && moon.y > 0 ? moon : { x: 0.5, y: 1 };
    const toward = (Math.atan2((light.x - 0.5) * aspect, light.y - 0.5) * 180) / Math.PI;
    return (((toward + 180) % 360) + 360) % 360;
};
