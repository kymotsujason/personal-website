import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const tsdk = process.argv[2];
if (!tsdk) {
    process.stderr.write("Usage: node probes/lsp-init.mjs none|SDK_PATH\n");
    process.exit(1);
}
const deadline = performance.now() + 15000;
const server = spawn("astro-ls", ["--stdio"], { stdio: "pipe" });
let buffer = Buffer.alloc(0);
let stderr = "";
let result;
let shutdownSent = false;
let exitSent = false;
let forced = false;
const oneLine = (value) => String(value).replace(/[\r\n]+/g, " ");
const send = (message) => {
    if (server.stdin.destroyed || !server.stdin.writable) return;
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
const terminate = () => {
    forced = true;
    if (result === "ok") {
        result = "error forced termination after ok";
    } else if (!result) {
        result = "error initialize deadline reached";
    }
    server.kill("SIGTERM");
};
const termTimer = setTimeout(terminate, Math.max(0, deadline - performance.now() - 3000));
const killTimer = setTimeout(() => {
    if (!forced) terminate();
    server.kill("SIGKILL");
}, Math.max(0, deadline - performance.now()));
const finish = (value, shutdown = false) => {
    if (result) return;
    result = value;
    if (shutdown) {
        shutdownSent = true;
        send({ id: 2, method: "shutdown", params: null });
    } else {
        terminate();
    }
};
server.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(0, 200);
});
server.stdin.on("error", () => {});
server.on("error", (error) => finish(`error ${oneLine(error.message)}`));
server.on("close", (code, signal) => {
    clearTimeout(termTimer);
    clearTimeout(killTimer);
    const success = result === "ok" && shutdownSent && exitSent && !forced && code === 0 && !signal;
    if (!result || (result === "ok" && !success)) {
        result = `error exit code=${code} stderr=${oneLine(stderr || signal || "")}`;
    }
    process.exitCode = success ? 0 : 1;
    process.stdout.write(`LSP tsdk=${oneLine(tsdk)} result=${oneLine(result)}\n`);
});
server.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const match = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString());
        if (!match) {
            finish("error missing Content-Length");
            return;
        }
        const end = headerEnd + 4 + Number(match[1]);
        if (buffer.length < end) return;
        let message;
        try {
            message = JSON.parse(buffer.subarray(headerEnd + 4, end).toString());
        } catch (error) {
            finish(`error ${oneLine(error.message)}`);
            return;
        }
        buffer = buffer.subarray(end);
        if (message.id === 1 && !result) {
            if (message.error) {
                finish(`error ${oneLine(message.error.message)}`, true);
            } else if (Object.hasOwn(message, "result")) {
                send({ method: "initialized", params: {} });
                finish("ok", true);
            }
        } else if (message.id === 2 && shutdownSent && !exitSent) {
            exitSent = true;
            send({ method: "exit" });
            server.stdin.end();
        }
    }
});
send({
    id: 1,
    method: "initialize",
    params: {
        processId: process.pid,
        rootUri: pathToFileURL(resolve("apps/web")).href,
        capabilities: {},
        ...(tsdk === "none" ? {} : { initializationOptions: { typescript: { tsdk } } }),
    },
});
