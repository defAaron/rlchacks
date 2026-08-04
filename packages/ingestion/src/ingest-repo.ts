import type { IngestCursor, RawPullRequest } from "@graft/shared";
import type { GitHubClient } from "./github-client.js";
import {
  ingestPullRequest,
  type IngestPullRequestResult,
} from "./ingest-pr.js";

export type IngestPrProgress = {
  pr: RawPullRequest;
  /** Watermark over PRs successfully ingested so far this run (oldest→newest). */
  watermark: IngestCursor;
  result: IngestPullRequestResult;
};

export type IngestRepositoryOptions = {
  client: GitHubClient;
  dataDir: string;
  owner: string;
  repo: string;
  /** Cap on merged PRs to fetch (default 200). */
  maxPrs?: number;
  /**
   * Optional lower bound for `merged_at` (exclusive), forwarded to the GitHub
   * client. Resume / incremental ingest pass the persisted ingest cursor here.
   */
  since?: string | null;
  /**
   * Invoked after each PR is fully persisted (oldest first). Callers use this
   * to advance the ingest watermark so an interrupted run can resume via cursor.
   */
  onPrIngested?: (progress: IngestPrProgress) => void | Promise<void>;
};

export type IngestRepositoryResult = {
  owner: string;
  repo: string;
  /** Merged PRs processed this run. */
  prs: number;
  comments: number;
  blobs: number;
  /** Newly created artifact files (0 on an idempotent re-run). */
  prsNew: number;
  commentsNew: number;
  blobsNew: number;
  /**
   * Suggested ingest watermark from this run's PRs (newest `mergedAt`).
   * `null` when no merged PRs were processed.
   */
  watermark: IngestCursor | null;
  pullRequests: RawPullRequest[];
};

/** Pick the newest merged PR as the ingest watermark. */
export function computeIngestWatermark(
  prs: RawPullRequest[],
): IngestCursor | null {
  if (prs.length === 0) {
    return null;
  }

  let best = prs[0]!;
  for (let i = 1; i < prs.length; i++) {
    const candidate = prs[i]!;
    if (candidate.mergedAt > best.mergedAt) {
      best = candidate;
      continue;
    }
    if (
      candidate.mergedAt === best.mergedAt &&
      candidate.number > best.number
    ) {
      best = candidate;
    }
  }

  return {
    lastMergedAt: best.mergedAt,
    lastPrNumber: best.number,
  };
}

/**
 * Oldest-first order so advancing `lastMergedAt` after each PR is a valid
 * resume cursor (newer merges remain fetchable via `since`).
 */
export function sortPullRequestsOldestFirst(
  prs: readonly RawPullRequest[],
): RawPullRequest[] {
  return [...prs].sort((a, b) => {
    if (a.mergedAt < b.mergedAt) {
      return -1;
    }
    if (a.mergedAt > b.mergedAt) {
      return 1;
    }
    return a.number - b.number;
  });
}

/**
 * List merged PRs and persist raw PR / comment / blob artifacts (ING-1–3, 7).
 * Does not touch pipeline cursors — callers (CLI) update the ingest watermark
 * (preferably via `onPrIngested` after each PR for interrupt-safe resume).
 */
export async function ingestRepository(
  options: IngestRepositoryOptions,
): Promise<IngestRepositoryResult> {
  const maxPrs = options.maxPrs ?? 200;
  if (!Number.isInteger(maxPrs) || maxPrs < 1) {
    throw new Error(`maxPrs must be a positive integer; got ${maxPrs}`);
  }

  const listed = await options.client.listMergedPullRequests({
    owner: options.owner,
    repo: options.repo,
    maxPrs,
    ...(options.since !== undefined ? { since: options.since } : {}),
  });
  const pullRequests = sortPullRequestsOldestFirst(listed);

  let comments = 0;
  let blobs = 0;
  let prsNew = 0;
  let commentsNew = 0;
  let blobsNew = 0;
  const completed: RawPullRequest[] = [];

  for (const pr of pullRequests) {
    const result = await ingestPullRequest({
      client: options.client,
      dataDir: options.dataDir,
      owner: options.owner,
      repo: options.repo,
      pr,
    });
    comments += result.comments.length;
    blobs += result.blobs.length;
    if (result.prCreated) {
      prsNew += 1;
    }
    commentsNew += result.commentsCreated;
    blobsNew += result.blobsCreated;

    completed.push(pr);
    const watermark = computeIngestWatermark(completed);
    if (watermark !== null && options.onPrIngested !== undefined) {
      await options.onPrIngested({ pr, watermark, result });
    }
  }

  return {
    owner: options.owner,
    repo: options.repo,
    prs: pullRequests.length,
    comments,
    blobs,
    prsNew,
    commentsNew,
    blobsNew,
    watermark: computeIngestWatermark(pullRequests),
    pullRequests,
  };
}
