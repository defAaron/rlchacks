/**
 * Recipe suppression mutations (Phase 6.1 / RCP-7).
 */

import {
  loadRewriteRecipeById,
  setRecipeSuppressed,
} from "@graft/compile";
import type { RewriteRecipe } from "@graft/shared";
import { graftNotFoundError } from "./explain.js";

export type SuppressRecipeResult = {
  recipe: RewriteRecipe;
  suppressed: boolean;
};

/**
 * Toggle suppression for one recipe. Explain-by-id still works after suppress.
 */
export async function suppressRecipe(
  dataDir: string,
  owner: string,
  name: string,
  recipeId: string,
  suppressed: boolean,
  now: () => Date = () => new Date(),
): Promise<SuppressRecipeResult> {
  const recipe = await loadRewriteRecipeById(
    dataDir,
    owner,
    name,
    recipeId,
  );
  if (recipe === null) {
    throw graftNotFoundError(recipeId);
  }

  await setRecipeSuppressed(
    dataDir,
    owner,
    name,
    recipeId,
    suppressed,
    now().toISOString(),
  );

  return {
    recipe: { ...recipe, suppressed },
    suppressed,
  };
}
