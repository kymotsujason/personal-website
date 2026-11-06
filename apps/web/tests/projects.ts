import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { parseFrontmatter } from "astro/markdown";
import { createSatteriMarkdownProcessor } from "@astrojs/markdown-satteri";

const DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/content/projects",
);

export type Entry = {
  slug: string;
  data: {
    title: string;
    summary: string;
    kicker: string;
    rank: number;
    date: string;
    stats: { value: string; label: string }[];
    links?: { label: string; url: string }[];
    source: "public" | "private" | "unreleased";
    hero: { still: string; loop?: string; alt: string };
    highlights: { title: string; text: string }[];
    stack: string[];
    status: string;
    license?: string;
    builtOn?: { name: string; url: string };
  };
  body: string;
  // the first paragraph's text as the page renders it
  intro: string;
};

// the same markdown processor the site builds with, with its smartPunctuation off like astro.config.mjs
const processor = await createSatteriMarkdownProcessor({
  syntaxHighlight: false,
  features: { smartPunctuation: false },
});

const introText = async (body: string) => {
  const { code } = await processor.render(body);
  const { document } = new JSDOM(`<body>${code}</body>`).window;
  const paragraph = document.body.querySelector(":scope > p");
  if (!paragraph) {
    throw new Error("an entry has no first paragraph");
  }
  return paragraph.textContent!.replace(/\s+/g, " ").trim();
};

// the frontmatter is read by astro's own parser, so line endings and yaml options match the build
export const parseEntry = async (
  file: string,
  source: string,
): Promise<Entry> => {
  const { frontmatter, rawFrontmatter, content } = parseFrontmatter(source);
  if (!rawFrontmatter) {
    throw new Error(`${file} has no frontmatter`);
  }
  return {
    slug: file.replace(/\.md$/, ""),
    data: frontmatter as Entry["data"],
    body: content,
    intro: await introText(content),
  };
};

export const entries: Entry[] = await Promise.all(
  readdirSync(DIR)
    .filter((file) => file.endsWith(".md"))
    .map((file) =>
      parseEntry(file, readFileSync(path.join(DIR, file), "utf8")),
    ),
);

export const byRank = [...entries].sort((a, b) => a.data.rank - b.data.rank);

// newest date first, and the id breaks a tie, the order the home screen's latest project is picked in
export const newest = [...entries].sort(
  (a, b) =>
    (a.data.date < b.data.date ? 1 : a.data.date > b.data.date ? -1 : 0) ||
    (a.slug < b.slug ? -1 : 1),
)[0]!;

export const entry = (slug: string): Entry => {
  const found = entries.find((e) => e.slug === slug);
  if (!found) {
    throw new Error(`no project entry ${slug}`);
  }
  return found;
};

export const projectPath = (e: Entry) => `/projects/${e.slug}`;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const dayText = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return `${MONTHS[month! - 1]} ${day}, ${year}`;
};

// the first paragraph of the body, as the page renders its text
export const firstParagraph = (e: Entry) => e.intro;
