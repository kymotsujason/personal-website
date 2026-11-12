// the 2d scene's log for a real phone, only in a PERF=1 build with ?perf in the address (flat/index.js loads it). for
// 40 s from load it keeps each frame's gap, the scene's state, and how long the frame's animation frame callbacks ran,
// with every error and warning, each tap, each step of a page swap, the rest rule's state as it changes, and what the
// frames layer looks like a few seconds after the first frame and at the end. then it posts it all to the preview
// server, which saves it in perf-logs/ as perf.js's logs are. it's how a phone's safari is read without a mac
const LOG_FOR = 40000;

// the frames layer and the frame on show, as the page has them now
const framesNow = () => {
    const layer = document.querySelector(".flat-frames");
    const on = document.querySelector(".flat-frame.on");
    const piece = on ? on.querySelector("i") : null;
    const rect = (el) => {
        const r = el.getBoundingClientRect();
        return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    };
    const style = (el, names) => {
        const cs = getComputedStyle(el);
        return Object.fromEntries(names.map((name) => [name, cs[name].slice(0, 120)]));
    };
    return {
        frames: document.querySelectorAll(".flat-frame").length,
        layer: layer ? { rect: rect(layer), ...style(layer, ["transform", "willChange", "visibility", "display", "opacity", "zIndex"]) } : null,
        on: on ? { index: [...on.parentElement.children].indexOf(on), set: on.dataset.set, pieces: on.querySelectorAll("i").length, rect: rect(on), ...style(on, ["visibility", "display"]) } : null,
        piece: piece ? { rect: rect(piece), ...style(piece, ["backgroundImage", "backgroundPosition", "width", "height", "visibility"]) } : null,
        screens: document.querySelectorAll(".flat-face").length,
        classes: document.documentElement.className
    };
};

// whether the frame's atlas loads as an image of its own, and how big it is
const atlasCheck = () =>
    new Promise((resolve) => {
        const piece = document.querySelector(".flat-frame.on i");
        const match = piece ? getComputedStyle(piece).backgroundImage.match(/url\("?([^")]+)"?\)/) : null;
        if (!match) {
            resolve({ url: null });
            return;
        }
        const image = new Image();
        const started = performance.now();
        image.onload = () => resolve({ url: match[1], size: [image.naturalWidth, image.naturalHeight], ms: Math.round(performance.now() - started) });
        image.onerror = () => resolve({ url: match[1], error: true });
        image.src = match[1];
    });

export const startFlatPerf = ({ status, effects = () => null }) => {
    const frames = [];
    const events = [];
    const snapshots = [];
    const note = (kind, text) => events.push([Math.round(performance.now()), kind, String(text).slice(0, 300)]);

    addEventListener("error", (event) => note("error", event.message || event.type));
    addEventListener("unhandledrejection", (event) => note("rejection", event.reason && (event.reason.stack || event.reason.message || event.reason)));
    ["warn", "error"].forEach((level) => {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            note(level, args.map((a) => (a && a.message) || a).join(" "));
            original(...args);
        };
    });
    new MutationObserver(() => note("classes", document.documentElement.className)).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    // the page swap's steps and the taps, to line up with the long frames
    ["astro:before-preparation", "astro:after-preparation", "astro:before-swap", "astro:after-swap", "astro:page-load"].forEach((name) =>
        document.addEventListener(name, () => note("nav", name.slice(6)), { capture: true })
    );
    ["pointerdown", "pointerup", "click"].forEach((name) => addEventListener(name, () => note("input", name), { capture: true }));

    // how long each frame's animation frame callbacks ran, so a long frame shows whether script or the browser's own
    // work (style, layout, paint, compositing) took the time
    let scriptMs = 0;
    const ask = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
        ask((time) => {
            const start = performance.now();
            try {
                callback(time);
            } finally {
                scriptMs += performance.now() - start;
            }
        });

    let last = 0;
    let lastState = "";
    let lastEffects = "";
    const tick = (now) => {
        const shown = JSON.stringify(effects());
        if (shown !== lastEffects) {
            lastEffects = shown;
            note("effects", shown);
        }
        const s = status();
        const state = s ? `${s.phone}/${s.busy ? "busy" : "still"}/${s.app ?? "home"}` : "none";
        frames.push([Math.round(now), last ? Math.round((now - last) * 10) / 10 : 0, state === lastState ? "" : state, Math.round(scriptMs * 10) / 10]);
        scriptMs = 0;
        lastState = state;
        last = now;
        if (now < LOG_FOR) {
            requestAnimationFrame(tick);
            return;
        }
        finish();
    };

    const snap = async (label) => {
        snapshots.push({ label, at: Math.round(performance.now()), ...framesNow(), atlas: await atlasCheck() });
    };
    const waitReady = setInterval(() => {
        if (document.documentElement.classList.contains("flat-ready")) {
            clearInterval(waitReady);
            setTimeout(() => snap("3 s after the first frame"), 3000);
        }
    }, 200);

    const finish = async () => {
        await snap("end");
        const log = {
            agent: navigator.userAgent,
            dpr: devicePixelRatio,
            window: [innerWidth, innerHeight],
            address: location.pathname + location.search,
            snapshots,
            events,
            frames
        };
        const agent = navigator.userAgent;
        const browser = /CriOS/.test(agent) ? "ios-chrome" : /Chrome/.test(agent) ? "chrome" : /Safari/.test(agent) ? "safari" : "other";
        const name = `flat-${browser}-${Date.now()}`;
        fetch(`/__perf?name=${name}`, { method: "POST", body: JSON.stringify(log) })
            .then((res) => res.text())
            .then((text) => {
                const shown = document.createElement("div");
                shown.textContent = `perf log ${text}: ${name}`;
                Object.assign(shown.style, { position: "fixed", left: "8px", bottom: "8px", padding: "6px 10px", background: "#000c", color: "#fff", font: "12px monospace", zIndex: 99999 });
                document.body.appendChild(shown);
            })
            .catch(() => {
                document.title = "perf log failed";
            });
    };
    requestAnimationFrame(tick);
};
