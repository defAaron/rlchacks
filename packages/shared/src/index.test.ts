import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLI_EXIT,
  CodeSpanSchema,
  CursorsSchema,
  DEFAULT_DATA_DIR,
  GRAFT_ERROR_CODES,
  GraftArtifactParseError,
  GraftError,
  GraftErrorCodes,
  GraftSuggestionSchema,
  PKG,
  RawPullRequestSchema,
  RawReviewCommentSchema,
  RepoConfigSchema,
  ReviewEpisodeSchema,
  RewriteRecipeSchema,
  getDataDir,
  graftNoDataError,
  parseArtifact,
  parseRepoSlug,
  repoDataRoot,
  repoScopedPath,
  repoScopedPathFromSlug,
} from "./index.js";

const validRawPullRequest = {
  id: "PR_kwDOAbc123",
  number: 42,
  mergedAt: "2024-06-15T12:34:56Z",
  mergeCommitSha: "abc123def4567890abc123def4567890abc123de",
  baseRef: "main",
  headRef: "fix/timeouts",
  title: "Fix flaky timeouts",
  url: "https://github.com/acme/widgets/pull/42",
};

const validRawReviewComment = {
  id: "RC_kwDOComment1",
  prNumber: 42,
  path: "src/api/client.ts",
  body: "Please use the shared retry helper instead of a bare setTimeout.",
  author: "reviewer-alice",
  createdAt: "2024-06-14T09:00:00Z",
  diffHunk:
    "@@ -10,6 +10,8 @@ export function fetchThing() {\n+  setTimeout(() => {}, 1000);\n",
  line: 12,
  originalLine: 12,
  side: "RIGHT",
  commitId: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  htmlUrl: "https://github.com/acme/widgets/pull/42#discussion_r1001",
};

const validCodeSpan = {
  path: "src/api/client.ts",
  startLine: 12,
  endLine: 12,
  sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  text: "setTimeout(() => {}, 1000);",
  normalized: "setTimeout(()=>{},N);",
};

const validReviewEpisode = {
  id: "ep_abc123",
  repo: "acme/widgets",
  prNumber: 42,
  commentId: "RC_kwDOComment1",
  path: "src/api/client.ts",
  language: "typescript",
  commentBody: "Please use the shared retry helper.",
  rejected: validCodeSpan,
  accepted: {
    ...validCodeSpan,
    startLine: 12,
    endLine: 14,
    sha: "abc123def4567890abc123def4567890abc123de",
    text: "await withRetry(() => fetchThing());",
    normalized: "await withRetry(()=>fetchThing());",
  },
  linkConfidence: "high" as const,
  linkReason: "suggestion_block_applied",
  actionable: true,
  discardReason: null,
  reviewer: "reviewer-alice",
  mergedAt: "2024-06-15T12:34:56Z",
};

const validRewriteRecipe = {
  id: "recipe_retry_helper",
  repo: "acme/widgets",
  title: "Prefer shared retry helper over bare setTimeout",
  rationale: "Reviewers reject ad-hoc timeouts in favor of withRetry.",
  scope: { pathPrefixes: ["src/api"], languages: ["typescript"] },
  before: "setTimeout(() => {}, 1000);",
  after: "await withRetry(() => fetchThing());",
  beforeSignals: ["setTimeout", "1000"],
  support: 3,
  episodeIds: ["ep_abc123", "ep_def456", "ep_ghi789"],
  reviewers: ["reviewer-alice", "reviewer-bob"],
  avgLinkConfidence: 0.9,
  suppressed: false,
  createdAt: "2024-06-16T00:00:00Z",
  updatedAt: "2024-06-16T00:00:00Z",
  compileRunId: "compile_run_1",
};

const validGraftSuggestion = {
  recipeId: "recipe_retry_helper",
  rank: 1,
  score: 0.87,
  matchPath: "src/api/client.ts",
  matchRange: { startLine: 20, endLine: 22 },
  patch: "--- a/src/api/client.ts\n+++ b/src/api/client.ts\n",
  title: "Prefer shared retry helper over bare setTimeout",
  rationale: "Reviewers reject ad-hoc timeouts in favor of withRetry.",
  support: 3,
  confidence: "high" as const,
  evidence: [
    {
      prNumber: 42,
      commentUrl: "https://github.com/acme/widgets/pull/42#discussion_r1001",
      episodeId: "ep_abc123",
    },
  ],
};

const validCursors = {
  ingest: { lastMergedAt: "2024-06-15T12:34:56Z", lastPrNumber: 42 },
  link: { updatedAt: "2024-06-15T13:00:00Z" },
  compile: {
    updatedAt: "2024-06-16T00:00:00Z",
    compileRunId: "compile_run_1",
  },
};

describe("@graft/shared", () => {
  it("exports package identity", () => {
    expect(PKG).toBe("@graft/shared");
  });
});

