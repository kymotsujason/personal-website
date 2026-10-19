// the github contribution graph for the widget. the worker's daily cron saves github's own contribution calendar, and
// the home route hands it over beside the weather, so nothing depends on a third party while someone is visiting

export const GITHUB_USER = "kymotsujason";
export const GITHUB_URL = `https://github.com/${GITHUB_USER}`;

// github's dark theme greens, with the empty level as a faint square that reads on any wallpaper
const LEVEL_COLORS = ["rgba(255, 255, 255, 0.14)", "#0e4429", "#006d32", "#26a641", "#39d353"];
const CELL = 10;
const GAP = 3;

// a yyyy-mm-dd day as github's calendar gives it, at noon so no time zone moves it to another day
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (date) => new Date(`${date}T12:00:00`);
const isDay = (date) => typeof date === "string" && ISO_DAY.test(date) && !Number.isNaN(dayOf(date).getTime());

// the github part of the home route's answer, { days: [{ date, level }], total }, or null when it's missing or out of
// shape, so the graph shows the empty grid
export const readContributions = (part) => {
    if (!part || !Array.isArray(part.days) || !Number.isFinite(part.total)) {
        return null;
    }
    const valid = part.days.every((day) => day && isDay(day.date) && Number.isInteger(day.level) && day.level >= 0 && day.level < LEVEL_COLORS.length);
    return valid ? { days: part.days, total: part.total } : null;
};

// fills .graph with as many week columns as fit its width, the last column ending on today like github's own graph.
// without data, or with a last day it can't read, the last column is a whole week
export const fillGraph = (graph, contributions) => {
    const weeks = Math.max(1, Math.floor((graph.clientWidth + GAP) / (CELL + GAP)));
    const days = contributions ? contributions.days : [];
    const last = days.length ? dayOf(days[days.length - 1].date).getDay() : NaN;
    const today = Number.isNaN(last) ? 6 : last;
    const count = (weeks - 1) * 7 + today + 1;
    const shown = days.slice(-count);
    graph.innerHTML = "";
    for (let i = 0; i < count; i++) {
        const cell = document.createElement("span");
        const day = shown[i - (count - shown.length)];
        cell.style.background = LEVEL_COLORS[day ? day.level : 0];
        graph.appendChild(cell);
    }
};
