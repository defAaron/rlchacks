/**
 * Patch construction from recipe after text (Phase 4.4 / RET-3).
 */

import type { MatchCandidate } from "./match.js";

export type PatchResult = {
  patch: string;
  warnings: string[];
};

/** Build a unified diff snippet when line alignment is straightforward. */
export function buildPatchForMatch(candidate: MatchCandidate): PatchResult {
  const warnings: string[] = [];
  const { recipe, matchPath, matchRange } = candidate;

  const beforeLines = recipe.before.split("\n");
  const afterLines = recipe.after.split("\n");

  if (matchRange === null) {
    warnings.push(
      "Could not align match range; returning before/after block only.",
    );
    return {
      patch: formatBeforeAfterBlock(recipe.before, recipe.after),
      warnings,
    };
  }

  const start = matchRange.startLine;
  const removedCount = beforeLines.length;
  const addedCount = afterLines.length;

  const header = [
    `--- a/${matchPath}`,
    `+++ b/${matchPath}`,
    `@@ -${start},${removedCount} +${start},${addedCount} @@`,
  ];

  const body = [
    ...beforeLines.map((l) => `-${l}`),
    ...afterLines.map((l) => `+${l}`),
  ];

  if (removedCount !== beforeLines.length || addedCount !== afterLines.length) {
    warnings.push("Line counts may be approximate for multi-line spans.");
  }

  return {
    patch: [...header, ...body].join("\n"),
    warnings,
  };
}

function formatBeforeAfterBlock(before: string, after: string): string {
  return [
    "--- before (rejected pattern)",
    before,
    "+++ after (historical accept)",
    after,
  ].join("\n");
}
