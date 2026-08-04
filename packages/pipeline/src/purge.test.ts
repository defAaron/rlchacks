import { cp, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoDataRoot } from "@graft/shared";
import { describe, expect, it } from "vitest";
import { purgeRepository } from "./purge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenRoot = path.join(
  here,
  "..",
  "..",
  "..",
  "testdata",
  "golden-episodes",
);

describe("purgeRepository", () => {
  it("removes repo artifact tree only", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-purge-"));
    await cp(goldenRoot, dataDir, { recursive: true });
    const root = repoDataRoot(dataDir, "acme", "widgets");
    await stat(root);

    const result = await purgeRepository(dataDir, "acme", "widgets");
    expect(result.removed).toBe(true);

    await expect(stat(root)).rejects.toThrow();
  });
});
