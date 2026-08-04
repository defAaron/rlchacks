import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  parseArtifact,
  ReviewEpisodeSchema,
  type ReviewEpisode,
} from "@graft/shared";
import { isCompileEligible } from "./accepted-fix.js";
import { reconstructBeforeFromTipAndHunk } from "./before-text.js";
import { linkRepository } from "./link-repository.js";
import type { LinkLlmClient } from "./llm-validate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const phase1SeedRoot = path.join(
  here,
  "..",
  "..",
  "..",
  "testdata",
  "phase1-seed",
);

async function copyPhase1Seed(): Promise<string> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "graft-link-"));
  await cp(phase1SeedRoot, dataDir, { recursive: true });
  return dataDir;
}

describe("reconstructBeforeFromTipAndHunk", () => {
  it("reverse-applies a fix hunk onto tip", () => {
    const tip = `export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) throw err;
      lastError = err;
    }
  }
  throw lastError;
}
`;
    const hunk = `@@ -4,7 +4,8 @@ export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
     try {
       return await fn();
     } catch (err) {
-      lastError = err;
+      if (i === attempts - 1) throw err;
+      lastError = err;
     }
   }
   throw lastError;`;

    const before = reconstructBeforeFromTipAndHunk(tip, hunk);
    expect(before).toContain("      lastError = err;");
    expect(before).not.toContain("attempts - 1");
  });
});

describe("linkRepository — phase1-seed offline", () => {
  it("writes episodes + index with medium+ before/after and discard debug", async () => {
    const dataDir = await copyPhase1Seed();
    const fixedNow = new Date("2024-07-01T00:00:00.000Z");

    const result = await linkRepository({
      dataDir,
      owner: "acme",
      name: "widgets",
      now: () => fixedNow,
    });

    expect(result.episodes).toBeGreaterThanOrEqual(1);
    expect(result.mediumOrHigher).toBeGreaterThanOrEqual(1);
    expect(result.discards).toBeGreaterThanOrEqual(1);
    expect(result.updatedAt).toBe("2024-07-01T00:00:00.000Z");
    expect(result.episodeLabels.length).toBe(result.episodes);
    expect(
      result.episodeLabels.every(
        (e) => e.linkConfidence.length > 0 && e.linkReason.length > 0,
      ),
    ).toBe(true);

    const index = JSON.parse(
      await readFile(result.indexPath, "utf8"),
    ) as {
      repo: string;
      episodes: Array<{
        id: string;
        linkConfidence: string;
        linkReason: string;
      }>;
    };
    expect(index.repo).toBe("acme/widgets");
    expect(index.episodes.length).toBe(result.episodes);

    const mediumPlus = index.episodes.filter(
      (e) => e.linkConfidence === "high" || e.linkConfidence === "medium",
    );
    expect(mediumPlus.length).toBeGreaterThanOrEqual(1);
    expect(mediumPlus[0]!.linkReason.length).toBeGreaterThan(0);

    const episodePath = path.join(
      dataDir,
      "repos",
      "acme",
      "widgets",
      "episodes",
      `${mediumPlus[0]!.id}.json`,
    );
    const episode = parseArtifact(
      ReviewEpisodeSchema,
      JSON.parse(await readFile(episodePath, "utf8")),
      "ReviewEpisode",
    ) as ReviewEpisode;

    expect(isCompileEligible(episode.linkConfidence)).toBe(true);
    expect(episode.rejected.text.length).toBeGreaterThan(0);
    expect(episode.accepted).not.toBeNull();
    expect(episode.accepted!.text.length).toBeGreaterThan(0);
    expect(episode.rejected.text).not.toBe(episode.accepted!.text);
    expect(episode.linkReason).toContain("rejected_from");

    const discards = JSON.parse(
      await readFile(result.discardsPath, "utf8"),
    ) as {
      discards: Array<{
        discardReason: string;
        commentId: string;
        bodyPreview: string;
      }>;
    };
    expect(
      discards.discards.some((d) => d.discardReason === "lgtm"),
    ).toBe(true);
    for (const d of discards.discards) {
      expect(d.bodyPreview.length).toBeLessThanOrEqual(160);
      expect(d.bodyPreview).not.toMatch(/\n/);
    }
  });

  it("makes zero LLM client calls when GRAFT_LLM_ENABLED is false", async () => {
    const dataDir = await copyPhase1Seed();
    const validateLink = vi.fn(async () => {
      throw new Error("network forbidden when LLM disabled");
    });
    const llmClient: LinkLlmClient = { validateLink };

    await linkRepository({
      dataDir,
      owner: "acme",
      name: "widgets",
      llmEnabled: false,
      llmApiKeyPresent: true,
      llmClient,
    });

    expect(validateLink).not.toHaveBeenCalled();
  });

  it("upgrades medium episodes when mocked LLM addresses=true", async () => {
    const dataDir = await copyPhase1Seed();
    const validateLink = vi.fn(async () => ({
      addresses: true,
      rationale: "mock upgrade",
    }));
    const llmClient: LinkLlmClient = { validateLink };

    const result = await linkRepository({
      dataDir,
      owner: "acme",
      name: "widgets",
      llmEnabled: true,
      llmApiKeyPresent: true,
      llmClient,
    });

    expect(validateLink).toHaveBeenCalled();
    expect(result.mediumOrHigher).toBeGreaterThanOrEqual(1);

    const index = JSON.parse(
      await readFile(result.indexPath, "utf8"),
    ) as {
      episodes: Array<{ linkConfidence: string; linkReason: string }>;
    };
    const upgraded = index.episodes.filter((e) =>
      e.linkReason.includes("llm_upgrade"),
    );
    expect(upgraded.length).toBeGreaterThanOrEqual(1);
    expect(upgraded.every((e) => e.linkConfidence === "high")).toBe(true);
  });

  it("downgrades medium episodes when mocked LLM addresses=false", async () => {
    const dataDir = await copyPhase1Seed();
    const validateLink = vi.fn(async () => ({
      addresses: false,
      rationale: "mock downgrade",
    }));
    const llmClient: LinkLlmClient = { validateLink };

    const result = await linkRepository({
      dataDir,
      owner: "acme",
      name: "widgets",
      llmEnabled: true,
      llmApiKeyPresent: true,
      llmClient,
    });

    expect(validateLink).toHaveBeenCalled();

    const index = JSON.parse(
      await readFile(result.indexPath, "utf8"),
    ) as {
      episodes: Array<{ linkConfidence: string; linkReason: string }>;
    };
    const downgraded = index.episodes.filter((e) =>
      e.linkReason.includes("llm_downgrade"),
    );
    expect(downgraded.length).toBeGreaterThanOrEqual(1);
    expect(downgraded.every((e) => e.linkConfidence === "low")).toBe(true);
  });
});
