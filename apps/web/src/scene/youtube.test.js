import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// stands in for the page: the scripts added to the head, and the ones taken out again
let scripts = [];
let removed = [];
// the YT objects whose loader asked for youtube's widget script
let widgets = [];
beforeEach(() => {
    scripts = [];
    removed = [];
    widgets = [];
    Player.made = [];
    globalThis.window = {};
    globalThis.location = { origin: "https://example.test" };
    globalThis.document = {
        createElement: () => {
            const el = {};
            el.remove = () => removed.push(el);
            return el;
        },
        head: { appendChild: (script) => scripts.push(script) }
    };
    mock.method(console, "warn", () => {});
    mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
});

// what youtube's iframe_api runs once it arrives, guard and all: only the first copy makes YT.ready and asks for the
// widget script, since a later copy finds YT.loading set
const runLoader = () => {
    if (!window.YT) {
        window.YT = { loading: 0, loaded: 0 };
    }
    const YT = window.YT;
    if (YT.loading) {
        return;
    }
    YT.loading = 1;
    const waiting = [];
    YT.ready = (f) => (YT.loaded ? f() : waiting.push(f));
    window.onYTReady = () => {
        YT.loaded = 1;
        waiting.forEach((f) => f());
    };
    widgets.push(YT);
};

class Player {
    constructor(host, options) {
        Player.made.push({ host, events: options.events });
    }
}

// the widget script arriving, which adds the player and calls both of the loader's ready callbacks
const widgetArrives = (YT = widgets.at(-1)) => {
    YT.Player = Player;
    window.onYTReady?.();
    window.onYouTubeIframeAPIReady?.();
};

// the element youtube's player goes in
const container = () => ({
    children: [],
    replaceChildren(...nodes) {
        this.children = nodes;
    }
});

let imports = 0;
const fresh = async () => (await import(`./youtube.js?n=${imports++}`)).youtubePlayer;

const events = () => {
    const seen = { failed: 0, ready: 0 };
    return { seen, handlers: { onReady: () => seen.ready++, onStateChange() {}, onError() {}, onAutoplayBlocked() {}, onLoadFailed: () => seen.failed++ } };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("a script that fails to load is removed and reported, and the next call asks again", async () => {
    const youtubePlayer = await fresh();
    const first = events();
    youtubePlayer(container())(first.handlers);
    assert.equal(scripts.length, 1);
    scripts[0].onerror();
    await flush();
    assert.equal(first.seen.failed, 1);
    assert.deepEqual(removed, [scripts[0]]);
    const second = events();
    youtubePlayer(container())(second.handlers);
    assert.equal(scripts.length, 2);
    runLoader();
    widgetArrives();
    await flush();
    assert.equal(Player.made.length, 1);
    assert.equal(Player.made[0].events.onStateChange, second.handlers.onStateChange);
    Player.made[0].events.onReady({});
    assert.equal(second.seen.ready, 1);
    assert.equal(second.seen.failed, 0);
});

test("an api script that never calls back fails after a wait, so a later call asks again", async () => {
    const youtubePlayer = await fresh();
    const first = events();
    youtubePlayer(container())(first.handlers);
    mock.timers.tick(9000);
    await flush();
    assert.equal(first.seen.failed, 0);
    mock.timers.tick(2000);
    await flush();
    assert.equal(first.seen.failed, 1);
    youtubePlayer(container())(events().handlers);
    assert.equal(scripts.length, 2);
});

test("a retry after the loader ran and its widget script never came loads the loader again, and gets its callback", async () => {
    const youtubePlayer = await fresh();
    const first = events();
    youtubePlayer(container())(first.handlers);
    runLoader();
    mock.timers.tick(10001);
    await flush();
    assert.equal(first.seen.failed, 1);
    const second = events();
    youtubePlayer(container())(second.handlers);
    assert.equal(scripts.length, 2);
    runLoader();
    assert.equal(widgets.length, 2, "the second loader asked for the widget script again");
    widgetArrives();
    await flush();
    assert.equal(Player.made.length, 1);
    assert.equal(second.seen.failed, 0);
});

test("a call once youtube's player api is here makes the player at once, with no script", async () => {
    const youtubePlayer = await fresh();
    window.YT = { Player };
    const first = events();
    youtubePlayer(container())(first.handlers);
    await flush();
    assert.equal(scripts.length, 0);
    assert.equal(Player.made.length, 1);
    assert.equal(first.seen.failed, 0);
});

test("a call while a late loader still waits on its widget script waits on it too, instead of adding a script", async () => {
    const youtubePlayer = await fresh();
    const first = events();
    youtubePlayer(container())(first.handlers);
    mock.timers.tick(10001);
    await flush();
    assert.equal(first.seen.failed, 1);
    // the first iframe_api arrives after its wait ran out
    runLoader();
    const second = events();
    youtubePlayer(container())(second.handlers);
    assert.equal(scripts.length, 1);
    widgetArrives();
    await flush();
    assert.equal(Player.made.length, 1);
    assert.equal(second.seen.failed, 0);
});

test("a wait on a late loader still runs out, and the call after it loads the loader again", async () => {
    const youtubePlayer = await fresh();
    youtubePlayer(container())(events().handlers);
    mock.timers.tick(10001);
    await flush();
    runLoader();
    const second = events();
    youtubePlayer(container())(second.handlers);
    mock.timers.tick(10001);
    await flush();
    assert.equal(second.seen.failed, 1);
    youtubePlayer(container())(events().handlers);
    assert.equal(scripts.length, 2);
    runLoader();
    assert.equal(widgets.length, 2);
});

test("a late script error after the wait ran out leaves the retry's load in place", async () => {
    const youtubePlayer = await fresh();
    const first = events();
    youtubePlayer(container())(first.handlers);
    mock.timers.tick(10001);
    await flush();
    const second = events();
    youtubePlayer(container())(second.handlers);
    assert.equal(scripts.length, 2);
    scripts[0].onerror();
    await flush();
    youtubePlayer(container())(events().handlers);
    assert.equal(scripts.length, 2, "the third call shares the retry's load");
    assert.equal(first.seen.failed, 1);
    assert.equal(second.seen.failed, 0);
});

test("a player that never says it's ready fails after a wait, gives back its spot, and the next call makes a new one", async () => {
    const youtubePlayer = await fresh();
    window.YT = { Player };
    const host = container();
    const first = events();
    youtubePlayer(host)(first.handlers);
    await flush();
    assert.equal(Player.made.length, 1);
    assert.deepEqual(host.children, [Player.made[0].host]);
    mock.timers.tick(14000);
    assert.equal(first.seen.failed, 0);
    mock.timers.tick(2000);
    assert.equal(first.seen.failed, 1);
    assert.deepEqual(host.children, []);
    Player.made[0].events.onReady({});
    assert.equal(first.seen.ready, 0, "a late ready from the old player is dropped");
    const second = events();
    youtubePlayer(host)(second.handlers);
    await flush();
    assert.equal(Player.made.length, 2);
    assert.deepEqual(host.children, [Player.made[1].host]);
    assert.notEqual(Player.made[1].host, Player.made[0].host);
});

test("a player that says it's ready in time isn't failed later", async () => {
    const youtubePlayer = await fresh();
    window.YT = { Player };
    const first = events();
    youtubePlayer(container())(first.handlers);
    await flush();
    Player.made[0].events.onReady({});
    mock.timers.tick(30000);
    assert.equal(first.seen.ready, 1);
    assert.equal(first.seen.failed, 0);
});
