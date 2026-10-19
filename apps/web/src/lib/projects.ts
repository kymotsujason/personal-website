import { getCollection } from "astro:content";
import { newestEntryFirst } from "./format";

export const sortedProjects = async () =>
  (await getCollection("projects")).sort(newestEntryFirst);

export const latestProject = async () => {
  const [latest] = await sortedProjects();
  if (!latest) {
    throw new Error("The home screen needs a project in src/content/projects");
  }
  return {
    title: latest.data.title,
    date: latest.data.date,
    summary: latest.data.summary,
    path: `/projects/${latest.id}`,
  };
};
