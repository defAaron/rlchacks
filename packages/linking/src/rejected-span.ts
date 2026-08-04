/**
 * Rejected span extraction (TRD §7.2, LNK-1 / Step 2.2).
 *
 * 1. Prefer GitHub line + side + path against a file blob.
 * 2. Else parse `diffHunk` for right-side lines.
 * 3. Else `linkConfidence: none`.
 *
 * Returns a partial link result; Step 2.3 fills accepted + final confidence.
 */

import type { CodeSpan, LinkConfidence, RawReviewComment } from "@graft/shared";
import { normalizeCodeSpanText } from "./normalize-code.js";

export const RejectedSpanLinkReasons = {
  LINE_BLOB: "rejected_from_line_blob",
  DIFF_HUNK: "rejected_from_diff_hunk",
  NONE: "rejected_span_none",
} as const;

export type RejectedSpanLinkReason =
  (typeof RejectedSpanLinkReasons)[keyof typeof RejectedSpanLinkReasons];

export type RejectedSpanSource = "line_blob" | "diff_hunk" | "none";

export type ExtractRejectedSpanInput = {
  comment: Pick<
    RawReviewComment,
    "path" | "line" | "originalLine" | "side" | "diffHunk" | "commitId"
  >;
  /**
   * File text at the comment locus (prefer the commit blob for RIGHT-side).
   * When absent or unusable, extraction falls back to `diffHunk`.
   */
  blobText?: string | null;
  /** Git blob sha written into `CodeSpan.sha` on the line/blob path. */
  blobSha?: string | null;
};

export type RejectedSpanExtraction = {
  rejected: CodeSpan | null;
  /**
   * Provisional: `none` when no rejected span; `null` when a span was found
   * and Step 2.3 still needs to assign final link confidence.
   */
  linkConfidence: LinkConfidence | null;
  linkReason: RejectedSpanLinkReason;
  source: RejectedSpanSource;
};

type DiffSide = "LEFT" | "RIGHT";

type HunkRightLine = {
  lineNumber: number;
  content: string;
  kind: "context" | "add";
};

type ParsedDiffHunk = {
  rightStart: number;
  rightLines: HunkRightLine[];
};

function makeCodeSpan(args: {
  path: string;
  startLine: number;
  endLine: number;
  sha: string;
  text: string;
}): CodeSpan {
  return {
    path: args.path,
    startLine: args.startLine,
    endLine: args.endLine,
    sha: args.sha,
    text: args.text,
    normalized: normalizeCodeSpanText(args.text),
  };
}

function noneResult(): RejectedSpanExtraction {
  return {
    rejected: null,
    linkConfidence: "none",
    linkReason: RejectedSpanLinkReasons.NONE,
    source: "none",
  };
}

function successResult(
  rejected: CodeSpan,
  source: Exclude<RejectedSpanSource, "none">,
  linkReason: Exclude<RejectedSpanLinkReason, "rejected_span_none">,
): RejectedSpanExtraction {
  return {
    rejected,
    linkConfidence: null,
    linkReason,
    source,
  };
}

/** Normalize GitHub `side` (string/number) to LEFT/RIGHT when recognized. */
export function normalizeCommentSide(
  side: RawReviewComment["side"],
): DiffSide | null {
  if (side === null || side === undefined) return null;
  const raw = String(side).trim().toUpperCase();
  if (raw === "LEFT" || raw === "L") return "LEFT";
  if (raw === "RIGHT" || raw === "R") return "RIGHT";
  return null;
}

/** Split file text into 1-based lines, dropping a trailing empty EOF line. */
export function splitBlobLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Parse a GitHub-style unified `diffHunk` and collect right-side lines
 * (context ` ` and additions `+`) with their new-file line numbers.
 */
