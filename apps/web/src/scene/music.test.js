import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createMusic, volumeFor, cleanTitle, loudnessAt, BASE_VOLUME, LEVEL_DEFAULT, LEVEL_STEPS } from "./music.js";

// five of the playlist's tracks, as src/data/tracks.json has them
const TRACKS = [
    { id: "_GOR5gvQwDI", title: "Simple Plan - I'm Just A Kid (Official Video) [HD]", channel: "SimplePlan" },
    { id: "iBsjEXsMM78", title: "paranoia - English Subtitles", channel: "EtoCetera" },
    { id: "GgxcvmkPD-I", title: '"Pts.Of.Athrty" (Official HD Video) - Linkin Park', channel: "Linkin Park" },
    { id: "oz4qTw15ixA", title: '009 Sound System "Speak To Angels" HD - now on Amazon MP3', channel: "trackonerecordings" },
    { id: "04F4xlWSFh0", title: "Drowning Pool - Bodies (Official HD Music Video)", channel: "DrowningPoolVEVO" }
];
const IDS = TRACKS.map((t) => t.id);
const CUED = 5;

// stands in for youtube's player and its events. state 1 is playing, 2 paused, and 5 cued, as in the iframe api
const fakePlayer = () => {
    const calls = [];
    let events = null;
    let loads = 0;
    let index = 0;
    let volume = 100;
    let time = 30;
    let playerState = -1;
    const player = {
        cuePlaylist: (ids) => {
            playerState = CUED;
            calls.push(["cuePlaylist", ids]);
        },
        getPlaylistIndex: () => index,
        getPlayerState: () => playerState,
        setVolume: (v) => {
            volume = v;
            calls.push(["setVolume", v]);
        },
        getVolume: () => volume,
        unMute: () => calls.push(["unMute"]),
        playVideo: () => calls.push(["playVideo"]),
        pauseVideo: () => calls.push(["pauseVideo"]),
        nextVideo: () => calls.push(["nextVideo"]),
        playVideoAt: (i) => calls.push(["playVideoAt", i]),
        getCurrentTime: () => time,
        getDuration: () => 120,
        seekTo: (seconds, allowAhead) => calls.push(["seekTo", seconds, allowAhead])
    };
    const load = (handlers) => {
        loads++;
        events = handlers;
    };
    const fire = (name, data) => {
        if (name === "onStateChange") {
            playerState = data;
        }
        events[name]({ target: player, data });
    };
    const moveTo = (i) => {
        index = i;
    };
    const setTime = (t) => {
        time = t;
    };
    const started = () => calls.some(([name]) => name === "playVideo" || name === "playVideoAt");
    return { calls, load, fire, moveTo, setTime, started, loads: () => loads, volume: () => volume };
};

const memory = () => {
    const kept = new Map();
    return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)) };
};

const make = (yt, options = {}) => createMusic({ tracks: TRACKS, loadPlayer: yt.load, storage: memory(), ...options });

// the player asked for and arrived
const ready = (music, yt) => {
    music.load();
    yt.fire("onReady");
};

