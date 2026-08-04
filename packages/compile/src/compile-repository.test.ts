import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileRepository } from "./compile-repository.js";
import { compileMetaPath, readRecipeIndex } from "./recipe-store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenRoot = path.join(
  here,
  "..",
  "..",
  "..",
  "testdata",
  "golden-episodes",
);

async function copyGolden(): Promise<string> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "graft-compile-"));
  await cp(goldenRoot, dataDir, { recursive: true });
  return dataDir;
}

describe("compileRepository — golden episodes", () => {
  it("writes compile-meta and recipe index; minSupport=2 drops singletons", async () => {
    const dataDir = await copyGolden();
    const result = await compileRepository({
      dataDir,
      owner: "acme",
      name: "widgets",
      minSupport: 2,
      now: () => new Date("2024-07-01T00:00:00Z"),
    });

    expect(result.inputEpisodes).toBe(12);
    expect(result.eligibleEpisodes).toBe(12);
    expect(result.recipesWritten).toBe(0);

    const metaRaw = await readFile(
      compileMetaPath(dataDir, "acme", "widgets"),
      "utf8",
    );
    const meta = JSON.parse(metaRaw) as { dropHistogram: { belowMinSupport: number } };
    expect(meta.dropHistogram.belowMinSupport).toBeGreaterThan(0);
  });

  it("minSupport=1 yields one recipe per eligible episode", async () => {
    const dataDir = await copyGolden();
    const result = await compileRepository({
      dataDir,
      owner: "acme",
      name: "widgets",
      minSupport: 1,
      now: () => new Date("2024-07-01T00:00:00Z"),
    });

    expect(result.recipesWritten).toBe(12);
    const index = await readRecipeIndex(dataDir, "acme", "widgets");
    expect(index?.recipes).toHaveLength(12);
    for (const entry of index?.recipes ?? []) {
      expect(entry.support).toBeGreaterThanOrEqual(1);
    }
  });

  it("changing minSupport changes recipe count predictably", async () => {
    const dataDir = await copyGolden();
    const high = await compileRepository({
      dataDir,
      owner: "acme",
      name: "widgets",
      minSupport: 2,
      now: () => new Date("2024-07-01T00:00:00Z"),
    });
    const low = await compileRepository({
      dataDir,
      owner: "acme",
      name: "widgets",
      minSupport: 1,
      now: () => new Date("2024-07-01T00:00:01Z"),
    });
    expect(low.recipesWritten).toBeGreaterThan(high.recipesWritten);
  });
});
