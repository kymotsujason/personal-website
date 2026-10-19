// youtube's iframe api, loaded once, making a player with no list, since music.js cues the tracks' ids
let api = null;

// the api script loads but never calls back on some flaky connections
const API_WAIT_MS = 10000;

// a failed load clears the cache, so the next call tries again
const loadApi = () => {
    if (!api) {
        api = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            let timer = null;
            const fail = (message) => {
                clearTimeout(timer);
                script.remove();
                api = null;
                reject(new Error(message));
            };
            window.onYouTubeIframeAPIReady = () => {
                clearTimeout(timer);
                resolve(window.YT);
            };
            script.src = "https://www.youtube.com/iframe_api";
            script.onerror = () => fail("youtube's player api didn't load");
            timer = setTimeout(() => fail("youtube's player api took too long"), API_WAIT_MS);
            document.head.appendChild(script);
        });
    }
    return api;
};

// a blocked api (an ad blocker, or offline) leaves the music card on the first track instead of breaking the page, and
// tells the music so a later press asks again
export const youtubePlayer = (host) => ({ onReady, onStateChange, onError, onAutoplayBlocked, onLoadFailed }) => {
    loadApi()
        .then((YT) => {
            new YT.Player(host, {
                host: "https://www.youtube-nocookie.com",
                width: "100%",
                height: "100%",
                playerVars: { playsinline: 1, rel: 0, origin: location.origin },
                events: { onReady, onStateChange, onError, onAutoplayBlocked }
            });
        })
        .catch((error) => {
            console.warn(error.message);
            onLoadFailed?.();
        });
};
