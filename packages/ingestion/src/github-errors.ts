import { RequestError } from "@octokit/request-error";

/**
 * GitHub / auth failures for ingest (TRD §9 exit code 3).
 * CLI maps these to process exit 3 with the message as primary UX (no stack).
 */
export type GitHubAccessFailureKind =
  | "missing_token"
  | "auth_failed"
  | "repo_not_found"
  | "rate_limit_exhausted"
  | "github_error";

export type GitHubAccessErrorContext = {
  owner?: string;
  repo?: string;
};

export class GitHubAccessError extends Error {
  readonly kind: GitHubAccessFailureKind;
  readonly status: number | undefined;
  /** TRD §9 — GitHub/auth failure. */
  readonly exitCode = 3 as const;

  constructor(
    kind: GitHubAccessFailureKind,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "GitHubAccessError";
    this.kind = kind;
    this.status = options.status;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function missingGitHubTokenError(): GitHubAccessError {
  return new GitHubAccessError(
    "missing_token",
    [
      "GITHUB_TOKEN is not set.",
      "Export a GitHub personal access token with read access to the target repo, then retry:",
      "  export GITHUB_TOKEN=ghp_your_token_here",
      "  graft ingest <owner/repo>",
    ].join("\n"),
  );
}

function repoSlug(context: GitHubAccessErrorContext): string {
  if (context.owner !== undefined && context.repo !== undefined) {
    return `${context.owner}/${context.repo}`;
  }
  return "the target repository";
}

export function rateLimitExhaustedError(
  context: GitHubAccessErrorContext,
  cause?: unknown,
): GitHubAccessError {
  const slug = repoSlug(context);
  const ingestTarget =
    context.owner !== undefined && context.repo !== undefined
      ? slug
      : "<owner/repo>";
  const options: { status?: number; cause?: unknown } = {};
  if (cause !== undefined) {
    options.cause = cause;
  }
  if (cause instanceof RequestError && typeof cause.status === "number") {
    options.status = cause.status;
  }

  return new GitHubAccessError(
    "rate_limit_exhausted",
    [
      `GitHub API rate limit (or transient error) exhausted while accessing ${slug}.`,
      "Wait for the rate-limit reset window, then retry:",
      `  graft ingest ${ingestTarget}`,
      "A higher-quota authenticated token usually raises the limit.",
    ].join("\n"),
    options,
  );
}

/**
 * Map Octokit / network failures into actionable `GitHubAccessError`s.
 * Pass-through if already a `GitHubAccessError`.
 */
export function toGitHubAccessError(
  err: unknown,
  context: GitHubAccessErrorContext = {},
): GitHubAccessError {
  if (err instanceof GitHubAccessError) {
    return err;
  }

  const slug = repoSlug(context);

  if (err instanceof RequestError) {
    if (err.status === 401) {
      return new GitHubAccessError(
        "auth_failed",
        [
          `GitHub rejected GITHUB_TOKEN (HTTP 401) while accessing ${slug}.`,
          "Check that the token is valid, not expired, and has not been revoked.",
          "Then: export GITHUB_TOKEN=... && graft ingest <owner/repo>",
        ].join("\n"),
        { status: 401, cause: err },
      );
    }

    if (err.status === 404) {
      return new GitHubAccessError(
        "repo_not_found",
        [
          `Repository ${slug} was not found (HTTP 404).`,
          "Confirm the owner/repo slug spelling.",
          "If the repo is private, ensure GITHUB_TOKEN can access it (scopes / org SSO).",
        ].join("\n"),
        { status: 404, cause: err },
      );
    }

    if (err.status === 403) {
      return new GitHubAccessError(
        "auth_failed",
        [
          `GitHub denied access to ${slug} (HTTP 403).`,
          "Check token scopes and org SSO authorization, then retry ingest.",
        ].join("\n"),
        { status: 403, cause: err },
      );
    }

    const status = err.status ?? "?";
    return new GitHubAccessError(
      "github_error",
      `GitHub API error (HTTP ${status}) for ${slug}: ${err.message}`,
      { status: err.status, cause: err },
    );
  }

  const message = err instanceof Error ? err.message : String(err);
  return new GitHubAccessError(
    "github_error",
    `GitHub request failed for ${slug}: ${message}`,
    { cause: err },
  );
}
