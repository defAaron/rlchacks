import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileRepository } from "@graft/compile";
import { describe, expect, it } from "vitest";
import {
  applyPreview,
  explainRecipe,
  listRecipes,
  loadRecipeIndex,
  suppressRecipe,
} from "./index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenRoot = path.join(
  here,
  "..",
  "..",
  "..",
  "testdata",
  "golden-episodes",
);

async function seedCompiled(): Promise<{
  dataDir: string;
  recipeId: string;
}> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "graft-suppress-"));
  await cp(goldenRoot, dataDir, { recursive: true });
  const env = { DATA_DIR: dataDir, GRAFT_MIN_SUPPORT: "1" };
  await compileRepository({
    dataDir,
    owner: "acme",
    name: "widgets",
    minSupport: 1,
    allowSingleHighConfidence: true,
    now: () => new Date(3_000_000),
  });
  const loaded = await loadRecipeIndex({
    dataDir,
    owner: "acme",
    name: "widgets",
  });
  return { dataDir, recipeId: loaded.recipes[0]!.id };
}

describe("suppressRecipe", () => {
  it("removes recipe from list/suggest but remains explainable", async () => {
    const { dataDir, recipeId } = await seedCompiled();

    const before = await loadRecipeIndex({
      dataDir,
      owner: "acme",
      name: "widgets",
    });
    expect(before.recipes.some((r) => r.id === recipeId)).toBe(true);

    await suppressRecipe(dataDir, "acme", "widgets", recipeId, true);

    const after = await loadRecipeIndex({
      dataDir,
      owner: "acme",
      name: "widgets",
    });
    expect(after.recipes.some((r) => r.id === recipeId)).toBe(false);

    const explained = await explainRecipe(
      dataDir,
      "acme",
      "widgets",
      recipeId,
    );
    expect(explained.recipe.id).toBe(recipeId);

    await suppressRecipe(dataDir, "acme", "widgets", recipeId, false);
    const restored = await loadRecipeIndex({
      dataDir,
      owner: "acme",
      name: "widgets",
    });
    expect(restored.recipes.some((r) => r.id === recipeId)).toBe(true);
  });
});

describe("applyPreview", () => {
  it("returns unified diff with warnings when range omitted", async () => {
    const { dataDir, recipeId } = await seedCompiled();
    const loaded = await loadRecipeIndex({
      dataDir,
      owner: "acme",
      name: "widgets",
    });
    const recipe = loaded.recipes.find((r) => r.id === recipeId)!;

    const preview = await applyPreview(dataDir, "acme", "widgets", {
      recipeId,
      path: recipe.scope.pathPrefixes[0] ?? "src/types.ts",
    });

    expect(preview.patch).toContain("after (historical accept)");
    expect(preview.warnings.length).toBeGreaterThan(0);
  });

  it("builds hunk-aligned patch when range provided", async () => {
    const { dataDir, recipeId } = await seedCompiled();
    const preview = await applyPreview(dataDir, "acme", "widgets", {
      recipeId,
      path: "src/types.ts",
      startLine: 10,
      endLine: 12,
    });
    expect(preview.patch).toContain("@@");
    expect(preview.patch).toContain("+++ b/src/types.ts");
  });
});
