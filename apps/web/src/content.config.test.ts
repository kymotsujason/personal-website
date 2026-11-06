import { expect, test, vi } from "vitest";
import type { z } from "astro/zod";

vi.mock("astro:content", () => ({
  defineCollection: (collection: unknown) => collection,
}));
vi.mock("astro/loaders", () => ({ glob: () => ({}) }));

const { collections } = await import("./content.config");
const schema = collections.blog.schema as z.ZodType;

const projectSchema = collections.projects.schema as z.ZodType;

const project = (date = "2026-10-14") => ({
  title: "t",
  summary: "s",
  kicker: "Web and 3D",
  rank: 1,
  date,
  stats: [
    { value: "1", label: "a" },
    { value: "2", label: "b" },
    { value: "3", label: "c" },
  ],
  links: [{ label: "GitHub", url: "https://github.com/kymotsujason/x" }],
  source: "public",
  hero: { still: "/og.jpg", alt: "a picture" },
  thumb: "/og.jpg",
  highlights: [
    { title: "a", text: "a" },
    { title: "b", text: "b" },
    { title: "c", text: "c" },
  ],
  stack: ["Astro"],
  status: "Live",
});

const accepts = (entry: unknown) => projectSchema.safeParse(entry).success;

const post = (date: string) => ({ title: "t", date, slug: "s" });

test("a post's date can be a day or an ISO time with its offset", () => {
  for (const date of [
    "2026-10-12",
    "2019-11-01T18:25:00.000-07:00",
    "2020-01-01T17:56:51Z",
  ]) {
    expect(schema.safeParse(post(date)).success, date).toBe(true);
  }
});

test("a post's date that isn't ISO is refused", () => {
  for (const date of [
    "Jan 5, 2019",
    "2019/01/05",
    "19-01-05",
    "2019-13-01",
    "2019-01-32",
    "2019-02-31",
    "2019-02-29",
    "2019-01-05 10:00",
  ]) {
    expect(schema.safeParse(post(date)).success, date).toBe(false);
  }
});

test("a project's date is a real day", () => {
  for (const date of ["2026-10-12", "2024-02-29"]) {
    expect(projectSchema.safeParse(project(date)).success, date).toBe(true);
  }
});

test("a project's date that isn't a real day is refused", () => {
  for (const date of [
    "2026-13-01",
    "2026-00-10",
    "2026-10-00",
    "2026-10-32",
    "2026-02-30",
    "2026-10-12T10:00:00Z",
    "Oct 12, 2026",
  ]) {
    expect(projectSchema.safeParse(project(date)).success, date).toBe(false);
  }
});

test("a project needs exactly three stats and three highlights", () => {
  const base = project();
  expect(accepts(base)).toBe(true);
  expect(accepts({ ...base, stats: base.stats.slice(0, 2) })).toBe(false);
  expect(accepts({ ...base, stats: [...base.stats, base.stats[0]] })).toBe(
    false,
  );
  expect(accepts({ ...base, highlights: base.highlights.slice(0, 2) })).toBe(
    false,
  );
  expect(
    accepts({ ...base, highlights: [...base.highlights, base.highlights[0]] }),
  ).toBe(false);
});

test("a project's links and built on point at https", () => {
  const base = project();
  const builtOn = { name: "tobiifree", url: "https://github.com/a/b" };
  expect(accepts({ ...base, builtOn })).toBe(true);
  expect(
    accepts({ ...base, links: [{ label: "x", url: "http://example.com" }] }),
  ).toBe(false);
  expect(accepts({ ...base, links: [{ label: "x", url: "not a url" }] })).toBe(
    false,
  );
  expect(
    accepts({ ...base, builtOn: { name: "x", url: "http://example.com" } }),
  ).toBe(false);
});

test("a project's pictures are paths on this site", () => {
  const base = project();
  const withHero = (hero: object) => ({ ...base, hero });
  expect(accepts({ ...base, thumb: "/projects/a/thumb.webp" })).toBe(true);
  expect(
    accepts(withHero({ still: "/a.webp", loop: "/a.webp", alt: "x" })),
  ).toBe(true);
  expect(accepts({ ...base, thumb: "https://example.com/a.webp" })).toBe(false);
  expect(accepts({ ...base, thumb: "a.webp" })).toBe(false);
  expect(accepts({ ...base, thumb: "/a b.webp" })).toBe(false);
  expect(accepts(withHero({ still: "a.webp", alt: "x" }))).toBe(false);
  expect(
    accepts(withHero({ still: "/a.webp", loop: "http://x/a.webp", alt: "x" })),
  ).toBe(false);
  expect(accepts(withHero({ still: "/a.webp", alt: "" }))).toBe(false);
  expect(
    accepts({ ...base, results: { src: "/r.svg", alt: "x", caption: "c" } }),
  ).toBe(true);
  expect(
    accepts({ ...base, results: { src: "r.svg", alt: "x", caption: "c" } }),
  ).toBe(false);
});

test("a project's source is public, private, or unreleased", () => {
  const base = project();
  for (const source of ["public", "private", "unreleased"]) {
    expect(accepts({ ...base, source }), source).toBe(true);
  }
  for (const source of ["open", "", "Public"]) {
    expect(accepts({ ...base, source }), source).toBe(false);
  }
});
