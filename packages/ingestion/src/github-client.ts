import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";
import {
  loadGraftEnv,
  parseArtifact,
  RawPullRequestSchema,
  RawReviewCommentSchema,
  type RawPullRequest,
  type RawReviewComment,
} from "@graft/shared";
import {
  rateLimitExhaustedError,
  missingGitHubTokenError,
  toGitHubAccessError,
} from "./github-errors.js";

/** Default page size for `GET /repos/{owner}/{repo}/pulls`. */
export const GITHUB_PULLS_PER_PAGE = 100;

/** Default page size for pull review comment lists. */
export const GITHUB_REVIEW_COMMENTS_PER_PAGE = 100;

/** Default retries after a rate-limit / transient GitHub failure (ING-6). */
export const DEFAULT_RATE_LIMIT_MAX_RETRIES = 5;

export type SleepFn = (ms: number) => Promise<void>;

export type GitHubFetch = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type GitHubClientOptions = {
  /** GitHub PAT / fine-grained token (`GITHUB_TOKEN`). */
  token: string;
  /**
   * Custom `fetch` for recorded fixtures / tests.
   * Live CI must not hit the network — inject fixture-backed fetch instead.
   */
  fetch?: GitHubFetch;
  /** Injectable delay (tests use a no-op / spy). */
  sleep?: SleepFn;
  /** Max backoff attempts after a rate-limit or 502 response. */
  maxRetries?: number;
  /**
   * Base delay for exponential backoff when `Retry-After` is absent.
   * Actual delay is `baseMs * 2 ** attempt`.
   */
  backoffBaseMs?: number;
  /** Override pulls page size (default 100). Smaller values help fixture tests. */
  pullsPerPage?: number;
};

export type ListMergedPullRequestsOptions = {
  owner: string;
  repo: string;
  /** Cap on merged PRs returned (newest-updated closed list order). */
  maxPrs?: number;
  /**
   * When set, keep only PRs with `mergedAt` strictly after this ISO timestamp.
   * Used later for incremental ingest (ING-4); safe to pass from step 1.1.
   */
  since?: string | null;
};

export type ListPullReviewCommentsOptions = {
  owner: string;
  repo: string;
  pullNumber: number;
};

export type FetchBlobAtRefOptions = {
  owner: string;
  repo: string;
  /** Repo-relative file path (e.g. `src/retry.ts`). */
  path: string;
  /** Commit SHA / ref to read (merge commit for ingest). */
  ref: string;
};

/** File contents at a commit, keyed later by git blob `sha` (ING-3). */
export type FetchedBlob = {
  sha: string;
  path: string;
  text: string;
};

export type GitHubClient = {
  readonly token: string;
  listMergedPullRequests(
    options: ListMergedPullRequestsOptions,
  ): Promise<RawPullRequest[]>;
  /** Inline review comments for one PR (ING-2). */
  listPullReviewComments(
    options: ListPullReviewCommentsOptions,
  ): Promise<RawReviewComment[]>;
  /**
   * Fetch a single file blob at `ref`. Returns `null` when the path is missing
   * (404) at that commit.
   */
  fetchBlobAtRef(options: FetchBlobAtRefOptions): Promise<FetchedBlob | null>;
};

type ListedPull = {
  id: number;
  node_id?: string;
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  merge_commit_sha: string | null;
  draft?: boolean;
  base: { ref: string };
  head: { ref: string };
};

type ListedReviewComment = {
  id: number;
  node_id?: string;
  body: string;
  path: string;
  diff_hunk?: string | null;
  line?: number | null;
  original_line?: number | null;
  side?: string | number | null;
  commit_id?: string | null;
  html_url: string;
  user: { login: string } | null;
  created_at: string;
};

const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Create an Octokit-backed GitHub client authenticated with `token`.
 * Retries with backoff on rate limits and 502 (ING-6).
 */
