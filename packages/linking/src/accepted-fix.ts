/**
 * Accepted-fix heuristics + link confidence (TRD §7.2, LNK-2 / LNK-3 / LNK-6).
 *
 * Confidence matrix (TRD):
 * | Suggestion block applied or exact span replacement | high   |
 * | Overlapping line change + lexical overlap          | medium |
 * | Same-file change only                              | low    |
 * | No candidate                                       | none   |
 *
 * ## Inputs the linker expects
 *
 * Phase 1 ingest may only store merge-tip blobs. Overlap heuristics need a
 * **before** snapshot (comment-commit / pre-fix file text) and an **after**
 * snapshot (merge tip). Callers must supply both — tip alone is not enough
 * to detect comment→merge line changes. Synthetic fixtures are fine for tests.
 *
 * - `beforeText` — file at the rejected locus (comment commit)
 * - `afterText` / `afterSha` — merge-tip blob (Phase 1 tip blob is enough here)
 * - `rejected` — from `extractRejectedSpan` (locus + window anchor)
 * - `commentBody` — suggestion fences + lexical keywords
 */

import type { CodeSpan, LinkConfidence } from "@graft/shared";
import { normalizeCodeSpanText } from "./normalize-code.js";
import { splitBlobLines } from "./rejected-span.js";

/** Default ± line window around the rejected span for overlap (TRD §7.2). */
export const DEFAULT_OVERLAP_WINDOW = 3;

/**
 * Confidences eligible for default recipe compile input (LNK-6 / TRD §7.3).
 * `low` / `none` are never auto-promoted.
 */
export const COMPILE_ELIGIBLE_CONFIDENCES = ["high", "medium"] as const;

export type CompileEligibleConfidence =
  (typeof COMPILE_ELIGIBLE_CONFIDENCES)[number];

export const AcceptedFixLinkReasons = {
  SUGGESTION_BLOCK_APPLIED: "suggestion_block_applied",
  EXACT_SPAN_REPLACEMENT: "exact_span_replacement",
  OVERLAP_LEXICAL: "overlap_lexical",
  SAME_FILE_ONLY: "same_file_only",
  NO_CHANGE: "no_change",
  MISSING_INPUTS: "missing_accepted_inputs",
  NO_REJECTED_LOCUS: "no_rejected_locus",
} as const;

export type AcceptedFixLinkReason =
  (typeof AcceptedFixLinkReasons)[keyof typeof AcceptedFixLinkReasons];

export type LinkAcceptedFixInput = {
  path: string;
  commentBody: string;
  /** Rejected span from Step 2.2; required to anchor the overlap window. */
  rejected: CodeSpan | null;
  /**
   * File text at the comment locus (comment commit / pre-fix).
   * Not the same as Phase 1 merge-tip blob unless the tip still matches.
   */
  beforeText?: string | null;
  /** File text at merge tip (post-fix). */
  afterText?: string | null;
  /** Blob/commit sha written into `accepted.sha`. */
  afterSha?: string | null;
  /** ± lines around rejected span. Default {@link DEFAULT_OVERLAP_WINDOW}. */
  overlapWindow?: number;
};

export type AcceptedFixLinkResult = {
  accepted: CodeSpan | null;
  linkConfidence: LinkConfidence;
  linkReason: AcceptedFixLinkReason;
};

type EditHunk = {
  /** 1-based inclusive before range; empty delete/insert uses sentinel conventions. */
  beforeStart: number;
  beforeEnd: number;
  afterStart: number;
  afterEnd: number;
  beforeLines: string[];
  afterLines: string[];
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

/**
 * LNK-6: default compile may only consume high/medium links.
 * Never auto-upgrades `low` / `none`.
 */
export function isCompileEligible(
  confidence: LinkConfidence,
): confidence is CompileEligibleConfidence {
  return confidence === "high" || confidence === "medium";
}

/**
 * Default compile input filter (LNK-6 / Checkpoint 2 Quarantine).
 * Phase 3 `@graft/compile` should use this (or {@link isCompileEligible})
 * so `low` / `none` never enter recipe compilation by default.
 */
export function defaultCompileEpisodes<
  T extends { linkConfidence: LinkConfidence },
>(episodes: readonly T[]): Array<T & { linkConfidence: CompileEligibleConfidence }> {
  return episodes.filter((e): e is T & {
    linkConfidence: CompileEligibleConfidence;
  } => isCompileEligible(e.linkConfidence));
}

/** Extract the first GitHub ` ```suggestion ` block body, if any. */
export function extractSuggestionBlock(commentBody: string): string | null {
  const match = /```suggestion[^\n]*\r?\n([\s\S]*?)```/i.exec(commentBody);
  if (!match) return null;
  const body = match[1] ?? "";
  // Drop a single trailing newline commonly present before the closing fence.
  return body.replace(/\r?\n$/, "");
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "of",
  "and",
  "or",
  "in",
  "on",
  "for",
  "is",
  "be",
  "this",
  "that",
  "please",
  "use",
  "here",
  "over",
  "with",
  "from",
  "should",
  "would",
  "could",
  "we",
  "you",
  "it",
  "as",
  "at",
  "by",
  "not",
  "do",
  "does",
  "did",
  "if",
  "then",
  "than",
  "into",
  "our",
  "your",
  "can",
  "will",
  "just",
  "also",
  "more",
  "some",
  "any",
  "all",
  "no",
  "yes",
  "ok",
  "nit",
  "nits",
]);

