import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { git } from "./collect.mjs";

export const allowlistName = "privacy-allowlist.json";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseAllowlist(json, source) {
  let value;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `${allowlistName} from ${source} isn't valid JSON (${error.message})`,
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${allowlistName} from ${source} isn't an object`);
  }
  for (const [path, hash] of Object.entries(value)) {
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error(
        `${allowlistName} from ${source} has a bad hash for ${path}`,
      );
    }
  }
  return value;
}

// the worktree copy is found next to this script so --dist works in a build without .git
export function readAllowlist(source) {
  if (source === "worktree") {
    const file = fileURLToPath(
      new URL(`../../${allowlistName}`, import.meta.url),
    );
    return parseAllowlist(readFileSync(file, "utf8"), "the worktree");
  }
  if (source === "index") {
    const listed = git(["ls-files", "-z", "--", allowlistName]).toString(
      "utf8",
    );
    if (listed === "") return {};
    return parseAllowlist(
      git(["show", `:${allowlistName}`]).toString("utf8"),
      "the index",
    );
  }
  const commit = git([
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${source}^{commit}`,
  ])
    .toString("utf8")
    .trim();
  const listed = git([
    "ls-tree",
    "-z",
    "--full-tree",
    "--name-only",
    commit,
    "--",
    allowlistName,
  ]).toString("utf8");
  if (listed === "") return {};
  return parseAllowlist(
    git(["show", `${commit}:${allowlistName}`]).toString("utf8"),
    commit,
  );
}
