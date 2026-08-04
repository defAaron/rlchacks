/**
 * MCP tool handlers — thin wrappers over @graft/retrieval (Phase 5).
 */

import { loadEpisodesByIds } from "@graft/compile";
import {
  DEFAULT_LIST_LIMIT,
  applyPreview,
  applyPreviewFromSuggestion,
  explainRecipe,
  getFreshnessSummary,
  listRecipes,
  suggestGrafts,
  type RecipeCard,
} from "@graft/retrieval";
import {
  GraftError,
  GraftErrorCodes,
  type GraftSuggestion,
  type ReviewEpisode,
  type RewriteRecipe,
} from "@graft/shared";
import type { McpServerContext } from "./context.js";
import { toMcpFreshness, type McpFreshness } from "./freshness.js";

export const MAX_LIST_LIMIT = 20;

export type ListRecipesInput = {
  path?: string;
  language?: string;
  query?: string;
  limit?: number;
};

export type ListRecipesOutput = {
  recipes: Array<{
    id: string;
    title: string;
    rationale: string;
    before: string;
    after: string;
    support: number;
    confidence: RecipeCard["confidence"];
    pathPrefixes: string[];
    evidenceCount: number;
  }>;
  freshness: McpFreshness;
  truncated?: boolean;
  warnings?: string[];
};

export type SuggestGraftsInput = {
  diff?: string;
  code?: string;
  path?: string;
  limit?: number;
};

export type SuggestGraftsOutput = {
  suggestions: GraftSuggestion[];
  freshness: McpFreshness;
  warnings?: string[];
};

export type ExplainRecipeInput = {
  recipeId: string;
};

export type ExplainEpisode = {
  id: string;
  prNumber: number;
  commentUrl: string;
  commentBody: string;
  rejected: string;
  accepted: string | null;
  linkConfidence: string;
};

export type ExplainRecipeOutput = {
  recipe: RewriteRecipe;
  episodes: ExplainEpisode[];
  freshness: McpFreshness;
};

export type FreshnessOutput = McpFreshness;

export type ApplyPreviewInput = {
  recipeId?: string;
  path?: string;
  startLine?: number;
  endLine?: number;
  /** Rank from suggest_grafts (0-based). Requires prior suggest context fields. */
  suggestionRank?: number;
  matchPath?: string;
  matchRange?: { startLine: number; endLine: number } | null;
};

export type ApplyPreviewOutput = {
  recipeId: string;
  title: string;
  rationale: string;
  matchPath: string;
  unifiedDiff: string;
  warnings: string[];
  freshness: McpFreshness;
};

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(Math.max(1, limit), MAX_LIST_LIMIT);
}

function episodeToExplainRow(ep: ReviewEpisode): ExplainEpisode {
  const [owner, name] = ep.repo.split("/");
  return {
    id: ep.id,
    prNumber: ep.prNumber,
    commentUrl: `https://github.com/${owner}/${name}/pull/${ep.prNumber}#discussion_${ep.commentId}`,
    commentBody: ep.commentBody,
    rejected: ep.rejected.text,
    accepted: ep.accepted?.text ?? null,
    linkConfidence: ep.linkConfidence,
  };
}

