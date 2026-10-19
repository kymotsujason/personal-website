import rss from "@astrojs/rss";
import { sortedPosts } from "../../lib/blog";

export async function GET(context) {
  const posts = await sortedPosts();
  return rss({
    title: "Jason Yue",
    description: "Posts from Jason Yue's blog",
    site: context.site,
    trailingSlash: false,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: new Date(post.data.date),
      link: `/blog/${post.data.slug}`,
    })),
  });
}