test("the tracks, their titles, and their art are known before the player, with no fetch for them", () => {
    const fetched = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        fetched.push(String(url));
        throw new Error("no network in this test");
    };
    try {
        const yt = fakePlayer();
        const music = make(yt);
        const { tracks, current, index, ready: hasPlayer } = music.state();
        assert.equal(hasPlayer, false);
        assert.equal(index, 0);
        assert.deepEqual(tracks[1], { id: "iBsjEXsMM78", title: "paranoia - English Subtitles", channel: "EtoCetera", art: "https://i.ytimg.com/vi/iBsjEXsMM78/hqdefault.jpg" });
        assert.deepEqual(tracks.map((t) => t.id), IDS);
        assert.equal(current.title, TRACKS[0].title);
        ready(music, yt);
        music.play();
        assert.equal(music.state().tracks[2].title, TRACKS[2].title);
        assert.deepEqual(fetched, []);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("nothing loads the player until it's asked for, and it loads once", () => {
    const yt = fakePlayer();
    const music = make(yt);
    music.next();
    music.previous();
    music.seek(0.5);
    assert.equal(yt.loads(), 0);
    music.load();
    music.load();
    assert.equal(yt.loads(), 1);
});

test("with no player, playAt loads it and plays that track once it's ready, at its volume", () => {
    const yt = fakePlayer();
    const storage = memory();
    const music = make(yt, { storage });
    music.playAt(4);
    assert.equal(yt.loads(), 1);
    assert.equal(storage.getItem("music"), "on");
    assert.equal(yt.started(), false);
    yt.fire("onReady");
    assert.deepEqual(yt.calls.at(-1), ["playVideoAt", 4]);
    assert.equal(yt.volume(), BASE_VOLUME);
    music.playAt(2);
    assert.deepEqual(yt.calls.at(-1), ["playVideoAt", 2]);
    assert.equal(yt.loads(), 1);
});

test("the player cues the playlist's ids when it's ready, and cueing never starts it", () => {
    const yt = fakePlayer();
    const music = make(yt);
    ready(music, yt);
    assert.deepEqual(yt.calls.find(([name]) => name === "cuePlaylist"), ["cuePlaylist", IDS]);
    assert.equal(yt.started(), false);
});

test("a start the browser blocks leaves the music off, so the next tap plays", () => {
    const yt = fakePlayer();
    const storage = memory();
    let changes = 0;
    const music = make(yt, { storage, onChange: () => changes++ });
    ready(music, yt);
    music.play();
    assert.equal(storage.getItem("music"), "on");
    const before = changes;
    yt.fire("onAutoplayBlocked");
    assert.equal(music.state().playing, false);
    assert.equal(storage.getItem("music"), "off");
    assert.ok(changes > before, "the card and the app hear about it");
    music.toggle();
    assert.deepEqual(yt.calls.at(-1), ["playVideo"]);
    assert.equal(storage.getItem("music"), "on");
});

test("a player still cued 3 s after a play call stops the music for this page, and keeps the saved preference", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
        for (const start of [(music) => music.play(), (music) => music.playAt(3)]) {
            const yt = fakePlayer();
            const storage = memory();
            let changes = 0;
            const music = make(yt, { storage, onChange: () => changes++ });
            ready(music, yt);
            start(music);
            mock.timers.tick(2900);
            const before = changes;
            mock.timers.tick(200);
            assert.equal(music.state().playing, false);
            assert.ok(changes > before, "the card and the app hear about it");
            // a slow start isn't a refusal, so a later visit still resumes
            assert.equal(storage.getItem("music"), "on");
        }
    } finally {
        mock.timers.reset();
    }
});

test("a player that started playing within 3 s keeps the music on", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
        const yt = fakePlayer();
        const storage = memory();
        const music = make(yt, { storage });
        ready(music, yt);
        music.play();
        yt.fire("onStateChange", 1);
        mock.timers.tick(3500);
        assert.equal(music.state().playing, true);
        assert.equal(storage.getItem("music"), "on");
    } finally {
        mock.timers.reset();
    }
});

test("play turns the volume to the track's level and remembers the music is on", () => {
    const yt = fakePlayer();
    const storage = memory();
    const music = make(yt, { storage });
    ready(music, yt);
    music.play();
    assert.deepEqual(yt.calls.slice(-3), [["setVolume", BASE_VOLUME], ["unMute"], ["playVideo"]]);
    assert.equal(storage.getItem("music"), "on");
});

test("pause remembers the music is off", () => {
    const yt = fakePlayer();
    const storage = memory();
    const music = make(yt, { storage });
    ready(music, yt);
    music.play();
    music.pause();
    assert.deepEqual(yt.calls.at(-1), ["pauseVideo"]);
    assert.equal(storage.getItem("music"), "off");
});

test("toggle plays when paused and pauses when playing", () => {
    const yt = fakePlayer();
    const music = make(yt);
    ready(music, yt);
    music.toggle();
    assert.deepEqual(yt.calls.at(-1), ["playVideo"]);
    yt.fire("onStateChange", 1);
    assert.equal(music.state().playing, true);
    music.toggle();
    assert.deepEqual(yt.calls.at(-1), ["pauseVideo"]);
});

