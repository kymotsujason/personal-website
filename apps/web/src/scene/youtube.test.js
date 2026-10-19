import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// stands in for the page: the scripts added to the head, and the ones taken out again
let scripts = [];
let removed = [];
beforeEach(() => {
    scripts = [];
    removed = [];
    globalThis.window = {};
    globalThis.location = { origin: "https://example.test" };
    globalThis.document = {
        createElement: () => {
            const script = {};
            script.remove = () => removed.push(script);
            return script;
        },
        head: { appendChild: (script) => scripts.push(script) }
    };
});

let imports = 0;
const fresh = async () => (await import(`./youtube.js?n=${imports++}`)).youtubePlayer;

const events = () => {
    const seen = { failed: 0 };
    return { seen, handlers: { onReady() {}, onStateChange() {}, onError() {}, onAutoplayBlocked() {}, onLoadFailed: () => seen.failed++ } };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("a script that fails to load is removed and reported, and the next call asks again", async () => {
    mock.method(console, "warn", () => {});
    const youtubePlayer = await fresh();
    const first = events();
    youtubePlayer({})(first.handlers);
    assert.equal(scripts.length, 1);
    scripts[0].onerror();
    await flush();
    assert.equal(first.seen.failed, 1);
    assert.deepEqual(removed, [scripts[0]]);
    const second = events();
    youtubePlayer({})(second.handlers);
    assert.equal(scripts.length, 2);
    class Player {
        constructor(host, options) {
            Player.made = options.events;
        }
    }
    window.YT = { Player };
    window.onYouTubeIframeAPIReady();
    await flush();
    assert.equal(Player.made.onReady, second.handlers.onReady);
    assert.equal(second.seen.failed, 0);
    mock.restoreAll();
});

test("an api script that never calls back fails after a wait, so a later call asks again", async () => {
    mock.method(console, "warn", () => {});
    mock.timers.enable({ apis: ["setTimeout"] });
    const youtubePlayer = await fresh();
    const first = events();
    youtubePlayer({})(first.handlers);
    mock.timers.tick(9000);
    await flush();
    assert.equal(first.seen.failed, 0);
    mock.timers.tick(2000);
    await flush();
    assert.equal(first.seen.failed, 1);
    youtubePlayer({})(events().handlers);
    assert.equal(scripts.length, 2);
    mock.timers.reset();
    mock.restoreAll();
});
