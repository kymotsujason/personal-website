// youtube's iframe api, loaded once, making a player with no list, since music.js cues the tracks' ids
let api = null;

// the api script loads but never calls back on some flaky connections
const API_WAIT_MS = 10000;
// the player's iframe can stall the same way, and then onReady never comes
const PLAYER_WAIT_MS = 15000;

// a failed load clears the cache, so the next call tries again. youtube's loader runs once per YT object and does
// nothing while YT.loading is set, so a load that ran out forgets a YT with no player, and the next try starts over
const loadApi = () => {
    if (window.YT?.Player) {
        return Promise.resolve(window.YT);
    }
    if (api) {
        return api;
    }
    const promise = new Promise((resolve, reject) => {
        let settled = false;
        let script = null;
        const ready = () => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(window.YT);
        };
        const fail = (message) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            script?.remove();
            if (api === promise) {
                api = null;
            }
            // the loader's var makes YT a global that can't be deleted
            if (window.YT && !window.YT.Player) {
                window.YT = undefined;
            }
            reject(new Error(message));
        };
        const timer = setTimeout(() => fail("youtube's player api took too long"), API_WAIT_MS);
        window.onYouTubeIframeAPIReady = ready;
        // a loader that arrived after an earlier wait ran out is still fetching its widget script
        if (window.YT?.loading) {
            window.YT.ready?.(ready);
            return;
        }
        script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.onerror = () => fail("youtube's player api didn't load");
        document.head.appendChild(script);
    });
    api = promise;
    return promise;
};

// a blocked api (an ad blocker, or offline) leaves the music card on the first track instead of breaking the page, and
// tells the music so a later press asks again. each player goes in a new spot in the host, which a stalled player
// gives back
export const youtubePlayer = (host) => ({ onReady, onStateChange, onError, onAutoplayBlocked, onLoadFailed }) => {
    const failed = (error) => {
        console.warn(error.message);
        onLoadFailed?.();
    };
    loadApi()
        .then((YT) => {
            const spot = document.createElement("div");
            host.replaceChildren(spot);
            let settled = false;
            let timer = null;
            const ready = (event) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                onReady(event);
            };
            new YT.Player(spot, {
                host: "https://www.youtube-nocookie.com",
                width: "100%",
                height: "100%",
                playerVars: { playsinline: 1, rel: 0, origin: location.origin },
                events: { onReady: ready, onStateChange, onError, onAutoplayBlocked }
            });
            if (settled) {
                return;
            }
            timer = setTimeout(() => {
                settled = true;
                host.replaceChildren();
                failed(new Error("youtube's player took too long"));
            }, PLAYER_WAIT_MS);
        })
        .catch(failed);
};
