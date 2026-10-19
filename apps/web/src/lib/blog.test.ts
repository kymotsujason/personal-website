import { describe, expect, test, vi } from "vitest";

vi.mock("astro:content", () => ({ getCollection: vi.fn() }));

const { getCollection } = await import("astro:content");
const { neighbors, postYear, sortedPosts } = await import("./blog");

const post = (slug: string) => ({ data: { slug } }) as never;
const posts = ["c", "b", "a"].map(post);

describe("neighbors", () => {
  test("the newest post has only an older one", () => {
    const found = neighbors(posts, "c");
    expect(found.newer).toBeUndefined();
    expect(found.older?.data.slug).toBe("b");
  });

  test("a middle post has both", () => {
    const found = neighbors(posts, "b");
    expect(found.newer?.data.slug).toBe("c");
    expect(found.older?.data.slug).toBe("a");
  });

  test("the oldest post has only a newer one", () => {
    const found = neighbors(posts, "a");
    expect(found.newer?.data.slug).toBe("b");
    expect(found.older).toBeUndefined();
  });

  test("an only post has neither", () => {
    expect(neighbors([post("a")], "a")).toEqual({});
  });

  test("an unknown slug has neither", () => {
    expect(neighbors(posts, "z")).toEqual({});
  });
});

describe("sortedPosts", () => {
  test("orders by the date's own text, so the year groups stay in order", async () => {
    // the first is later as an instant, but it was written on new year's eve where it was written
    const dates = [
      "2019-06-01",
      "2019-12-31T23:00:00.000-08:00",
      "2020-01-01T03:00:00.000Z",
    ];
    vi.mocked(getCollection).mockResolvedValue(
      dates.map((date) => ({ data: { date } })) as never,
    );
    const sorted = (await sortedPosts()).map((p) => p.data.date);
    expect(sorted).toEqual([
      "2020-01-01T03:00:00.000Z",
      "2019-12-31T23:00:00.000-08:00",
      "2019-06-01",
    ]);
    expect(sorted.map(postYear)).toEqual(["2020", "2019", "2019"]);
  });
});
