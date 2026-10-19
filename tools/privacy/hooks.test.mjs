import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, "../..");

const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd, ...args) {
  return spawnSync("git", args, { cwd, env, encoding: "utf8" });
}

function ok(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function refused(result, reason) {
  assert.notEqual(
    result.status,
    0,
    `expected a refusal\n${result.stdout}\n${result.stderr}`,
  );
  assert.match(result.stderr, reason);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const cleanPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
  pngChunk("IDAT", deflateSync(Buffer.from([0, 0x80]))),
  pngChunk("IEND", Buffer.alloc(0)),
]);

function jpegSegment(marker, payload) {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

const exifJpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  jpegSegment(0xe1, Buffer.from("Exif\0\0MM\0*\0\0\0\x08\0\0", "latin1")),
  jpegSegment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
  jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
  Buffer.from([0x12, 0x34, 0xff, 0xd9]),
]);

function writeFile(repo, path, bytes) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), bytes);
}

function allow(repo, path, bytes) {
  writeFile(repo, path, bytes);
  const file = join(repo, "privacy-allowlist.json");
  const allowlist = JSON.parse(readFileSync(file, "utf8"));
  allowlist[path] = sha256(bytes);
  writeFileSync(file, JSON.stringify(allowlist, null, 2) + "\n");
}

function commitAll(repo, message, ...flags) {
  ok(git(repo, "add", "-A"));
  return git(repo, "commit", "-q", "-m", message, ...flags);
}

