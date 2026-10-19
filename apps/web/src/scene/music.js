// jason's "old goodies" playlist from src/data/tracks.json, played by youtube's player, which loads when first needed
import { LEVEL_DEFAULT, LEVEL_STEPS, artFor, savedLevel } from "./musicInfo.js";

// the home and music pages and the tests read these from here
export { LEVEL_DEFAULT, LEVEL_STEPS, artFor, cleanTitle } from "./musicInfo.js";

// quiet but noticeable, out of youtube's 100
export const BASE_VOLUME = 20;
// tracks that are louder or quieter than the rest, by video id, with the volume that evens them out
export const VOLUMES = {};
const FADE_MS = 3000;
const FADE_STEP_MS = 100;
// how far into a song previous goes back to its start instead of to the song before, as ios does
const RESTART_AFTER = 3;
// how long a play call waits to see the player leave the cued state before counting the start as blocked
const START_WAIT_MS = 3000;
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;
const ENDED = 0;
const CUED = 5;
const UNSTARTED = -1;

export const volumeFor = (id, volumes = VOLUMES) => volumes[id] ?? BASE_VOLUME;

// a track plays at its own volume at LEVEL_DEFAULT, scaled up or down from there
export const loudnessAt = (id, level, volumes = VOLUMES) => Math.min(100, Math.round((volumeFor(id, volumes) * level) / LEVEL_DEFAULT));

