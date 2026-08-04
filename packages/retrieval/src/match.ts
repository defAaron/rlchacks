/**
 * Diff / code matching + TRD scoring (Phase 4.3 / RET-2, RET-4, RET-5).
 */

import { normalizeForClustering, tokenizeNormalized, jaccardSimilarity } from "@graft/compile";
import type {
  GraftSuggestion,
  ReviewEpisode,
  RewriteRecipe,
  SuggestionConfidence,
  SuggestionEvidence,
} from "@graft/shared";
import { type DiffHunk, hunkSnippet, parseUnifiedDiff } from "./diff-parser.js";

export type MatchContext = {
  recipes: readonly RewriteRecipe[];
  episodesById: Map<string, ReviewEpisode>;
  diff?: string;
  /** Raw file contents when diff is absent. */
  files?: Array<{ path: string; content: string }>;
  pathHint?: string;
  limit?: number;
};

export type MatchCandidate = {
  recipe: RewriteRecipe;
  matchPath: string;
  matchRange: { startLine: number; endLine: number } | null;
  signalMatchStrength: number;
  pathSpecificity: number;
  recency: number;
  score: number;
};

function confidenceLabel(avg: number): SuggestionConfidence {
  if (avg >= 0.85) {
    return "high";
  }
  if (avg >= 0.6) {
    return "medium";
  }
  return "low";
}

function pathMatchesScope(filePath: string, recipe: RewriteRecipe): boolean {
  return recipe.scope.pathPrefixes.some((prefix) => {
    const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return filePath === prefix.replace(/\/$/, "") || filePath.startsWith(p);
  });
}

function signalMatchStrength(
  snippet: string,
  recipe: RewriteRecipe,
): number {
  if (recipe.beforeSignals.length === 0) {
    return 0;
  }
  const haystack = snippet.toLowerCase();
  let hits = 0;
  for (const signal of recipe.beforeSignals) {
    if (haystack.includes(signal.toLowerCase())) {
      hits++;
    }
  }
  return hits / recipe.beforeSignals.length;
}

function normalizedSimilarity(aText: string, bText: string): number {
  const a = tokenizeNormalized(normalizeForClustering(aText));
  const b = tokenizeNormalized(normalizeForClustering(bText));
  return jaccardSimilarity(a, b);
}

function normalizedBeforeSimilarity(
  snippet: string,
  recipe: RewriteRecipe,
): number {
  return normalizedSimilarity(snippet, recipe.before);
}

function pathSpecificity(filePath: string, recipe: RewriteRecipe): number {
  let best = 0;
  for (const prefix of recipe.scope.pathPrefixes) {
    const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
    if (filePath.startsWith(normalized) || filePath === prefix.replace(/\/$/, "")) {
      const depth = prefix.split("/").filter(Boolean).length;
      best = Math.max(best, Math.min(1, depth / 4));
    }
  }
  return best;
}

function recencyScore(recipe: RewriteRecipe, episodes: ReviewEpisode[]): number {
  if (episodes.length === 0) {
    return 0;
  }
  const latest = episodes.reduce((max, ep) =>
    ep.mergedAt > max ? ep.mergedAt : max,
  episodes[0]!.mergedAt);
  const ageMs = Date.now() - new Date(latest).getTime();
  const yearMs = 365 * 24 * 60 * 60 * 1000;
  return Math.max(0, 1 - ageMs / yearMs);
}

function buildEvidence(
  recipe: RewriteRecipe,
  episodesById: Map<string, ReviewEpisode>,
): SuggestionEvidence[] {
  const evidence: SuggestionEvidence[] = [];
  for (const episodeId of recipe.episodeIds) {
    const ep = episodesById.get(episodeId);
    if (ep === undefined) {
      continue;
    }
    const [owner, name] = ep.repo.split("/");
    const commentUrl =
      `https://github.com/${owner}/${name}/pull/${ep.prNumber}#discussion_${ep.commentId}`;
    evidence.push({
      prNumber: ep.prNumber,
      commentUrl,
      episodeId: ep.id,
    });
  }
  return evidence;
}

/** Hard filter: must have ≥1 evidence pointer (RET-5). */
export function hasEvidence(
  recipe: RewriteRecipe,
  episodesById: Map<string, ReviewEpisode>,
): boolean {
  return buildEvidence(recipe, episodesById).length > 0;
}