describe("error codes", () => {
  it("exports the TRD §8.3 set", () => {
    expect(GRAFT_ERROR_CODES).toEqual([
      "GRAFT_NO_DATA",
      "GRAFT_STALE",
      "GRAFT_NOT_FOUND",
      "GRAFT_INVALID_DIFF",
      "GRAFT_BUDGET",
    ]);
    expect(GraftErrorCodes.GRAFT_NO_DATA).toBe("GRAFT_NO_DATA");
  });

  it("constructs typed GraftError", () => {
    const err = new GraftError(
      GraftErrorCodes.GRAFT_NO_DATA,
      "Repo not ingested",
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GraftError);
    expect(err.code).toBe("GRAFT_NO_DATA");
  });

  it("graftNoDataError is ready for later stages (exit 2)", () => {
    const err = graftNoDataError("acme/widgets");
    expect(err.code).toBe(GraftErrorCodes.GRAFT_NO_DATA);
    expect(err.message).toMatch(/GRAFT_NO_DATA/);
    expect(err.message).toMatch(/graft ingest/);
    expect(CLI_EXIT.NO_DATA).toBe(2);
    expect(CLI_EXIT.GITHUB).toBe(3);
  });
});

describe("schemas — valid fixtures", () => {
  it("parses RawPullRequest", () => {
    expect(parseArtifact(RawPullRequestSchema, validRawPullRequest, "RawPullRequest"))
      .toEqual(validRawPullRequest);
  });

  it("parses RawReviewComment", () => {
    expect(
      parseArtifact(
        RawReviewCommentSchema,
        validRawReviewComment,
        "RawReviewComment",
      ),
    ).toEqual(validRawReviewComment);
  });

  it("parses CodeSpan", () => {
    expect(parseArtifact(CodeSpanSchema, validCodeSpan, "CodeSpan")).toEqual(
      validCodeSpan,
    );
  });

  it("parses ReviewEpisode", () => {
    expect(
      parseArtifact(ReviewEpisodeSchema, validReviewEpisode, "ReviewEpisode"),
    ).toEqual(validReviewEpisode);
  });

  it("parses RewriteRecipe", () => {
    expect(
      parseArtifact(RewriteRecipeSchema, validRewriteRecipe, "RewriteRecipe"),
    ).toEqual(validRewriteRecipe);
  });

  it("parses GraftSuggestion", () => {
    expect(
      parseArtifact(
        GraftSuggestionSchema,
        validGraftSuggestion,
        "GraftSuggestion",
      ),
    ).toEqual(validGraftSuggestion);
  });

  it("parses Cursors", () => {
    expect(parseArtifact(CursorsSchema, validCursors, "Cursors")).toEqual(
      validCursors,
    );
  });

  it("parses RepoConfig with TRD defaults", () => {
    const parsed = parseArtifact(
      RepoConfigSchema,
      { owner: "acme", name: "widgets" },
      "RepoConfig",
    );
    expect(parsed.defaultBranch).toBe("main");
    expect(parsed.backfill.maxPrs).toBe(200);
    expect(parsed.backfill.since).toBeNull();
    expect(parsed.compile.minSupport).toBe(2);
    expect(parsed.compile.allowSingleHighConfidence).toBe(false);
    expect(parsed.paths.exclude).toContain("**/vendor/**");
  });
});

