import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CodeSpanSchema, parseArtifact, type CodeSpan } from "@graft/shared";
import {
  AcceptedFixLinkReasons,
  COMPILE_ELIGIBLE_CONFIDENCES,
  computeLineHunks,
  defaultCompileEpisodes,
  extractCommentKeywords,
  extractSuggestionBlock,
  hasLexicalOverlap,
  isCompileEligible,
  linkAcceptedFix,
  type LinkAcceptedFixInput,
} from "./accepted-fix.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesPath = path.join(
  here,
  "..",
  "testdata",
  "accepted-fix",
  "cases.json",
);

type GoldenCase = {
  id: string;
  description: string;
  path: string;
  commentBody: string;
  rejected: CodeSpan | null;
  beforeText: string | null;
  afterText: string | null;
  afterSha: string | null;
  expected: {
    linkConfidence: string;
    linkReason: string;
    accepted: {
      path: string;
      startLine: number;
      endLine: number;
      sha: string;
      text: string;
      normalized: string;
    } | null;
  };
};

describe("linkAcceptedFix — TRD confidence matrix (LNK-2 / LNK-3)", () => {
  it("matches the TRD confidence table golden cases", async () => {
    const cases = JSON.parse(await readFile(casesPath, "utf8")) as GoldenCase[];
    expect(cases.map((c) => c.id).sort()).toEqual([
      "high-exact-span-replacement",
      "high-suggestion-block-applied",
      "low-same-file-only",
      "medium-overlap-lexical",
      "none-no-change",
    ]);

    const mismatches: string[] = [];
    for (const c of cases) {
      const result = linkAcceptedFix({
        path: c.path,
        commentBody: c.commentBody,
        rejected: c.rejected,
        beforeText: c.beforeText,
        afterText: c.afterText,
        afterSha: c.afterSha,
      });

      if (result.linkConfidence !== c.expected.linkConfidence) {
        mismatches.push(
          `${c.id}: linkConfidence expected ${c.expected.linkConfidence}, got ${result.linkConfidence}`,
        );
      }
      if (result.linkReason !== c.expected.linkReason) {
        mismatches.push(
          `${c.id}: linkReason expected ${c.expected.linkReason}, got ${result.linkReason}`,
        );
      }
      if (JSON.stringify(result.accepted) !== JSON.stringify(c.expected.accepted)) {
        mismatches.push(
          `${c.id}: accepted mismatch\n  expected: ${JSON.stringify(c.expected.accepted)}\n  got:      ${JSON.stringify(result.accepted)}`,
        );
      } else if (result.accepted !== null) {
        parseArtifact(CodeSpanSchema, result.accepted, "CodeSpan");
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("covers every TRD confidence matrix row exactly once", async () => {
    const cases = JSON.parse(await readFile(casesPath, "utf8")) as GoldenCase[];
    const byConfidence = Object.fromEntries(
      cases.map((c) => [c.expected.linkConfidence, c.id]),
    );
    expect(byConfidence).toMatchObject({
      high: expect.any(String),
      medium: "medium-overlap-lexical",
      low: "low-same-file-only",
      none: "none-no-change",
    });
    expect(
      cases.filter((c) => c.expected.linkConfidence === "high").map((c) => c.id),
    ).toEqual(
      expect.arrayContaining([
        "high-suggestion-block-applied",
        "high-exact-span-replacement",
      ]),
    );
  });
});

describe("isCompileEligible — LNK-6", () => {
  it("allows only high and medium by default", () => {
    expect(COMPILE_ELIGIBLE_CONFIDENCES).toEqual(["high", "medium"]);
    expect(isCompileEligible("high")).toBe(true);
    expect(isCompileEligible("medium")).toBe(true);
    expect(isCompileEligible("low")).toBe(false);
    expect(isCompileEligible("none")).toBe(false);
  });

  it("never auto-promotes low/none matrix outcomes", async () => {
    const cases = JSON.parse(await readFile(casesPath, "utf8")) as GoldenCase[];
    for (const c of cases) {
      const result = linkAcceptedFix({
        path: c.path,
        commentBody: c.commentBody,
        rejected: c.rejected,
        beforeText: c.beforeText,
        afterText: c.afterText,
        afterSha: c.afterSha,
      });
      const eligible = isCompileEligible(result.linkConfidence);
      if (
        result.linkConfidence === "low" ||
        result.linkConfidence === "none"
      ) {
        expect(eligible).toBe(false);
      } else {
        expect(eligible).toBe(true);
      }
    }
  });
});

describe("defaultCompileEpisodes — Checkpoint 2 Quarantine", () => {
  it("excludes low/none from default compile input", () => {
    const episodes = [
      { id: "h", linkConfidence: "high" as const },
      { id: "m", linkConfidence: "medium" as const },
      { id: "l", linkConfidence: "low" as const },
      { id: "n", linkConfidence: "none" as const },
    ];
    const eligible = defaultCompileEpisodes(episodes);
    expect(eligible.map((e) => e.id)).toEqual(["h", "m"]);
    expect(
      eligible.every((e) => isCompileEligible(e.linkConfidence)),
    ).toBe(true);
  });

  it("returns empty when only quarantined confidences are present", () => {
    expect(
      defaultCompileEpisodes([
        { linkConfidence: "low" as const },
        { linkConfidence: "none" as const },
      ]),
    ).toEqual([]);
  });
});

describe("linkAcceptedFix — helpers + edge cases", () => {
  it("extractSuggestionBlock reads GitHub suggestion fences", () => {
    expect(
      extractSuggestionBlock("x\n```suggestion\nfoo();\n```\ny"),
    ).toBe("foo();");
    expect(extractSuggestionBlock("no fence")).toBeNull();
  });

  it("extractCommentKeywords drops stopwords and fences", () => {
    const keys = extractCommentKeywords(
      "Please use the shared cache helper.\n```suggestion\nignore();\n```",
    );
    expect(keys.has("please")).toBe(false);
    expect(keys.has("shared")).toBe(true);
    expect(keys.has("cache")).toBe(true);
    expect(keys.has("helper")).toBe(true);
    expect(keys.has("ignore")).toBe(false);
  });

  it("hasLexicalOverlap matches keyword tokens in code", () => {
    expect(
      hasLexicalOverlap(new Set(["memoize", "cache"]), "sharedCache.memoize(x)"),
    ).toBe(true);
    expect(hasLexicalOverlap(new Set(["memoize"]), "const x = 1;")).toBe(false);
  });

  it("computeLineHunks finds a single-line replacement", () => {
    const hunks = computeLineHunks("a\nb\nc\n", "a\nB\nc\n");
    expect(hunks).toEqual([
      {
        beforeStart: 2,
        beforeEnd: 2,
        afterStart: 2,
        afterEnd: 2,
        beforeLines: ["b"],
        afterLines: ["B"],
      },
    ]);
  });

  it("returns none when before/after snapshots are missing", () => {
    const rejected: CodeSpan = {
      path: "src/a.ts",
      startLine: 1,
      endLine: 1,
      sha: "x",
      text: "a",
      normalized: "a",
    };
    const input: LinkAcceptedFixInput = {
      path: "src/a.ts",
      commentBody: "change this",
      rejected,
      beforeText: null,
      afterText: "a\n",
      afterSha: "sha",
    };
    expect(linkAcceptedFix(input)).toEqual({
      accepted: null,
      linkConfidence: "none",
      linkReason: AcceptedFixLinkReasons.MISSING_INPUTS,
    });
  });

  it("returns none when rejected locus is missing and no suggestion applied", () => {
    expect(
      linkAcceptedFix({
        path: "src/a.ts",
        commentBody: "please rename this",
        rejected: null,
        beforeText: "a\n",
        afterText: "b\n",
        afterSha: "sha",
      }),
    ).toEqual({
      accepted: null,
      linkConfidence: "none",
      linkReason: AcceptedFixLinkReasons.NO_REJECTED_LOCUS,
    });
  });
});
