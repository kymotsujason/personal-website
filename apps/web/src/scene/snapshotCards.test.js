import { test } from "node:test";
import assert from "node:assert/strict";
import { forHost } from "./snapshotCards.js";

// a kept page's copy sits in a shadow root, where nothing matches html or :root, so their rules move to the host
test("html and :root rules move to the host, keeping the classes and :not() they test", () => {
    assert.equal(forHost(":root { --a: 1; }"), ":host { --a: 1; }");
    assert.equal(forHost("html { --sky-top: red; }"), ":host { --sky-top: red; }");
    assert.equal(forHost("html.has-3d #page .flat-footer { display: none; }"), ":host(.has-3d) #page .flat-footer { display: none; }");
    assert.equal(forHost("html:not(.page-pinned) #page > .sky { opacity: 1; }"), ":host(:not(.page-pinned)) #page > .sky { opacity: 1; }");
    assert.equal(forHost("a, html.glass-simple:not(.scene-failed) #page b { x: y; }"), "a, :host(.glass-simple:not(.scene-failed)) #page b { x: y; }");
});

test("names that only contain html are left alone", () => {
    assert.equal(forHost(".html-rules, #htmlish, [data-html] { x: y; }"), ".html-rules, #htmlish, [data-html] { x: y; }");
});
