/**
 * Deterministic recipe title + rationale from comment keywords (Phase 3.3).
 */

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "before",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "please",
  "the",
  "this",
  "to",
  "use",
  "with",
  "you",
  "your",
  "we",
  "should",
  "can",
  "instead",
  "rather",
  "just",
  "also",
  "that",
  "these",
  "those",
  "not",
  "no",
  "do",
  "does",
  "did",
  "was",
  "were",
  "will",
  "would",
  "could",
  "may",
  "might",
  "must",
  "need",
  "needs",
  "add",
  "make",
  "sure",
]);

function extractKeywords(bodies: string[]): string[] {
  const freq = new Map<string, number>();
  for (const body of bodies) {
    const words =
      body
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)) ?? [];
    for (const word of words) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([word]) => word);
}

function capitalize(s: string): string {
  if (s.length === 0) {
    return s;
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type TitleInput = {
  commentBodies: string[];
  support: number;
  pathPrefix: string;
};

export type TitleResult = {
  title: string;
  rationale: string;
};

/** Deterministic title/rationale — no LLM (GRAFT_LLM_ENABLED irrelevant here). */
export function deriveTitleAndRationale(input: TitleInput): TitleResult {
  const keywords = extractKeywords(input.commentBodies);
  const keywordPhrase =
    keywords.length > 0
      ? keywords.slice(0, 3).join(", ")
      : "historical review pattern";

  const scopeHint = input.pathPrefix.replace(/\/$/, "") || "repo";

  const title =
    keywords.length > 0
      ? `${capitalize(keywords[0]!)}: ${scopeHint} rewrite (${input.support} reviews)`
      : `Review rewrite in ${scopeHint} (${input.support} reviews)`;

  const rationale = `Past reviewers flagged ${keywordPhrase} in ${scopeHint}; accepted fixes clustered from ${input.support} linked episode(s).`;

  return { title, rationale };
}
