/**
 * Orchestrate raw → ReviewEpisode linking for one repo (Step 2.4).
 *
 * Reads `raw/prs`, `raw/comments`, `raw/blobs` (+ optional `raw/blob-index.json`),
 * writes `episodes/<id>.json`, `episodes/index.json`, and `episodes/discards.json`.
 * Does **not** update `cursors.json` — CLI persists the link watermark via
 * `@graft/pipeline` (same pattern as ingest).
 *
 * ## beforeText limitations (Phase 1 tip-only)
 *
 * Merge-tip blobs alone cannot distinguish comment-time vs merge-tip file text.
 * Resolution order:
 * 1. Comment-commit blob via `blob-index.json` (enhanced seed / future ingest)
 * 2. Reverse-apply `diffHunk` onto tip when tip still matches hunk right side
 * 3. Tip as before (usually `no_change` → confidence `none`)
 *
 * Rejected-span extraction prefers the comment-commit blob when indexed so
 * line numbers match review time; tip-only falls through to `diffHunk` (LNK-1).
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  graftNoDataError,
  parseArtifact,
  RawPullRequestSchema,
  RawReviewCommentSchema,
  repoScopedPath,
  type LinkConfidence,
  type RawPullRequest,
  type RawReviewComment,
  type ReviewEpisode,
} from "@graft/shared";
import { assessActionability } from "./actionability.js";
import { linkAcceptedFix } from "./accepted-fix.js";
import {
  loadSingleBlobFallback,
  readBlobIndex,
  resolveBlobAtRef,
  type BlobIndex,
  type ResolvedBlob,
} from "./blob-index.js";
import { resolveBeforeText } from "./before-text.js";
import { stableEpisodeId } from "./episode-id.js";
import {
  toIndexEntry,
  truncateBodyPreview,
  writeDiscardDebugIndex,
  writeEpisodeIndex,
  writeReviewEpisode,
  type DiscardDebugEntry,
  type EpisodeIndexEntry,
} from "./episode-store.js";
import { inferLanguageFromPath } from "./language.js";
import {
  applyLlmMediumValidation,
  type LinkLlmClient,
} from "./llm-validate.js";
import { extractRejectedSpan } from "./rejected-span.js";

export type LinkRepositoryOptions = {
  dataDir: string;
  owner: string;
  name: string;
  /** Injected clock for watermark/index timestamps. */
  now?: () => Date;
  /**
   * From `GRAFT_LLM_ENABLED` (default false). When false, the LLM client is
   * never invoked (SAF-2 / LNK-5).
   */
  llmEnabled?: boolean;
  /** True when a provider API key is configured. */
  llmApiKeyPresent?: boolean;
  /** Injectable LLM client (mock in tests; HTTP provider from CLI). */
  llmClient?: LinkLlmClient;
};

/** Compact confidence label for CLI / UI output paths (SAF-4). */
export type LinkEpisodeLabel = {
  id: string;
  linkConfidence: LinkConfidence;
  linkReason: string;
};

export type LinkRepositoryResult = {
  repo: string;
  episodes: number;
  discards: number;
  /** Episodes with confidence high or medium (inspectable before/after). */
  mediumOrHigher: number;
  episodeIds: string[];
  /** Per-episode confidence + reason for printable output (SAF-4 / Checkpoint 2 Labels). */
  episodeLabels: LinkEpisodeLabel[];
  indexPath: string;
  discardsPath: string;
  updatedAt: string;
};

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

async function loadPullRequests(
  dataDir: string,
  owner: string,
  name: string,
): Promise<RawPullRequest[]> {
  const dir = repoScopedPath(dataDir, owner, name, "raw", "prs");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: unknown }).code === "ENOENT"
    ) {
      return [];
    }
    throw err;
  }

  const prs: RawPullRequest[] = [];
  for (const fileName of names.filter((n) => n.endsWith(".json")).sort()) {
    const json = await readJsonFile(path.join(dir, fileName));
    prs.push(parseArtifact(RawPullRequestSchema, json, "RawPullRequest"));
  }
  return prs;
}

async function loadReviewComments(
  dataDir: string,
  owner: string,
  name: string,
): Promise<RawReviewComment[]> {
  const dir = repoScopedPath(dataDir, owner, name, "raw", "comments");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: unknown }).code === "ENOENT"
    ) {
      return [];
    }
    throw err;
  }

  const comments: RawReviewComment[] = [];
  for (const fileName of names.filter((n) => n.endsWith(".json")).sort()) {
    const json = await readJsonFile(path.join(dir, fileName));
    comments.push(
      parseArtifact(RawReviewCommentSchema, json, "RawReviewComment"),
    );
  }
  return comments;
}

function combineLinkReason(
  rejectedReason: string,
  acceptedReason: string,
): string {
  if (rejectedReason === "rejected_span_none") {
    return rejectedReason;
  }
  return `${rejectedReason}+${acceptedReason}`;
}

/**
 * Link all raw review comments for a repo into episode artifacts.
 */
