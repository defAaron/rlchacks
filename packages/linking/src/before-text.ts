/**
 * Best-effort `beforeText` when Phase 1 only stored merge-tip blobs.
 *
 * ## Limitations (Phase 1 tip-only)
 *
 * - Ingest persists file text at the **merge commit**, not the comment commit.
 * - Overlap / exact-replacement confidence needs a true before snapshot.
 * - When a comment-commit blob is present (enhanced seed / future ingest),
 *   prefer that over reconstruction.
 * - Otherwise reverse-apply the review `diffHunk` onto the tip when the tip
 *   still matches the hunk's right-hand side; if the tip diverged (fix landed
 *   after the comment), reconstruction fails and callers may fall back to tip
 *   (which usually yields `no_change` / `none`).
 */

import { splitBlobLines } from "./rejected-span.js";

type ParsedUnifiedHunk = {
  leftStart: number;
  rightStart: number;
  /** Old-file lines in hunk order (context + deletions), no prefix. */
  leftLines: string[];
  /** New-file lines in hunk order (context + additions), no prefix. */
  rightLines: string[];
};

/**
 * Parse the first GitHub-style unified hunk into left/right line lists.
 */
export function parseUnifiedDiffHunk(
  diffHunk: string,
): ParsedUnifiedHunk | null {
  const lines = diffHunk.replace(/\r\n/g, "\n").split("\n");
  let headerIdx = -1;
  let leftStart = 0;
  let rightStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s@@/.exec(
      lines[i] ?? "",
    );
    if (match) {
      headerIdx = i;
      leftStart = Number(match[1]);
      rightStart = Number(match[2]);
      break;
    }
  }
  if (
    headerIdx < 0 ||
    !Number.isFinite(leftStart) ||
    !Number.isFinite(rightStart) ||
    leftStart < 1 ||
    rightStart < 1
  ) {
    return null;
  }

  const leftLines: string[] = [];
  const rightLines: string[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (raw.startsWith("@@")) break;
    if (raw.startsWith("\\")) continue;

    const prefix = raw.charAt(0);
    const content = raw.length > 0 ? raw.slice(1) : "";

    if (prefix === " ") {
      leftLines.push(content);
      rightLines.push(content);
    } else if (prefix === "-") {
      leftLines.push(content);
    } else if (prefix === "+") {
      rightLines.push(content);
    } else if (raw.length === 0) {
      leftLines.push("");
      rightLines.push("");
    }
  }

  if (leftLines.length === 0 && rightLines.length === 0) return null;
  return { leftStart, rightStart, leftLines, rightLines };
}

/**
 * Reverse-apply a unified hunk onto tip (`after`) text to estimate before.
 * Returns null when the tip does not contain the hunk's right-hand lines
 * at the expected offsets (tip diverged from comment-time right side).
 */
export function reconstructBeforeFromTipAndHunk(
  afterText: string,
  diffHunk: string | null | undefined,
): string | null {
  if (diffHunk === null || diffHunk === undefined || diffHunk.trim() === "") {
    return null;
  }
  const parsed = parseUnifiedDiffHunk(diffHunk);
  if (parsed === null) return null;
  if (parsed.rightLines.length === 0) {
    // Pure deletion hunk — insert left lines at rightStart.
    const afterLines = splitBlobLines(afterText);
    const idx = Math.max(0, parsed.rightStart - 1);
    const beforeLines = [
      ...afterLines.slice(0, idx),
      ...parsed.leftLines,
      ...afterLines.slice(idx),
    ];
    return `${beforeLines.join("\n")}\n`;
  }

  const afterLines = splitBlobLines(afterText);
  const start = parsed.rightStart - 1;
  const end = start + parsed.rightLines.length;
  if (start < 0 || end > afterLines.length) return null;

  for (let i = 0; i < parsed.rightLines.length; i++) {
    if (afterLines[start + i] !== parsed.rightLines[i]) {
      return null;
    }
  }

  const beforeLines = [
    ...afterLines.slice(0, start),
    ...parsed.leftLines,
    ...afterLines.slice(end),
  ];
  return `${beforeLines.join("\n")}\n`;
}

export type ResolveBeforeTextInput = {
  /** Preferred: file text at the comment commit. */
  commentCommitText?: string | null;
  /** Merge-tip file text (Phase 1 default). */
  tipText?: string | null;
  diffHunk?: string | null;
};

export type ResolveBeforeTextResult = {
  beforeText: string | null;
  source: "comment_commit_blob" | "hunk_reverse" | "tip_fallback" | "none";
};

/**
 * Resolve best-effort before text for accepted-fix linking.
 */
export function resolveBeforeText(
  input: ResolveBeforeTextInput,
): ResolveBeforeTextResult {
  const commentText = input.commentCommitText ?? null;
  if (commentText !== null && commentText !== "") {
    return { beforeText: commentText, source: "comment_commit_blob" };
  }

  const tipText = input.tipText ?? null;
  if (tipText !== null && tipText !== "") {
    const fromHunk = reconstructBeforeFromTipAndHunk(tipText, input.diffHunk);
    if (fromHunk !== null) {
      return { beforeText: fromHunk, source: "hunk_reverse" };
    }
    return { beforeText: tipText, source: "tip_fallback" };
  }

  return { beforeText: null, source: "none" };
}
