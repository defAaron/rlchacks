/**
 * Orchestrate episodes → rewrite recipes for one repo (Phase 3.4).
 */

import { defaultCompileEpisodes } from "@graft/linking";
import { graftNoDataError, type RewriteRecipe } from "@graft/shared";
import {
  clusterAllEpisodes,
  clusterScope,
  DEFAULT_CLUSTER_THRESHOLD,
  toCompileEpisode,
  type EpisodeCluster,
} from "./cluster.js";
import { loadReviewEpisodes } from "./episode-loader.js";
import { newCompileRunId, stableRecipeId } from "./recipe-id.js";
import {
  clearRecipeArtifacts,
  readSuppressions,
  toRecipeIndexEntry,
  writeCompileMeta,
  writeRecipeIndex,
  writeRewriteRecipe,
  type CompileMeta,
} from "./recipe-store.js";
import { deriveTitleAndRationale } from "./titles.js";

export type CompileRepositoryOptions = {
  dataDir: string;
  owner: string;
  name: string;
  minSupport: number;
  allowSingleHighConfidence?: boolean;
  clusterSimilarityThreshold?: number;
  now?: () => Date;
};

export type CompileRepositoryResult = {
  repo: string;
  compileRunId: string;
  updatedAt: string;
  inputEpisodes: number;
  eligibleEpisodes: number;
  clustersFormed: number;
  recipesWritten: number;
  recipes: RewriteRecipe[];
  meta: CompileMeta;
};

function clusterToRecipe(
  cluster: EpisodeCluster,
  args: {
    repo: string;
    compileRunId: string;
    now: Date;
    suppressedIds: Set<string>;
  },
): RewriteRecipe {
  const medoid = cluster.medoid;
  const scope = clusterScope(cluster);
  const pathPrefix = scope.pathPrefixes[0] ?? "";
  const { title, rationale } = deriveTitleAndRationale({
    commentBodies: cluster.episodes.map((e) => e.commentBody),
    support: cluster.support,
    pathPrefix,
  });

  const id = stableRecipeId(args.repo, cluster.episodeIds);
  const iso = args.now.toISOString();

  return {
    id,
    repo: args.repo,
    title,
    rationale,
    scope,
    before: medoid.rejected.text,
    after: medoid.accepted?.text ?? "",
    beforeSignals: cluster.beforeSignals,
    support: cluster.support,
    episodeIds: cluster.episodeIds,
    reviewers: cluster.reviewers,
    avgLinkConfidence: cluster.avgLinkConfidence,
    suppressed: args.suppressedIds.has(id),
    createdAt: iso,
    updatedAt: iso,
    compileRunId: args.compileRunId,
  };
}

function passesMinSupport(
  cluster: EpisodeCluster,
  minSupport: number,
  allowSingleHighConfidence: boolean,
): boolean {
  if (cluster.support >= minSupport) {
    return true;
  }
  if (
    allowSingleHighConfidence &&
    cluster.support === 1 &&
    cluster.medoid.linkConfidence === "high"
  ) {
    return true;
  }
  return false;
}

/**
 * Compile linked episodes into rewrite recipes on disk.
 * Uses {@link defaultCompileEpisodes} — never promotes low/none (LNK-6).
 */
export async function compileRepository(
  options: CompileRepositoryOptions,
): Promise<CompileRepositoryResult> {
  const repo = `${options.owner}/${options.name}`;
  const now = options.now ?? (() => new Date());
  const runAt = now();
  const compileRunId = newCompileRunId(repo, runAt);
  const updatedAt = runAt.toISOString();

  const allEpisodes = await loadReviewEpisodes(
    options.dataDir,
    options.owner,
    options.name,
  );
  if (allEpisodes.length === 0) {
    throw graftNoDataError(repo);
  }

  const dropHistogram = {
    belowMinSupport: 0,
    noAccepted: 0,
    lowConfidence: 0,
    noneConfidence: 0,
  };

  for (const ep of allEpisodes) {
    if (ep.accepted === null) {
      dropHistogram.noAccepted++;
    } else if (ep.linkConfidence === "low") {
      dropHistogram.lowConfidence++;
    } else if (ep.linkConfidence === "none") {
      dropHistogram.noneConfidence++;
    }
  }

  const eligible = defaultCompileEpisodes(
    allEpisodes.filter((e) => e.accepted !== null),
  );

  const compileEpisodes = eligible.map(toCompileEpisode);
  const clusters = clusterAllEpisodes(compileEpisodes, {
    similarityThreshold:
      options.clusterSimilarityThreshold ?? DEFAULT_CLUSTER_THRESHOLD,
  });

  const allowSingleHigh =
    options.allowSingleHighConfidence === true;
  const minSupport = options.minSupport;

  const passing = clusters.filter((c) => {
    const ok = passesMinSupport(c, minSupport, allowSingleHigh);
    if (!ok) {
      dropHistogram.belowMinSupport++;
    }
    return ok;
  });

  const suppressedIds = await readSuppressions(
    options.dataDir,
    options.owner,
    options.name,
  );

  await clearRecipeArtifacts(options.dataDir, options.owner, options.name);

  const recipes: RewriteRecipe[] = [];
  for (const cluster of passing) {
    const recipe = clusterToRecipe(cluster, {
      repo,
      compileRunId,
      now: runAt,
      suppressedIds,
    });
    await writeRewriteRecipe(
      options.dataDir,
      options.owner,
      options.name,
      recipe,
    );
    recipes.push(recipe);
  }

  await writeRecipeIndex(options.dataDir, options.owner, options.name, {
    repo,
    updatedAt,
    compileRunId,
    recipes: recipes.map(toRecipeIndexEntry),
  });

  const meta: CompileMeta = {
    repo,
    compileRunId,
    updatedAt,
    thresholds: {
      minSupport,
      allowSingleHighConfidence: allowSingleHigh,
      clusterSimilarityThreshold:
        options.clusterSimilarityThreshold ?? DEFAULT_CLUSTER_THRESHOLD,
    },
    inputEpisodes: allEpisodes.length,
    eligibleEpisodes: eligible.length,
    clustersFormed: clusters.length,
    recipesWritten: recipes.length,
    dropHistogram,
  };

  await writeCompileMeta(options.dataDir, options.owner, options.name, meta);

  return {
    repo,
    compileRunId,
    updatedAt,
    inputEpisodes: allEpisodes.length,
    eligibleEpisodes: eligible.length,
    clustersFormed: clusters.length,
    recipesWritten: recipes.length,
    recipes,
    meta,
  };
}
