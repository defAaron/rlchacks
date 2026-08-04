/**
 * explainRecipe — full evidence for one recipe (Phase 4 / MCP prep).
 */

import { loadEpisodesByIds, loadRewriteRecipeById } from "@graft/compile";
import {
  GraftError,
  GraftErrorCodes,
  type ReviewEpisode,
  type RewriteRecipe,
} from "@graft/shared";

export type RecipeEvidence = {
  episodeId: string;
  prNumber: number;
  commentUrl: string;
  linkConfidence: string;
  linkReason: string;
  reviewer: string | null;
  path: string;
  commentBody: string;
};

export type ExplainRecipeResult = {
  recipe: RewriteRecipe;
  evidence: RecipeEvidence[];
};

export function graftNotFoundError(id: string): GraftError {
  return new GraftError(
    GraftErrorCodes.GRAFT_NOT_FOUND,
    `Recipe not found: ${id}`,
  );
}

function episodeToEvidence(ep: ReviewEpisode): RecipeEvidence {
  const [owner, name] = ep.repo.split("/");
  return {
    episodeId: ep.id,
    prNumber: ep.prNumber,
    commentUrl: `https://github.com/${owner}/${name}/pull/${ep.prNumber}#discussion_${ep.commentId}`,
    linkConfidence: ep.linkConfidence,
    linkReason: ep.linkReason,
    reviewer: ep.reviewer,
    path: ep.path,
    commentBody: ep.commentBody,
  };
}

export async function explainRecipe(
  dataDir: string,
  owner: string,
  name: string,
  recipeId: string,
): Promise<ExplainRecipeResult> {
  const recipe = await loadRewriteRecipeById(
    dataDir,
    owner,
    name,
    recipeId,
  );
  if (recipe === null) {
    throw graftNotFoundError(recipeId);
  }

  const episodes = await loadEpisodesByIds(
    dataDir,
    owner,
    name,
    recipe.episodeIds,
  );

  const evidence = recipe.episodeIds
    .map((id) => episodes.get(id))
    .filter((e): e is ReviewEpisode => e !== undefined)
    .map(episodeToEvidence);

  return { recipe, evidence };
}
