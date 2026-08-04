import { describe, expect, it } from "vitest";
import type { ReviewEpisode } from "@graft/shared";
import {
  clusterAllEpisodes,
  clusterEpisodes,
  deriveBeforeSignals,
  toCompileEpisode,
} from "./cluster.js";

function makeEpisode(
  id: string,
  rejected: string,
  accepted: string,
  path = "src/retry.ts",
): ReviewEpisode {
  return {
    id,
    repo: "acme/widgets",
    prNumber: 100,
    commentId: `comment-${id}`,
    path,
    language: "typescript",
    commentBody: "Use throw on last attempt instead of storing lastError.",
    rejected: {
      path,
      startLine: 1,
      endLine: 1,
      sha: "before",
      text: rejected,
      normalized: rejected.replace(/\s+/g, ""),
    },
    accepted: {
      path,
      startLine: 1,
      endLine: 1,
      sha: "after",
      text: accepted,
      normalized: accepted.replace(/\s+/g, ""),
    },
    linkConfidence: "medium",
    linkReason: "overlap_lexical",
    actionable: true,
    discardReason: null,
    reviewer: "alice",
    mergedAt: "2024-06-15T12:00:00Z",
  };
}

describe("clusterEpisodes", () => {
  it("merges near-duplicate pairs into one cluster with support ≥ 2", () => {
    const ep1 = toCompileEpisode(
      makeEpisode("ep_a", "      lastError = err;", "      if (i === attempts - 1) throw err;"),
    );
    const ep2 = toCompileEpisode(
      makeEpisode(
        "ep_b",
        "        lastError = err;",
        "        if (attempt === max - 1) throw err;",
      ),
    );

    const clusters = clusterEpisodes([ep1, ep2], { similarityThreshold: 0.5 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.support).toBeGreaterThanOrEqual(2);
    expect(clusters[0]!.episodeIds).toHaveLength(2);
    expect(clusters[0]!.beforeSignals.length).toBeGreaterThan(0);
  });

  it("keeps dissimilar episodes as separate singleton clusters", () => {
    const episodes = [
      toCompileEpisode(
        makeEpisode("ep_1", "const x = 1;", "const x = 2;", "src/a.ts"),
      ),
      toCompileEpisode(
        makeEpisode("ep_2", "await fetch(url)", "return null;", "src/b.ts"),
      ),
    ];
    const clusters = clusterAllEpisodes(episodes);
    expect(clusters.length).toBeGreaterThanOrEqual(2);
  });
});

describe("deriveBeforeSignals", () => {
  it("extracts substrings ≥ 4 chars from rejected text", () => {
    const signals = deriveBeforeSignals("      lastError = err;");
    expect(signals.some((s) => s.includes("lastError"))).toBe(true);
  });
});