export const createMusic = ({ tracks: list, loadPlayer, storage, volumes = VOLUMES, onChange = () => {} }) => {
    const tracks = list.map(({ id, title, channel }) => ({ id, title, channel, art: artFor(id) }));
    const ids = tracks.map((t) => t.id);
    let player = null;
    let loading = false;
    let index = 0;
    let playing = false;
    // whether the player has really played since the music last stopped, since a blocked start can go from buffering
    // back to unstarted without ever playing
    let played = false;
    let failures = 0;
    // the player's code or youtube's api didn't arrive, so the next press asks again
    let unavailable = false;
    // what to do once the player is ready, for a play or resume that came before it: "fade" or "play"
    let startWhenReady = null;
    // a track tapped before the player was ready, played once it is
    let trackWhenReady = null;
    let fade = null;
    let startCheck = null;
    let level = savedLevel(storage);
    const loudness = (id = ids[index]) => loudnessAt(id, level, volumes);

    const state = () => ({ ready: player !== null, ids, index, playing, tracks, current: tracks[index] ?? null, volume: player ? player.getVolume() : null, level, failed: ids.length > 0 && failures >= ids.length, unavailable });
    const changed = () => onChange(state());

    const load = () => {
        if (player || loading) {
            return;
        }
        loading = true;
        if (unavailable) {
            unavailable = false;
            changed();
        }
        loadPlayer({ onReady, onStateChange, onError, onAutoplayBlocked, onLoadFailed });
    };

    const stopFade = () => {
        if (fade) {
            clearInterval(fade);
            fade = null;
        }
    };

    const stopStartCheck = () => {
        clearTimeout(startCheck);
        startCheck = null;
    };

    // the play control shows again, so the next tap plays
    const stopStarting = () => {
        stopFade();
        stopStartCheck();
        playing = false;
        played = false;
        changed();
    };

    // only youtube saying so turns the saved preference off, since a start that's just slow looks the same as a
    // silent block
    const blocked = () => {
        stopStarting();
        storage.setItem("music", "off");
    };

    // some browsers block a start without saying so, and the player just stays cued
    const watchStart = () => {
        stopStartCheck();
        startCheck = setTimeout(() => {
            startCheck = null;
            if (player.getPlayerState() === CUED) {
                stopStarting();
            }
        }, START_WAIT_MS);
    };

    // starts the current track at its volume, or from silence up to it when fading in. the fade reads the level each
    // step, so pressing a volume button mid fade lands on the new level
    const start = (fadeIn) => {
        stopFade();
        player.setVolume(fadeIn ? 0 : loudness());
        player.unMute();
        player.playVideo();
        watchStart();
        if (!fadeIn) {
            return;
        }
        const steps = FADE_MS / FADE_STEP_MS;
        let step = 0;
        fade = setInterval(() => {
            step++;
            player.setVolume(Math.round((loudness() * Math.min(step, steps)) / steps));
            if (step >= steps) {
                stopFade();
            }
        }, FADE_STEP_MS);
    };

    const startAt = (i) => {
        stopFade();
        player.setVolume(loudness(ids[i]));
        player.unMute();
        player.playVideoAt(i);
        watchStart();
    };

    const play = () => {
        storage.setItem("music", "on");
        failures = 0;
        if (player) {
            start(false);
        } else {
            startWhenReady = "play";
            load();
        }
    };

    const pause = () => {
        stopFade();
        stopStartCheck();
        startWhenReady = null;
        trackWhenReady = null;
        storage.setItem("music", "off");
        if (player) {
            player.pauseVideo();
        }
    };

    // cueing never starts the list
    const onReady = (event) => {
        player = event.target;
        player.cuePlaylist(ids);
        if (player.setLoop) {
            player.setLoop(true);
        }
        changed();
        if (trackWhenReady !== null) {
            startAt(trackWhenReady);
        } else if (startWhenReady) {
            start(startWhenReady === "fade");
        }
        trackWhenReady = null;
        startWhenReady = null;
    };

    // a new track starts at its own volume, unless a fade in is still bringing the volume up
    // playing or pausing from youtube's own controls in the music app is remembered the same as from the card
    const onStateChange = (event) => {
        // buffering is still playing, and an unstarted player keeps playing only once it has played
        if (event.data === PLAYING) {
            playing = true;
            played = true;
        } else if (event.data === BUFFERING) {
            playing = true;
        } else if (event.data === UNSTARTED) {
            playing = played;
        } else if (event.data === PAUSED || event.data === ENDED || event.data === CUED) {
            playing = false;
            played = false;
        }
        if (event.data === PLAYING) {
            failures = 0;
            stopStartCheck();
            storage.setItem("music", "on");
        } else if (event.data === PAUSED) {
            storage.setItem("music", "off");
        }
        const i = player.getPlaylistIndex();
        if (i >= 0 && i !== index) {
            index = i;
            if (!fade) {
                player.setVolume(loudness());
            }
        }
        changed();
    };

    // a track that won't play (removed, private, or blocked from embedding) is skipped, but only once round the list
    const onError = () => {
        if (ids.length && failures >= ids.length) {
            return;
        }
        failures++;
        player.nextVideo();
        changed();
    };

    const onAutoplayBlocked = () => blocked();

    const onLoadFailed = () => {
        loading = false;
        unavailable = true;
        startWhenReady = null;
        trackWhenReady = null;
        changed();
    };

    return {
        state,
        load,
        // how far into the track it is, at as a share of its length (0 before the player or the track is ready)
        position: () => {
            const time = player ? player.getCurrentTime() || 0 : 0;
            const duration = player ? player.getDuration() || 0 : 0;
            return { time, duration, at: duration > 0 ? Math.min(time / duration, 1) : 0 };
        },
        seek: (at) => {
            if (!player) {
                return;
            }
            const duration = player.getDuration() || 0;
            player.seekTo(Math.min(Math.max(at, 0), 1) * duration, true);
        },
        play,
        pause,
        toggle: () => (playing ? pause() : play()),
        level: () => level,
        // one step up (1) or down (-1), kept for the next visit. gives back the new level
        stepLevel: (delta) => {
            level = Math.min(LEVEL_STEPS, Math.max(0, level + delta));
            storage.setItem("volumeLevel", String(level));
            if (player && !fade) {
                player.setVolume(loudness());
            }
            changed();
            return level;
        },
        next: () => {
            if (player) {
                player.nextVideo();
            }
        },
        // the first song's previous is the last song, as the list loops
        previous: () => {
            if (!player) {
                return;
            }
            if ((player.getCurrentTime() || 0) > RESTART_AFTER) {
                player.seekTo(0, true);
                return;
            }
            const i = Math.max(player.getPlaylistIndex(), 0);
            player.playVideoAt((i - 1 + ids.length) % ids.length);
        },
        playAt: (i) => {
            storage.setItem("music", "on");
            failures = 0;
            if (player) {
                startAt(i);
                return;
            }
            trackWhenReady = i;
            load();
        },
        // a later visit's first click or key fades in music left on, and the caller loads the player
        resume: () => {
            if (storage.getItem("music") !== "on") {
                return false;
            }
            // music started from youtube's own player, whose presses the page never hears, is already on
            if (playing) {
                return true;
            }
            if (player) {
                start(true);
            } else {
                startWhenReady = "fade";
            }
            return true;
        }
    };
};