export async function handleListRecipes(
  ctx: McpServerContext,
  recipes: readonly RewriteRecipe[],
  input: ListRecipesInput,
): Promise<ListRecipesOutput> {
  const freshnessSummary = await getFreshnessSummary(
    ctx.dataDir,
    ctx.owner,
    ctx.name,
  );
  const limit = clampLimit(input.limit);

  const listOpts: Parameters<typeof listRecipes>[1] = { limit };
  if (input.path !== undefined) {
    listOpts.path = input.path;
  }
  if (input.language !== undefined) {
    listOpts.language = input.language;
  }
  if (input.query !== undefined) {
    listOpts.q = input.query;
  }

  const listed = listRecipes(recipes, listOpts);
  const warnings: string[] = [];
  if (freshnessSummary.stale && freshnessSummary.reason !== null) {
    warnings.push(freshnessSummary.reason);
  }
  if (listed.truncated) {
    warnings.push(
      `Results truncated to ${listed.recipes.length} of ${listed.totalMatched} matches (GRAFT_BUDGET).`,
    );
  }

  return {
    recipes: listed.recipes.map((r) => ({
      id: r.id,
      title: r.title,
      rationale: r.rationale,
      before: r.before,
      after: r.after,
      support: r.support,
      confidence: r.confidence,
      pathPrefixes: r.pathPrefixes,
      evidenceCount: r.evidenceCount,
    })),
    freshness: toMcpFreshness(freshnessSummary),
    ...(listed.truncated ? { truncated: true } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function handleSuggestGrafts(
  ctx: McpServerContext,
  recipes: readonly RewriteRecipe[],
  input: SuggestGraftsInput,
): Promise<SuggestGraftsOutput> {
  const freshnessSummary = await getFreshnessSummary(
    ctx.dataDir,
    ctx.owner,
    ctx.name,
  );

  const hasDiff = input.diff !== undefined && input.diff.trim() !== "";
  const hasCode = input.code !== undefined && input.code.trim() !== "";

  if (!hasDiff && !hasCode) {
    throw new GraftError(
      GraftErrorCodes.GRAFT_INVALID_DIFF,
      "Provide diff (unified diff) or code + path.",
    );
  }
  if (hasCode && (input.path === undefined || input.path.trim() === "")) {
    throw new GraftError(
      GraftErrorCodes.GRAFT_INVALID_DIFF,
      "path is required when code is provided.",
    );
  }

  const suggestOpts: Parameters<typeof suggestGrafts>[0] = {
    dataDir: ctx.dataDir,
    owner: ctx.owner,
    name: ctx.name,
    recipes,
    limit: clampLimit(input.limit),
  };

  if (hasDiff && input.diff !== undefined) {
    suggestOpts.diff = input.diff;
  } else if (hasCode && input.path !== undefined && input.code !== undefined) {
    suggestOpts.files = [{ path: input.path, content: input.code }];
  }

  const result = await suggestGrafts(suggestOpts);
  const warnings = [...result.warnings];
  if (freshnessSummary.stale && freshnessSummary.reason !== null) {
    warnings.unshift(freshnessSummary.reason);
  }

  for (const s of result.suggestions) {
    if (s.evidence.length === 0) {
      throw new GraftError(
        GraftErrorCodes.GRAFT_NO_DATA,
        "Internal error: suggestion missing evidence pointers (RET-5).",
      );
    }
  }

  return {
    suggestions: result.suggestions,
    freshness: toMcpFreshness(freshnessSummary),
    ...(warnings.length > 0 ? { warnings: [...new Set(warnings)] } : {}),
  };
}

export async function handleExplainRecipe(
  ctx: McpServerContext,
  input: ExplainRecipeInput,
): Promise<ExplainRecipeOutput> {
  const freshnessSummary = await getFreshnessSummary(
    ctx.dataDir,
    ctx.owner,
    ctx.name,
  );

  const explained = await explainRecipe(
    ctx.dataDir,
    ctx.owner,
    ctx.name,
    input.recipeId,
  );

  const episodesById = await loadEpisodesByIds(
    ctx.dataDir,
    ctx.owner,
    ctx.name,
    explained.recipe.episodeIds,
  );

  const episodes = explained.recipe.episodeIds
    .map((id) => episodesById.get(id))
    .filter((e): e is ReviewEpisode => e !== undefined)
    .map(episodeToExplainRow);

  return {
    recipe: explained.recipe,
    episodes,
    freshness: toMcpFreshness(freshnessSummary),
  };
}

export async function handleFreshness(
  ctx: McpServerContext,
): Promise<FreshnessOutput> {
  const freshnessSummary = await getFreshnessSummary(
    ctx.dataDir,
    ctx.owner,
    ctx.name,
  );
  return toMcpFreshness(freshnessSummary);
}

export async function handleApplyPreview(
  ctx: McpServerContext,
  input: ApplyPreviewInput,
): Promise<ApplyPreviewOutput> {
  const freshnessSummary = await getFreshnessSummary(
    ctx.dataDir,
    ctx.owner,
    ctx.name,
  );

  if (input.recipeId !== undefined && input.path !== undefined) {
    const previewInput: Parameters<typeof applyPreview>[3] = {
      recipeId: input.recipeId,
      path: input.path,
    };
    if (input.startLine !== undefined) {
      previewInput.startLine = input.startLine;
    }
    if (input.endLine !== undefined) {
      previewInput.endLine = input.endLine;
    }
    const preview = await applyPreview(
      ctx.dataDir,
      ctx.owner,
      ctx.name,
      previewInput,
    );
    return {
      recipeId: preview.recipeId,
      title: preview.title,
      rationale: preview.rationale,
      matchPath: preview.matchPath,
      unifiedDiff: preview.patch,
      warnings: preview.warnings,
      freshness: toMcpFreshness(freshnessSummary),
    };
  }

  if (
    input.recipeId !== undefined &&
    input.matchPath !== undefined
  ) {
    const preview = await applyPreviewFromSuggestion(
      ctx.dataDir,
      ctx.owner,
      ctx.name,
      {
        recipeId: input.recipeId,
        matchPath: input.matchPath,
        matchRange: input.matchRange ?? null,
      },
    );
    return {
      recipeId: preview.recipeId,
      title: preview.title,
      rationale: preview.rationale,
      matchPath: preview.matchPath,
      unifiedDiff: preview.patch,
      warnings: preview.warnings,
      freshness: toMcpFreshness(freshnessSummary),
    };
  }

  throw new GraftError(
    GraftErrorCodes.GRAFT_INVALID_DIFF,
    "Provide recipeId + path (+ optional startLine/endLine) or recipeId + matchPath from suggest_grafts.",
  );
}
