import { getCollection } from "astro:content";
import { newestEntryFirst } from "./format";

// the build fails on a duplicate rank or a gap, so the list can't quietly lose or repeat an entry
export const orderByRank = <T extends { id: string; data: { rank: number } }>(
  entries: T[],
): T[] => {
  const sorted = [...entries].sort((a, b) => a.data.rank - b.data.rank);
  sorted.forEach((entry, i) => {
    const previous = sorted[i - 1];
    if (previous && previous.data.rank === entry.data.rank) {
      throw new Error(
        `Projects "${previous.id}" and "${entry.id}" share rank ${entry.data.rank}`,
      );
    }
    if (entry.data.rank !== i + 1) {
      throw new Error(
        `Project ranks must run 1 to ${sorted.length}, and "${entry.id}" has rank ${entry.data.rank} where ${i + 1} is missing`,
      );
    }
  });
  return sorted;
};

export const rankedProjects = async () =>
  orderByRank(await getCollection("projects"));

export const pickLatest = <T extends { id: string; data: { date: string } }>(
  entries: T[],
): T => {
  const [latest] = [...entries].sort(newestEntryFirst);
  if (!latest) {
    throw new Error("The home screen needs a project in src/content/projects");
  }
  return latest;
};

export const latestProject = async () => {
  const latest = pickLatest(await getCollection("projects"));
  return {
    title: latest.data.title,
    date: latest.data.date,
    summary: latest.data.summary,
    path: `/projects/${latest.id}`,
  };
};
