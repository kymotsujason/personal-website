// a frame log for measuring on a real phone, only with ?perf in the address. for 30 s from load it keeps each frame's
// gap, script time, fold, and blur, the webgl calls over 2 ms with what they uploaded, the phone's state as it
// changes, when three makes a shader program or a texture (so a stall can be matched to a first draw), and when
// youtube's files arrived, then posts it all to the dev or preview server (vite.config.js saves it in perf-logs/).
// loaded first by scene/index.js, so the webgl calls are wrapped before three makes its renderer
const params = new URLSearchParams(location.search);
const LOG_FOR = 30000;

if (params.has("perf")) {
    const frames = [];
    const calls = [];
    const phases = [];
    const made = [];
    let scriptMs = 0;
    let lastPhase = "";
    let lastMade = "";

    // when each image decode started and finished, and how long its own call held the thread, since a decode outside
    // a frame callback shows only as a long gap. texture storage is always kept, to see when each large one is made
    const decodes = [];
    if (window.createImageBitmap) {
        const decode = window.createImageBitmap.bind(window);
        window.createImageBitmap = (...args) => {
            const start = performance.now();
            const result = decode(...args);
            const sync = performance.now() - start;
            const size = args[0] && args[0].size ? `${Math.round(args[0].size / 1024)}k` : args[0] && args[0].constructor.name;
            const entry = [Math.round(start), Math.round(sync * 10) / 10, null, size];
            decodes.push(entry);
            return result.then((bitmap) => {
                entry[2] = Math.round(performance.now());
                entry[3] = `${size} ${bitmap.width}x${bitmap.height}`;
                return bitmap;
            });
        };
    }

    const timed = ["texImage2D", "texSubImage2D", "texStorage2D", "generateMipmap", "compileShader", "linkProgram", "getProgramParameter", "getShaderParameter", "drawElements", "drawArrays"];
    [window.WebGL2RenderingContext, window.WebGLRenderingContext].filter(Boolean).forEach((context) => {
        timed.forEach((name) => {
            const original = context.prototype[name];
            if (!original) {
                return;
            }
            context.prototype[name] = function (...args) {
                const start = performance.now();
                const result = original.apply(this, args);
                const ms = performance.now() - start;
                if (ms > 2 || (name === "texStorage2D" && args[3] * args[4] >= 1024 * 1024)) {
                    const source = args.find((a) => a && typeof a === "object" && "width" in a);
                    const what = source ? `${source.width}x${source.height} ${source.constructor.name}` : name === "texStorage2D" ? `${args[3]}x${args[4]} levels ${args[1]}` : "";
                    calls.push([Math.round(start), name, Math.round(ms * 10) / 10, what]);
                }
                return result;
            };
        });
    });

    // every frame callback is timed, so a frame's script time is the sum of them
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => request((now) => {
        const start = performance.now();
        callback(now);
        scriptMs += performance.now() - start;
    });

    const tick = (now) => {
        const spike = window.spike;
        const fold = spike && spike.pose ? Math.round(spike.pose.fold * 100) / 100 : null;
        const blur = spike && spike.pose ? Math.round(spike.pose.blur * 10) / 10 : null;
        frames.push([Math.round(now * 10) / 10, Math.round(scriptMs * 10) / 10, fold, blur]);
        scriptMs = 0;
        const info = spike && spike.renderer ? spike.renderer().info : null;
        if (info) {
            const counts = `${info.programs ? info.programs.length : 0} ${info.memory.textures}`;
            if (counts !== lastMade) {
                lastMade = counts;
                made.push([Math.round(now), ...counts.split(" ").map(Number)]);
            }
        }
        const s = spike && spike.state;
        const phase = s ? `${document.body.classList.contains("ready") ? "shown" : "black"} ${s.phone} ${s.busy ? "busy" : "still"} ${s.zoomed ? "app" : "home"}` : "loading";
        if (phase !== lastPhase) {
            lastPhase = phase;
            phases.push([Math.round(now), phase]);
        }
        if (now < LOG_FOR) {
            request(tick);
            return;
        }
        const canvas = document.querySelector("canvas");
        const log = {
            agent: navigator.userAgent,
            dpr: devicePixelRatio,
            window: [innerWidth, innerHeight],
            canvas: canvas ? [canvas.width, canvas.height] : null,
            bitmaps: typeof createImageBitmap !== "undefined",
            phases,
            made,
            // when youtube's scripts and the player's page arrived, to match against long frames
            youtube: performance.getEntriesByType("resource").filter((e) => /youtube|ytimg|googlevideo/.test(e.name)).map((e) => [Math.round(e.startTime), Math.round(e.responseEnd), e.initiatorType, e.name.split("?")[0].slice(-60)]),
            decodes,
            calls,
            frames
        };
        const agent = navigator.userAgent;
        const browser = /CriOS/.test(agent) ? "ios-chrome" : /Chrome/.test(agent) ? "chrome" : /Safari/.test(agent) ? "safari" : "other";
        const name = `${browser}-${Date.now()}`;
        fetch(`/__perf?name=${name}`, { method: "POST", body: JSON.stringify(log) })
            .then((res) => res.text())
            .then((text) => {
                document.title = `perf ${text}`;
                const note = document.createElement("div");
                note.textContent = `perf log ${text}: ${name}`;
                Object.assign(note.style, { position: "fixed", left: "8px", bottom: "8px", padding: "6px 10px", background: "#000c", color: "#fff", font: "12px monospace", zIndex: 99999 });
                document.body.appendChild(note);
            })
            .catch(() => {
                document.title = "perf log failed";
            });
    };
    request(tick);
}
