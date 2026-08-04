import { describe, expect, it } from "vitest";
import type { RewriteRecipe } from "@graft/shared";
import { listRecipes } from "./list-recipes.js";

function recipe(id: string, support: number, pathPrefix: string): RewriteRecipe {
  return {
    id,
    repo: "acme/widgets",
    title: `Recipe ${id}`,
    rationale: "test rationale",
    scope: { pathPrefixes: [pathPrefix], languages: ["typescript"] },
    before: "before code",
    after: "after code",
    beforeSignals: ["before"],
    support,
    episodeIds: ["ep_1"],
    reviewers: ["alice"],
    avgLinkConfidence: 0.9,
    suppressed: false,
    createdAt: "2024-06-16T00:00:00Z",
    updatedAt: "2024-06-16T00:00:00Z",
    compileRunId: "compile_test",
  };
}

describe("listRecipes", () => {
  const recipes = [
    recipe("r1", 5, "src/api/"),
    recipe("r2", 2, "src/util/"),
    recipe("r3", 8, "src/api/"),
  ];

  it("filters by path prefix and sorts by support", () => {
    const result = listRecipes(recipes, { path: "src/api", limit: 8 });
    expect(result.totalMatched).toBe(2);
    expect(result.recipes[0]!.id).toBe("r3");
    expect(result.recipes[0]!.confidence).toBe("high");
    expect(result.recipes[0]!.evidenceCount).toBe(1);
  });

  it("respects limit and reports truncation", () => {
    const result = listRecipes(recipes, { limit: 1 });
    expect(result.recipes).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
});
