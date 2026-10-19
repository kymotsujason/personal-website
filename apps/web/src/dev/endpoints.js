// the dev server's own routes: /__save writes a key file the pose editor or a bake sends into public/keys, /__perf
// writes a frame log a phone sends with ?perf (perf.js) into perf-logs/, and /api/home stands in for the worker's
// route. /__perf also runs beside astro preview when PERF=1, since astro preview doesn't load the site's vite plugins
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { cityFor, createWeatherSource } from "../../worker/weather.js";

const keysDir = path.resolve(import.meta.dirname, "../../public/keys");
const perfDir = path.resolve(import.meta.dirname, "../../perf-logs");
const SAVE_MAX_BYTES = 1024 * 1024;
const PERF_MAX_BYTES = 8 * 1024 * 1024;

const isLoopback = (address) => address === "::1" || /^(?:::ffff:)?127\.\d+\.\d+\.\d+$/.test(address);

// a request with no origin may come from a tool like curl on this machine, but not from another one. the preview's
// proxy adds the client's address to x-forwarded-for, so every hop has to be this machine too
const fromThisMachine = (req) => {
    const forwarded = req.headers["x-forwarded-for"];
    const hops = forwarded === undefined ? [] : forwarded.split(",").map((hop) => hop.trim());
    return isLoopback(req.socket.remoteAddress || "") && hops.every(isLoopback);
};

// any page open while the server runs can send a simple post to it, so a write has to come from the server's own page
// (or from a tool like curl on this machine, which sends no origin)
const fromOwnPage = (req) => {
    if (req.headers["sec-fetch-site"] === "cross-site") {
        return false;
    }
    const origin = req.headers.origin;
    if (origin === undefined) {
        return fromThisMachine(req);
    }
    try {
        return new URL(origin).host === req.headers.host;
    } catch {
        return false;
    }
};

// a write that fails partway leaves the old file alone, since the new text only takes its name once it's all on disk
const writeWhole = (file, text) => {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temp, text);
        fs.renameSync(temp, file);
    } catch (error) {
        fs.rmSync(temp, { force: true });
        throw error;
    }
};

const jsonWriter = (dir, maxBytes) => (req, res) => {
    const name = new URL(req.url, "http://localhost").searchParams.get("name") || "";
    if (req.method !== "POST" || !/^[a-z0-9-]+$/.test(name)) {
        res.statusCode = 400;
        res.end("bad request");
        return;
    }
    if (!fromOwnPage(req)) {
        res.statusCode = 403;
        res.end("forbidden");
        return;
    }
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
        size += chunk.length;
        if (size <= maxBytes) {
            chunks.push(chunk);
        }
    });
    req.on("end", () => {
        if (size > maxBytes) {
            res.statusCode = 413;
            res.end("too large");
            return;
        }
        const body = Buffer.concat(chunks).toString("utf8");
        try {
            JSON.parse(body);
        } catch {
            res.statusCode = 400;
            res.end("not json");
            return;
        }
        try {
            fs.mkdirSync(dir, { recursive: true });
            writeWhole(path.join(dir, `${name}.json`), body);
        } catch (error) {
            console.error(`couldn't save ${name}.json: ${error.message}`);
            res.statusCode = 500;
            res.end("couldn't save");
            return;
        }
        res.end("saved");
    });
};

const dataDir = path.resolve(import.meta.dirname, "../data");

// node has no cache api, so the dev route keeps the weather in memory for as long as its cache-control header says
const memoryCache = () => {
    const entries = new Map();
    return {
        match: async (key) => {
            const entry = entries.get(key);
            return entry && Date.now() < entry.until ? new Response(entry.body, { headers: entry.headers }) : undefined;
        },
        put: async (key, response) => {
            const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("Cache-Control") || "")?.[1] || 0);
            entries.set(key, { body: await response.text(), headers: response.headers, until: Date.now() + maxAge * 1000 });
        }
    };
};

// the worker's /api/home with live weather for the visitor's time zone city, since there's no cloudflare location in
// dev, and the github fixture in place of what the cron saves
const homeRoute = () => {
    const cities = JSON.parse(fs.readFileSync(path.join(dataDir, "tzCities.json"), "utf8"));
    const github = JSON.parse(fs.readFileSync(path.join(dataDir, "github-fixture.json"), "utf8"));
    const weatherFor = createWeatherSource({ cache: memoryCache() });
    return async (req, res) => {
        const tz = new URL(req.url, "http://localhost").searchParams.get("tz") || "";
        const at = cityFor(cities, tz);
        const result = at ? await weatherFor(at[0], at[1]).catch(() => null) : null;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ weather: result && result.ok ? result.weather : null, github }));
    };
};

// a vite plugin for the dev server
export const devEndpoints = ({ keys = keysDir, perf = perfDir } = {}) => ({
    name: "dev-endpoints",
    configureServer(server) {
        server.middlewares.use("/__save", jsonWriter(keys, SAVE_MAX_BYTES));
        server.middlewares.use("/__perf", jsonWriter(perf, PERF_MAX_BYTES));
        server.middlewares.use("/api/home", homeRoute());
    }
});

// a small server on a free local port that answers /__perf, for astro preview to proxy to. gives back its address
// and a way to close it
export const startPerfServer = async (dir = perfDir) => {
    const savePerf = jsonWriter(dir, PERF_MAX_BYTES);
    const server = http.createServer((req, res) => {
        if (new URL(req.url, "http://localhost").pathname !== "/__perf") {
            res.statusCode = 404;
            res.end("not found");
            return;
        }
        savePerf(req, res);
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    server.unref();
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolve) => server.close(resolve))
    };
};

// astro preview's proxy options for /__perf. the host stays the one the phone asked for, so the origin check compares
// it with the page's origin, and the phone's address goes in x-forwarded-for, since every request reaches the frame log
// server from this machine
export const perfProxy = (target) => ({ "/__perf": { target, changeOrigin: false, xfwd: true } });
