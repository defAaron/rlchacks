/**
 * Greedy episode clustering + medoid exemplars (Phase 3.2).
 */

import type { LinkConfidence, ReviewEpisode } from "@graft/shared";
import { normalizeForClustering } from "./normalize.js";
import { pairSimilarity } from "./similarity.js";

/** Default merge threshold for greedy clustering. */
export const DEFAULT_CLUSTER_THRESHOLD = 0.72;

export type CompileEpisode = ReviewEpisode & {
  rejectedNormalized: string;
  acceptedNormalized: string;
};

export type EpisodeCluster = {
  episodes: CompileEpisode[];
  /** Medoid episode — representative before/after exemplar. */
  medoid: CompileEpisode;
  support: number;
  episodeIds: string[];
  reviewers: string[];
  avgLinkConfidence: number;
  beforeSignals: string[];
};

function linkConfidenceScore(confidence: LinkConfidence): number {
  switch (confidence) {
    case "high":
      return 1;
    case "medium":
      return 0.7;
    case "low":
      return 0.3;
    default:
      return 0;
  }
}

/** Top-level path segment bucket key (e.g. `src` from `src/api/client.ts`). */
export function pathBucketKey(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  return parts[0] ?? "";
}

export function bucketKey(episode: ReviewEpisode): string {
  const lang = episode.language ?? "unknown";
  const segment = pathBucketKey(episode.path);
  return `${lang}\0${segment}`;
}

/** Attach compile-time normalized forms to an eligible episode. */
export function toCompileEpisode(episode: ReviewEpisode): CompileEpisode {
  return {
    ...episode,
    rejectedNormalized: normalizeForClustering(episode.rejected.text),
    acceptedNormalized: episode.accepted
      ? normalizeForClustering(episode.accepted.text)
      : "",
  };
}

function chooseMedoid(members: CompileEpisode[]): CompileEpisode {
  if (members.length === 1) {
    return members[0]!;
  }

  let best = members[0]!;
  let bestScore = -1;

  for (const candidate of members) {
    let total = 0;
    for (const other of members) {
      if (other.id === candidate.id) {
        continue;
      }
      total += pairSimilarity(
        {
          rejectedNormalized: candidate.rejectedNormalized,
          acceptedNormalized: candidate.acceptedNormalized,
        },
        {
          rejectedNormalized: other.rejectedNormalized,
          acceptedNormalized: other.acceptedNormalized,
        },
      );
    }
    const avg = members.length > 1 ? total / (members.length - 1) : 1;
    if (avg > bestScore) {
      bestScore = avg;
      best = candidate;
    }
  }

  return best;
}

const MIN_SIGNAL_LEN = 4;

/** Distinctive rejected substrings for retrieval matching (TRD §7.3). */
export function deriveBeforeSignals(rejectedText: string): string[] {
  const signals = new Set<string>();

  // Whole-line trimmed chunks (multi-line rejected spans).
  for (const line of rejectedText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length >= MIN_SIGNAL_LEN && /[A-Za-z0-9]/.test(trimmed)) {
      signals.add(trimmed);
    }
  }

  // Identifier-like tokens from rejected text.
  for (const token of rejectedText.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? []) {
    if (token.length >= MIN_SIGNAL_LEN && !/^[_]+$/.test(token)) {
      signals.add(token);
    }
  }

  return [...signals].slice(0, 12);
}

function commonPathPrefix(paths: string[]): string[] {
  if (paths.length === 0) {
    return [];
  }
  const split = paths.map((p) => p.split("/"));
  const prefix: string[] = [];
  const minLen = Math.min(...split.map((s) => s.length));

  for (let i = 0; i < minLen - 1; i++) {
    const segment = split[0]![i];
    if (segment !== undefined && split.every((s) => s[i] === segment)) {
      prefix.push(segment);
    } else {
      break;
    }
  }

  if (prefix.length === 0) {
    return [pathBucketKey(paths[0] ?? "")].filter(Boolean);
  }
  return [`${prefix.join("/")}/`];
}

export function buildCluster(members: CompileEpisode[]): EpisodeCluster {
  const medoid = chooseMedoid(members);
  const reviewers = [
    ...new Set(
      members
        .map((e) => e.reviewer)
        .filter((r): r is string => r !== null && r.trim() !== ""),
    ),
  ];
  const avgLinkConfidence =
    members.reduce((sum, e) => sum + linkConfidenceScore(e.linkConfidence), 0) /
    members.length;

  return {
    episodes: members,
    medoid,
    support: members.length,
    episodeIds: members.map((e) => e.id),
    reviewers,
    avgLinkConfidence,
    beforeSignals: deriveBeforeSignals(medoid.rejected.text),
  };
}

export type ClusterOptions = {
  similarityThreshold?: number;
};

/**
 * Greedy clustering within a bucket: merge episodes above threshold.
 * Returns clusters (including singletons).
 */
export function clusterEpisodes(
  episodes: CompileEpisode[],
  options: ClusterOptions = {},
): EpisodeCluster[] {
  const threshold = options.similarityThreshold ?? DEFAULT_CLUSTER_THRESHOLD;
  const clusters: CompileEpisode[][] = episodes.map((e) => [e]);

  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i]!;
        const b = clusters[j]!;
        const repA = a[0]!;
        const repB = b[0]!;
        const sim = pairSimilarity(
          {
            rejectedNormalized: repA.rejectedNormalized,
            acceptedNormalized: repA.acceptedNormalized,
          },
          {
            rejectedNormalized: repB.rejectedNormalized,
            acceptedNormalized: repB.acceptedNormalized,
          },
        );
        if (sim >= threshold) {
          clusters[i] = [...a, ...b];
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  return clusters.map((members) => buildCluster(members));
}

/** Bucket episodes by language + path segment, then cluster each bucket. */
export function clusterAllEpisodes(
  episodes: CompileEpisode[],
  options: ClusterOptions = {},
): EpisodeCluster[] {
  const buckets = new Map<string, CompileEpisode[]>();
  for (const episode of episodes) {
    const key = bucketKey(episode);
    const list = buckets.get(key) ?? [];
    list.push(episode);
    buckets.set(key, list);
  }

  const out: EpisodeCluster[] = [];
  for (const bucket of buckets.values()) {
    out.push(...clusterEpisodes(bucket, options));
  }
  return out;
}

export function clusterScope(cluster: EpisodeCluster): {
  pathPrefixes: string[];
  languages: string[];
} {
  const paths = cluster.episodes.map((e) => e.path);
  const languages = [
    ...new Set(
      cluster.episodes
        .map((e) => e.language)
        .filter((l): l is string => l !== null && l.trim() !== ""),
    ),
  ];
  return {
    pathPrefixes: commonPathPrefix(paths),
    languages,
  };
}