/** Comment keywords for lexical overlap (fences stripped; stopwords dropped). */
export function extractCommentKeywords(commentBody: string): Set<string> {
  const withoutFences = commentBody.replace(/```[\s\S]*?```/g, " ");
  const tokens = withoutFences.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [];
  const out = new Set<string>();
  for (const t of tokens) {
    if (!STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

/** True when ≥1 comment keyword appears in code text (token or substring). */
export function hasLexicalOverlap(
  keywords: Set<string>,
  codeText: string,
): boolean {
  if (keywords.size === 0) return false;
  const lower = codeText.toLowerCase();
  const codeTokens = new Set(lower.match(/[a-z][a-z0-9_]{2,}/g) ?? []);
  for (const k of keywords) {
    if (codeTokens.has(k) || lower.includes(k)) return true;
  }
  return false;
}

function textsEqualNormalized(a: string, b: string): boolean {
  return normalizeCodeSpanText(a) === normalizeCodeSpanText(b);
}

/**
 * Line-level LCS diff → contiguous edit hunks (before/after 1-based ranges).
 */
export function computeLineHunks(beforeText: string, afterText: string): EditHunk[] {
  const before = splitBlobLines(beforeText);
  const after = splitBlobLines(afterText);
  const n = before.length;
  const m = after.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (before[i] === after[j]) {
        dp[i]![j] = (dp[i + 1]![j + 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
      }
    }
  }

  type Op =
    | { kind: "eq"; bi: number; ai: number }
    | { kind: "del"; bi: number }
    | { kind: "add"; ai: number };

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ kind: "eq", bi: i, ai: j });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      ops.push({ kind: "del", bi: i });
      i += 1;
    } else {
      ops.push({ kind: "add", ai: j });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ kind: "del", bi: i });
    i += 1;
  }
  while (j < m) {
    ops.push({ kind: "add", ai: j });
    j += 1;
  }

  const hunks: EditHunk[] = [];
  let idx = 0;
  while (idx < ops.length) {
    const op = ops[idx];
    if (op === undefined || op.kind === "eq") {
      idx += 1;
      continue;
    }

    const beforeLines: string[] = [];
    const afterLines: string[] = [];
    let beforeStart = 0;
    let beforeEnd = 0;
    let afterStart = 0;
    let afterEnd = 0;
    let sawBefore = false;
    let sawAfter = false;

    while (idx < ops.length) {
      const cur = ops[idx];
      if (cur === undefined || cur.kind === "eq") break;
      if (cur.kind === "del") {
        const line = before[cur.bi] ?? "";
        beforeLines.push(line);
        const lineNo = cur.bi + 1;
        if (!sawBefore) {
          beforeStart = lineNo;
          sawBefore = true;
        }
        beforeEnd = lineNo;
      } else {
        const line = after[cur.ai] ?? "";
        afterLines.push(line);
        const lineNo = cur.ai + 1;
        if (!sawAfter) {
          afterStart = lineNo;
          sawAfter = true;
        }
        afterEnd = lineNo;
      }
      idx += 1;
    }

    // Pure insert: anchor beforeStart to the line after which content was inserted.
    if (!sawBefore) {
      // Find previous eq before-index, else 0 (insert at file start).
      let prevBefore = 0;
      for (let k = idx - 1; k >= 0; k--) {
        const prev = ops[k];
        if (prev?.kind === "eq") {
          prevBefore = prev.bi + 1;
          break;
        }
        if (prev?.kind === "del") {
          prevBefore = prev.bi + 1;
          break;
        }
      }
      beforeStart = prevBefore + 1;
      beforeEnd = prevBefore;
    }
    // Pure delete: anchor afterStart similarly.
    if (!sawAfter) {
      let prevAfter = 0;
      for (let k = idx - 1; k >= 0; k--) {
        const prev = ops[k];
        if (prev?.kind === "eq") {
          prevAfter = prev.ai + 1;
          break;
        }
        if (prev?.kind === "add") {
          prevAfter = prev.ai + 1;
          break;
        }
      }
      afterStart = prevAfter + 1;
      afterEnd = prevAfter;
    }

    hunks.push({
      beforeStart,
      beforeEnd,
      afterStart,
      afterEnd,
      beforeLines,
      afterLines,
    });
  }

  return hunks;
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function hunkOverlapsRejected(
  hunk: EditHunk,
  rejected: CodeSpan,
  window: number,
): boolean {
  const wStart = Math.max(1, rejected.startLine - window);
  const wEnd = rejected.endLine + window;

  if (hunk.beforeLines.length === 0) {
    // Insertion between beforeEnd and beforeStart (beforeEnd < beforeStart).
    const insertPoint = hunk.beforeEnd;
    return insertPoint >= wStart - 1 && insertPoint <= wEnd;
  }
  return rangesOverlap(hunk.beforeStart, hunk.beforeEnd, wStart, wEnd);
}

