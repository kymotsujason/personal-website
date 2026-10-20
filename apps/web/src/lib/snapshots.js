// the last page each app showed, kept so the app switcher can show where each app was left, the way ios shows an
// app's last screen, and so opening it from there goes back to the same page and scroll. it's kept across visits, and
// a copy from another build is dropped, since its markup may not match the css any more
import { read, write } from "./storage.js";

const KEY = "appSnapshots";
// a page larger than this isn't kept, so the store stays well inside the browser's limit
const MAX_HTML = 200000;
const NOT_APPS = new Set(["home", "not-found"]);

const buildId = () =>
  document.querySelector('meta[name="build-id"]')?.getAttribute("content") ??
  "";

const readAll = () => {
  try {
    const all = JSON.parse(read("local", KEY) || "{}");
    return all && typeof all === "object" && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
};

// #page as it is now, for the app it belongs to
export const captureSnapshot = (page) => {
  const app = page?.dataset.app;
  if (!app || NOT_APPS.has(app)) {
    return false;
  }
  const html = page.innerHTML;
  if (html.length > MAX_HTML) {
    return false;
  }
  const body = page.querySelector(":scope > .body");
  const all = readAll();
  all[app] = {
    build: buildId(),
    path: location.pathname,
    page: page.dataset.page ?? "",
    html,
    scroll: body ? body.scrollTop : 0,
  };
  return write("local", KEY, JSON.stringify(all));
};

// app's last page, or null when there's none from this build
export const snapshotOf = (app) => {
  const shot = readAll()[app];
  if (
    !shot ||
    shot.build !== buildId() ||
    typeof shot.html !== "string" ||
    typeof shot.path !== "string"
  ) {
    return null;
  }
  return {
    path: shot.path,
    page: typeof shot.page === "string" ? shot.page : "",
    html: shot.html,
    scroll: Number(shot.scroll) || 0,
  };
};

// a kept page's markup as inert nodes to show, with anything that could run or load another page taken out, since
// what's read back from storage isn't trusted
const DROPPED = "script, iframe, object, embed, base, form, link, meta";
export const snapshotNodes = (html) => {
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  root.querySelectorAll(DROPPED).forEach((el) => el.remove());
  root.querySelectorAll("*").forEach((el) => {
    for (const { name, value } of [...el.attributes]) {
      if (
        name.startsWith("on") ||
        /^\s*javascript:/i.test(value) ||
        name === "srcdoc"
      ) {
        el.removeAttribute(name);
      }
    }
  });
  return root;
};
