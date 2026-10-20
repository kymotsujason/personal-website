// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { captureSnapshot, snapshotNodes, snapshotOf } from "./snapshots.js";

const page = (app, html, scroll = 0) => {
  const el = document.createElement("main");
  el.id = "page";
  el.dataset.app = app;
  el.dataset.page = app.toLowerCase();
  el.innerHTML = `<div class="body">${html}</div>`;
  el.querySelector(".body").scrollTop = scroll;
  return el;
};

const setBuild = (id) => {
  document.head.innerHTML = `<meta name="build-id" content="${id}">`;
};

beforeEach(() => {
  localStorage.clear();
  setBuild("b1");
  history.replaceState(null, "", "/blog/a-post");
});

describe("an app's last page", () => {
  test("is kept with its address and comes back for the same build", () => {
    expect(captureSnapshot(page("Blog", "<h1>A post</h1>"))).toBe(true);
    expect(snapshotOf("Blog")).toMatchObject({
      path: "/blog/a-post",
      page: "blog",
      html: '<div class="body"><h1>A post</h1></div>',
    });
  });

  test("from another build is dropped, since its markup may not match the css", () => {
    captureSnapshot(page("Blog", "<h1>A post</h1>"));
    setBuild("b2");
    expect(snapshotOf("Blog")).toBeNull();
  });

  test("isn't kept for the home screen or the not found page", () => {
    expect(captureSnapshot(page("home", "<h1>Home</h1>"))).toBe(false);
    expect(captureSnapshot(page("not-found", "<h1>Gone</h1>"))).toBe(false);
    expect(snapshotOf("home")).toBeNull();
  });

  test("past the size limit isn't kept, and doesn't replace the last one", () => {
    captureSnapshot(page("Blog", "<h1>A post</h1>"));
    expect(captureSnapshot(page("Blog", "x".repeat(200001)))).toBe(false);
    expect(snapshotOf("Blog")?.html).toContain("A post");
  });

  test("shows with nothing that could run or load another page", () => {
    const root = snapshotNodes(
      '<h1 onclick="x()">Hi</h1><img src="/a.png" onerror="x()"><script>x()</script>' +
        '<a href="javascript:x()">link</a><iframe src="/x"></iframe><form action="/y"></form>',
    );
    const holder = document.createElement("div");
    holder.append(root);
    expect(holder.innerHTML).toBe('<h1>Hi</h1><img src="/a.png"><a>link</a>');
  });

  test("that storage can't read gives nothing instead of throwing", () => {
    localStorage.setItem("appSnapshots", "{not json");
    expect(snapshotOf("Blog")).toBeNull();
  });
});
