import { getCollection, type CollectionEntry } from "astro:content";
import { newestEntryFirst } from "./format";

export const sortedPosts = async () =>
  (await getCollection("blog")).sort(newestEntryFirst);

// posts are newest first, so the older one comes after
export const neighbors = (
  posts: CollectionEntry<"blog">[],
  slug: string,
): { older?: CollectionEntry<"blog">; newer?: CollectionEntry<"blog"> } => {
  const at = posts.findIndex((post) => post.data.slug === slug);
  if (at === -1) {
    return {};
  }
  const found: {
    older?: CollectionEntry<"blog">;
    newer?: CollectionEntry<"blog">;
  } = {};
  if (posts[at + 1]) {
    found.older = posts[at + 1];
  }
  if (at > 0) {
    found.newer = posts[at - 1];
  }
  return found;
};

// the year a post was written in, read from the date's own first four characters
export const postYear = (date: string): string => date.slice(0, 4);
