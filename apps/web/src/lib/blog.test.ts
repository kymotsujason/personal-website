import { describe, expect, test, vi } from "vitest";

vi.mock("astro:content", () => ({ getCollection: vi.fn() }));

const { neighbors } = await import("./blog");

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