function makeRepo(t) {
  const root = mkdtempSync(join(tmpdir(), "privacy-hooks-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const bare = join(root, "remote.git");
  ok(git(root, "init", "-q", "--bare", "-b", "main", bare));
  ok(git(root, "init", "-q", "-b", "main", repo));
  cpSync(join(siteRoot, ".githooks"), join(repo, ".githooks"), {
    recursive: true,
  });
  cpSync(here, join(repo, "tools", "privacy"), {
    recursive: true,
    filter: (source) => !source.endsWith(".test.mjs"),
  });
  writeFileSync(join(repo, "privacy-allowlist.json"), "{}\n");
  writeFileSync(join(repo, "README.md"), "# test\n");
  ok(git(repo, "config", "core.hooksPath", ".githooks"));
  ok(git(repo, "remote", "add", "origin", bare));
  ok(commitAll(repo, "Initial"));
  const modes = ok(git(repo, "ls-files", "-s", ".githooks"));
  assert.match(modes, /^100755 \S+ 0\t\.githooks\/pre-commit$/m);
  assert.match(modes, /^100755 \S+ 0\t\.githooks\/pre-push$/m);
  return { root, repo, bare };
}

function remoteHas(bare, ref) {
  return git(bare, "rev-parse", "--verify", "--quiet", ref).status === 0;
}

function commitCount(repo) {
  return ok(git(repo, "rev-list", "--count", "HEAD"));
}

test("a commit of a JPEG with EXIF is refused", (t) => {
  const { repo } = makeRepo(t);
  allow(repo, "apps/web/public/photo.jpg", exifJpeg);
  refused(commitAll(repo, "Add photo"), /photo\.jpg carries exif/);
  assert.equal(commitCount(repo), "1");
});

test("a commit of a clean image missing from the allowlist is refused", (t) => {
  const { repo } = makeRepo(t);
  writeFile(repo, "apps/web/public/a.png", cleanPng);
  refused(commitAll(repo, "Add image"), /a\.png is not on the allowlist/);
  assert.equal(commitCount(repo), "1");
});

test("a forbidden file committed and then deleted is refused on a first push", (t) => {
  const { repo, bare } = makeRepo(t);
  writeFile(repo, "art/secret.png", cleanPng);
  ok(commitAll(repo, "Add secret", "--no-verify"));
  rmSync(join(repo, "art"), { recursive: true });
  ok(commitAll(repo, "Remove secret"));
  refused(
    git(repo, "push", "origin", "main"),
    /art\/secret\.png is on the deny list/,
  );
  assert.equal(remoteHas(bare, "refs/heads/main"), false);
});

test("a forbidden file committed and then deleted is refused on a new branch", (t) => {
  const { repo, bare } = makeRepo(t);
  ok(git(repo, "push", "-q", "origin", "main"));
  ok(git(repo, "checkout", "-q", "-b", "feature"));
  writeFile(repo, "apps/web/public/desk-unblurred.jpg", exifJpeg);
  ok(commitAll(repo, "Add desk", "--no-verify"));
  rmSync(join(repo, "apps/web/public/desk-unblurred.jpg"));
  ok(commitAll(repo, "Remove desk"));
  refused(
    git(repo, "push", "origin", "feature"),
    /desk-unblurred\.jpg is on the deny list/,
  );
  assert.equal(remoteHas(bare, "refs/heads/feature"), false);
});

test("a push to a push URL that lacks a commit scans that commit", (t) => {
  const { root, repo } = makeRepo(t);
  writeFile(repo, "art/desk.png", cleanPng);
  ok(commitAll(repo, "Add desk", "--no-verify"));
  ok(git(repo, "push", "-q", "--no-verify", "origin", "main"));
  rmSync(join(repo, "art"), { recursive: true });
  ok(commitAll(repo, "Remove desk"));
  const publicBare = join(root, "public.git");
  ok(git(root, "init", "-q", "--bare", "-b", "main", publicBare));
  ok(git(repo, "config", "remote.origin.pushurl", publicBare));
  refused(
    git(repo, "push", "origin", "main"),
    /art\/desk\.png is on the deny list/,
  );
  assert.equal(remoteHas(publicBare, "refs/heads/main"), false);
});

test("a forbidden copy of an allowlisted image is refused at push", (t) => {
  const { repo, bare } = makeRepo(t);
  allow(repo, "apps/web/public/a.png", cleanPng);
  writeFile(repo, "art/a.png", cleanPng);
  ok(commitAll(repo, "Add image and copy", "--no-verify"));
  rmSync(join(repo, "art"), { recursive: true });
  ok(commitAll(repo, "Remove copy"));
  refused(
    git(repo, "push", "origin", "main"),
    /art\/a\.png is on the deny list/,
  );
  assert.equal(remoteHas(bare, "refs/heads/main"), false);
});

test("a forbidden file added in a merge resolution is refused at push", (t) => {
  const { repo, bare } = makeRepo(t);
  ok(git(repo, "checkout", "-q", "-b", "side"));
  writeFile(repo, "side.txt", "side\n");
  ok(commitAll(repo, "Add side"));
  ok(git(repo, "checkout", "-q", "main"));
  writeFile(repo, "main.txt", "main\n");
  ok(commitAll(repo, "Add main"));
  ok(git(repo, "merge", "-q", "--no-ff", "--no-commit", "side"));
  writeFile(repo, "scene.blend1", "blend");
  ok(commitAll(repo, "Merge side", "--no-verify"));
  assert.equal(ok(git(repo, "rev-list", "--count", "--merges", "HEAD")), "1");
  rmSync(join(repo, "scene.blend1"));
  ok(commitAll(repo, "Remove blend"));
  refused(
    git(repo, "push", "origin", "main"),
    /scene\.blend1 is on the deny list/,
  );
  assert.equal(remoteHas(bare, "refs/heads/main"), false);
});

test("a clean push passes", (t) => {
  const { repo, bare } = makeRepo(t);
  allow(repo, "apps/web/public/a.png", cleanPng);
  ok(commitAll(repo, "Add image"));
  ok(git(repo, "push", "-q", "origin", "main"));
  assert.equal(
    ok(git(bare, "rev-parse", "main")),
    ok(git(repo, "rev-parse", "HEAD")),
  );
  ok(git(repo, "checkout", "-q", "-b", "feature"));
  writeFile(repo, "notes.txt", "notes\n");
  ok(commitAll(repo, "Add notes"));
  ok(git(repo, "push", "-q", "origin", "feature"));
  assert.equal(
    ok(git(bare, "rev-parse", "feature")),
    ok(git(repo, "rev-parse", "HEAD")),
  );
});

test("a commit is refused when the metadata reader is missing", (t) => {
  const { repo } = makeRepo(t);
  const reader = join(repo, "tools", "privacy", "metadata.mjs");
  renameSync(reader, `${reader}.away`);
  writeFile(repo, "README.md", "# changed\n");
  ok(git(repo, "add", "README.md"));
  refused(git(repo, "commit", "-q", "-m", "Change readme"), /metadata\.mjs/);
  assert.equal(commitCount(repo), "1");
});

test("a push that only deletes a remote branch passes", (t) => {
  const { repo, bare } = makeRepo(t);
  ok(git(repo, "push", "-q", "origin", "main", "main:old"));
  assert.equal(remoteHas(bare, "refs/heads/old"), true);
  writeFile(repo, "art/secret.png", cleanPng);
  ok(commitAll(repo, "Add secret", "--no-verify"));
  refused(
    git(repo, "push", "origin", "main", ":old"),
    /art\/secret\.png is on the deny list/,
  );
  assert.equal(remoteHas(bare, "refs/heads/old"), true);
  ok(git(repo, "push", "-q", "origin", "--delete", "old"));
  assert.equal(remoteHas(bare, "refs/heads/old"), false);
});

test("a push is refused when the remote's commit isn't known locally", (t) => {
  const { root, repo, bare } = makeRepo(t);
  ok(git(repo, "push", "-q", "origin", "main"));
  const other = join(root, "other");
  ok(git(root, "clone", "-q", bare, other));
  writeFile(other, "other.txt", "other\n");
  ok(commitAll(other, "Add other"));
  ok(git(other, "push", "-q", "origin", "main"));
  const remoteMain = ok(git(bare, "rev-parse", "main"));
  writeFile(repo, "mine.txt", "mine\n");
  ok(commitAll(repo, "Add mine"));
  refused(git(repo, "push", "--force", "origin", "main"), /isn't known here/);
  assert.equal(ok(git(bare, "rev-parse", "main")), remoteMain);
});

test("the hooks refuse an EXIF commit in a fresh clone and in a worktree", (t) => {
  const { root, repo } = makeRepo(t);
  const clone = join(root, "clone");
  ok(git(root, "clone", "-q", repo, clone));
  ok(git(clone, "config", "core.hooksPath", ".githooks"));
  allow(clone, "apps/web/public/photo.jpg", exifJpeg);
  refused(commitAll(clone, "Add photo"), /photo\.jpg carries exif/);
  assert.equal(commitCount(clone), "1");

  const worktree = join(root, "worktree");
  ok(git(repo, "worktree", "add", "-q", "-b", "wt", worktree));
  allow(worktree, "apps/web/public/photo.jpg", exifJpeg);
  refused(commitAll(worktree, "Add photo"), /photo\.jpg carries exif/);
  assert.equal(commitCount(worktree), "1");
});

// the push workflow's call, check.mjs --range with the push's before and after commits
function checkRange(repo, before, after) {
  return spawnSync(
    "node",
    ["tools/privacy/check.mjs", "--range", before, after],
    { cwd: repo, env, encoding: "utf8" },
  );
}

test("--range from a zero before scans every commit up to after", (t) => {
  const { repo } = makeRepo(t);
  writeFile(repo, "art/secret.png", cleanPng);
  ok(commitAll(repo, "Add secret", "--no-verify"));
  rmSync(join(repo, "art"), { recursive: true });
  ok(commitAll(repo, "Remove secret"));
  refused(
    checkRange(repo, "0".repeat(40), "HEAD"),
    /art\/secret\.png is on the deny list/,
  );
});

test("--range scans the commits after before and none before it", (t) => {
  const { repo } = makeRepo(t);
  writeFile(repo, "art/secret.png", cleanPng);
  ok(commitAll(repo, "Add secret", "--no-verify"));
  const added = ok(git(repo, "rev-parse", "HEAD"));
  rmSync(join(repo, "art"), { recursive: true });
  ok(commitAll(repo, "Remove secret"));
  const removed = ok(git(repo, "rev-parse", "HEAD"));
  writeFile(repo, "notes.txt", "notes\n");
  ok(commitAll(repo, "Add notes"));
  const after = ok(git(repo, "rev-parse", "HEAD"));
  const clean = checkRange(repo, removed, after);
  assert.equal(clean.status, 0, `${clean.stdout}\n${clean.stderr}`);
  assert.match(clean.stdout, /in 1 commits/);
  refused(
    checkRange(repo, `${added}~1`, after),
    /art\/secret\.png is on the deny list/,
  );
});

test("both hooks are committed as executable", () => {
  const modes = ok(git(siteRoot, "ls-files", "-s", ".githooks"));
  assert.match(modes, /^100755 \S+ 0\t\.githooks\/pre-commit$/m);
  assert.match(modes, /^100755 \S+ 0\t\.githooks\/pre-push$/m);
});
