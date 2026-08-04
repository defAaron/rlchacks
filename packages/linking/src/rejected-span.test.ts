import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CodeSpanSchema, parseArtifact } from "@graft/shared";
import { normalizeCodeSpanText } from "./normalize-code.js";
import {
  extractRejectedSpan,
  normalizeCommentSide,
  parseDiffHunkRightLines,
  RejectedSpanLinkReasons,
  splitBlobLines,
  type ExtractRejectedSpanInput,
} from "./rejected-span.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesPath = path.join(
  here,
  "..",
  "testdata",
  "rejected-span",
  "cases.json",
);
const phase1CommentPath = path.join(
  here,
  "..",
  "..",
  "..",
  "testdata",
  "phase1-seed",
  "repos",
  "acme",
  "widgets",
  "raw",
  "comments",
  "PRRC_kwDOFixtureComment1.json",
);
const phase1BlobPath = path.join(
  here,
  "..",
  "..",
  "..",
  "testdata",
  "phase1-seed",
  "repos",
  "acme",
  "widgets",
  "raw",
  "blobs",
  "blobsha1111111111111111111111111111111111.txt",
);

type GoldenCase = {
  id: string;
  description: string;
  comment: ExtractRejectedSpanInput["comment"];
  blobText: string | null;
  blobSha: string | null;
  expected: {
    source: string;
    linkConfidence: string | null;
    linkReason: string;
    rejected: {
      path: string;
      startLine: number;
      endLine: number;
      sha: string;
      text: string;
      normalized: string;
    } | null;
  };
};

describe("extractRejectedSpan — golden fixtures (LNK-1)", () => {
  it("covers line/blob, diffHunk fallback, and none paths", async () => {
    const cases = JSON.parse(await readFile(casesPath, "utf8")) as GoldenCase[];
    expect(cases.map((c) => c.id).sort()).toEqual([
      "diff-hunk-fallback",
      "line-blob-success",
      "none-neither-works",
    ]);

    const mismatches: string[] = [];
    for (const c of cases) {
      const result = extractRejectedSpan({
        comment: c.comment,
        blobText: c.blobText,
        blobSha: c.blobSha,
      });

      if (result.source !== c.expected.source) {
        mismatches.push(
          `${c.id}: source expected ${c.expected.source}, got ${result.source}`,
        );
      }
      if (result.linkConfidence !== c.expected.linkConfidence) {
        mismatches.push(
          `${c.id}: linkConfidence expected ${JSON.stringify(c.expected.linkConfidence)}, got ${JSON.stringify(result.linkConfidence)}`,
        );
      }
      if (result.linkReason !== c.expected.linkReason) {
        mismatches.push(
          `${c.id}: linkReason expected ${c.expected.linkReason}, got ${result.linkReason}`,
        );
      }
      if (JSON.stringify(result.rejected) !== JSON.stringify(c.expected.rejected)) {
        mismatches.push(
          `${c.id}: rejected mismatch\n  expected: ${JSON.stringify(c.expected.rejected)}\n  got:      ${JSON.stringify(result.rejected)}`,
        );
      } else if (result.rejected !== null) {
        // Ensure golden rejected spans satisfy shared schema
        parseArtifact(CodeSpanSchema, result.rejected, "CodeSpan");
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("extracts rejected span from phase1 comment-commit blob (line/blob)", async () => {
    const comment = JSON.parse(
      await readFile(phase1CommentPath, "utf8"),
    ) as ExtractRejectedSpanInput["comment"] & { id?: string };
    // Enhanced seed: comment-commit blob (before), not merge tip.
    const beforeBlobPath = path.join(
      path.dirname(phase1BlobPath),
      "blobsha2222222222222222222222222222222222.txt",
    );
    const blobText = await readFile(beforeBlobPath, "utf8");

    expect(comment.line).toBe(7);
    expect(splitBlobLines(blobText)[6]).toBe("      lastError = err;");

    const result = extractRejectedSpan({
      comment: {
        path: comment.path,
        line: comment.line,
        originalLine: comment.originalLine,
        side: comment.side,
        diffHunk: comment.diffHunk,
        commitId: comment.commitId,
      },
      blobText,
      blobSha: "blobsha2222222222222222222222222222222222",
    });

    expect(result).toEqual({
      source: "line_blob",
      linkConfidence: null,
      linkReason: RejectedSpanLinkReasons.LINE_BLOB,
      rejected: {
        path: "src/retry.ts",
        startLine: 7,
        endLine: 7,
        sha: "blobsha2222222222222222222222222222222222",
        text: "      lastError = err;",
        normalized: "lastError=err;",
      },
    });
  });

  it("falls back to diffHunk when tip blob line content diverged", async () => {
    const comment = JSON.parse(
      await readFile(phase1CommentPath, "utf8"),
    ) as ExtractRejectedSpanInput["comment"];
    const tipText = await readFile(phase1BlobPath, "utf8");
    // Tip line 7 is the early-return fix, not the rejected line — use an
    // out-of-range line so LNK-1 path 1 fails and hunk fallback runs.
    const result = extractRejectedSpan({
      comment: {
        ...comment,
        line: 99,
        originalLine: 99,
      },
      blobText: tipText,
      blobSha: "blobsha1111111111111111111111111111111111",
    });

    expect(result.source).toBe("diff_hunk");
    expect(result.linkReason).toBe(RejectedSpanLinkReasons.DIFF_HUNK);
    expect(result.rejected).not.toBeNull();
  });
});

describe("extractRejectedSpan — helpers + edge cases", () => {
  it("normalizeCodeSpanText matches shared fixture style", () => {
    expect(normalizeCodeSpanText("setTimeout(() => {}, 1000);")).toBe(
      "setTimeout(()=>{},N);",
    );
  });

  it("normalizeCommentSide accepts LEFT/RIGHT variants", () => {
    expect(normalizeCommentSide("RIGHT")).toBe("RIGHT");
    expect(normalizeCommentSide("left")).toBe("LEFT");
    expect(normalizeCommentSide("R")).toBe("RIGHT");
    expect(normalizeCommentSide(null)).toBeNull();
  });

  it("parseDiffHunkRightLines numbers added lines from the header", () => {
    const parsed = parseDiffHunkRightLines(
      [
        "@@ -1,2 +1,3 @@",
        " keep",
        "+added",
        " tail",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      rightStart: 1,
      rightLines: [
        { lineNumber: 1, content: "keep", kind: "context" },
        { lineNumber: 2, content: "added", kind: "add" },
        { lineNumber: 3, content: "tail", kind: "context" },
      ],
    });
  });

  it("skips LEFT-side blob path and uses diffHunk right lines when possible", () => {
    const result = extractRejectedSpan({
      comment: {
        path: "src/a.ts",
        line: 2,
        originalLine: 2,
        side: "LEFT",
        diffHunk: ["@@ -1,2 +1,2 @@", "-old", "+new", " same"].join("\n"),
        commitId: "abc",
      },
      blobText: "line1\nold\nline3\n",
      blobSha: "blobsha",
    });
    expect(result.source).toBe("diff_hunk");
    expect(result.rejected?.text).toBe("new");
    expect(result.rejected?.startLine).toBe(1);
  });

  it("returns none for malformed hunk with no right-side lines", () => {
    const result = extractRejectedSpan({
      comment: {
        path: "src/a.ts",
        line: null,
        originalLine: null,
        side: "RIGHT",
        diffHunk: "not a hunk",
        commitId: null,
      },
    });
    expect(result).toEqual({
      rejected: null,
      linkConfidence: "none",
      linkReason: RejectedSpanLinkReasons.NONE,
      source: "none",
    });
  });
});
