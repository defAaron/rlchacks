/**
 * Load linked episodes from disk for compile input.
 */

import { readdir, readFile } from "node:fs/promises";
import {
  parseArtifact,
  repoScopedPath,
  ReviewEpisodeSchema,
  type ReviewEpisode,
} from "@graft/shared";

export type EpisodeIndex = {
  repo: string;
  updatedAt: string;
  episodes: Array<{ id: string }>;
};

export function episodesDir(
  dataDir: string,
  owner: string,
  name: string,
): string {
  return repoScopedPath(dataDir, owner, name, "episodes");
}

export async function readEpisodeIndex(
  dataDir: string,
  owner: string,
  name: string,
): Promise<EpisodeIndex | null> {
  const indexPath = repoScopedPath(
    dataDir,
    owner,
    name,
    "episodes",
    "index.json",
  );
  try {
    const raw = await readFile(indexPath, "utf8");
    return JSON.parse(raw) as EpisodeIndex;
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: unknown }).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
}

export async function loadReviewEpisodes(
  dataDir: string,
  owner: string,
  name: string,
): Promise<ReviewEpisode[]> {
  const index = await readEpisodeIndex(dataDir, owner, name);
  if (index === null) {
    return [];
  }

  const episodes: ReviewEpisode[] = [];
  for (const entry of index.episodes) {
    const filePath = repoScopedPath(
      dataDir,
      owner,
      name,
      "episodes",
      `${entry.id}.json`,
    );
    const raw = await readFile(filePath, "utf8");
    const json = JSON.parse(raw) as unknown;
    episodes.push(parseArtifact(ReviewEpisodeSchema, json, "ReviewEpisode"));
  }

  return episodes;
}

/** Load episodes by id (for retrieval evidence). */
export async function loadEpisodesByIds(
  dataDir: string,
  owner: string,
  name: string,
  ids: readonly string[],
): Promise<Map<string, ReviewEpisode>> {
  const map = new Map<string, ReviewEpisode>();
  for (const id of ids) {
    const filePath = repoScopedPath(
      dataDir,
      owner,
      name,
      "episodes",
      `${id}.json`,
    );
    try {
      const raw = await readFile(filePath, "utf8");
      const json = JSON.parse(raw) as unknown;
      map.set(
        id,
        parseArtifact(ReviewEpisodeSchema, json, "ReviewEpisode"),
      );
    } catch (err) {
      if (
        err !== null &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: unknown }).code === "ENOENT"
      ) {
        continue;
      }
      throw err;
    }
  }
  return map;
}
