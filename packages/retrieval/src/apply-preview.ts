/**
 * apply_preview — unified diff for a recipe at a location, no writes (Phase 7.1 / MCP-4).
 */

import { loadRewriteRecipeById } from "@graft/compile";
import type { MatchRange } from "@graft/shared";
import { graftNotFoundError } from "./explain.js";
import { buildPatchForMatch, type PatchResult } from "./patch.js";

export type ApplyPreviewInput = {
  recipeId: string;
  path: string;
  startLine?: number;
  endLine?: number;
};

export type ApplyPreviewResult = PatchResult & {
  recipeId: string;
  title: string;
  rationale: string;
  matchPath: string;
  matchRange: MatchRange | null;
};

/**
 * Build a preview patch for an explicit recipe + location.
 * When line range is omitted, returns before/after block with alignment warnings.
 */
export async function applyPreview(
  dataDir: string,
  owner: string,
  name: string,
  input: ApplyPreviewInput,
): Promise<ApplyPreviewResult> {
  const recipe = await loadRewriteRecipeById(
    dataDir,
    owner,
    name,
    input.recipeId,
  );
  if (recipe === null) {
    throw graftNotFoundError(input.recipeId);
  }

  const matchRange =
    input.startLine !== undefined && input.endLine !== undefined
      ? { startLine: input.startLine, endLine: input.endLine }
      : null;

  const built = buildPatchForMatch({
    recipe,
    matchPath: input.path,
    matchRange,
    signalMatchStrength: 0,
    pathSpecificity: 0,
    recency: 0,
    score: 0,
  });

  return {
    recipeId: recipe.id,
    title: recipe.title,
    rationale: recipe.rationale,
    matchPath: input.path,
    matchRange,
    patch: built.patch,
    warnings: built.warnings,
  };
}

/**
 * Preview from a ranked suggestion (recipeId + match metadata from suggest_grafts).
 */
export async function applyPreviewFromSuggestion(
  dataDir: string,
  owner: string,
  name: string,
  args: {
    recipeId: string;
    matchPath: string;
    matchRange: MatchRange | null;
  },
): Promise<ApplyPreviewResult> {
  const range = args.matchRange;
  const input: ApplyPreviewInput = {
    recipeId: args.recipeId,
    path: args.matchPath,
  };
  if (range !== null) {
    input.startLine = range.startLine;
    input.endLine = range.endLine;
  }
  return applyPreview(dataDir, owner, name, input);
}
