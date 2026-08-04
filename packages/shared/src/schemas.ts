import { z } from "zod";

/** ISO-8601 datetime with timezone (GitHub-style `...Z`). */
const IsoDateTime = z.string().datetime();

export const LinkConfidenceSchema = z.enum([
  "high",
  "medium",
  "low",
  "none",
]);
export type LinkConfidence = z.infer<typeof LinkConfidenceSchema>;

export const SuggestionConfidenceSchema = z.enum(["high", "medium", "low"]);
export type SuggestionConfidence = z.infer<typeof SuggestionConfidenceSchema>;

// --- Raw artifacts ---------------------------------------------------------

export const RawPullRequestSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  mergedAt: IsoDateTime,
  mergeCommitSha: z.string().min(1),
  baseRef: z.string().min(1),
  headRef: z.string().min(1),
  title: z.string(),
  url: z.string().url(),
});
export type RawPullRequest = z.infer<typeof RawPullRequestSchema>;

export const RawReviewCommentSchema = z.object({
  id: z.string().min(1),
  prNumber: z.number().int().positive(),
  path: z.string().min(1),
  body: z.string(),
  author: z.string().min(1),
  createdAt: IsoDateTime,
  diffHunk: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  originalLine: z.number().int().positive().nullable(),
  side: z.union([z.string(), z.number()]).nullable(),
  commitId: z.string().nullable(),
  htmlUrl: z.string().url(),
});
export type RawReviewComment = z.infer<typeof RawReviewCommentSchema>;

// --- Linked episodes -------------------------------------------------------

export const CodeSpanSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  sha: z.string().min(1),
  text: z.string(),
  normalized: z.string(),
});
export type CodeSpan = z.infer<typeof CodeSpanSchema>;

export const ReviewEpisodeSchema = z
  .object({
    id: z.string().min(1),
    repo: z.string().min(1),
    prNumber: z.number().int().positive(),
    commentId: z.string().min(1),
    path: z.string().min(1),
    language: z.string().nullable(),
    commentBody: z.string(),
    rejected: CodeSpanSchema,
    accepted: CodeSpanSchema.nullable(),
    linkConfidence: LinkConfidenceSchema,
    linkReason: z.string().min(1),
    actionable: z.boolean(),
    discardReason: z.string().nullable(),
    reviewer: z.string().nullable(),
    mergedAt: IsoDateTime,
  })
  .refine((ep) => ep.rejected.endLine >= ep.rejected.startLine, {
    message: "rejected.endLine must be >= rejected.startLine",
    path: ["rejected", "endLine"],
  })
  .refine(
    (ep) =>
      ep.accepted === null || ep.accepted.endLine >= ep.accepted.startLine,
    {
      message: "accepted.endLine must be >= accepted.startLine",
      path: ["accepted", "endLine"],
    },
  );
export type ReviewEpisode = z.infer<typeof ReviewEpisodeSchema>;

// --- Recipes & suggestions -------------------------------------------------

export const RecipeScopeSchema = z.object({
  pathPrefixes: z.array(z.string()),
  languages: z.array(z.string()),
});
export type RecipeScope = z.infer<typeof RecipeScopeSchema>;

export const RewriteRecipeSchema = z.object({
  id: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1),
  rationale: z.string().min(1),
  scope: RecipeScopeSchema,
  before: z.string(),
  after: z.string(),
  beforeSignals: z.array(z.string()),
  support: z.number().int().nonnegative(),
  episodeIds: z.array(z.string().min(1)),
  reviewers: z.array(z.string()),
  avgLinkConfidence: z.number().min(0).max(1),
  suppressed: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  compileRunId: z.string().min(1),
});
export type RewriteRecipe = z.infer<typeof RewriteRecipeSchema>;

export const MatchRangeSchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});
export type MatchRange = z.infer<typeof MatchRangeSchema>;

export const SuggestionEvidenceSchema = z.object({
  prNumber: z.number().int().positive(),
  commentUrl: z.string().url(),
  episodeId: z.string().min(1),
});
export type SuggestionEvidence = z.infer<typeof SuggestionEvidenceSchema>;

export const GraftSuggestionSchema = z
  .object({
    recipeId: z.string().min(1),
    rank: z.number().int().nonnegative(),
    score: z.number(),
    matchPath: z.string().min(1),
    matchRange: MatchRangeSchema.nullable(),
    patch: z.string(),
    title: z.string().min(1),
    rationale: z.string().min(1),
    support: z.number().int().nonnegative(),
    confidence: SuggestionConfidenceSchema,
    evidence: z.array(SuggestionEvidenceSchema),
  })
  .refine(
    (s) =>
      s.matchRange === null || s.matchRange.endLine >= s.matchRange.startLine,
    {
      message: "matchRange.endLine must be >= startLine",
      path: ["matchRange", "endLine"],
    },
  );
export type GraftSuggestion = z.infer<typeof GraftSuggestionSchema>;

// --- Cursors & config ------------------------------------------------------

export const IngestCursorSchema = z.object({
  lastMergedAt: IsoDateTime.nullable(),
  lastPrNumber: z.number().int().positive().nullable(),
});
export type IngestCursor = z.infer<typeof IngestCursorSchema>;

export const LinkCursorSchema = z.object({
  updatedAt: IsoDateTime.nullable(),
});
export type LinkCursor = z.infer<typeof LinkCursorSchema>;

export const CompileCursorSchema = z.object({
  updatedAt: IsoDateTime.nullable(),
  compileRunId: z.string().nullable(),
});
export type CompileCursor = z.infer<typeof CompileCursorSchema>;

/** `cursors.json` — ingest / link / compile watermarks (TRD §6.2, Step 0.4). */
export const CursorsSchema = z.object({
  ingest: IngestCursorSchema,
  link: LinkCursorSchema,
  compile: CompileCursorSchema,
});
export type Cursors = z.infer<typeof CursorsSchema>;

export const RepoConfigSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  defaultBranch: z.string().min(1).default("main"),
  backfill: z
    .object({
      maxPrs: z.number().int().positive().default(200),
      since: IsoDateTime.nullable().default(null),
    })
    .default({ maxPrs: 200, since: null }),
  compile: z
    .object({
      minSupport: z.number().int().positive().default(2),
      allowSingleHighConfidence: z.boolean().default(false),
    })
    .default({ minSupport: 2, allowSingleHighConfidence: false }),
  paths: z
    .object({
      include: z.array(z.string()).default([]),
      exclude: z
        .array(z.string())
        .default(["**/vendor/**", "**/dist/**"]),
    })
    .default({
      include: [],
      exclude: ["**/vendor/**", "**/dist/**"],
    }),
});
export type RepoConfig = z.infer<typeof RepoConfigSchema>;
