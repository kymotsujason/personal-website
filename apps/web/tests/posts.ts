import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// the blog's posts as their files say, newest first, for tests that check every post is listed
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../src/content/blog");

const field = (text: string, name: string) => {
  const found = text.match(new RegExp(`^${name}: (.+)$`, "m"));
  if (!found) {
    throw new Error(`a post has no ${name}`);
  }
  return found[1].startsWith('"') ? (JSON.parse(found[1]) as string) : found[1];
};

export const posts = readdirSync(dir)
  .filter((name) => name.endsWith(".md"))
  .map((name) => {
    const text = readFileSync(path.join(dir, name), "utf8");
    return {
      title: field(text, "title"),
      slug: field(text, "slug"),
      date: field(text, "date"),
    };
  })
  .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