export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const token = options.token.trim();
  if (token === "") {
    throw new Error("GitHub token must be a non-empty string");
  }

  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? DEFAULT_RATE_LIMIT_MAX_RETRIES;
  const backoffBaseMs = options.backoffBaseMs ?? 1000;
  const pullsPerPage = options.pullsPerPage ?? GITHUB_PULLS_PER_PAGE;
  if (!Number.isInteger(pullsPerPage) || pullsPerPage < 1) {
    throw new Error(
      `pullsPerPage must be a positive integer; got ${pullsPerPage}`,
    );
  }

  const octokit = new Octokit({
    auth: token,
    ...(options.fetch !== undefined
      ? { request: { fetch: options.fetch } }
      : {}),
  });

  async function withBackoff<T>(
    operation: () => Promise<T>,
    context: { owner: string; repo: string },
    options: { passthroughNotFound?: boolean } = {},
  ): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await operation();
      } catch (err) {
        if (isRetryableGitHubError(err) && attempt < maxRetries) {
          const delayMs = retryDelayMs(err, attempt, backoffBaseMs);
          await sleep(delayMs);
          attempt += 1;
          continue;
        }
        if (isRetryableGitHubError(err)) {
          throw rateLimitExhaustedError(context, err);
        }
        if (
          options.passthroughNotFound === true &&
          err instanceof RequestError &&
          err.status === 404
        ) {
          throw err;
        }
        throw toGitHubAccessError(err, context);
      }
    }
  }

  return {
    token,
    async listMergedPullRequests(
      listOptions: ListMergedPullRequestsOptions,
    ): Promise<RawPullRequest[]> {
      const maxPrs = listOptions.maxPrs ?? 200;
      if (!Number.isInteger(maxPrs) || maxPrs < 1) {
        throw new Error(`maxPrs must be a positive integer; got ${maxPrs}`);
      }

      const since = listOptions.since ?? null;
      const merged: RawPullRequest[] = [];
      let page = 1;
      const context = { owner: listOptions.owner, repo: listOptions.repo };

      while (merged.length < maxPrs) {
        const { data } = await withBackoff(
          () =>
            octokit.rest.pulls.list({
              owner: listOptions.owner,
              repo: listOptions.repo,
              state: "closed",
              sort: "updated",
              direction: "desc",
              per_page: pullsPerPage,
              page,
            }),
          context,
        );

        const pulls = data as ListedPull[];
        if (pulls.length === 0) {
          break;
        }

        for (const pr of pulls) {
          const mapped = toRawPullRequest(pr, since);
          if (mapped === undefined) {
            continue;
          }
          merged.push(mapped);
          if (merged.length >= maxPrs) {
            break;
          }
        }

        if (pulls.length < pullsPerPage) {
          break;
        }
        page += 1;
      }

      return merged;
    },

    async listPullReviewComments(
      listOptions: ListPullReviewCommentsOptions,
    ): Promise<RawReviewComment[]> {
      const pullNumber = listOptions.pullNumber;
      if (!Number.isInteger(pullNumber) || pullNumber < 1) {
        throw new Error(
          `pullNumber must be a positive integer; got ${pullNumber}`,
        );
      }

      const comments: RawReviewComment[] = [];
      let page = 1;
      const context = { owner: listOptions.owner, repo: listOptions.repo };

      for (;;) {
        const { data } = await withBackoff(
          () =>
            octokit.rest.pulls.listReviewComments({
              owner: listOptions.owner,
              repo: listOptions.repo,
              pull_number: pullNumber,
              per_page: GITHUB_REVIEW_COMMENTS_PER_PAGE,
              page,
            }),
          context,
        );

        const batch = data as ListedReviewComment[];
        if (batch.length === 0) {
          break;
        }

        for (const comment of batch) {
          comments.push(toRawReviewComment(comment, pullNumber));
        }

        if (batch.length < GITHUB_REVIEW_COMMENTS_PER_PAGE) {
          break;
        }
        page += 1;
      }

      return comments;
    },

    async fetchBlobAtRef(
      blobOptions: FetchBlobAtRefOptions,
    ): Promise<FetchedBlob | null> {
      const filePath = blobOptions.path.trim();
      if (filePath === "") {
        throw new Error("path must be a non-empty string");
      }
      const ref = blobOptions.ref.trim();
      if (ref === "") {
        throw new Error("ref must be a non-empty string");
      }

      const context = { owner: blobOptions.owner, repo: blobOptions.repo };

      try {
        const { data } = await withBackoff(
          () =>
            octokit.rest.repos.getContent({
              owner: blobOptions.owner,
              repo: blobOptions.repo,
              path: filePath,
              ref,
            }),
          context,
          { passthroughNotFound: true },
        );

        if (Array.isArray(data)) {
          throw new Error(
            `Expected file at ${filePath}@${ref}, got a directory listing`,
          );
        }
        if (data.type !== "file") {
          throw new Error(
            `Expected file at ${filePath}@${ref}, got type "${data.type}"`,
          );
        }
        if (data.encoding !== "base64" || typeof data.content !== "string") {
          throw new Error(
            `GitHub contents response for ${filePath}@${ref} missing base64 content`,
          );
        }

        const text = Buffer.from(
          data.content.replace(/\n/g, ""),
          "base64",
        ).toString("utf8");

        return {
          sha: data.sha,
          path: data.path,
          text,
        };
      } catch (err) {
        if (err instanceof RequestError && err.status === 404) {
          return null;
        }
        throw err;
      }
    },
  };
}

