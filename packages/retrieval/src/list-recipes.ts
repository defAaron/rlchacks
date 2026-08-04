/**
 * listRecipes — filter, rank, and cap payloads (Phase 4.2 / RET-1, RET-6).
 */

import type { RewriteRecipe, SuggestionConfidence } from "@graft/shared";

export const DEFAULT_LIST_LIMIT = 8;
export const MAX_CODE_LINES = 40;
export const MAX_PAYLOAD_BYTES = 32 * 1024;

export type ListRecipesOptions = {
  path?: string;
  language?: string;
  /** Free-text query against title, rationale, beforeSignals. */
  q?: string;
  limit?: number;
};

export type RecipeCard = {
  id: string;
  title: string;
  rationale: string;
  before: string;
  after: string;
  support: number;
  confidence: SuggestionConfidence;
  evidenceCount: number;
  pathPrefixes: string[];
  languages: string[];
  avgLinkConfidence: number;
};

export type ListRecipesResult = {
  recipes: RecipeCard[];
  truncated: boolean;
  totalMatched: number;
};

function confidenceLabel(avg: number): SuggestionConfidence {
  if (avg >= 0.85) {
    return "high";
  }
  if (avg >= 0.6) {
    return "medium";
  }
  return "low";
}

function truncateCode(text: string, maxLines = MAX_CODE_LINES): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return text;
  }
  return `${lines.slice(0, maxLines).join("\n")}\n… (${lines.length - maxLines} more lines)`;
}

function matchesPath(recipe: RewriteRecipe, pathPrefix?: string): boolean {
  if (pathPrefix === undefined || pathPrefix.trim() === "") {
    return true;
  }
  const prefix = pathPrefix.trim();
  return recipe.scope.pathPrefixes.some(
    (p) => prefix.startsWith(p) || p.startsWith(prefix),
  ) || recipe.scope.pathPrefixes.some((p) =>
    prefix.split("/").slice(0, p.replace(/\/$/, "").split("/").length).join("/") === p.replace(/\/$/, ""),
  );
}

function matchesLanguage(recipe: RewriteRecipe, language?: string): boolean {
  if (language === undefined || language.trim() === "") {
    return true;
  }
  const lang = language.trim().toLowerCase();
  return (
    recipe.scope.languages.length === 0 ||
    recipe.scope.languages.some((l) => l.toLowerCase() === lang)
  );
}

function matchesQuery(recipe: RewriteRecipe, q?: string): boolean {
  if (q === undefined || q.trim() === "") {
    return true;
  }
  const needle = q.trim().toLowerCase();
  const haystack = [
    recipe.title,
    recipe.rationale,
    recipe.before,
    recipe.after,
    ...recipe.beforeSignals,
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

function recipeToCard(recipe: RewriteRecipe): RecipeCard {
  return {
    id: recipe.id,
    title: recipe.title,
    rationale: recipe.rationale,
    before: truncateCode(recipe.before),
    after: truncateCode(recipe.after),
    support: recipe.support,
    confidence: confidenceLabel(recipe.avgLinkConfidence),
    evidenceCount: recipe.episodeIds.length,
    pathPrefixes: recipe.scope.pathPrefixes,
    languages: recipe.scope.languages,
    avgLinkConfidence: recipe.avgLinkConfidence,
  };
}

/** Estimate JSON payload size for budget enforcement. */
function estimateBytes(cards: RecipeCard[]): number {
  return Buffer.byteLength(JSON.stringify(cards), "utf8");
}

export function listRecipes(
  recipes: readonly RewriteRecipe[],
  options: ListRecipesOptions = {},
): ListRecipesResult {
  const limit = options.limit ?? DEFAULT_LIST_LIMIT;

  let matched = recipes.filter(
    (r) =>
      matchesPath(r, options.path) &&
      matchesLanguage(r, options.language) &&
      matchesQuery(r, options.q),
  );

  matched = [...matched].sort(
    (a, b) => b.support - a.support || b.avgLinkConfidence - a.avgLinkConfidence,
  );

  const totalMatched = matched.length;
  let cards = matched.slice(0, limit).map(recipeToCard);
  let truncated = totalMatched > limit;

  while (cards.length > 0 && estimateBytes(cards) > MAX_PAYLOAD_BYTES) {
    cards = cards.slice(0, cards.length - 1);
    truncated = true;
  }

  return { recipes: cards, truncated, totalMatched };
}
