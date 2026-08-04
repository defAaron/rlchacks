/**
 * API server context (Phase 6.3).
 */

import { resolveGraftConfig } from "@graft/shared";

export type ApiContext = {
  repo: string;
  owner: string;
  name: string;
  dataDir: string;
};

export type ResolveApiContextOptions = {
  repo?: string;
  env?: NodeJS.ProcessEnv;
};

export async function resolveApiContext(
  options: ResolveApiContextOptions = {},
): Promise<ApiContext> {
  const resolveOpts: Parameters<typeof resolveGraftConfig>[0] = {
    init: false,
  };
  if (options.repo !== undefined) {
    resolveOpts.repo = options.repo;
  }
  if (options.env !== undefined) {
    resolveOpts.env = options.env;
  }
  const resolved = await resolveGraftConfig(resolveOpts);
  return {
    repo: resolved.repoSlug,
    owner: resolved.repo.owner,
    name: resolved.repo.name,
    dataDir: resolved.paths.dataDir,
  };
}
