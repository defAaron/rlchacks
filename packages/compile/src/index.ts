export const PKG = "@graft/compile" as const;

export {
  normalizeForClustering,
  stableNormalizeHash,
  clusterPairKey,
  type NormalizeOptions,
} from "./normalize.js";

export {
  tokenizeNormalized,
  jaccardSimilarity,
  lengthRatio,
  pairSimilarity,
  type EpisodePairLike,
} from "./similarity.js";

export {
  DEFAULT_CLUSTER_THRESHOLD,
  pathBucketKey,
  bucketKey,
  toCompileEpisode,
  deriveBeforeSignals,
  buildCluster,
  clusterEpisodes,
  clusterAllEpisodes,
  clusterScope,
  type CompileEpisode,
  type EpisodeCluster,
  type ClusterOptions,
} from "./cluster.js";

export { deriveTitleAndRationale, type TitleInput, type TitleResult } from "./titles.js";

export { stableRecipeId, newCompileRunId } from "./recipe-id.js";

export {
  episodesDir,
  readEpisodeIndex,
  loadReviewEpisodes,
  loadEpisodesByIds,
  type EpisodeIndex,
} from "./episode-loader.js";

export {
  recipesDir,
  recipePath,
  recipeIndexPath,
  compileMetaPath,
  suppressionsPath,
  readSuppressions,
  readSuppressionsFile,
  writeSuppressions,
  setRecipeSuppressed,
  writeRewriteRecipe,
  writeRecipeIndex,
  writeCompileMeta,
  clearRecipeArtifacts,
  toRecipeIndexEntry,
  readRecipeIndex,
  loadRewriteRecipes,
  loadRewriteRecipeById,
  type RecipeIndexEntry,
  type RecipeIndex,
  type CompileMeta,
  type SuppressionsFile,
} from "./recipe-store.js";

export {
  compileRepository,
  type CompileRepositoryOptions,
  type CompileRepositoryResult,
} from "./compile-repository.js";
