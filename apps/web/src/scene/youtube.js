// youtube's iframe api, loaded once, making a player with no list, since music.js cues the tracks' ids
let api = null;

const loadApi = () => {
    if (!api) {
        api = new Promise((resolve, reject) => {
            window.onYouTubeIframeAPIReady = () => resolve(window.YT);
            const script = document.createElement("script");
            script.src = "https://www.youtube.com/iframe_api";
            script.onerror = () => reject(new Error("youtube's player api didn't load"));
            document.head.appendChild(script);
        });
    }
    return api;
};

// a blocked api (an ad blocker, or offline) leaves the music card on the first track instead of breaking the page
export const youtubePlayer = (host) => ({ onReady, onStateChange, onError, onAutoplayBlocked }) => {
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
        .catch((error) => console.warn(error.message));
};
