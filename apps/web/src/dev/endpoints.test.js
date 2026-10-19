import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeAll, afterAll, expect, test } from "vitest";
import { devEndpoints, startPerfServer } from "./endpoints.js";

const NAME = "endpoints-test-probe";
const keyFile = path.resolve(import.meta.dirname, "../../public/keys", `${NAME}.json`);
const perfFile = path.resolve(import.meta.dirname, "../../perf-logs", `${NAME}.json`);

// the plugin's routes on a real local server, the way vite's connect stack hands a request to them
let server;
let base;
beforeAll(async () => {
    const routes = new Map();
    devEndpoints().configureServer({ middlewares: { use: (route, handler) => routes.set(route, handler) } });
    server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://localhost");
        const handler = routes.get(url.pathname);
        if (!handler) {
            res.statusCode = 404;
            res.end();
            return;
        }
        handler(req, res);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
afterEach(() => {
    fs.rmSync(keyFile, { force: true });
    fs.rmSync(perfFile, { force: true });
});

const post = (url, body, headers = {}) =>
    new Promise((resolve, reject) => {
        const req = http.request(url, { method: "POST", headers }, (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
        });
        req.on("error", reject);
        req.end(body);
    });

test("/__save takes a post from the dev server's own page", async () => {
    const status = await post(`${base}/__save?name=${NAME}`, '{"a":1}', { Origin: base, "Sec-Fetch-Site": "same-origin" });
    expect(status).toBe(200);
    expect(fs.readFileSync(keyFile, "utf8")).toBe('{"a":1}');
});

test("/__save takes a post with no origin, like curl's", async () => {
    expect(await post(`${base}/__save?name=${NAME}`, '{"a":1}')).toBe(200);
    expect(fs.existsSync(keyFile)).toBe(true);
});

test("/__save refuses a post from another site's page", async () => {
    const status = await post(`${base}/__save?name=${NAME}`, '{"a":1}', { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" });
    expect(status).toBe(403);
    expect(fs.existsSync(keyFile)).toBe(false);
});

test("/__save refuses a post from another local port", async () => {
    const status = await post(`${base}/__save?name=${NAME}`, '{"a":1}', { Origin: "http://127.0.0.1:1" });
    expect(status).toBe(403);
    expect(fs.existsSync(keyFile)).toBe(false);
});

test("/__save refuses a cross site post that hides its origin", async () => {
    const status = await post(`${base}/__save?name=${NAME}`, '{"a":1}', { "Sec-Fetch-Site": "cross-site" });
    expect(status).toBe(403);
    expect(fs.existsSync(keyFile)).toBe(false);
});

test("/__save refuses an opaque origin", async () => {
    expect(await post(`${base}/__save?name=${NAME}`, '{"a":1}', { Origin: "null" })).toBe(403);
    expect(fs.existsSync(keyFile)).toBe(false);
});

test("/__save refuses a body past its cap", async () => {
    const body = JSON.stringify({ pad: "x".repeat(2 * 1024 * 1024) });
    expect(await post(`${base}/__save?name=${NAME}`, body)).toBe(413);
    expect(fs.existsSync(keyFile)).toBe(false);
});

test("/__perf refuses a post from another site's page", async () => {
    const status = await post(`${base}/__perf?name=${NAME}`, "{}", { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" });
    expect(status).toBe(403);
    expect(fs.existsSync(perfFile)).toBe(false);
});

test("the preview's frame log server refuses a post from another site's page", async () => {
    const perfBase = await startPerfServer();
    const status = await post(`${perfBase}/__perf?name=${NAME}`, "{}", { Origin: "https://evil.example" });
    expect(status).toBe(403);
    expect(fs.existsSync(perfFile)).toBe(false);
    expect(await post(`${perfBase}/__perf?name=${NAME}`, "{}", { Origin: perfBase })).toBe(200);
});
