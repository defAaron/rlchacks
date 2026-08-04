import { describe, expect, it } from "vitest";
import type { ReviewEpisode, RewriteRecipe } from "@graft/shared";
import { matchDiffToRecipes } from "./match.js";

const REJECTED_DIFF = `diff --git a/src/types.ts b/src/types.ts
--- a/src/types.ts
+++ b/src/types.ts
@@ -1 +1 @@
+export function handle(value: any) {
`;

const ACCEPTED_DIFF = `diff --git a/src/types.ts b/src/types.ts
--- a/src/types.ts
+++ b/src/types.ts
@@ -1 +1 @@
+export function handle(value: unknown) {
`;

function episode(): ReviewEpisode {
  return {
    id: "ep_types",
    repo: "acme/widgets",
    prNumber: 119,
    commentId: "PRRC_kwDOFixtureComment119",
    path: "src/types.ts",
    language: "typescript",
    commentBody: "Avoid any",
    rejected: {
      path: "src/types.ts",
      startLine: 1,
      endLine: 1,
      sha: "b",
      text: "export function handle(value: any) {",
      normalized: "exportfunctionhandle(value:any){",
    },
    accepted: {
      path: "src/types.ts",
      startLine: 1,
      endLine: 1,
      sha: "a",
      text: "export function handle(value: unknown) {",
      normalized: "exportfunctionhandle(value:unknown){",
    },
    linkConfidence: "high",
    linkReason: "exact_span_replacement",
    actionable: true,
    discardReason: null,
    reviewer: "jade",
    mergedAt: "2024-06-16T19:00:00Z",
  };
}

function recipe(): RewriteRecipe {
  const ep = episode();
  return {
    id: "rcp_types_any",
    repo: "acme/widgets",
    title: "Avoid any — use unknown",
    rationale: "Reviewers reject any in favor of unknown.",
    scope: { pathPrefixes: ["src/"], languages: ["typescript"] },
    before: ep.rejected.text,
    after: ep.accepted!.text,
    beforeSignals: ["any", "export function handle"],
    support: 1,
    episodeIds: [ep.id],
    reviewers: ["jade"],
    avgLinkConfidence: 1,
    suppressed: false,
    createdAt: "2024-06-16T00:00:00Z",
    updatedAt: "2024-06-16T00:00:00Z",
    compileRunId: "compile_test",
  };
}

describe("matchDiffToRecipes — behavioral", () => {
  const ep = episode();
  const episodesById = new Map([[ep.id, ep]]);
  const recipes = [recipe()];

  it("surfaces recipe for rejected sample diff", () => {
    const matches = matchDiffToRecipes({
      recipes,
      episodesById,
      diff: REJECTED_DIFF,
    });
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]!.recipe.id).toBe("rcp_types_any");
  });

  it("does not suggest self-rewrite on accepted sample diff", () => {
    const matches = matchDiffToRecipes({
      recipes,
      episodesById,
      diff: ACCEPTED_DIFF,
    });
    expect(matches).toHaveLength(0);
  });
});