function scoreCandidate(
  recipe: RewriteRecipe,
  args: {
    filePath: string;
    snippet: string;
    startLine: number;
    endLine: number;
    episodesById: Map<string, ReviewEpisode>;
    maxSupport: number;
  },
): MatchCandidate | null {
  if (!pathMatchesScope(args.filePath, recipe)) {
    return null;
  }

  const episodes = recipe.episodeIds
    .map((id) => args.episodesById.get(id))
    .filter((e): e is ReviewEpisode => e !== undefined);

  if (!hasEvidence(recipe, args.episodesById)) {
    return null;
  }

  const signal = signalMatchStrength(args.snippet, recipe);
  const beforeSim = normalizedBeforeSimilarity(args.snippet, recipe);
  const combinedSignal = Math.max(signal, beforeSim);

  // Require some match signal — rejected sample should hit, accepted should not.
  if (combinedSignal < 0.15 && beforeSim < 0.35) {
    return null;
  }

  // Self-rewrite guard: if snippet already matches accepted form, skip.
  const acceptedSim = normalizedSimilarity(args.snippet, recipe.after);
  if (acceptedSim >= 0.85 && acceptedSim > beforeSim) {
    return null;
  }

  const supportNorm =
    args.maxSupport > 0 ? recipe.support / args.maxSupport : 0;
  const linkConfidenceNorm = recipe.avgLinkConfidence;
  const pathSpec = pathSpecificity(args.filePath, recipe);
  const recency = recencyScore(recipe, episodes);

  const score =
    0.35 * supportNorm +
    0.25 * linkConfidenceNorm +
    0.2 * pathSpec +
    0.1 * recency +
    0.1 * combinedSignal;

  return {
    recipe,
    matchPath: args.filePath,
    matchRange: { startLine: args.startLine, endLine: args.endLine },
    signalMatchStrength: combinedSignal,
    pathSpecificity: pathSpec,
    recency,
    score,
  };
}

export function matchDiffToRecipes(
  ctx: MatchContext,
): MatchCandidate[] {
  const maxSupport = Math.max(1, ...ctx.recipes.map((r) => r.support));
  const candidates: MatchCandidate[] = [];

  const hunks: DiffHunk[] = [];
  if (ctx.diff !== undefined) {
    hunks.push(...parseUnifiedDiff(ctx.diff).hunks);
  }
  if (ctx.files !== undefined) {
    for (const file of ctx.files) {
      hunks.push({
        path: file.path,
        newLines: file.content.split("\n"),
        newStartLine: 1,
        raw: file.content,
      });
    }
  }

  for (const hunk of hunks) {
    const path = ctx.pathHint ?? hunk.path;
    const snippet = hunkSnippet(hunk);
    const endLine = hunk.newStartLine + Math.max(0, hunk.newLines.length - 1);

    for (const recipe of ctx.recipes) {
      const match = scoreCandidate(recipe, {
        filePath: path,
        snippet,
        startLine: hunk.newStartLine,
        endLine,
        episodesById: ctx.episodesById,
        maxSupport,
      });
      if (match !== null) {
        candidates.push(match);
      }
    }
  }

  // Deduplicate by recipe id — keep best score.
  const byRecipe = new Map<string, MatchCandidate>();
  for (const c of candidates) {
    const prev = byRecipe.get(c.recipe.id);
    if (prev === undefined || c.score > prev.score) {
      byRecipe.set(c.recipe.id, c);
    }
  }

  return [...byRecipe.values()].sort((a, b) => b.score - a.score);
}

export function candidatesToSuggestions(
  candidates: MatchCandidate[],
  episodesById: Map<string, ReviewEpisode>,
  buildPatch: (c: MatchCandidate) => string,
  limit = 8,
): GraftSuggestion[] {
  const top = candidates.slice(0, limit);
  return top.map((c, index) => {
    const evidence = buildEvidence(c.recipe, episodesById);
    if (evidence.length === 0) {
      throw new Error(
        `Refusing suggestion without evidence for recipe ${c.recipe.id}`,
      );
    }
    return {
      recipeId: c.recipe.id,
      rank: index + 1,
      score: c.score,
      matchPath: c.matchPath,
      matchRange: c.matchRange,
      patch: buildPatch(c),
      title: c.recipe.title,
      rationale: c.recipe.rationale,
      support: c.recipe.support,
      confidence: confidenceLabel(c.recipe.avgLinkConfidence),
      evidence,
    };
  });
}