test("a new track gets its own volume when it starts", () => {
    const yt = fakePlayer();
    const music = make(yt, { volumes: { iBsjEXsMM78: 15 } });
    ready(music, yt);
    music.play();
    yt.moveTo(1);
    yt.fire("onStateChange", 1);
    assert.equal(yt.volume(), 15);
    assert.equal(music.state().index, 1);
    assert.equal(music.state().current.id, "iBsjEXsMM78");
    assert.equal(volumeFor("GgxcvmkPD-I", { iBsjEXsMM78: 15 }), BASE_VOLUME);
});

test("a track that fails to load is skipped", () => {
    const yt = fakePlayer();
    const music = make(yt);
    ready(music, yt);
    yt.fire("onError", 150);
    assert.deepEqual(yt.calls.at(-1), ["nextVideo"]);
});

test("a later visit with the music on fades it in at the first click, up to the track's level", () => {
    mock.timers.enable({ apis: ["setInterval"] });
    try {
        const yt = fakePlayer();
        const storage = memory();
        storage.setItem("music", "on");
        const music = make(yt, { storage });
        ready(music, yt);
        assert.equal(music.resume(), true);
        assert.equal(yt.volume(), 0);
        assert.ok(yt.calls.some(([name]) => name === "playVideo"));
        mock.timers.tick(1500);
        assert.ok(yt.volume() > 0 && yt.volume() < BASE_VOLUME, `halfway it was ${yt.volume()}`);
        mock.timers.tick(2000);
        assert.equal(yt.volume(), BASE_VOLUME);
    } finally {
        mock.timers.reset();
    }
});

test("the first click doesn't start music that was left off or never turned on", () => {
    for (const kept of [null, "off"]) {
        const yt = fakePlayer();
        const storage = memory();
        if (kept) {
            storage.setItem("music", kept);
        }
        const music = make(yt, { storage });
        ready(music, yt);
        assert.equal(music.resume(), false);
        assert.ok(!yt.started(), `kept ${kept}`);
    }
});

test("a click before the player is ready starts the music once it is, without loading the player itself", () => {
    const yt = fakePlayer();
    const storage = memory();
    storage.setItem("music", "on");
    const music = make(yt, { storage });
    assert.equal(music.resume(), true);
    assert.equal(yt.loads(), 0);
    ready(music, yt);
    assert.ok(yt.calls.some(([name]) => name === "playVideo"));
});

test("play before the player is ready loads it and starts the music once it is, at its level without a fade", () => {
    const yt = fakePlayer();
    const music = make(yt);
    music.play();
    assert.equal(yt.loads(), 1);
    assert.ok(!yt.started());
    yt.fire("onReady");
    assert.ok(yt.calls.some(([name]) => name === "playVideo"));
    assert.equal(yt.volume(), BASE_VOLUME);
});

test("pause before the player is ready takes back a play, a playAt, or a resume", () => {
    for (const first of [(music) => music.play(), (music) => music.playAt(2), (music) => music.resume()]) {
        const yt = fakePlayer();
        const storage = memory();
        storage.setItem("music", "on");
        const music = make(yt, { storage });
        first(music);
        music.pause();
        ready(music, yt);
        assert.ok(!yt.started(), String(first));
    }
});

test("the music hears about each change", () => {
    const yt = fakePlayer();
    let changes = 0;
    const music = make(yt, { onChange: () => changes++ });
    ready(music, yt);
    const before = changes;
    yt.fire("onStateChange", 1);
    assert.ok(changes > before);
    assert.equal(music.state().playing, true);
});

test("skipping stops after every track has failed once in a row, instead of looping forever", () => {
    const yt = fakePlayer();
    const music = make(yt);
    ready(music, yt);
    for (let i = 0; i < IDS.length + 2; i++) {
        yt.fire("onError", 150);
    }
    assert.equal(yt.calls.filter(([name]) => name === "nextVideo").length, IDS.length);
    assert.equal(music.state().failed, true);
});

