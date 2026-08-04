/**
 * Unified diff parser for suggest matching (Phase 4.3).
 */

import { GraftError, GraftErrorCodes } from "@graft/shared";

export type DiffHunk = {
  path: string;
  /** Lines from the new file side (RIGHT). */
  newLines: string[];
  /** 1-based start line in new file for the hunk body. */
  newStartLine: number;
  /** Raw hunk text including @@ header. */
  raw: string;
};

export type ParsedDiff = {
  hunks: DiffHunk[];
};

export function graftInvalidDiffError(message: string): GraftError {
  return new GraftError(GraftErrorCodes.GRAFT_INVALID_DIFF, message);
}

/** Parse a unified diff into per-file hunks (new-file line focus). */
export function parseUnifiedDiff(diff: string): ParsedDiff {
  const trimmed = diff.trim();
  if (trimmed === "") {
    throw graftInvalidDiffError("Empty diff");
  }

  const hunks: DiffHunk[] = [];
  const lines = diff.split(/\r?\n/);
  let currentPath: string | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    const plusMatch = /^\+\+\+ b\/(.+)$/.exec(line);
    if (plusMatch) {
      currentPath = plusMatch[1] ?? null;
      i++;
      continue;
    }

    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch && currentPath !== null) {
      const newStart = Number.parseInt(hunkMatch[2] ?? "1", 10);
      const hunkLines: string[] = [line];
      const newSideLines: string[] = [];
      i++;

      while (i < lines.length) {
        const hLine = lines[i] ?? "";
        if (hLine.startsWith("@@ ") || hLine.startsWith("diff ")) {
          break;
        }
        if (hLine.startsWith("+++ ") || hLine.startsWith("--- ")) {
          i++;
          continue;
        }
        hunkLines.push(hLine);
        if (hLine.startsWith("+") && !hLine.startsWith("+++")) {
          newSideLines.push(hLine.slice(1));
        } else if (hLine.startsWith(" ")) {
          newSideLines.push(hLine.slice(1));
        }
        i++;
      }

      hunks.push({
        path: currentPath,
        newLines: newSideLines,
        newStartLine: newStart,
        raw: hunkLines.join("\n"),
      });
      continue;
    }

    i++;
  }

  if (hunks.length === 0) {
    throw graftInvalidDiffError(
      "Could not parse unified diff; expected +++ b/<path> and @@ hunks",
    );
  }

  return { hunks };
}

/** Join hunk new-side lines into a single snippet for matching. */
export function hunkSnippet(hunk: DiffHunk): string {
  return hunk.newLines.join("\n");
}
