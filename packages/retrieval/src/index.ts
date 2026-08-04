export const PKG = "@graft/retrieval" as const;

export {
  loadRecipeIndex,
  type RecipeIndexLoaderOptions,
  type LoadedRecipeIndex,
} from "./recipe-loader.js";

export {
  listRecipes,
  DEFAULT_LIST_LIMIT,
  MAX_CODE_LINES,
  MAX_PAYLOAD_BYTES,
  type ListRecipesOptions,
  type RecipeCard,
  type ListRecipesResult,
} from "./list-recipes.js";

export {
  parseUnifiedDiff,
  hunkSnippet,
  graftInvalidDiffError,
  type DiffHunk,
  type ParsedDiff,
} from "./diff-parser.js";

export {
  matchDiffToRecipes,
  candidatesToSuggestions,
  hasEvidence,
  type MatchContext,
  type MatchCandidate,
} from "./match.js";

export { buildPatchForMatch, type PatchResult } from "./patch.js";

export { suggestGrafts, type SuggestGraftsOptions, type SuggestGraftsResult } from "./suggest.js";

export {
  explainRecipe,
  graftNotFoundError,
  type RecipeEvidence,
  type ExplainRecipeResult,
} from "./explain.js";

export {
  getFreshnessSummary,
  formatStaleBanner,
  type FreshnessSummary,
} from "./freshness.js";
