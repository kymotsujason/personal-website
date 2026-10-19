// how much daylight there is at a local hour. the ramps are centered on sunrise and sunset, which come from the
// visitor's weather when it's known and default to 7 and 19, the old fixed schedule (night until 6, dawn from 6 to 8,
// day, dusk from 18 to 20, night again). `day` is 0 at night and 1 in full daylight, `warm` peaks at sunrise and
// sunset. polar is "night" or "day" where the sun doesn't rise or doesn't set that day
const clamp01 = (t) => Math.min(Math.max(t, 0), 1);
const smooth = (t) => t * t * (3 - 2 * t);

export const daylight = (hour, sunrise = 7, sunset = 19, polar = null) => {
    if (polar === "night") {
        return { day: 0, warm: 0 };
    }
    if (polar === "day") {
        return { day: 1, warm: 0 };
    }
    const h = ((hour % 24) + 24) % 24;
    // a sunset at or before sunrise is the next day's, for a visitor whose clock is far from where they are
    const set = sunset > sunrise ? sunset : sunset + 24;
    let day = 0;
    let warm = 0;
    // the day can reach past midnight either way, so the hour is also checked a day earlier and a day later
    [h - 24, h, h + 24].forEach((t) => {
        day = Math.max(day, smooth(clamp01(Math.min((t - (sunrise - 1)) / 2, (set + 1 - t) / 2))));
        warm = Math.max(warm, 1 - Math.abs(t - sunrise) / 1.2, 1 - Math.abs(t - set) / 1.2);
    });
    return { day, warm };
};

export const hourNow = (date = new Date()) => date.getHours() + date.getMinutes() / 60;
