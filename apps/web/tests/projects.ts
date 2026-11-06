import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const DIR = path.join("src/content/projects");

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
};

const read = (file: string): Entry => {
  const source = readFileSync(path.join(DIR, file), "utf8");
  const found = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!found) {
    throw new Error(`${file} has no frontmatter`);
  }
  return {
    slug: file.replace(/\.md$/, ""),
    data: parse(found[1]!),
    body: found[2]!,
  };
};

export const entries: Entry[] = readdirSync(DIR)
  .filter((file) => file.endsWith(".md"))
  .map(read);

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

// the first paragraph of the body, with the inline markdown marks taken off, to match the rendered text
export const firstParagraph = (e: Entry) =>
  e.body
    .trim()
    .split(/\n\s*\n/)[0]!
    .replace(/[*_`]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ");
