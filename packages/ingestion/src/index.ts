export const PKG = "@graft/ingestion" as const;

export {
  GITHUB_PULLS_PER_PAGE,
  GITHUB_REVIEW_COMMENTS_PER_PAGE,
  DEFAULT_RATE_LIMIT_MAX_RETRIES,
  createGitHubClient,
  createGitHubClientFromEnv,
  toRawPullRequest,
  toRawReviewComment,
  isRetryableGitHubError,
  type SleepFn,
  type GitHubFetch,
  type GitHubClientOptions,
  type ListMergedPullRequestsOptions,
  type ListPullReviewCommentsOptions,
  type FetchBlobAtRefOptions,
  type FetchedBlob,
  type GitHubClient,
} from "./github-client.js";

export {
  GitHubAccessError,
  missingGitHubTokenError,
  rateLimitExhaustedError,
  toGitHubAccessError,
  type GitHubAccessFailureKind,
  type GitHubAccessErrorContext,
} from "./github-errors.js";

export {
  GITHUB_FIXTURE_ROOT,
  LIST_MERGED_PRS_FIXTURE_DIR,
  PULL_REVIEW_COMMENTS_FIXTURE_DIR,
  CONTENTS_FIXTURE_DIR,
  createFixtureFetch,
  rateLimitForbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
  type FixtureFetchOptions,
} from "./fixture-fetch.js";

export {
  rawPullRequestPath,
  rawReviewCommentPath,
  rawBlobPath,
  writeRawPullRequest,
  writeRawReviewComment,
  writeRawBlob,
  type WriteRawResult,
} from "./raw-store.js";

export {
  ingestPullRequest,
  type IngestPullRequestOptions,
  type IngestPullRequestResult,
} from "./ingest-pr.js";

export {
  computeIngestWatermark,
  ingestRepository,
  sortPullRequestsOldestFirst,
  type IngestPrProgress,
  type IngestRepositoryOptions,
  type IngestRepositoryResult,
} from "./ingest-repo.js";