test("titles lose their bracketed notes and trailing upload notes, from the real playlist", () => {
    assert.equal(cleanTitle("Simple Plan - I'm Just A Kid (Official Video) [HD]"), "Simple Plan - I'm Just A Kid");
    assert.equal(cleanTitle('"Pts.Of.Athrty" (Official HD Video) - Linkin Park'), '"Pts.Of.Athrty" - Linkin Park');
    assert.equal(cleanTitle("paranoia - English Subtitles"), "paranoia");
    assert.equal(cleanTitle("Brave Song by Aoi Tada FULL (angel beats ending)"), "Brave Song by Aoi Tada FULL");
    assert.equal(cleanTitle('009 Sound System "Speak To Angels" HD - now on Amazon MP3'), '009 Sound System "Speak To Angels" HD');
    assert.equal(cleanTitle("Drowning Pool - Bodies (Official HD Music Video)"), "Drowning Pool - Bodies");
    assert.equal(cleanTitle("Maplestory Theme Music - Intro"), "Maplestory Theme Music - Intro");
});

test("a title that's nothing but notes keeps its original text", () => {
    assert.equal(cleanTitle("[Official Video]"), "[Official Video]");
    assert.equal(cleanTitle(""), "");
});

test("playing or pausing from youtube's own controls is remembered too", () => {
    const yt = fakePlayer();
    const storage = memory();
    const music = make(yt, { storage });
    ready(music, yt);
    yt.fire("onStateChange", 1);
    assert.equal(storage.getItem("music"), "on");
    yt.fire("onStateChange", 2);
    assert.equal(storage.getItem("music"), "off");
});

test("the position is how far into the track it is, as a share of its length", () => {
    const yt = fakePlayer();
    const music = make(yt);
    assert.deepEqual(music.position(), { time: 0, duration: 0, at: 0 });
    ready(music, yt);
    assert.deepEqual(music.position(), { time: 30, duration: 120, at: 0.25 });
});

test("seeking jumps to a share of the track, kept between its start and end", () => {
    const yt = fakePlayer();
    const music = make(yt);
    music.seek(0.5);
    ready(music, yt);
    music.seek(0.5);
    music.seek(1.4);
    music.seek(-0.2);
    assert.deepEqual(yt.calls.filter(([name]) => name === "seekTo"), [["seekTo", 60, true], ["seekTo", 120, true], ["seekTo", 0, true]]);
});

test("previous goes back to the start of the song once it's a few seconds in", () => {
    const yt = fakePlayer();
    const music = make(yt);
    ready(music, yt);
    yt.moveTo(1);
    yt.setTime(3.5);
    music.previous();
    assert.deepEqual(yt.calls.at(-1), ["seekTo", 0, true]);
});

test("previous near the start of a song plays the song before it", () => {
    const yt = fakePlayer();
    const music = make(yt);
    ready(music, yt);
    yt.moveTo(2);
    yt.setTime(1);
    music.previous();
    assert.deepEqual(yt.calls.at(-1), ["playVideoAt", 1]);
});

test("previous on the first song plays the last one", () => {
    const yt = fakePlayer();
    const music = make(yt);
    ready(music, yt);
    yt.setTime(0.5);
    music.previous();
    assert.deepEqual(yt.calls.at(-1), ["playVideoAt", IDS.length - 1]);
});

test("the volume buttons step a level that scales the track's volume and is remembered", () => {
    const yt = fakePlayer();
    const storage = memory();
    const music = make(yt, { storage, volumes: { iBsjEXsMM78: 15 } });
    ready(music, yt);
    music.play();
    assert.equal(music.level(), LEVEL_DEFAULT);
    assert.equal(yt.volume(), BASE_VOLUME);
    assert.equal(music.stepLevel(1), LEVEL_DEFAULT + 1);
    assert.equal(yt.volume(), Math.round((BASE_VOLUME * (LEVEL_DEFAULT + 1)) / LEVEL_DEFAULT));
    // a track with its own volume is scaled from that
    yt.moveTo(1);
    yt.fire("onStateChange", 1);
    assert.equal(yt.volume(), loudnessAt("iBsjEXsMM78", LEVEL_DEFAULT + 1, { iBsjEXsMM78: 15 }));
    // the level stops at both ends, and 0 is silent
    for (let i = 0; i < 40; i++) {
        music.stepLevel(-1);
    }
    assert.equal(music.level(), 0);
    assert.equal(yt.volume(), 0);
    for (let i = 0; i < 40; i++) {
        music.stepLevel(1);
    }
    assert.equal(music.level(), LEVEL_STEPS);
    assert.equal(yt.volume(), 15 * 2);
    // a later visit starts on the saved level, and a bad saved value falls back to the default
    assert.equal(make(fakePlayer(), { storage }).level(), LEVEL_STEPS);
    storage.setItem("volumeLevel", "loud");
    assert.equal(make(fakePlayer(), { storage }).level(), LEVEL_DEFAULT);
});

