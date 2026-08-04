/**
 * In-memory recipe index with repo scoping (Phase 4.1).
 */

import {
  loadRewriteRecipes,
  readRecipeIndex,
  readSuppressions,
  type RecipeIndex,
} from "@graft/compile";
import { graftNoDataError, type RewriteRecipe } from "@graft/shared";

export type RecipeIndexLoaderOptions = {
  dataDir: string;
  owner: string;
  name: string;
  /** When true, include suppressed recipes (default false). */
  includeSuppressed?: boolean;
};

export type LoadedRecipeIndex = {
  repo: string;
  index: RecipeIndex | null;
  recipes: RewriteRecipe[];
  loadedAt: number;
};

/**
 * Load recipes into memory for one repo. Filters suppressed by default.
 * Enforces repo scope via repo-scoped paths (SAF-1).
 */
export async function loadRecipeIndex(
  options: RecipeIndexLoaderOptions,
): Promise<LoadedRecipeIndex> {
  const repo = `${options.owner}/${options.name}`;
  const index = await readRecipeIndex(
    options.dataDir,
    options.owner,
    options.name,
  );

  if (index === null) {
    throw graftNoDataError(repo);
  }

  const all = await loadRewriteRecipes(
    options.dataDir,
    options.owner,
    options.name,
  );

  const suppressed = await readSuppressions(
    options.dataDir,
    options.owner,
    options.name,
  );

  const includeSuppressed = options.includeSuppressed === true;
  const recipes = includeSuppressed
    ? all
    : all.filter((r) => !r.suppressed && !suppressed.has(r.id));

  return {
    repo,
    index,
    recipes,
    loadedAt: Date.now(),
  };
}
