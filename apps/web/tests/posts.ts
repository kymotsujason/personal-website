import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "astro/markdown";

// the blog's posts as their files say, newest first, for tests that check every post is listed
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../src/content/blog");

// the frontmatter is read by astro's own parser, so quoting, line endings, and yaml options match the build
export const readPost = (text: string) => {
  const { frontmatter } = parseFrontmatter(text);
  const post = {
    title: frontmatter.title,
    slug: frontmatter.slug,
    date: frontmatter.date,
  };
  for (const [name, value] of Object.entries(post)) {
    if (typeof value !== "string") {
      throw new Error(`a post has no ${name}`);
    }
  }
  return post as { title: string; slug: string; date: string };
};

export const posts = readdirSync(dir)
  .filter((name) => name.endsWith(".md"))
  .map((name) => readPost(readFileSync(path.join(dir, name), "utf8")))
  .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
