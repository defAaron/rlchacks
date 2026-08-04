/**
 * Persist linked episodes + indexes under `episodes/` (TRD §6.2).
 */

import { mkdir, writeFile } from "node:fs/promises";
import {
  parseArtifact,
  redactSecrets,
  repoScopedPath,
  ReviewEpisodeSchema,
  type LinkConfidence,
  type ReviewEpisode,
} from "@graft/shared";

export type EpisodeIndexEntry = {
  id: string;
  prNumber: number;
  commentId: string;
  path: string;
  linkConfidence: LinkConfidence;
  linkReason: string;
  actionable: boolean;
};

export type EpisodeIndex = {
  repo: string;
  updatedAt: string;
  episodes: EpisodeIndexEntry[];
};

/** Truncated discard debug row (non-actionable comments from Step 2.1). */
export type DiscardDebugEntry = {
  commentId: string;
  prNumber: number;
  path: string;
  author: string;
  discardReason: string;
  /** Truncated body for debug (never full secrets-bearing logs). */
  bodyPreview: string;
};

export type DiscardDebugIndex = {
  repo: string;
  updatedAt: string;
  discards: DiscardDebugEntry[];
};

const BODY_PREVIEW_MAX = 160;

export function episodePath(
  dataDir: string,
  owner: string,
  name: string,
  episodeId: string,
): string {
  return repoScopedPath(
    dataDir,
    owner,
    name,
    "episodes",
    `${episodeId}.json`,
  );
}

export function episodeIndexPath(
  dataDir: string,
  owner: string,
  name: string,
): string {
  return repoScopedPath(dataDir, owner, name, "episodes", "index.json");
}

export function discardDebugIndexPath(
  dataDir: string,
  owner: string,
  name: string,
): string {
  return repoScopedPath(
    dataDir,
    owner,
    name,
    "episodes",
    "discards.json",
  );
}

export function truncateBodyPreview(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (oneLine.length <= BODY_PREVIEW_MAX) return oneLine;
  return `${oneLine.slice(0, BODY_PREVIEW_MAX - 1)}…`;
}

export function redactEpisodeForPersist(episode: ReviewEpisode): ReviewEpisode {
  return {
    ...episode,
    commentBody: redactSecrets(episode.commentBody),
    rejected: {
      ...episode.rejected,
      text: redactSecrets(episode.rejected.text),
      normalized: redactSecrets(episode.rejected.normalized),
    },
    accepted:
      episode.accepted === null
        ? null
        : {
            ...episode.accepted,
            text: redactSecrets(episode.accepted.text),
            normalized: redactSecrets(episode.accepted.normalized),
          },
  };
}

export async function writeReviewEpisode(
  dataDir: string,
  owner: string,
  name: string,
  episode: ReviewEpisode,
): Promise<string> {
  const validated = parseArtifact(
    ReviewEpisodeSchema,
    episode,
    "ReviewEpisode",
  );
  const redacted = redactEpisodeForPersist(validated);
  const filePath = episodePath(dataDir, owner, name, redacted.id);
  await mkdir(repoScopedPath(dataDir, owner, name, "episodes"), {
    recursive: true,
  });
  await writeFile(
    filePath,
    `${JSON.stringify(redacted, null, 2)}\n`,
    "utf8",
  );
  return filePath;
}

export async function writeEpisodeIndex(
  dataDir: string,
  owner: string,
  name: string,
  index: EpisodeIndex,
): Promise<string> {
  const filePath = episodeIndexPath(dataDir, owner, name);
  await mkdir(repoScopedPath(dataDir, owner, name, "episodes"), {
    recursive: true,
  });
  await writeFile(filePath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return filePath;
}

export async function writeDiscardDebugIndex(
  dataDir: string,
  owner: string,
  name: string,
  index: DiscardDebugIndex,
): Promise<string> {
  const filePath = discardDebugIndexPath(dataDir, owner, name);
  await mkdir(repoScopedPath(dataDir, owner, name, "episodes"), {
    recursive: true,
  });
  await writeFile(filePath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return filePath;
}

export function toIndexEntry(episode: ReviewEpisode): EpisodeIndexEntry {
  return {
    id: episode.id,
    prNumber: episode.prNumber,
    commentId: episode.commentId,
    path: episode.path,
    linkConfidence: episode.linkConfidence,
    linkReason: episode.linkReason,
    actionable: episode.actionable,
  };
}
