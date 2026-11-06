import { expect, test, vi } from "vitest";

vi.mock("astro:content", () => ({ getCollection: vi.fn() }));

const { getCollection } = await import("astro:content");
const { latestProject, orderByRank, pickLatest } = await import("./projects");

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

const dated = (id: string, rank: number, date: string) => ({
  id,
  data: {
    rank,
    date,
    title: `Title ${id}`,
    summary: `Summary ${id}`,
  },
});

// the top ranked entry is the oldest, so picking the first ranked project would pick wrong
const disagreeing = [
  dated("top-ranked-oldest", 1, "2026-01-05"),
  dated("middle", 2, "2026-03-01"),
  dated("lowest-ranked-newest", 3, "2026-10-19"),
];

test("pickLatest picks the newest date, not the top rank", () => {
  expect(pickLatest(disagreeing).id).toBe("lowest-ranked-newest");
  expect(pickLatest([...disagreeing].reverse()).id).toBe(
    "lowest-ranked-newest",
  );
});

test("pickLatest breaks a date tie by id", () => {
  const tied = [dated("b", 1, "2026-05-01"), dated("a", 2, "2026-05-01")];
  expect(pickLatest(tied).id).toBe("a");
});

test("pickLatest throws on no entries", () => {
  expect(() => pickLatest([])).toThrow(/needs a project/);
});

test("latestProject returns the newest entry's own fields and path", async () => {
  vi.mocked(getCollection).mockResolvedValue(disagreeing as never);
  expect(await latestProject()).toEqual({
    title: "Title lowest-ranked-newest",
    date: "2026-10-19",
    summary: "Summary lowest-ranked-newest",
    path: "/projects/lowest-ranked-newest",
  });
});
