// the github contribution graph for the widget. the worker's daily cron saves github's own contribution calendar, and
// the home route hands it over beside the weather, so nothing depends on a third party while someone is visiting

export const GITHUB_USER = "kymotsujason";
export const GITHUB_URL = `https://github.com/${GITHUB_USER}`;

// github's dark theme greens, with the empty level as a faint square that reads on any wallpaper
const LEVEL_COLORS = ["rgba(255, 255, 255, 0.14)", "#0e4429", "#006d32", "#26a641", "#39d353"];
const CELL = 10;
const GAP = 3;

// the github part of the home route's answer, { days: [{ date, level }], total }, or null when it's missing or out of
// shape, so the graph shows the empty grid
export const readContributions = (part) => {
    if (!part || !Array.isArray(part.days) || !Number.isFinite(part.total)) {
        return null;
    }
    const valid = part.days.every((day) => day && typeof day.date === "string" && Number.isInteger(day.level) && day.level >= 0 && day.level < LEVEL_COLORS.length);
    return valid ? { days: part.days, total: part.total } : null;
};

// fills .graph with as many week columns as fit its width, the last column ending on today like github's own graph.
// without data it shows the empty grid
export const fillGraph = (graph, contributions) => {
    const weeks = Math.max(1, Math.floor((graph.clientWidth + GAP) / (CELL + GAP)));
    const days = contributions ? contributions.days : [];
    const today = days.length ? new Date(`${days[days.length - 1].date}T12:00:00`).getDay() : 6;
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
