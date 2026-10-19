import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = JSON.parse(
  readFileSync(join(site, "package.json"), "utf8"),
).scripts;

const steps = (script) => script.split("&&").map((step) => step.trim());

test("pnpm check runs the privacy and tools suites beside the web app's", () => {
  const check = steps(scripts.check);
  assert.ok(check.includes("pnpm test:privacy"), scripts.check);
  assert.ok(check.includes("pnpm test:tools"), scripts.check);
  assert.ok(check.includes("pnpm -C apps/web check"), scripts.check);
});

test("the workflow on every push runs pnpm check", () => {
  const workflow = readFileSync(
    join(site, ".github/workflows/privacy.yml"),
    "utf8",
  );
  assert.match(workflow, /^ {6}- run: pnpm check$/m);
});
