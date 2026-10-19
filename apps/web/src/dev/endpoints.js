// the dev server's own routes: /__save writes a key file the pose editor or a bake sends into public/keys, /__perf
// writes a frame log a phone sends with ?perf (perf.js) into perf-logs/, and /api/home stands in for the worker's
// route. /__perf also runs beside astro preview when PERF=1, since astro preview doesn't load the site's vite plugins
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { cityFor, createWeatherSource } from "../../worker/weather.js";

const keysDir = path.resolve(import.meta.dirname, "../../public/keys");
const perfDir = path.resolve(import.meta.dirname, "../../perf-logs");
const SAVE_MAX_BYTES = 1024 * 1024;
const PERF_MAX_BYTES = 8 * 1024 * 1024;

// any page open while the server runs can send a simple post to it, so a write has to come from the server's own page
// (or from a tool like curl, which sends no origin)
const fromOwnPage = (req) => {
    if (req.headers["sec-fetch-site"] === "cross-site") {
        return false;
    }
    const origin = req.headers.origin;
    if (origin === undefined) {
        return true;
    }
    try {
        return new URL(origin).host === req.headers.host;
    } catch {
        return false;
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
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${name}.json`), body);
        res.end("saved");
    });
};

const saveKeys = jsonWriter(keysDir, SAVE_MAX_BYTES);
const savePerf = jsonWriter(perfDir, PERF_MAX_BYTES);

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
export const devEndpoints = () => ({
    name: "dev-endpoints",
    configureServer(server) {
        server.middlewares.use("/__save", saveKeys);
        server.middlewares.use("/__perf", savePerf);
        server.middlewares.use("/api/home", homeRoute());
    }
});

// a small server on a free local port that answers /__perf, for astro preview to proxy to. gives back its address
export const startPerfServer = async () => {
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
    return `http://127.0.0.1:${server.address().port}`;
};
