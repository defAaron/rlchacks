import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseArtifact,
  RawPullRequestSchema,
  RawReviewCommentSchema,
  redactSecrets,
  repoScopedPath,
  type RawPullRequest,
  type RawReviewComment,
} from "@graft/shared";

export type WriteRawResult = {
  path: string;
  /** True when the file did not exist before this write. */
  created: boolean;
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Path to `raw/prs/<number>.json` under the repo data root (TRD §6.2). */
export function rawPullRequestPath(
  dataDir: string,
  owner: string,
  name: string,
  prNumber: number,
): string {
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    throw new Error(`prNumber must be a positive integer; got ${prNumber}`);
  }
  return repoScopedPath(
    dataDir,
    owner,
    name,
    "raw",
    "prs",
    `${prNumber}.json`,
  );
}

/** Path to `raw/comments/<commentId>.json` under the repo data root. */
export function rawReviewCommentPath(
  dataDir: string,
  owner: string,
  name: string,
  commentId: string,
): string {
  if (commentId.trim() === "") {
    throw new Error("commentId must be a non-empty string");
  }
  return repoScopedPath(
    dataDir,
    owner,
    name,
    "raw",
    "comments",
    `${commentId}.json`,
  );
}

/** Path to `raw/blobs/<sha>.txt` under the repo data root. */
export function rawBlobPath(
  dataDir: string,
  owner: string,
  name: string,
  sha: string,
): string {
  if (sha.trim() === "") {
    throw new Error("blob sha must be a non-empty string");
  }
  return repoScopedPath(dataDir, owner, name, "raw", "blobs", `${sha}.txt`);
}

/**
 * Persist a validated raw pull request artifact (ING-7).
 * Idempotent: same number overwrites with an equivalent payload.
 */
export async function writeRawPullRequest(
  dataDir: string,
  owner: string,
  name: string,
  pr: RawPullRequest,
): Promise<WriteRawResult> {
  const validated = parseArtifact(RawPullRequestSchema, pr, "RawPullRequest");
  const filePath = rawPullRequestPath(
    dataDir,
    owner,
    name,
    validated.number,
  );
  const created = !(await pathExists(filePath));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(validated, null, 2)}\n`,
    "utf8",
  );
  return { path: filePath, created };
}

/**
 * Persist a validated raw review comment artifact (ING-2, ING-7).
 * Idempotent: same comment id overwrites with an equivalent payload.
 */
export async function writeRawReviewComment(
  dataDir: string,
  owner: string,
  name: string,
  comment: RawReviewComment,
): Promise<WriteRawResult> {
  const validated = parseArtifact(
    RawReviewCommentSchema,
    comment,
    "RawReviewComment",
  );
  const redacted = {
    ...validated,
    body: redactSecrets(validated.body),
  };
  const filePath = rawReviewCommentPath(
    dataDir,
    owner,
    name,
    redacted.id,
  );
  const created = !(await pathExists(filePath));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(redacted, null, 2)}\n`,
    "utf8",
  );
  return { path: filePath, created };
}

/**
 * Persist a file blob by git sha as UTF-8 text (ING-3, ING-7).
 * Idempotent: same sha overwrites with the same content.
 */
export async function writeRawBlob(
  dataDir: string,
  owner: string,
  name: string,
  sha: string,
  text: string,
): Promise<WriteRawResult> {
  const filePath = rawBlobPath(dataDir, owner, name, sha);
  const created = !(await pathExists(filePath));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, redactSecrets(text), "utf8");
  return { path: filePath, created };
}