function hunkSize(hunk: EditHunk): number {
  return hunk.beforeLines.length + hunk.afterLines.length;
}

function pickSmallest(hunks: EditHunk[]): EditHunk | null {
  if (hunks.length === 0) return null;
  let best = hunks[0]!;
  for (let i = 1; i < hunks.length; i++) {
    const h = hunks[i]!;
    if (hunkSize(h) < hunkSize(best)) best = h;
  }
  return best;
}

function spanFromAfterHunk(
  path: string,
  afterSha: string,
  hunk: EditHunk,
): CodeSpan | null {
  if (hunk.afterLines.length === 0) return null;
  return makeCodeSpan({
    path,
    startLine: hunk.afterStart,
    endLine: hunk.afterEnd,
    sha: afterSha,
    text: hunk.afterLines.join("\n"),
  });
}

function findSuggestionSpanInAfter(
  path: string,
  afterSha: string,
  afterLines: string[],
  suggestion: string,
  rejected: CodeSpan | null,
  window: number,
): CodeSpan | null {
  const suggestionLines = splitBlobLines(suggestion);
  if (suggestionLines.length === 0) return null;

  const candidates: CodeSpan[] = [];
  for (let start = 0; start + suggestionLines.length <= afterLines.length; start++) {
    let match = true;
    for (let k = 0; k < suggestionLines.length; k++) {
      if (afterLines[start + k] !== suggestionLines[k]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    candidates.push(
      makeCodeSpan({
        path,
        startLine: start + 1,
        endLine: start + suggestionLines.length,
        sha: afterSha,
        text: suggestionLines.join("\n"),
      }),
    );
  }

  if (candidates.length === 0) {
    // Normalized fallback: allow whitespace/literal masking differences.
    for (let start = 0; start + suggestionLines.length <= afterLines.length; start++) {
      const slice = afterLines
        .slice(start, start + suggestionLines.length)
        .join("\n");
      if (textsEqualNormalized(slice, suggestion)) {
        candidates.push(
          makeCodeSpan({
            path,
            startLine: start + 1,
            endLine: start + suggestionLines.length,
            sha: afterSha,
            text: slice,
          }),
        );
      }
    }
  }

  if (candidates.length === 0) return null;
  if (rejected === null) return candidates[0] ?? null;

  const wStart = Math.max(1, rejected.startLine - window);
  const wEnd = rejected.endLine + window;
  const near = candidates.filter((c) =>
    rangesOverlap(c.startLine, c.endLine, wStart, wEnd),
  );
  return (near[0] ?? candidates[0]) ?? null;
}

function isExactSpanReplacement(hunk: EditHunk, rejected: CodeSpan): boolean {
  if (hunk.beforeLines.length === 0) return false;
  if (hunk.afterLines.length === 0) return false;
  if (
    hunk.beforeStart !== rejected.startLine ||
    hunk.beforeEnd !== rejected.endLine
  ) {
    return false;
  }
  const beforeText = hunk.beforeLines.join("\n");
  const afterText = hunk.afterLines.join("\n");
  if (beforeText !== rejected.text) return false;
  return beforeText !== afterText;
}

/**
 * Propose an accepted-fix span and assign link confidence (LNK-2, LNK-3).
 *
 * Does not auto-upgrade `low` / `none` (LNK-6) — use {@link isCompileEligible}
 * when selecting compile inputs.
 */
export function linkAcceptedFix(
  input: LinkAcceptedFixInput,
): AcceptedFixLinkResult {
  const beforeText = input.beforeText ?? null;
  const afterText = input.afterText ?? null;
  const afterSha = input.afterSha ?? null;
  const window = input.overlapWindow ?? DEFAULT_OVERLAP_WINDOW;
  const path = input.path;
  const rejected = input.rejected;

  if (
    beforeText === null ||
    afterText === null ||
    afterSha === null ||
    afterSha.trim() === ""
  ) {
    return {
      accepted: null,
      linkConfidence: "none",
      linkReason: AcceptedFixLinkReasons.MISSING_INPUTS,
    };
  }

  if (rejected === null) {
    // Without a rejected locus we only accept a clear applied suggestion.
    const suggestion = extractSuggestionBlock(input.commentBody);
    if (suggestion !== null) {
      const afterLines = splitBlobLines(afterText);
      const span = findSuggestionSpanInAfter(
        path,
        afterSha.trim(),
        afterLines,
        suggestion,
        null,
        window,
      );
      if (span !== null) {
        return {
          accepted: span,
          linkConfidence: "high",
          linkReason: AcceptedFixLinkReasons.SUGGESTION_BLOCK_APPLIED,
        };
      }
    }
    return {
      accepted: null,
      linkConfidence: "none",
      linkReason: AcceptedFixLinkReasons.NO_REJECTED_LOCUS,
    };
  }

  if (beforeText === afterText) {
    return {
      accepted: null,
      linkConfidence: "none",
      linkReason: AcceptedFixLinkReasons.NO_CHANGE,
    };
  }

  const hunks = computeLineHunks(beforeText, afterText);
  if (hunks.length === 0) {
    return {
      accepted: null,
      linkConfidence: "none",
      linkReason: AcceptedFixLinkReasons.NO_CHANGE,
    };
  }

  const suggestion = extractSuggestionBlock(input.commentBody);
  if (suggestion !== null) {
    const afterLines = splitBlobLines(afterText);
    const suggestionSpan = findSuggestionSpanInAfter(
      path,
      afterSha.trim(),
      afterLines,
      suggestion,
      rejected,
      window,
    );
    if (suggestionSpan !== null) {
      return {
        accepted: suggestionSpan,
        linkConfidence: "high",
        linkReason: AcceptedFixLinkReasons.SUGGESTION_BLOCK_APPLIED,
      };
    }
  }

  const overlapping = hunks.filter((h) =>
    hunkOverlapsRejected(h, rejected, window),
  );

  if (overlapping.length > 0) {
    const exact = overlapping.find((h) => isExactSpanReplacement(h, rejected));
    if (exact !== undefined) {
      const accepted = spanFromAfterHunk(path, afterSha.trim(), exact);
      return {
        accepted,
        linkConfidence: "high",
        linkReason: AcceptedFixLinkReasons.EXACT_SPAN_REPLACEMENT,
      };
    }

    const best = pickSmallest(overlapping)!;
    const accepted = spanFromAfterHunk(path, afterSha.trim(), best);
    const keywords = extractCommentKeywords(input.commentBody);
    const lexicalTarget = [
      accepted?.text ?? "",
      best.afterLines.join("\n"),
      best.beforeLines.join("\n"),
    ].join("\n");

    if (hasLexicalOverlap(keywords, lexicalTarget)) {
      return {
        accepted,
        linkConfidence: "medium",
        linkReason: AcceptedFixLinkReasons.OVERLAP_LEXICAL,
      };
    }

    // Overlap without lexical keywords still beats same-file-only: keep medium
    // when the comment has no extractable keywords; otherwise fall to low.
    if (keywords.size === 0) {
      return {
        accepted,
        linkConfidence: "medium",
        linkReason: AcceptedFixLinkReasons.OVERLAP_LEXICAL,
      };
    }

    return {
      accepted,
      linkConfidence: "low",
      linkReason: AcceptedFixLinkReasons.SAME_FILE_ONLY,
    };
  }

  // Same-file change, no line overlap with rejected ± window → low.
  const smallest = pickSmallest(hunks)!;
  const accepted = spanFromAfterHunk(path, afterSha.trim(), smallest);
  return {
    accepted,
    linkConfidence: "low",
    linkReason: AcceptedFixLinkReasons.SAME_FILE_ONLY,
  };
}