export function parseDiffHunkRightLines(
  diffHunk: string,
): ParsedDiffHunk | null {
  const lines = diffHunk.replace(/\r\n/g, "\n").split("\n");
  let headerIdx = -1;
  let rightStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s@@/.exec(
      lines[i] ?? "",
    );
    if (match) {
      headerIdx = i;
      rightStart = Number(match[2]);
      break;
    }
  }
  if (headerIdx < 0 || !Number.isFinite(rightStart) || rightStart < 1) {
    return null;
  }

  const rightLines: HunkRightLine[] = [];
  let rightLine = rightStart;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (raw.startsWith("@@")) break;
    if (raw.startsWith("\\")) continue;

    const prefix = raw.charAt(0);
    const content = raw.length > 0 ? raw.slice(1) : "";

    if (prefix === "+" || prefix === " ") {
      rightLines.push({
        lineNumber: rightLine,
        content,
        kind: prefix === "+" ? "add" : "context",
      });
      rightLine += 1;
    } else if (prefix === "-") {
      // Left-side only — do not advance right line counter.
      continue;
    } else if (raw.length === 0) {
      // Empty line without prefix — treat as blank context.
      rightLines.push({
        lineNumber: rightLine,
        content: "",
        kind: "context",
      });
      rightLine += 1;
    }
  }

  if (rightLines.length === 0) return null;
  return { rightStart, rightLines };
}

function tryExtractFromLineBlob(
  comment: ExtractRejectedSpanInput["comment"],
  blobText: string,
  blobSha: string,
): CodeSpan | null {
  const side = normalizeCommentSide(comment.side);
  // LEFT maps to the base/old file; ingest blobs are file contents at a ref
  // (merge/commit tip), so only RIGHT (or unspecified) can use the blob path.
  if (side === "LEFT") return null;

  const line = comment.line ?? comment.originalLine;
  if (line === null) return null;

  const lines = splitBlobLines(blobText);
  if (line < 1 || line > lines.length) return null;

  const text = lines[line - 1];
  if (text === undefined) return null;

  return makeCodeSpan({
    path: comment.path,
    startLine: line,
    endLine: line,
    sha: blobSha,
    text,
  });
}

function spanFromRightLines(
  path: string,
  sha: string,
  chosen: HunkRightLine[],
): CodeSpan | null {
  if (chosen.length === 0) return null;
  const first = chosen[0];
  const last = chosen[chosen.length - 1];
  if (first === undefined || last === undefined) return null;

  return makeCodeSpan({
    path,
    startLine: first.lineNumber,
    endLine: last.lineNumber,
    sha,
    text: chosen.map((l) => l.content).join("\n"),
  });
}

function tryExtractFromDiffHunk(
  comment: ExtractRejectedSpanInput["comment"],
): CodeSpan | null {
  const hunk = comment.diffHunk;
  if (hunk === null || hunk.trim() === "") return null;

  const parsed = parseDiffHunkRightLines(hunk);
  if (parsed === null) return null;

  const sha =
    comment.commitId !== null && comment.commitId.trim() !== ""
      ? comment.commitId
      : "diff-hunk";

  const side = normalizeCommentSide(comment.side);
  // RIGHT (or unspecified) line numbers map onto the hunk's new-file side.
  // LEFT comments refer to the old file — do not match originalLine against
  // right-side numbering; fall through to added/all right lines.
  if (side !== "LEFT") {
    const targetLine = comment.line ?? comment.originalLine;
    if (targetLine !== null) {
      const hit = parsed.rightLines.find((l) => l.lineNumber === targetLine);
      if (hit !== undefined) {
        return spanFromRightLines(comment.path, sha, [hit]);
      }
    }
  }

  // No usable target line: prefer added right-side lines, else all right lines.
  const added = parsed.rightLines.filter((l) => l.kind === "add");
  return spanFromRightLines(
    comment.path,
    sha,
    added.length > 0 ? added : parsed.rightLines,
  );
}

/**
 * Extract the rejected code span for a review comment (LNK-1).
 */
export function extractRejectedSpan(
  input: ExtractRejectedSpanInput,
): RejectedSpanExtraction {
  const blobText = input.blobText ?? null;
  const blobSha = input.blobSha ?? null;

  if (
    blobText !== null &&
    blobText !== "" &&
    blobSha !== null &&
    blobSha.trim() !== ""
  ) {
    const fromBlob = tryExtractFromLineBlob(
      input.comment,
      blobText,
      blobSha.trim(),
    );
    if (fromBlob !== null) {
      return successResult(
        fromBlob,
        "line_blob",
        RejectedSpanLinkReasons.LINE_BLOB,
      );
    }
  }

  const fromHunk = tryExtractFromDiffHunk(input.comment);
  if (fromHunk !== null) {
    return successResult(
      fromHunk,
      "diff_hunk",
      RejectedSpanLinkReasons.DIFF_HUNK,
    );
  }

  return noneResult();
}
