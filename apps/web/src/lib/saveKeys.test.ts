import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tools = resolve(__dirname, "../../tools");

const writeKeys = (path: string, data: string) =>
  spawnSync(
    "python3",
    [
      "-I",
      "-B",
      "-c",
      `import sys; sys.path.insert(0, sys.argv[1]); import saveKeys; saveKeys.writeKeys(${data}, sys.argv[2])`,
      tools,
      path,
    ],
    { encoding: "utf8" },
  );

test("saveKeys leaves the keys file as it was when the write fails, and writes it whole when it works", () => {
  const dir = mkdtempSync(join(tmpdir(), "savekeys-"));
  const path = join(dir, "keys.json");
  writeFileSync(path, '{"old":true}');
  const failed = writeKeys(path, "{'Left': {1, 2}}");
  expect(failed.status).not.toBe(0);
  expect(readFileSync(path, "utf8")).toBe('{"old":true}');
  expect(readdirSync(dir)).toEqual(["keys.json"]);
  const worked = writeKeys(path, "{'Left': [1, 2]}");
  expect(worked.status, worked.stderr).toBe(0);
  expect(readFileSync(path, "utf8")).toBe('{"Left":[1,2]}');
  expect(readdirSync(dir)).toEqual(["keys.json"]);
});
