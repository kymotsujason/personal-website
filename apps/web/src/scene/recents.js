import { read, write } from "../lib/storage.js";

// the order apps were opened in, oldest first, for the app switcher's row (see switcher.js). it's kept for the tab's
// session, so a reload doesn't forget it
const KEY = "recentApps";

// the list with name moved to its end
export const withOpened = (list, name) => [...list.filter((n) => n !== name), name];

// the apps in the switcher's order: never opened first in the home screen's order, then the opened ones from oldest
// to newest, so the open app is last
export const recentOrder = (apps, opened) => {
    const known = opened.filter((name) => apps.some((a) => a.name === name));
    const fresh = apps.filter((a) => !known.includes(a.name));
    return [...fresh, ...known.map((name) => apps.find((a) => a.name === name))];
};

const stored = () => {
    try {
        const list = JSON.parse(read("session", KEY) || "[]");
        return Array.isArray(list) ? list.filter((n) => typeof n === "string") : [];
    } catch {
        return [];
    }
};

export const noteOpened = (name) => {
    write("session", KEY, JSON.stringify(withOpened(stored(), name)));
};

export const openedSoFar = () => stored();
