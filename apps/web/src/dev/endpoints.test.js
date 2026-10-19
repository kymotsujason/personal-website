import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { preview } from "vite";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { devEndpoints, perfProxy, startPerfServer } from "./endpoints.js";

const NAME = "endpoints-test-probe";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "endpoints-test-"));
const keysDir = path.join(root, "keys");
const perfDir = path.join(root, "perf-logs");
const keyFile = path.join(keysDir, `${NAME}.json`);
const perfFile = path.join(perfDir, `${NAME}.json`);
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

// a non loopback address of this machine, so a request to it comes from an address that isn't loopback either
const lanAddress = Object.values(os.networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === "IPv4" && !entry.internal)?.address;

// the plugin's routes on a real local server, the way vite's connect stack hands a request to them. a remote address
// stands in for a client on another machine
const serve = async (plugin, remoteAddress) => {
    const routes = new Map();
    plugin.configureServer({ middlewares: { use: (route, handler) => routes.set(route, handler) } });
    const server = http.createServer((req, res) => {
        if (remoteAddress) {
            Object.defineProperty(req.socket, "remoteAddress", { value: remoteAddress });
        }
        const handler = routes.get(new URL(req.url, "http://localhost").pathname);
        if (!handler) {
            res.statusCode = 404;
            res.end();
            return;
        }
        handler(req, res);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolve) => server.close(resolve))
    };
};

let local;
let lan;
beforeAll(async () => {
    local = await serve(devEndpoints({ keys: keysDir, perf: perfDir }));
    lan = await serve(devEndpoints({ keys: keysDir, perf: perfDir }), "192.168.1.50");
});
afterAll(async () => {
    await local.close();
    await lan.close();
    fs.rmSync(root, { recursive: true, force: true });
});
afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(keysDir, { recursive: true, force: true });
    fs.rmSync(perfDir, { recursive: true, force: true });
});

// a fresh connection each time, so a test's socket never carries over to the next. node sends no length for a get's
// body unless it's given one
const send = (url, { method = "POST", body, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
        const length = body === undefined ? {} : { "Content-Length": Buffer.byteLength(body) };
        const req = http.request(url, { method, headers: { ...length, ...headers }, agent: false }, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
        });
        req.on("error", reject);
        req.end(body);
    });
const post = async (url, body, headers) => (await send(url, { body, headers })).status;

test("/__save takes a post from the dev server's own page", async () => {
    const status = await post(`${local.base}/__save?name=${NAME}`, '{"a":1}', { Origin: local.base, "Sec-Fetch-Site": "same-origin" });
    expect(status).toBe(200);
    expect(fs.readFileSync(keyFile, "utf8")).toBe('{"a":1}');
    expect(files(keysDir)).toEqual([`${NAME}.json`]);
});

test("/__save takes a post with no origin, like curl's on the same machine", async () => {
    expect(await post(`${local.base}/__save?name=${NAME}`, '{"a":1}')).toBe(200);
    expect(fs.existsSync(keyFile)).toBe(true);
});

test("/__save and /__perf refuse a post with no origin from another machine", async () => {
    expect(await post(`${lan.base}/__save?name=${NAME}`, '{"a":1}')).toBe(403);
    expect(await post(`${lan.base}/__perf?name=${NAME}`, "{}")).toBe(403);
    expect(files(keysDir)).toEqual([]);
    expect(files(perfDir)).toEqual([]);
});

test("/__save refuses a post with no origin that a proxy forwarded from another machine", async () => {
    expect(await post(`${local.base}/__save?name=${NAME}`, '{"a":1}', { "X-Forwarded-For": "192.168.1.50" })).toBe(403);
    expect(await post(`${local.base}/__save?name=${NAME}`, '{"a":1}', { "X-Forwarded-For": "127.0.0.1, 192.168.1.50" })).toBe(403);
    expect(files(keysDir)).toEqual([]);
    expect(await post(`${local.base}/__save?name=${NAME}`, '{"a":1}', { "X-Forwarded-For": "127.0.0.1" })).toBe(200);
});

