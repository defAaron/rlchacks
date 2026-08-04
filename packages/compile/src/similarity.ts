/**
 * Token Jaccard + length ratio similarity for episode clustering (TRD §7.3).
 */

/** Tokenize normalized code into alphanumeric chunks. */
export function tokenizeNormalized(text: string): Set<string> {
  const tokens = text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  return new Set(tokens.filter((t) => t.length > 0));
}

/** Jaccard similarity between two token sets. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection++;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Length ratio: min/max of combined normalized string lengths. */
export function lengthRatio(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0 && lenB === 0) {
    return 1;
  }
  const max = Math.max(lenA, lenB);
  if (max === 0) {
    return 0;
  }
  return Math.min(lenA, lenB) / max;
}

export type EpisodePairLike = {
  rejectedNormalized: string;
  acceptedNormalized: string;
};

/** Combined similarity score in [0, 1] for clustering merge decisions. */
export function pairSimilarity(a: EpisodePairLike, b: EpisodePairLike): number {
  const combinedA = `${a.rejectedNormalized}\n${a.acceptedNormalized}`;
  const combinedB = `${b.rejectedNormalized}\n${b.acceptedNormalized}`;

  const tokensA = tokenizeNormalized(combinedA);
  const tokensB = tokenizeNormalized(combinedB);
  const jaccard = jaccardSimilarity(tokensA, tokensB);
  const length = lengthRatio(combinedA, combinedB);

  // TRD: token Jaccard + length ratio — equal weight blend.
  return 0.5 * jaccard + 0.5 * length;
}
