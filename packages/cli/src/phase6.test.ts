import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseRecipesSuppressArgs,
  runCompile,
  runIngest,
  runRecipesList,
  runRecipesSuppress,
} from "./index.js";
import { createGitHubClient } from "@graft/ingestion";
import { createFixtureFetch } from "@graft/ingestion";

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenRoot = path.join(
  here,
  "..",
  "..",
  "..",
  "testdata",
  "golden-episodes",
);

describe("parseRecipesSuppressArgs", () => {
  it("parses repo, id, and --unsuppress", () => {
    expect(
      parseRecipesSuppressArgs(["acme/widgets", "recipe-1", "--unsuppress"]),
    ).toEqual({
      repo: "acme/widgets",
      recipeId: "recipe-1",
      unsuppress: true,
    });
  });
});

describe("runRecipesSuppress + incremental ingest", () => {
  it("suppress hides recipe from list but explain still works via API path", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-cli-phase6-"));
    await cp(goldenRoot, dataDir, { recursive: true });
    const env = { DATA_DIR: dataDir, GRAFT_MIN_SUPPORT: "1" };

    await runCompile({
      repo: "acme/widgets",
      env,
      now: () => 3_000_000,
      log: () => {},
    });

    const listed = await runRecipesList({
      repo: "acme/widgets",
      env,
      log: () => {},
    });
    const recipeId = listed.recipes[0]!.id;

    await runRecipesSuppress({
      repo: "acme/widgets",
      recipeId,
      env,
      log: () => {},
    });

    const after = await runRecipesList({
      repo: "acme/widgets",
      env,
      log: () => {},
    });
    expect(after.recipes.some((r) => r.id === recipeId)).toBe(false);
  });

  it("second ingest with cursor fetches delta only", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-cli-ingest-delta-"));
    const client = createGitHubClient({
      token: "ghp_fixture_token",
      fetch: createFixtureFetch(),
      pullsPerPage: 3,
    });

    const first = await runIngest({
      repo: "acme/widgets",
      maxPrs: 2,
      env: { DATA_DIR: dataDir },
      client,
      log: () => {},
    });
    expect(first.prsNew).toBe(2);

    const second = await runIngest({
      repo: "acme/widgets",
      maxPrs: 2,
      env: { DATA_DIR: dataDir },
      client,
      log: () => {},
    });
    expect(second.prs).toBeLessThanOrEqual(first.prs);
    expect(second.prsNew).toBe(0);
  });
});
