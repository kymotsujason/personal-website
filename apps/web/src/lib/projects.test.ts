import { expect, test, vi } from "vitest";

vi.mock("astro:content", () => ({ getCollection: vi.fn() }));

const { orderByRank } = await import("./projects");

const entry = (id: string, rank: number) => ({ id, data: { rank } });

test("orderByRank sorts by rank", () => {
  const sorted = orderByRank([entry("c", 3), entry("a", 1), entry("b", 2)]);
  expect(sorted.map((e) => e.id)).toEqual(["a", "b", "c"]);
});

test("orderByRank throws when two entries share a rank", () => {
  expect(() => orderByRank([entry("a", 1), entry("b", 1)])).toThrow(
    /"a".*"b"|"b".*"a"/,
  );
});

test("orderByRank throws when ranks skip a number", () => {
  expect(() => orderByRank([entry("a", 1), entry("c", 3)])).toThrow(
    /2 is missing/,
  );
});
