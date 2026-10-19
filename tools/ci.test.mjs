import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = JSON.parse(
  readFileSync(join(site, "package.json"), "utf8"),
).scripts;
const workflow = readFileSync(
  join(site, ".github/workflows/privacy.yml"),
  "utf8",
);

const steps = (script) => script.split("&&").map((step) => step.trim());

// each of the job's steps as its own text, in the order they run
const workflowSteps = workflow.split(/^(?= {6}- )/m).slice(1);
const runsAfterFailure = (step) => /^ {8}if: \$\{\{ !cancelled\(\)/m.test(step);

test("pnpm check runs the privacy and tools suites beside the web app's", () => {
  const check = steps(scripts.check);
  assert.ok(check.includes("pnpm test:privacy"), scripts.check);
  assert.ok(check.includes("pnpm test:tools"), scripts.check);
  assert.ok(check.includes("pnpm -C apps/web check"), scripts.check);
});

test("the workflow on every push runs pnpm check", () => {
  assert.match(workflow, /^ {6}- run: pnpm check$/m);
});

test("a failing step can't skip the range scan, the suites, or the build's dist checks", () => {
  const runs = workflowSteps.filter((step) => /^ {6}- run: /.test(step));
  assert.match(runs[0], /check\.mjs --range "\$BEFORE" "\$AFTER"/);
  for (const pattern of [
    /^ {6}- run: pnpm check$/m,
    /^ {6}- run: pnpm -C apps\/web build$/m,
  ]) {
    assert.ok(
      runs.some((step) => pattern.test(step)),
      String(pattern),
    );
  }
  for (const step of runs.slice(1)) {
    assert.ok(runsAfterFailure(step), step);
  }
});