describe("schemas — invalid fixtures throw typed errors", () => {
  it("rejects RawPullRequest missing mergedAt", () => {
    const { mergedAt: _omit, ...bad } = validRawPullRequest;
    void _omit;
    expect(() =>
      parseArtifact(RawPullRequestSchema, bad, "RawPullRequest"),
    ).toThrow(GraftArtifactParseError);
  });

  it("rejects RawPullRequest with non-ISO mergedAt", () => {
    expect(() =>
      parseArtifact(
        RawPullRequestSchema,
        { ...validRawPullRequest, mergedAt: "yesterday" },
        "RawPullRequest",
      ),
    ).toThrow(GraftArtifactParseError);
  });

  it("rejects RawReviewComment with bad url", () => {
    expect(() =>
      parseArtifact(
        RawReviewCommentSchema,
        { ...validRawReviewComment, htmlUrl: "not-a-url" },
        "RawReviewComment",
      ),
    ).toThrow(GraftArtifactParseError);
  });

  it("rejects CodeSpan with non-positive startLine", () => {
    expect(() =>
      parseArtifact(
        CodeSpanSchema,
        { ...validCodeSpan, startLine: 0 },
        "CodeSpan",
      ),
    ).toThrow(GraftArtifactParseError);
  });

  it("rejects ReviewEpisode with inverted rejected lines", () => {
    expect(() =>
      parseArtifact(
        ReviewEpisodeSchema,
        {
          ...validReviewEpisode,
          rejected: { ...validCodeSpan, startLine: 10, endLine: 5 },
        },
        "ReviewEpisode",
      ),
    ).toThrow(GraftArtifactParseError);
  });

  it("rejects ReviewEpisode with invalid linkConfidence", () => {
    expect(() =>
      parseArtifact(
        ReviewEpisodeSchema,
        { ...validReviewEpisode, linkConfidence: "maybe" },
        "ReviewEpisode",
      ),
    ).toThrow(GraftArtifactParseError);
  });

  it("rejects RewriteRecipe with avgLinkConfidence out of range", () => {
    expect(() =>
      parseArtifact(
        RewriteRecipeSchema,
        { ...validRewriteRecipe, avgLinkConfidence: 1.5 },
        "RewriteRecipe",
      ),
    ).toThrow(GraftArtifactParseError);
  });

  it("rejects GraftSuggestion missing evidence pointers shape", () => {
    expect(() =>
      parseArtifact(
        GraftSuggestionSchema,
        {
          ...validGraftSuggestion,
          evidence: [{ prNumber: 1, episodeId: "ep_x" }],
        },
        "GraftSuggestion",
      ),
    ).toThrow(GraftArtifactParseError);
  });

  it("rejects Cursors missing ingest watermark", () => {
    expect(() =>
      parseArtifact(
        CursorsSchema,
        { link: validCursors.link, compile: validCursors.compile },
        "Cursors",
      ),
    ).toThrow(GraftArtifactParseError);
  });

  it("rejects RepoConfig with non-positive minSupport", () => {
    expect(() =>
      parseArtifact(
        RepoConfigSchema,
        {
          owner: "acme",
          name: "widgets",
          compile: { minSupport: 0, allowSingleHighConfidence: false },
        },
        "RepoConfig",
      ),
    ).toThrow(GraftArtifactParseError);
  });

  it("GraftArtifactParseError carries structured issues", () => {
    try {
      parseArtifact(
        RawPullRequestSchema,
        { ...validRawPullRequest, number: "forty-two" },
        "RawPullRequest",
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GraftArtifactParseError);
      const typed = err as GraftArtifactParseError;
      expect(typed.artifact).toBe("RawPullRequest");
      expect(typed.issues.length).toBeGreaterThan(0);
      expect(typed.issues[0]?.path).toContain("number");
    }
  });
});

describe("DATA_DIR path helpers", () => {
  it("defaults DATA_DIR to ./data", () => {
    expect(getDataDir({})).toBe(DEFAULT_DATA_DIR);
    expect(DEFAULT_DATA_DIR).toBe("./data");
  });

  it("reads DATA_DIR from env map", () => {
    expect(getDataDir({ DATA_DIR: "/tmp/graft-data" })).toBe("/tmp/graft-data");
  });

  it("builds repo-scoped roots as data/repos/<owner>/<name>", () => {
    expect(repoDataRoot("./data", "acme", "widgets")).toBe(
      path.join("./data", "repos", "acme", "widgets"),
    );
    expect(
      repoScopedPath("./data", "acme", "widgets", "raw", "prs", "42.json"),
    ).toBe(
      path.resolve("./data", "repos", "acme", "widgets", "raw", "prs", "42.json"),
    );
  });

  it("parses owner/name slugs", () => {
    expect(parseRepoSlug("acme/widgets")).toEqual({
      owner: "acme",
      name: "widgets",
    });
    expect(
      repoScopedPathFromSlug("./data", "acme/widgets", "config.json"),
    ).toBe(path.resolve("./data", "repos", "acme", "widgets", "config.json"));
  });

  it("rejects cross-repo / traversal segments", () => {
    expect(() => parseRepoSlug("acme/widgets/extra")).toThrow(/owner\/name/);
    expect(() => parseRepoSlug("../etc/passwd")).toThrow();
    expect(() => parseRepoSlug("acme/..")).toThrow(/Invalid repo/);
    expect(() => parseRepoSlug("acme/foo/../bar")).toThrow(/owner\/name/);
    expect(() => repoScopedPath("./data", "acme", "widgets", "..", "other")).toThrow(
      /Illegal path segment|escapes/,
    );
    expect(() =>
      repoScopedPath("./data", "acme", "widgets", "raw", "../other-repo", "x"),
    ).toThrow(/Illegal path segment|escapes/);
    expect(() =>
      repoScopedPath("./data", "acme", "..", "config.json"),
    ).toThrow(/Invalid repo/);
    expect(() =>
      repoScopedPath("./data", "acme", "widgets", "/etc/passwd"),
    ).toThrow(/Absolute path segment/);
    expect(() =>
      repoScopedPathFromSlug("./data", "../acme/widgets", "raw"),
    ).toThrow(/Invalid repo|owner\/name/);
  });
});
