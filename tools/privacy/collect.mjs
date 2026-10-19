import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const empty = new Uint8Array(0);

export function isZeroSha(sha) {
  return /^0+$/.test(sha);
}

export function git(args, input) {
  const result = spawnSync("git", args, {
    input,
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error)
    throw new Error(`git ${args[0]} couldn't run (${result.error.message})`);
  if (result.status !== 0) {
    const stderr = result.stderr.toString("utf8").trim();
    throw new Error(
      `git ${args.join(" ")} failed with ${result.status}: ${stderr}`,
    );
  }
  return result.stdout;
}

export function gitSucceeds(args) {
  const result = spawnSync("git", args, { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function splitNul(buffer) {
  const text = buffer.toString("utf8");
  if (text === "") return [];
  if (!text.endsWith("\0")) throw new Error("git output didn't end with NUL");
  return text.slice(0, -1).split("\0");
}

export function readBlobs(shas) {
  const unique = [...new Set(shas)];
  const blobs = new Map();
  if (unique.length === 0) return blobs;
  const out = git(["cat-file", "--batch"], unique.join("\n") + "\n");
  let pos = 0;
  for (const sha of unique) {
    const lineEnd = out.indexOf(0x0a, pos);
    if (lineEnd === -1)
      throw new Error("git cat-file returned fewer objects than asked for");
    const header = out.toString("utf8", pos, lineEnd).split(" ");
    if (header.length !== 3 || header[0] !== sha || header[1] !== "blob") {
      throw new Error(
        `git cat-file couldn't read blob ${sha} (${header.join(" ")})`,
      );
    }
    const start = lineEnd + 1;
    const end = start + Number(header[2]);
    if (end + 1 > out.length)
      throw new Error(`git cat-file cut blob ${sha} short`);
    blobs.set(sha, out.subarray(start, end));
    pos = end + 1;
  }
  return blobs;
}

function withBytes(entries) {
  const wanted = entries.filter((entry) => entry.type === "blob");
  const blobs = readBlobs(wanted.map((entry) => entry.sha));
  return entries.map((entry) => ({
    path: entry.path,
    bytes: blobs.get(entry.sha) ?? empty,
  }));
}

export function collectIndex() {
  const entries = splitNul(git(["ls-files", "-s", "-z"])).map((line) => {
    const tab = line.indexOf("\t");
    const [mode, sha] = line.slice(0, tab).split(" ");
    return {
      path: line.slice(tab + 1),
      sha,
      type: mode === "160000" ? "commit" : "blob",
    };
  });
  return withBytes(entries);
}

export function listCommits(revArgs) {
  const out = git(["rev-list", "--topo-order", ...revArgs]).toString("utf8");
  return out.split("\n").filter((line) => line !== "");
}

// keyed on path and blob, since rev-list --objects names a blob under only one of its paths
export function collectHistory(commits) {
  const seen = new Set();
  const groups = [];
  for (const commit of commits) {
    const entries = [];
    for (const line of splitNul(
      git(["ls-tree", "-r", "-z", "--full-tree", commit]),
    )) {
      const tab = line.indexOf("\t");
      const [, type, sha] = line.slice(0, tab).split(" ");
      const path = line.slice(tab + 1);
      const key = `${sha}\0${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ path, sha, type });
    }
    if (entries.length > 0) groups.push({ commit, entries });
  }
  return groups;
}

export function withGroupBytes(group) {
  return withBytes(group.entries);
}

export function collectDir(dir, prefix) {
  if (!lstatSync(dir).isDirectory()) throw new Error(`${dir} isn't a folder`);
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const path = prefix + relative(dir, full).split(sep).join("/");
        files.push({
          path,
          bytes: readFileSync(full),
        });
      } else {
        throw new Error(`${full} isn't a plain file or folder`);
      }
    }
  };
  walk(dir);
  return files;
}
