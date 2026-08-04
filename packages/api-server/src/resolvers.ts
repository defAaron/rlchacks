/**
 * GraphQL resolvers — thin layer over @graft/retrieval (Phase 6.3).
 */

import {
  applyPreview,
  explainRecipe,
  getFreshnessSummary,
  listRecipes,
  loadRecipeIndex,
  suggestGrafts,
  suppressRecipe,
  type RecipeCard,
} from "@graft/retrieval";
import type { RewriteRecipe } from "@graft/shared";
import { GraphQLError } from "graphql";
import type { ApiContext } from "./context.js";

function toGraphqlError(err: unknown): GraphQLError {
  if (err instanceof GraphQLError) {
    return err;
  }
  if (err !== null && typeof err === "object" && "code" in err) {
    const code = String((err as { code: unknown }).code);
    const message =
      err instanceof Error ? err.message : "Graft error";
    return new GraphQLError(message, { extensions: { code } });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new GraphQLError(message);
}

async function withGql<T>(
  ctx: ApiContext,
  fn: (ctx: ApiContext) => Promise<T>,
): Promise<T> {
  try {
    return await fn(ctx);
  } catch (err) {
    throw toGraphqlError(err);
  }
}

function cardConfidence(card: RecipeCard): "high" | "medium" | "low" {
  return card.confidence;
}

function recipeToGraphql(
  recipe: RewriteRecipe,
  card?: RecipeCard,
): {
  id: string;
  title: string;
  rationale: string;
  before: string;
  after: string;
  support: number;
  confidence: "high" | "medium" | "low";
  pathPrefixes: string[];
  suppressed: boolean;
  evidenceCount: number;
} {
  const confidence =
    card?.confidence ??
    (recipe.avgLinkConfidence >= 0.85
      ? "high"
      : recipe.avgLinkConfidence >= 0.6
        ? "medium"
        : "low");
  return {
    id: recipe.id,
    title: recipe.title,
    rationale: recipe.rationale,
    before: recipe.before,
    after: recipe.after,
    support: recipe.support,
    confidence,
    pathPrefixes: recipe.scope.pathPrefixes,
    suppressed: recipe.suppressed,
    evidenceCount: recipe.episodeIds.length,
  };
}

async function loadRecipes(ctx: ApiContext) {
  return loadRecipeIndex({
    dataDir: ctx.dataDir,
    owner: ctx.owner,
    name: ctx.name,
  });
}

export const resolvers = {
  Query: {
    health: () => "ok",

    async recipes(
      _: unknown,
      args: {
        path?: string;
        language?: string;
        q?: string;
        limit?: number;
      },
      ctx: ApiContext,
    ) {
      return withGql(ctx, async (apiCtx) => {
        const loaded = await loadRecipes(apiCtx);
      const listOpts: Parameters<typeof listRecipes>[1] = {};
      if (args.path !== undefined) {
        listOpts.path = args.path;
      }
      if (args.language !== undefined) {
        listOpts.language = args.language;
      }
      if (args.q !== undefined) {
        listOpts.q = args.q;
      }
      if (args.limit !== undefined) {
        listOpts.limit = args.limit;
      }
      const listed = listRecipes(loaded.recipes, listOpts);
      const byId = new Map(loaded.recipes.map((r) => [r.id, r]));
      return listed.recipes.map((card) => {
        const full = byId.get(card.id);
        if (full === undefined) {
          throw new GraphQLError(`Recipe missing on disk: ${card.id}`, {
            extensions: { code: "GRAFT_NOT_FOUND" },
          });
        }
        return recipeToGraphql(full, card);
      });
      });
    },

    async recipe(_: unknown, args: { id: string }, ctx: ApiContext) {
      return withGql(ctx, async (apiCtx) => {
        const loaded = await loadRecipes(apiCtx);
      const found = loaded.recipes.find((r) => r.id === args.id);
      if (found === undefined) {
        const { loadRewriteRecipeById } = await import("@graft/compile");
        const byId = await loadRewriteRecipeById(
          apiCtx.dataDir,
          apiCtx.owner,
          apiCtx.name,
          args.id,
        );
        if (byId === null) {
          return null;
        }
        return recipeToGraphql(byId);
      }
      const card = listRecipes([found]).recipes[0];
      return recipeToGraphql(found, card);
      });
    },

    async suggestGrafts(
      _: unknown,
      args: {
        diff?: string;
        code?: string;
        path?: string;
        limit?: number;
      },
      ctx: ApiContext,
    ) {
      return withGql(ctx, async (apiCtx) => {
        const loaded = await loadRecipes(apiCtx);
        const hasDiff = args.diff !== undefined && args.diff.trim() !== "";
        const hasCode = args.code !== undefined && args.code.trim() !== "";
        if (!hasDiff && !hasCode) {
          throw new GraphQLError("Provide diff or code + path.", {
            extensions: { code: "GRAFT_INVALID_DIFF" },
          });
        }
        if (hasCode && (args.path === undefined || args.path.trim() === "")) {
          throw new GraphQLError("path is required when code is provided.", {
            extensions: { code: "GRAFT_INVALID_DIFF" },
          });
        }

        const suggestOpts: Parameters<typeof suggestGrafts>[0] = {
          dataDir: apiCtx.dataDir,
          owner: apiCtx.owner,
          name: apiCtx.name,
          recipes: loaded.recipes,
        };
      if (args.limit !== undefined) {
        suggestOpts.limit = args.limit;
      }
      if (hasDiff && args.diff !== undefined) {
        suggestOpts.diff = args.diff;
      } else if (hasCode && args.path !== undefined && args.code !== undefined) {
        suggestOpts.files = [{ path: args.path, content: args.code }];
      }

      const result = await suggestGrafts(suggestOpts);
      return result.suggestions;
      });
    },

    async freshness(_: unknown, __: unknown, ctx: ApiContext) {
      return withGql(ctx, async (apiCtx) => {
        const summary = await getFreshnessSummary(
          apiCtx.dataDir,
          apiCtx.owner,
          apiCtx.name,
        );
      return {
        repo: summary.repo,
        ingestAt: summary.ingestAt,
        linkAt: summary.linkAt,
        compileAt: summary.compileAt,
        episodes: summary.episodeCount,
        recipes: summary.recipeCount,
        stale: summary.stale,
        reason: summary.reason,
      };
      });
    },

    async applyPreview(
      _: unknown,
      args: {
        recipeId: string;
        path: string;
        startLine?: number;
        endLine?: number;
      },
      ctx: ApiContext,
    ) {
      return withGql(ctx, async (apiCtx) => {
        const input: Parameters<typeof applyPreview>[3] = {
          recipeId: args.recipeId,
          path: args.path,
        };
      if (args.startLine !== undefined) {
        input.startLine = args.startLine;
      }
      if (args.endLine !== undefined) {
        input.endLine = args.endLine;
      }
      const preview = await applyPreview(
        apiCtx.dataDir,
        apiCtx.owner,
        apiCtx.name,
        input,
      );
      return {
        recipeId: preview.recipeId,
        title: preview.title,
        rationale: preview.rationale,
        matchPath: preview.matchPath,
        unifiedDiff: preview.patch,
        warnings: preview.warnings,
      };
      });
    },
  },

  Mutation: {
    async suppressRecipe(
      _: unknown,
      args: { id: string; suppressed: boolean },
      ctx: ApiContext,
    ) {
      return withGql(ctx, async (apiCtx) => {
        const result = await suppressRecipe(
          apiCtx.dataDir,
          apiCtx.owner,
          apiCtx.name,
          args.id,
          args.suppressed,
        );
        const card = listRecipes([result.recipe]).recipes[0];
        return recipeToGraphql(result.recipe, card);
      });
    },
  },

  Recipe: {
    async evidence(parent: { id: string }, _: unknown, ctx: ApiContext) {
      return withGql(ctx, async (apiCtx) => {
        const explained = await explainRecipe(
          apiCtx.dataDir,
          apiCtx.owner,
          apiCtx.name,
          parent.id,
        );
        return explained.evidence;
      });
    },
  },
};