test("/__save refuses a post from another site's page", async () => {
    const status = await post(`${local.base}/__save?name=${NAME}`, '{"a":1}', { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" });
    expect(status).toBe(403);
    expect(fs.existsSync(keyFile)).toBe(false);
});

test("/__save refuses a post from another local port", async () => {
    const status = await post(`${local.base}/__save?name=${NAME}`, '{"a":1}', { Origin: "http://127.0.0.1:1" });
    expect(status).toBe(403);
    expect(fs.existsSync(keyFile)).toBe(false);
});

test("/__save refuses a cross site post that hides its origin", async () => {
    const status = await post(`${local.base}/__save?name=${NAME}`, '{"a":1}', { "Sec-Fetch-Site": "cross-site" });
    expect(status).toBe(403);
    expect(fs.existsSync(keyFile)).toBe(false);
});

test("/__save refuses an opaque origin", async () => {
    expect(await post(`${local.base}/__save?name=${NAME}`, '{"a":1}', { Origin: "null" })).toBe(403);
    expect(fs.existsSync(keyFile)).toBe(false);
});

test("/__save refuses a body past its cap", async () => {
    const body = JSON.stringify({ pad: "x".repeat(2 * 1024 * 1024) });
    expect(await post(`${local.base}/__save?name=${NAME}`, body)).toBe(413);
    expect(fs.existsSync(keyFile)).toBe(false);
});

test("/__save refuses a name that isn't a plain lowercase file name, and writes nothing", async () => {
    for (const query of ["?name=../escape", "?name=..%2Fescape", "?name=A", "?name=", "", "?name=a.b"]) {
        expect(await post(`${local.base}/__save${query}`, '{"a":1}'), query).toBe(400);
    }
    expect(files(keysDir)).toEqual([]);
    expect(fs.existsSync(path.join(root, "escape.json"))).toBe(false);
});

test("/__save refuses a get and a body that isn't json, and writes nothing", async () => {
    expect((await send(`${local.base}/__save?name=${NAME}`, { method: "GET", body: '{"a":1}' })).status).toBe(400);
    expect(await post(`${local.base}/__save?name=${NAME}`, "{not json")).toBe(400);
    expect(await post(`${local.base}/__save?name=${NAME}`, "")).toBe(400);
    expect(files(keysDir)).toEqual([]);
});

test("/__perf refuses a post from another site's page", async () => {
    const status = await post(`${local.base}/__perf?name=${NAME}`, "{}", { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" });
    expect(status).toBe(403);
    expect(fs.existsSync(perfFile)).toBe(false);
});

test("a save that can't write answers 500, and the server keeps answering", async () => {
    const blocked = path.join(root, "blocked");
    fs.writeFileSync(blocked, "a file where the folder should be");
    const server = await serve(devEndpoints({ keys: blocked, perf: blocked }));
    try {
        expect(await post(`${server.base}/__save?name=${NAME}`, '{"a":1}')).toBe(500);
        expect(await post(`${server.base}/__perf?name=${NAME}`, "{}")).toBe(500);
        expect(await post(`${local.base}/__save?name=${NAME}`, '{"a":1}')).toBe(200);
    } finally {
        await server.close();
        fs.rmSync(blocked);
    }
});

test("a write that fails partway leaves the old key file whole and no temp file behind", async () => {
    fs.mkdirSync(keysDir, { recursive: true });
    fs.writeFileSync(keyFile, '{"old":1}');
    const write = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data) => {
        write(file, String(data).slice(0, 3));
        throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    });
    expect(await post(`${local.base}/__save?name=${NAME}`, '{"new":2}')).toBe(500);
    vi.restoreAllMocks();
    expect(fs.readFileSync(keyFile, "utf8")).toBe('{"old":1}');
    expect(files(keysDir)).toEqual([`${NAME}.json`]);
});

test("/api/home answers the github fixture and no weather for a time zone it doesn't know", async () => {
    const res = await send(`${local.base}/api/home?tz=Not/A_Zone`, { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(res.headers["cache-control"]).toBe("no-store");
    const github = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../data/github-fixture.json"), "utf8"));
    expect(JSON.parse(res.text)).toEqual({ weather: null, github });
});

test("the preview's frame log server refuses a post from another site's page", async () => {
    const perf = await startPerfServer(perfDir);
    try {
        const status = await post(`${perf.url}/__perf?name=${NAME}`, "{}", { Origin: "https://evil.example" });
        expect(status).toBe(403);
        expect(fs.existsSync(perfFile)).toBe(false);
        expect(await post(`${perf.url}/__perf?name=${NAME}`, "{}", { Origin: perf.url })).toBe(200);
    } finally {
        await perf.close();
    }
});

// astro preview with PERF=1 hands /__perf to the frame log server through vite's preview proxy, with these options
const previewWithPerf = async (host) => {
    const perf = await startPerfServer(perfDir);
    const dir = fs.mkdtempSync(path.join(root, "preview-"));
    fs.mkdirSync(path.join(dir, "dist"));
    fs.writeFileSync(path.join(dir, "dist", "index.html"), "<!doctype html><title>preview</title>");
    const server = await preview({
        root: dir,
        configFile: false,
        logLevel: "silent",
        preview: { host, port: 0, strictPort: true, proxy: perfProxy(perf.url) }
    });
    return {
        base: `http://${host}:${server.httpServer.address().port}`,
        close: async () => {
            await server.close();
            await perf.close();
        }
    };
};

test("a frame log the preview's own page posts through the preview proxy is saved", async () => {
    const site = await previewWithPerf("127.0.0.1");
    try {
        const status = await post(`${site.base}/__perf?name=${NAME}`, '{"frames":[]}', { Origin: site.base, "Sec-Fetch-Site": "same-origin" });
        expect(status).toBe(200);
        expect(fs.readFileSync(perfFile, "utf8")).toBe('{"frames":[]}');
        expect(await post(`${site.base}/__perf?name=${NAME}`, "{}", { Origin: "https://evil.example" })).toBe(403);
    } finally {
        await site.close();
    }
});

test.skipIf(!lanAddress)("a post with no origin from another machine through the preview proxy is refused", async () => {
    const site = await previewWithPerf(lanAddress);
    try {
        expect(await post(`${site.base}/__perf?name=${NAME}`, "{}")).toBe(403);
        expect(files(perfDir)).toEqual([]);
        expect(await post(`${site.base}/__perf?name=${NAME}`, "{}", { Origin: site.base })).toBe(200);
    } finally {
        await site.close();
    }
});
