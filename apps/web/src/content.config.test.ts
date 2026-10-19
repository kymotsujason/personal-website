import { expect, test, vi } from "vitest";
import type { z } from "astro/zod";

vi.mock("astro:content", () => ({
  defineCollection: (collection: unknown) => collection,
}));
vi.mock("astro/loaders", () => ({ glob: () => ({}) }));

const { collections } = await import("./content.config");
const schema = collections.blog.schema as z.ZodType;

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
    "2019-01-05 10:00",
  ]) {
    expect(schema.safeParse(post(date)).success, date).toBe(false);
  }
});