export async function linkRepository(
  options: LinkRepositoryOptions,
): Promise<LinkRepositoryResult> {
  const { dataDir, owner, name } = options;
  const now = options.now ?? (() => new Date());
  const llmEnabled = options.llmEnabled ?? false;
  const llmApiKeyPresent = options.llmApiKeyPresent ?? false;
  const llmClient = options.llmClient;
  const repo = `${owner}/${name}`;
  const updatedAt = now().toISOString();

  const prs = await loadPullRequests(dataDir, owner, name);
  const comments = await loadReviewComments(dataDir, owner, name);

  if (prs.length === 0 && comments.length === 0) {
    throw graftNoDataError(repo);
  }

  const prByNumber = new Map(prs.map((pr) => [pr.number, pr]));
  const index: BlobIndex | null = await readBlobIndex(dataDir, owner, name);
  const singleBlob = await loadSingleBlobFallback(dataDir, owner, name);

  const indexEntries: EpisodeIndexEntry[] = [];
  const discards: DiscardDebugEntry[] = [];
  const episodeIds: string[] = [];
  let mediumOrHigher = 0;

  // Stable order: PR number, then comment id.
  const ordered = [...comments].sort((a, b) => {
    if (a.prNumber !== b.prNumber) return a.prNumber - b.prNumber;
    return a.id.localeCompare(b.id);
  });

  for (const comment of ordered) {
    const actionability = assessActionability({
      body: comment.body,
      author: comment.author,
    });

    if (!actionability.actionable) {
      discards.push({
        commentId: comment.id,
        prNumber: comment.prNumber,
        path: comment.path,
        author: comment.author,
        discardReason: actionability.discardReason ?? "unknown",
        bodyPreview: truncateBodyPreview(comment.body),
      });
      continue;
    }

    const pr = prByNumber.get(comment.prNumber);
    if (pr === undefined) {
      discards.push({
        commentId: comment.id,
        prNumber: comment.prNumber,
        path: comment.path,
        author: comment.author,
        discardReason: "missing_pull_request",
        bodyPreview: truncateBodyPreview(comment.body),
      });
      continue;
    }

    const tipBlob: ResolvedBlob | null = await resolveBlobAtRef({
      dataDir,
      owner,
      name,
      ref: pr.mergeCommitSha,
      path: comment.path,
      index,
      singleBlob,
    });

    const commentBlob: ResolvedBlob | null = await resolveBlobAtRef({
      dataDir,
      owner,
      name,
      ref: comment.commitId,
      path: comment.path,
      index,
      // Do not fall back to tip for comment-commit — tip is post-fix.
      singleBlob: null,
    });

    const beforeResolved = resolveBeforeText({
      commentCommitText: commentBlob?.text ?? null,
      tipText: tipBlob?.text ?? null,
      diffHunk: comment.diffHunk,
    });

    // Prefer comment-commit blob for rejected locus (line numbers match review).
    // Tip-only: omit blob so LNK-1 falls through to diffHunk.
    const rejectedExtraction = extractRejectedSpan({
      comment: {
        path: comment.path,
        line: comment.line,
        originalLine: comment.originalLine,
        side: comment.side,
        diffHunk: comment.diffHunk,
        commitId: comment.commitId,
      },
      blobText: commentBlob?.text ?? null,
      blobSha: commentBlob?.sha ?? null,
    });

    if (rejectedExtraction.rejected === null) {
      discards.push({
        commentId: comment.id,
        prNumber: comment.prNumber,
        path: comment.path,
        author: comment.author,
        discardReason: rejectedExtraction.linkReason,
        bodyPreview: truncateBodyPreview(comment.body),
      });
      continue;
    }

    const acceptedLink = linkAcceptedFix({
      path: comment.path,
      commentBody: comment.body,
      rejected: rejectedExtraction.rejected,
      beforeText: beforeResolved.beforeText,
      afterText: tipBlob?.text ?? null,
      afterSha: tipBlob?.sha ?? null,
    });

    const linkReason = combineLinkReason(
      rejectedExtraction.linkReason,
      acceptedLink.linkReason,
    );

    // Optional LLM validation: medium only; never invents episodes (LNK-5).
    const llmAdjusted = await applyLlmMediumValidation({
      linkConfidence: acceptedLink.linkConfidence,
      linkReason,
      commentBody: comment.body,
      path: comment.path,
      rejected: rejectedExtraction.rejected,
      accepted: acceptedLink.accepted,
      llmEnabled,
      llmApiKeyPresent,
      ...(llmClient !== undefined ? { llmClient } : {}),
    });

    const episode: ReviewEpisode = {
      id: stableEpisodeId(repo, comment.id),
      repo,
      prNumber: comment.prNumber,
      commentId: comment.id,
      path: comment.path,
      language: inferLanguageFromPath(comment.path),
      commentBody: comment.body,
      rejected: rejectedExtraction.rejected,
      accepted: acceptedLink.accepted,
      linkConfidence: llmAdjusted.linkConfidence,
      linkReason: llmAdjusted.linkReason,
      actionable: true,
      discardReason: null,
      reviewer: comment.author,
      mergedAt: pr.mergedAt,
    };

    await writeReviewEpisode(dataDir, owner, name, episode);
    indexEntries.push(toIndexEntry(episode));
    episodeIds.push(episode.id);
    if (
      episode.linkConfidence === "high" ||
      episode.linkConfidence === "medium"
    ) {
      mediumOrHigher += 1;
    }
  }

  const indexPath = await writeEpisodeIndex(dataDir, owner, name, {
    repo,
    updatedAt,
    episodes: indexEntries,
  });
  const discardsPath = await writeDiscardDebugIndex(dataDir, owner, name, {
    repo,
    updatedAt,
    discards,
  });

  const episodeLabels: LinkEpisodeLabel[] = indexEntries.map((e) => ({
    id: e.id,
    linkConfidence: e.linkConfidence,
    linkReason: e.linkReason,
  }));

  return {
    repo,
    episodes: indexEntries.length,
    discards: discards.length,
    mediumOrHigher,
    episodeIds,
    episodeLabels,
    indexPath,
    discardsPath,
    updatedAt,
  };
}
