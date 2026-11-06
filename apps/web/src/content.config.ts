import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { ISO_DATE, ISO_DAY, isRealDay } from "./lib/format";

const SITE_PATH = z.string().regex(/^\/[^\s]+$/);
const HTTPS_URL = z.url().startsWith("https://");

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    kicker: z.string(),
    rank: z.number().int().min(1),
    date: z.string().regex(ISO_DAY).refine(isRealDay),
    stats: z
      .array(z.object({ value: z.string(), label: z.string() }))
      .length(3),
    links: z.array(z.object({ label: z.string(), url: HTTPS_URL })).optional(),
    source: z.enum(["public", "private", "unreleased"]),
    hero: z.object({
      still: SITE_PATH,
      loop: SITE_PATH.optional(),
      alt: z.string().min(1),
      position: z.string().optional(),
    }),
    thumb: SITE_PATH,
    highlights: z
      .array(z.object({ title: z.string(), text: z.string() }))
      .length(3),
    results: z
      .object({ src: SITE_PATH, alt: z.string().min(1), caption: z.string() })
      .optional(),
    stack: z.array(z.string()).min(1),
    status: z.string(),
    license: z.string().optional(),
    builtOn: z.object({ name: z.string(), url: HTTPS_URL }).optional(),
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