/**
 * Build a client from `GITHUB_TOKEN` in the environment (via `@graft/shared`).
 */
export function createGitHubClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: Omit<GitHubClientOptions, "token"> = {},
): GitHubClient {
  const { githubToken } = loadGraftEnv(env);
  if (githubToken === undefined) {
    throw missingGitHubTokenError();
  }
  return createGitHubClient({ ...options, token: githubToken });
}

/** Map a GitHub pull list item to `RawPullRequest`, or skip if unmerged/draft/too old. */
export function toRawPullRequest(
  pr: ListedPull,
  since: string | null = null,
): RawPullRequest | undefined {
  if (pr.draft === true) {
    return undefined;
  }
  if (pr.merged_at === null || pr.merge_commit_sha === null) {
    return undefined;
  }
  if (since !== null && pr.merged_at <= since) {
    return undefined;
  }

  return parseArtifact(
    RawPullRequestSchema,
    {
      id: pr.node_id !== undefined && pr.node_id !== "" ? pr.node_id : String(pr.id),
      number: pr.number,
      mergedAt: pr.merged_at,
      mergeCommitSha: pr.merge_commit_sha,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      title: pr.title,
      url: pr.html_url,
    },
    "RawPullRequest",
  );
}

/** Map a GitHub pull review comment to `RawReviewComment` (ING-2). */
export function toRawReviewComment(
  comment: ListedReviewComment,
  prNumber: number,
): RawReviewComment {
  const author =
    comment.user !== null && comment.user.login.trim() !== ""
      ? comment.user.login
      : "ghost";

  return parseArtifact(
    RawReviewCommentSchema,
    {
      id:
        comment.node_id !== undefined && comment.node_id !== ""
          ? comment.node_id
          : String(comment.id),
      prNumber,
      path: comment.path,
      body: comment.body,
      author,
      createdAt: comment.created_at,
      diffHunk: comment.diff_hunk ?? null,
      line: comment.line ?? null,
      originalLine: comment.original_line ?? null,
      side: comment.side ?? null,
      commitId: comment.commit_id ?? null,
      htmlUrl: comment.html_url,
    },
    "RawReviewComment",
  );
}

export function isRetryableGitHubError(err: unknown): boolean {
  if (!(err instanceof RequestError)) {
    return false;
  }
  if (err.status === 502 || err.status === 503 || err.status === 429) {
    return true;
  }
  if (err.status === 403) {
    return isRateLimitForbidden(err);
  }
  return false;
}

function isRateLimitForbidden(err: RequestError): boolean {
  const remaining = headerValue(err, "x-ratelimit-remaining");
  if (remaining === "0") {
    return true;
  }
  if (headerValue(err, "retry-after") !== undefined) {
    return true;
  }
  const msg = err.message.toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("secondary rate limit") ||
    msg.includes("abuse detection")
  );
}

function retryDelayMs(
  err: unknown,
  attempt: number,
  backoffBaseMs: number,
): number {
  if (err instanceof RequestError) {
    const retryAfter = headerValue(err, "retry-after");
    if (retryAfter !== undefined) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.ceil(seconds * 1000);
      }
    }
    const reset = headerValue(err, "x-ratelimit-reset");
    if (reset !== undefined) {
      const resetEpoch = Number(reset);
      if (Number.isFinite(resetEpoch)) {
        const untilResetMs = resetEpoch * 1000 - Date.now();
        if (untilResetMs > 0) {
          return untilResetMs;
        }
      }
    }
  }
  return backoffBaseMs * 2 ** attempt;
}

function headerValue(err: RequestError, name: string): string | undefined {
  const headers = err.response?.headers;
  if (headers === undefined) {
    return undefined;
  }
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  return Array.isArray(raw) ? raw[0] : String(raw);
}
