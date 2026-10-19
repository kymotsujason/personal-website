import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = join(site, ".claude/hooks/format.sh");

// a project of its own that borrows the web app's prettier, so the hook never writes into the repo
function runHook(name, text) {
  const root = mkdtempSync(join(tmpdir(), "format-hook-"));
  try {
    mkdirSync(join(root, "apps"));
    symlinkSync(join(site, "apps/web"), join(root, "apps/web"));
    const file = join(root, name);
    writeFileSync(file, text);
    const run = spawnSync("bash", [hook], {
      input: JSON.stringify({ tool_input: { file_path: file } }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    return readFileSync(file, "utf8");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the format hook formats every file type prettier checks", () => {
  const cases = [
    ["a.ts", "export const a={b:'c'}\n", 'export const a = { b: "c" };\n'],
    ["a.js", "export const a={b:'c'}\n", 'export const a = { b: "c" };\n'],
    ["a.mjs", "export const a={b:'c'}\n", 'export const a = { b: "c" };\n'],
    ["a.jsonc", '{"a":1, // b\n}\n', '{\n  "a": 1, // b\n}\n'],
  ];
  for (const [name, text, formatted] of cases) {
    assert.equal(runHook(name, text), formatted, name);
  }
});
