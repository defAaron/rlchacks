export const PKG = "@graft/shared" as const;

export {
  GraftErrorCodes,
  GRAFT_ERROR_CODES,
  CLI_EXIT,
  GraftError,
  graftNoDataError,
  GraftArtifactParseError,
  type GraftErrorCode,
  type CliExitCode,
  type GraftArtifactIssue,
} from "./errors.js";

export { parseArtifact } from "./parse.js";

export {
  DEFAULT_DATA_DIR,
  getDataDir,
  parseRepoSlug,
  repoDataRoot,
  repoScopedPath,
  repoScopedPathFromSlug,
  type RepoRef,
} from "./paths.js";

export {
  DEFAULT_MIN_SUPPORT,
  DEFAULT_LLM_ENABLED,
  loadGraftEnv,
  defaultRepoConfig,
  repoConfigPath,
  readRepoConfig,
  writeRepoConfig,
  resolveGraftConfig,
  toPrintableResolvedConfig,
  type GraftEnv,
  type ResolveGraftConfigOptions,
  type ResolvedGraftConfig,
} from "./config.js";

export {
  LinkConfidenceSchema,
  SuggestionConfidenceSchema,
  RawPullRequestSchema,
  RawReviewCommentSchema,
  CodeSpanSchema,
  ReviewEpisodeSchema,
  RecipeScopeSchema,
  RewriteRecipeSchema,
  MatchRangeSchema,
  SuggestionEvidenceSchema,
  GraftSuggestionSchema,
  IngestCursorSchema,
  LinkCursorSchema,
  CompileCursorSchema,
  CursorsSchema,
  RepoConfigSchema,
  type LinkConfidence,
  type SuggestionConfidence,
  type RawPullRequest,
  type RawReviewComment,
  type CodeSpan,
  type ReviewEpisode,
  type RecipeScope,
  type RewriteRecipe,
  type MatchRange,
  type SuggestionEvidence,
  type GraftSuggestion,
  type IngestCursor,
  type LinkCursor,
  type CompileCursor,
  type Cursors,
  type RepoConfig,
} from "./schemas.js";
