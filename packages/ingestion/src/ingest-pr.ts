import type { RawPullRequest, RawReviewComment } from "@graft/shared";
import type { FetchedBlob, GitHubClient } from "./github-client.js";
import {
  writeRawBlob,
  writeRawPullRequest,
  writeRawReviewComment,
} from "./raw-store.js";

export type IngestPullRequestOptions = {
  client: GitHubClient;
  dataDir: string;
  owner: string;
  repo: string;
  pr: RawPullRequest;
};

export type IngestPullRequestResult = {
  prPath: string;
  commentPaths: string[];
  blobPaths: string[];
  comments: RawReviewComment[];
  blobs: FetchedBlob[];
  /** True when the PR artifact file was newly created (not overwritten). */
  prCreated: boolean;
  commentsCreated: number;
  blobsCreated: number;
};

/**
 * Fetch inline review comments + merge-commit blobs for one PR and persist
 * under `raw/prs/`, `raw/comments/`, `raw/blobs/` (ING-2, ING-3, ING-7).
 * Network fetches run before any writes so an interrupt mid-PR leaves no
 * partial artifacts for that PR (resume can re-fetch cleanly).
 * Cursor / watermark updates are left for CLI ingest (step 1.3).
 */
export async function ingestPullRequest(
  options: IngestPullRequestOptions,
): Promise<IngestPullRequestResult> {
  const { client, dataDir, owner, repo, pr } = options;

  const comments = await client.listPullReviewComments({
    owner,
    repo,
    pullNumber: pr.number,
  });

  const paths = [...new Set(comments.map((c) => c.path))];
  const blobs: FetchedBlob[] = [];
  const seenBlobShas = new Set<string>();

  for (const filePath of paths) {
    const blob = await client.fetchBlobAtRef({
      owner,
      repo,
      path: filePath,
      ref: pr.mergeCommitSha,
    });
    if (blob === null) {
      continue;
    }
    if (seenBlobShas.has(blob.sha)) {
      continue;
    }
    seenBlobShas.add(blob.sha);
    blobs.push(blob);
  }

  const prWrite = await writeRawPullRequest(dataDir, owner, repo, pr);

  const commentPaths: string[] = [];
  let commentsCreated = 0;
  for (const comment of comments) {
    const written = await writeRawReviewComment(dataDir, owner, repo, comment);
    commentPaths.push(written.path);
    if (written.created) {
      commentsCreated += 1;
    }
  }

  const blobPaths: string[] = [];
  let blobsCreated = 0;
  for (const blob of blobs) {
    const written = await writeRawBlob(
      dataDir,
      owner,
      repo,
      blob.sha,
      blob.text,
    );
    blobPaths.push(written.path);
    if (written.created) {
      blobsCreated += 1;
    }
  }

  return {
    prPath: prWrite.path,
    commentPaths,
    blobPaths,
    comments,
    blobs,
    prCreated: prWrite.created,
    commentsCreated,
    blobsCreated,
  };
}
