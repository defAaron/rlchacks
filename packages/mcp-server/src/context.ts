/**
 * Repo-scoped MCP server context (SAF-1).
 */

import {
  getFreshnessSummary,
  loadRecipeIndex,
  type LoadedRecipeIndex,
} from "@graft/retrieval";
import { resolveGraftConfig } from "@graft/shared";

export type McpServerContext = {
  dataDir: string;
  owner: string;
  name: string;
  repoSlug: string;
};

export type ResolveMcpContextOptions = {
  env?: NodeJS.ProcessEnv;
  /** Explicit repo slug; falls back to GRAFT_REPO. */
  repo?: string;
};

export async function resolveMcpContext(
  options: ResolveMcpContextOptions = {},
): Promise<McpServerContext> {
  const env = options.env ?? process.env;
  const resolveOpts: Parameters<typeof resolveGraftConfig>[0] = { env, init: false };
  if (options.repo !== undefined) {
    resolveOpts.repo = options.repo;
  }
  const resolved = await resolveGraftConfig(resolveOpts);
  const { owner, name } = resolved.repo;
  return {
    dataDir: resolved.paths.dataDir,
    owner,
    name,
    repoSlug: `${owner}/${name}`,
  };
}

/** In-memory recipe cache; reload when compile watermark changes (TRD §14). */
export class RecipeIndexCache {
  private loaded: LoadedRecipeIndex | null = null;
  private compileAt: string | null | undefined;

  async get(ctx: McpServerContext): Promise<LoadedRecipeIndex> {
    const freshness = await getFreshnessSummary(
      ctx.dataDir,
      ctx.owner,
      ctx.name,
    );
    if (
      this.loaded !== null &&
      this.compileAt === freshness.compileAt
    ) {
      return this.loaded;
    }
    this.loaded = await loadRecipeIndex({
      dataDir: ctx.dataDir,
      owner: ctx.owner,
      name: ctx.name,
    });
    this.compileAt = freshness.compileAt;
    return this.loaded;
  }

  clear(): void {
    this.loaded = null;
    this.compileAt = undefined;
  }
}
