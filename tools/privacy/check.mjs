import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAllowlist, sha256 } from "./allowlist.mjs";
import {
  collectDir,
  collectHistory,
  collectIndex,
  git,
  gitSucceeds,
  isZeroSha,
  listCommits,
  withGroupBytes,
} from "./collect.mjs";
import {
  imageType,
  inlineFindings,
  scanMetadata,
  typeName,
  unscannableTypes,
} from "./metadata.mjs";

const usage =
  "usage: check.mjs --index | --push <REMOTE_NAME> | --range <BEFORE> <AFTER> | --dist <DIR>";

export function denyRule(path) {
  const lower = path.toLowerCase();
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  if (base.startsWith("desk-unblurred")) return "desk-unblurred*";
  if (/\.(heic|heif|hif)$/.test(base)) return "*.heic, *.heif, *.hif";
  if (/\.blend\d*$/.test(base)) return "*.blend";
  if (/(^|\/)art\//.test(lower)) return "art/";
  if (base === "hands.glb" || base === "phone.glb") return base;
  return null;
}

function scanProblems(bytes, name) {
  try {
    const found = scanMetadata(bytes, name);
    return found.length > 0 ? [`${name} carries ${found.join(", ")}`] : [];
  } catch (error) {
    return [error.message];
  }
}

// an inline image is refused without reading its payload, since images ship from public/ as committed
function inlineProblems(file, type) {
  let found;
  try {
    found = inlineFindings(file.bytes, type, file.path);
  } catch (error) {
    return [`${file.path} ${error.message}`];
  }
  const problems = [];
  if (found.image !== null) {
    problems.push(
      `${file.path} holds an inline image (${found.image}). Inline images aren't allowed, so put the image in public/ and link to it`,
    );
  }
  if (found.svgLabels.length > 0) {
    problems.push(
      `${file.path} has inline <svg> markup that carries ${found.svgLabels.join(", ")}`,
    );
  }
  return problems;
}

export function checkFiles(files, allowlist) {
  const problems = [];
  const add = (problem) => {
    if (problem !== null) problems.push(problem);
  };
  for (const file of files) {
    const rule = denyRule(file.path);
    if (rule !== null) {
      add(`${file.path} is on the deny list (${rule})`);
      continue;
    }
    let type;
    try {
      type = imageType(file.bytes, file.path);
    } catch (error) {
      add(error.message);
      continue;
    }
    if (type === null) {
      for (const problem of inlineProblems(file, type)) add(problem);
      continue;
    }
    if (unscannableTypes.has(type)) {
      add(`${file.path} is ${typeName(type)}, which the check can't scan`);
      continue;
    }
    if (type !== "svg" && type !== "svgz") {
      const actual = sha256(file.bytes);
      if (!Object.hasOwn(allowlist, file.path)) {
        add(`${file.path} is not on the allowlist (sha256 ${actual})`);
      } else if (allowlist[file.path] !== actual) {
        add(
          `${file.path} has sha256 ${actual}, which doesn't match the allowlist's ${allowlist[file.path]}`,
        );
      }
    }
    for (const problem of scanProblems(file.bytes, file.path)) add(problem);
    if (type === "svg" || type === "svgz") {
      for (const problem of inlineProblems(file, type)) add(problem);
    }
  }
  const unique = [...new Set(problems)];
  return { ok: unique.length === 0, problems: unique };
}

function commitOf(rev) {
  return git(["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`])
    .toString("utf8")
    .trim();
}

function toTopLevel() {
  process.chdir(git(["rev-parse", "--show-toplevel"]).toString("utf8").trim());
}

function pushRevArgs(remote, stdin) {
  const include = [];
  const exclude = [];
  for (const line of stdin.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.trim().split(" ");
    const sha = /^[0-9a-f]{40,64}$/;
    if (parts.length !== 4 || !sha.test(parts[1]) || !sha.test(parts[3])) {
      throw new Error(`can't read the pre-push line "${line}"`);
    }
    const [localRef, localSha, remoteRef, remoteSha] = parts;
    if (isZeroSha(localSha)) continue;
    include.push(commitOf(localSha));
    if (!isZeroSha(remoteSha)) {
      if (!gitSucceeds(["cat-file", "-e", `${remoteSha}^{commit}`])) {
        throw new Error(
          `${remoteRef} on ${remote} is at ${remoteSha}, which isn't known here, so fetch before pushing ${localRef}`,
        );
      }
      exclude.push(remoteSha);
    }
  }
  if (include.length === 0) return null;
  return [...include, "--not", ...exclude];
}

function rangeRevArgs(before, after) {
  const target = commitOf(after);
  if (isZeroSha(before)) return [target];
  return [target, "--not", commitOf(before)];
}

function checkHistory(revArgs) {
  const commits = listCommits(revArgs);
  const problems = [];
  let count = 0;
  for (const group of collectHistory(commits)) {
    const files = withGroupBytes(group);
    count += files.length;
    const allowlist = readAllowlist(group.commit);
    for (const problem of checkFiles(files, allowlist).problems) {
      problems.push(`${group.commit.slice(0, 12)}: ${problem}`);
    }
  }
  return {
    problems,
    summary: `${count} file versions in ${commits.length} commits`,
  };
}

function run(args) {
  const mode = args[0];
  if (mode === "--index" && args.length === 1) {
    toTopLevel();
    const files = collectIndex();
    const { problems } = checkFiles(files, readAllowlist("index"));
    return { problems, summary: `${files.length} files in the index` };
  }
  if (mode === "--push" && args.length === 2) {
    toTopLevel();
    const revArgs = pushRevArgs(args[1], readFileSync(0, "utf8"));
    if (revArgs === null)
      return { problems: [], summary: "only deletions to push" };
    return checkHistory(revArgs);
  }
  if (mode === "--range" && args.length === 3) {
    toTopLevel();
    return checkHistory(rangeRevArgs(args[1], args[2]));
  }
  if (mode === "--dist" && args.length === 2) {
    const files = collectDir(resolve(args[1]), "apps/web/public/");
    const { problems } = checkFiles(files, readAllowlist("worktree"));
    return { problems, summary: `${files.length} files in ${args[1]}` };
  }
  throw new Error(usage);
}

function isMain() {
  return (
    process.argv[1] !== undefined &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMain()) {
  try {
    const { problems, summary } = run(process.argv.slice(2));
    if (problems.length > 0) {
      console.error(`privacy check failed (${summary}):`);
      for (const problem of problems) console.error(`  ${problem}`);
      process.exitCode = 1;
    } else {
      console.log(`privacy check passed (${summary})`);
    }
  } catch (error) {
    console.error(`privacy check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
