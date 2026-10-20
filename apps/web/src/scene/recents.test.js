import { test } from "node:test";
import assert from "node:assert/strict";
import { recentOrder, withOpened } from "./recents.js";

const APPS = [{ name: "About" }, { name: "Projects" }, { name: "Blog" }, { name: "Music" }];
const names = (apps) => apps.map((a) => a.name);

// the switcher's row, the way ios lays it out: the app open now on the right, the ones before it to its left from
// newest to oldest, and apps not opened yet furthest left in the home screen's order
test("the open app is last, the apps opened before it come before it, and unopened apps come first", () => {
    assert.deepEqual(names(recentOrder(APPS, ["About", "Blog"])), ["Projects", "Music", "About", "Blog"]);
});

test("an app opened again moves to the end, and a name that isn't an app is left out", () => {
    const opened = withOpened(withOpened(withOpened(["Gone"], "About"), "Blog"), "About");
    assert.deepEqual(opened, ["Gone", "Blog", "About"]);
    assert.deepEqual(names(recentOrder(APPS, opened)), ["Projects", "Music", "Blog", "About"]);
});

test("with nothing opened yet the row is the home screen's order", () => {
    assert.deepEqual(names(recentOrder(APPS, [])), ["About", "Projects", "Blog", "Music"]);
});