test("a player load that fails clears the wait, so the next play asks again and the music says it's unavailable", () => {
    const yt = fakePlayer();
    const music = make(yt);
    music.play();
    assert.equal(yt.loads(), 1);
    yt.fire("onLoadFailed");
    assert.equal(music.state().unavailable, true);
    music.play();
    assert.equal(yt.loads(), 2);
    assert.equal(music.state().unavailable, false);
    yt.fire("onReady");
    assert.deepEqual(yt.calls.at(-1), ["playVideo"]);
});

test("a new load after a failed one tells the card and the app the music isn't unavailable anymore", () => {
    const yt = fakePlayer();
    const heard = [];
    const music = make(yt, { onChange: (state) => heard.push(state.unavailable) });
    music.load();
    yt.fire("onLoadFailed");
    assert.deepEqual(heard, [true]);
    music.load();
    assert.equal(yt.loads(), 2);
    assert.deepEqual(heard, [true, false]);
});

test("a failed load forgets the play and track that were waiting on it", () => {
    const yt = fakePlayer();
    const music = make(yt);
    music.playAt(3);
    yt.fire("onLoadFailed");
    music.load();
    yt.fire("onReady");
    assert.equal(yt.started(), false);
});

test("a track that is buffering still counts as playing, so a toggle pauses it", () => {
    const yt = fakePlayer();
    const music = make(yt);
    ready(music, yt);
    music.play();
    yt.fire("onStateChange", 1);
    yt.fire("onStateChange", 3);
    assert.equal(music.state().playing, true);
    const before = yt.calls.length;
    music.toggle();
    assert.deepEqual(yt.calls.slice(before), [["pauseVideo"]]);
});

test("an unstarted player after a start that never played isn't playing", () => {
    const yt = fakePlayer();
    const music = make(yt);
    ready(music, yt);
    music.play();
    yt.fire("onStateChange", 3);
    assert.equal(music.state().playing, true);
    yt.fire("onStateChange", -1);
    assert.equal(music.state().playing, false);
});

test("an unstarted player keeps the playing state it had", () => {
    const yt = fakePlayer();
    const music = make(yt);
    ready(music, yt);
    music.play();
    yt.fire("onStateChange", 1);
    yt.fire("onStateChange", -1);
    assert.equal(music.state().playing, true);
    yt.fire("onStateChange", 2);
    assert.equal(music.state().playing, false);
});

test("a resume while the music is already playing leaves it playing at its volume", () => {
    const yt = fakePlayer();
    const storage = memory();
    const music = make(yt, { storage });
    ready(music, yt);
    music.play();
    yt.fire("onStateChange", 1);
    const before = yt.calls.length;
    assert.equal(music.resume(), true);
    assert.deepEqual(yt.calls.slice(before), []);
    assert.equal(yt.volume(), BASE_VOLUME);
});

test("a pause while the page is hidden keeps the saved preference, and the site's own pause still saves off", () => {
    const yt = fakePlayer();
    const storage = memory();
    const music = make(yt, { storage, visible: () => false });
    ready(music, yt);
    music.play();
    yt.fire("onStateChange", 1);
    yt.fire("onStateChange", 2);
    assert.equal(music.state().playing, false);
    assert.equal(storage.getItem("music"), "on");
    music.pause();
    assert.equal(storage.getItem("music"), "off");
});
