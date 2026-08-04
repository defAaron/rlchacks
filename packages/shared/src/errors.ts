/** API / tool error codes from TRD §8.3 */
export const GraftErrorCodes = {
  GRAFT_NO_DATA: "GRAFT_NO_DATA",
  GRAFT_STALE: "GRAFT_STALE",
  GRAFT_NOT_FOUND: "GRAFT_NOT_FOUND",
  GRAFT_INVALID_DIFF: "GRAFT_INVALID_DIFF",
  GRAFT_BUDGET: "GRAFT_BUDGET",
} as const;

export type GraftErrorCode =
  (typeof GraftErrorCodes)[keyof typeof GraftErrorCodes];

export const GRAFT_ERROR_CODES = Object.values(GraftErrorCodes);

/**
 * CLI process exit codes (TRD §9).
 * `NO_DATA` is reserved for later serve/suggest stages when a repo has not
 * been ingested — throw {@link graftNoDataError} and map via CLI handler.
 */
export const CLI_EXIT = {
  OK: 0,
  ERROR: 1,
  NO_DATA: 2,
  GITHUB: 3,
} as const;

export type CliExitCode = (typeof CLI_EXIT)[keyof typeof CLI_EXIT];

export class GraftError extends Error {
  readonly code: GraftErrorCode;

  constructor(code: GraftErrorCode, message: string) {
    super(message);
    this.name = "GraftError";
    this.code = code;
  }
}

/**
 * Ready for later stages (serve / suggest / MCP): repo has no Graft artifacts.
 * CLI maps this to exit code {@link CLI_EXIT.NO_DATA} (2).
 */
export function graftNoDataError(repo?: string): GraftError {
  const where = repo !== undefined && repo.trim() !== "" ? ` for ${repo}` : "";
  return new GraftError(
    GraftErrorCodes.GRAFT_NO_DATA,
    [
      `No Graft data${where} (GRAFT_NO_DATA).`,
      "Ingest the repository first:",
      "  graft ingest <owner/repo>",
    ].join("\n"),
  );
}

export type GraftArtifactIssue = {
  path: PropertyKey[];
  message: string;
  code: string;
};

/** Thrown when a persisted artifact fails zod validation. */
export class GraftArtifactParseError extends Error {
  readonly artifact: string;
  readonly issues: GraftArtifactIssue[];

  constructor(artifact: string, issues: GraftArtifactIssue[]) {
    const summary = issues
      .slice(0, 3)
      .map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
      .join("; ");
    super(`Invalid ${artifact}: ${summary}`);
    this.name = "GraftArtifactParseError";
    this.artifact = artifact;
    this.issues = issues;
  }
}
