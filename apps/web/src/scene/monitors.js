// the monitors in the desk photo follow jason's kde wallpaper, which timewall switches by the clock between four
// images of one forest: 3 at sunrise from 6, 0 by day from 10, 1 at dusk from 17, and 2 at night from 21 (the night
// image is what the photo shows). each change crossfades over a few minutes instead of cutting
export const WALLPAPER_TIMES = [[6, 3], [10, 0], [17, 1], [21, 2]];
export const NIGHT = 2;
const FADE_HOURS = 0.1;

// which images show at an hour on the visitor's clock: from fades to `to` as t goes from 0 to 1
export const wallpaperAt = (hour) => {
    const h = ((hour % 24) + 24) % 24;
    let i = WALLPAPER_TIMES.length - 1;
    WALLPAPER_TIMES.forEach(([start], k) => {
        if (start <= h) {
            i = k;
        }
    });
    const [start, to] = WALLPAPER_TIMES[i];
    const from = WALLPAPER_TIMES[(i + WALLPAPER_TIMES.length - 1) % WALLPAPER_TIMES.length][1];
    const t = Math.min((((h - start) % 24) + 24) % 24 / FADE_HOURS, 1);
    return t >= 1 ? { from: to, to, t: 1 } : { from, to, t };
};
