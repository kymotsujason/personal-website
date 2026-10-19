import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { ISO_DATE, ISO_DAY, isRealDay } from "./lib/format";

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    date: z.string().regex(ISO_DAY).refine(isRealDay),
    summary: z.string(),
    links: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
    images: z.array(z.string()).optional(),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    date: z.string().regex(ISO_DATE).refine(isRealDay),
    slug: z.string(),
    feature_image: z.string().optional(),
    thumb: z.string().optional(),
  }),
});

export const collections = { projects, blog };
