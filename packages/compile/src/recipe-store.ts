/**
 * Persist recipes, index, and compile-meta (TRD §6.2 / Phase 3.4).
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseArtifact,
  repoScopedPath,
  RewriteRecipeSchema,
  type RewriteRecipe,
} from "@graft/shared";

export type RecipeIndexEntry = {
  id: string;
  title: string;
  support: number;
  avgLinkConfidence: number;
  pathPrefixes: string[];
  languages: string[];
  suppressed: boolean;
};

export type RecipeIndex = {
  repo: string;
  updatedAt: string;
  compileRunId: string;
  recipes: RecipeIndexEntry[];
};

export type CompileMeta = {
  repo: string;
  compileRunId: string;
  updatedAt: string;
  thresholds: {
    minSupport: number;
    allowSingleHighConfidence: boolean;
    clusterSimilarityThreshold: number;
  };
  inputEpisodes: number;
  eligibleEpisodes: number;
  clustersFormed: number;
  recipesWritten: number;
  dropHistogram: {
    belowMinSupport: number;
    noAccepted: number;
    lowConfidence: number;
    noneConfidence: number;
  };
};

export function recipesDir(
  dataDir: string,
  owner: string,
  name: string,
): string {
  return repoScopedPath(dataDir, owner, name, "recipes");
}

export function recipePath(
  dataDir: string,
  owner: string,
  name: string,
  recipeId: string,
): string {
  return repoScopedPath(dataDir, owner, name, "recipes", `${recipeId}.json`);
}

export function recipeIndexPath(
  dataDir: string,
  owner: string,
  name: string,
): string {
  return repoScopedPath(dataDir, owner, name, "recipes", "index.json");
}

export function compileMetaPath(
  dataDir: string,
  owner: string,
  name: string,
): string {
  return repoScopedPath(dataDir, owner, name, "compile-meta.json");
}

export function suppressionsPath(
  dataDir: string,
  owner: string,
  name: string,
): string {
  return repoScopedPath(dataDir, owner, name, "suppressions.json");
}

export async function readSuppressions(
  dataDir: string,
  owner: string,
  name: string,
): Promise<Set<string>> {
  const filePath = suppressionsPath(dataDir, owner, name);
  try {
    const raw = await readFile(filePath, "utf8");
    const json = JSON.parse(raw) as { suppressed?: string[] };
    return new Set(json.suppressed ?? []);
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: unknown }).code === "ENOENT"
    ) {
      return new Set();
    }
    throw err;
  }
}

export async function writeRewriteRecipe(
  dataDir: string,
  owner: string,
  name: string,
  recipe: RewriteRecipe,
): Promise<string> {
  const validated = parseArtifact(RewriteRecipeSchema, recipe, "RewriteRecipe");
  const filePath = recipePath(dataDir, owner, name, validated.id);
  await mkdir(recipesDir(dataDir, owner, name), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  return filePath;
}

export async function writeRecipeIndex(
  dataDir: string,
  owner: string,
  name: string,
  index: RecipeIndex,
): Promise<string> {
  const filePath = recipeIndexPath(dataDir, owner, name);
  await mkdir(recipesDir(dataDir, owner, name), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return filePath;
}

export async function writeCompileMeta(
  dataDir: string,
  owner: string,
  name: string,
  meta: CompileMeta,
): Promise<string> {
  const filePath = compileMetaPath(dataDir, owner, name);
  await mkdir(repoScopedPath(dataDir, owner, name), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return filePath;
}

/** Remove prior recipe JSON files (recompile overwrites); preserves suppressions.json. */
export async function clearRecipeArtifacts(
  dataDir: string,
  owner: string,
  name: string,
): Promise<number> {
  const dir = recipesDir(dataDir, owner, name);
  let removed = 0;
  try {
    const names = await readdir(dir);
    for (const file of names) {
      if (file === "index.json") {
        continue;
      }
      if (file.endsWith(".json")) {
        await rm(path.join(dir, file));
        removed++;
      }
    }
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: unknown }).code === "ENOENT"
    ) {
      return 0;
    }
    throw err;
  }
  return removed;
}

export function toRecipeIndexEntry(recipe: RewriteRecipe): RecipeIndexEntry {
  return {
    id: recipe.id,
    title: recipe.title,
    support: recipe.support,
    avgLinkConfidence: recipe.avgLinkConfidence,
    pathPrefixes: recipe.scope.pathPrefixes,
    languages: recipe.scope.languages,
    suppressed: recipe.suppressed,
  };
}

export async function readRecipeIndex(
  dataDir: string,
  owner: string,
  name: string,
): Promise<RecipeIndex | null> {
  const filePath = recipeIndexPath(dataDir, owner, name);
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as RecipeIndex;
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: unknown }).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
}

export async function loadRewriteRecipes(
  dataDir: string,
  owner: string,
  name: string,
): Promise<RewriteRecipe[]> {
  const index = await readRecipeIndex(dataDir, owner, name);
  if (index === null) {
    return [];
  }

  const recipes: RewriteRecipe[] = [];
  for (const entry of index.recipes) {
    const filePath = recipePath(dataDir, owner, name, entry.id);
    const raw = await readFile(filePath, "utf8");
    const json = JSON.parse(raw) as unknown;
    recipes.push(parseArtifact(RewriteRecipeSchema, json, "RewriteRecipe"));
  }
  return recipes;
}

export async function loadRewriteRecipeById(
  dataDir: string,
  owner: string,
  name: string,
  recipeId: string,
): Promise<RewriteRecipe | null> {
  const filePath = recipePath(dataDir, owner, name, recipeId);
  try {
    const raw = await readFile(filePath, "utf8");
    const json = JSON.parse(raw) as unknown;
    return parseArtifact(RewriteRecipeSchema, json, "RewriteRecipe");
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: unknown }).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
}
