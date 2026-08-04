/**
 * Phase 8 integration tests — multi-repo isolation, redaction on persist.
 */

import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRecipeIndex } from "@graft/retrieval";
import {
  RawReviewCommentSchema,
  parseArtifact,
  redactSecrets,
  resolveGraftConfig,
} from "@graft/shared";
import { writeRawReviewComment } from "@graft/ingestion";

describe("Phase 8 — multi-repo isolation (SAF-1)", () => {
  it("loads recipes only from the requested repo scope", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-p8-"));
    const recipeA = {
      id: "recipe-a",
      repo: "acme/widgets",
      title: "Widget fix",
      rationale: "Because",
      scope: { pathPrefixes: ["src/"], languages: ["typescript"] },
      before: "a",
      after: "b",
      beforeSignals: [],
      support: 2,
      episodeIds: ["ep-a"],
      reviewers: ["r1"],
      avgLinkConfidence: 0.9,
      suppressed: false,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      compileRunId: "run-a",
    };
    const recipeB = { ...recipeA, id: "recipe-b", repo: "other/app", title: "Other" };

    for (const [owner, name, recipe] of [
      ["acme", "widgets", recipeA],
      ["other", "app", recipeB],
    ] as const) {
      const dir = path.join(dataDir, "repos", owner, name, "recipes");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, `${recipe.id}.json`),
        `${JSON.stringify(recipe, null, 2)}\n`,
      );
      await writeFile(
        path.join(dir, "index.json"),
        `${JSON.stringify({ repo: `${owner}/${name}`, updatedAt: "2024-01-01T00:00:00Z", compileRunId: "run", recipes: [{ id: recipe.id, title: recipe.title, support: 2, avgLinkConfidence: 0.9, pathPrefixes: ["src/"], languages: ["typescript"], suppressed: false }] }, null, 2)}\n`,
      );
    }

    const loadedA = await loadRecipeIndex({
      dataDir,
      owner: "acme",
      name: "widgets",
    });
    expect(loadedA.recipes.map((r) => r.id)).toEqual(["recipe-a"]);
    expect(loadedA.recipes.every((r) => r.repo === "acme/widgets")).toBe(true);

    const loadedB = await loadRecipeIndex({
      dataDir,
      owner: "other",
      name: "app",
    });
    expect(loadedB.recipes.map((r) => r.id)).toEqual(["recipe-b"]);
  });

  it("resolveGraftConfig refuses repos outside allowlist", async () => {
    await expect(
      resolveGraftConfig({
        repo: "evil/repo",
        env: { GRAFT_REPO_ALLOWLIST: "acme/widgets" },
        init: false,
      }),
    ).rejects.toThrow(/GRAFT_REPO_ALLOWLIST/);
  });
});

describe("Phase 8 — redaction on persist (SAF-3)", () => {
  it("writeRawReviewComment scrubs ghp_ tokens from body", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-redact-"));
    const comment = parseArtifact(
      RawReviewCommentSchema,
      {
        id: "c1",
        prNumber: 1,
        path: "src/a.ts",
        body: "Use token ghp_1234567890abcdefghijklmnopqrstuvwxyz please",
        author: "dev",
        createdAt: "2024-01-01T00:00:00Z",
        diffHunk: null,
        line: null,
        originalLine: null,
        side: null,
        commitId: null,
        htmlUrl: "https://github.com/acme/widgets/pull/1#discussion_r1",
      },
      "RawReviewComment",
    );
    await writeRawReviewComment(dataDir, "acme", "widgets", comment);
    const stored = await readFile(
      path.join(dataDir, "repos", "acme", "widgets", "raw", "comments", "c1.json"),
      "utf8",
    );
    expect(stored).not.toContain("ghp_1234567890abcdefghijklmnopqrstuvwxyz");
    expect(stored).toContain("ghp_[REDACTED]");
  });

  it("redactSecrets is idempotent for placeholders", () => {
    const once = redactSecrets("token ghp_1234567890abcdefghijklmnopqrstuvwxyz");
    expect(redactSecrets(once)).toBe(once);
  });
});
