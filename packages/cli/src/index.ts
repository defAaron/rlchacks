#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  compileRepository,
  type CompileRepositoryResult,
} from "@graft/compile";
import {
  createGitHubClientFromEnv,
  GitHubAccessError,
  ingestRepository,
  type GitHubClient,
  type IngestRepositoryResult,
} from "@graft/ingestion";
import {
  createLinkLlmClientFromEnv,
  hasLlmApiKey,
  linkRepository,
  type LinkEpisodeLabel,
  type LinkRepositoryResult,
} from "@graft/linking";
import {
  defaultCursors,
  readCursors,
  writeCursors,
} from "@graft/pipeline";
import {
  explainRecipe,
  formatStaleBanner,
  getFreshnessSummary,
  listRecipes,
  loadRecipeIndex,
  suggestGrafts,
  suppressRecipe,
  type ExplainRecipeResult,
  type FreshnessSummary,
  type ListRecipesResult,
  type SuggestGraftsResult,
  type SuppressRecipeResult,
} from "@graft/retrieval";
import { runStdioServer } from "@graft/mcp-server";
import { runApiServer } from "@graft/api-server";
import { purgeRepository } from "@graft/pipeline";
import {
  CLI_EXIT,
  GraftError,
  GraftErrorCodes,
  parseRepoSlug,
  resolveGraftConfig,
  toPrintableResolvedConfig,
  type Cursors,
  type CompileCursor,
  type IngestCursor,
  type LinkCursor,
} from "@graft/shared";

export const PKG = "@graft/cli" as const;

type ConfigCliOptions = {
  repo: string | undefined;
  init: boolean;
};

export type IngestCliOptions = {
  repo: string;
  maxPrs: number;
};

export type RunIngestOptions = {
  repo: string;
  maxPrs?: number;
  env?: NodeJS.ProcessEnv;
  /** Injected client for offline tests; live runs use env token. */
  client?: GitHubClient;
  /** Injected clock for duration tests. */
  now?: () => number;
  log?: (line: string) => void;
};

export type IngestCliSummary = {
  repo: string;
  prs: number;
  comments: number;
  blobs: number;
  prsNew: number;
  commentsNew: number;
  blobsNew: number;
  durationMs: number;
  ingestWatermark: IngestCursor;
};

export type LinkCliOptions = {
  repo: string;
};

export type RunLinkOptions = {
  repo: string;
  env?: NodeJS.ProcessEnv;
  /** Injected clock for duration + watermark timestamps. */
  now?: () => number;
  log?: (line: string) => void;
};

export type LinkCliSummary = {
  repo: string;
  episodes: number;
  discards: number;
  mediumOrHigher: number;
  durationMs: number;
  linkWatermark: LinkCursor;
  /** Per-episode confidence labels for CLI output (SAF-4 / Checkpoint 2 Labels). */
  episodeLabels: LinkEpisodeLabel[];
};

export type CompileCliOptions = {
  repo: string;
};

export type RunCompileOptions = {
  repo: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  log?: (line: string) => void;
};

export type CompileCliSummary = {
  repo: string;
  recipes: number;
  eligibleEpisodes: number;
  inputEpisodes: number;
  clustersFormed: number;
  durationMs: number;
  compileWatermark: CompileCursor;
  staleBanner: string | null;
};

export type SuggestCliOptions = {
  repo: string;
  diffFile?: string;
  pathHint?: string;
};

export type RunSuggestOptions = {
  repo: string;
  diff?: string;
  pathHint?: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
};

export type SuggestCliSummary = {
  repo: string;
  suggestions: SuggestGraftsResult["suggestions"];
  warnings: string[];
  staleBanner: string | null;
  freshness: FreshnessSummary;
};

export type RecipesListCliOptions = {
  repo: string;
  path?: string;
  language?: string;
  q?: string;
};

export type RecipesExplainCliOptions = {
  repo: string;
  recipeId: string;
};

export type RecipesSuppressCliOptions = {
  repo: string;
  recipeId: string;
  unsuppress?: boolean;
};

export type PurgeCliOptions = {
  repo: string;
};

export type ServeMcpCliOptions = {
  repo?: string;
};

export type ServeApiCliOptions = {
  repo?: string;
  host?: string;
  port?: number;
};

export type MainOptions = {
  env?: NodeJS.ProcessEnv;
  /** Override stderr for tests (default `console.error`). */
  error?: (line: string) => void;
  /** Injected GitHub client for offline ingest tests. */
  client?: GitHubClient;
};

function printUsage(error: (line: string) => void = console.error): void {
  error(`Usage:
  graft config [--repo owner/name] [--init]
  graft ingest <owner/repo> [--max-prs 200]
  graft link <owner/repo>
  graft compile <owner/repo>
  graft suggest <owner/repo> [--diff file|-] [--path hint]
  graft recipes list <owner/repo> [--path prefix] [--language lang] [--q text]
  graft recipes explain <owner/repo> <recipe-id>
  graft recipes suppress <owner/repo> <recipe-id> [--unsuppress]
  graft purge <owner/repo>
  graft serve mcp [--repo owner/name]
  graft serve api [--repo owner/name] [--host host] [--port n]

Commands:
  config   Print resolved Graft config for a repo (no network)
  ingest   Fetch merged PR review history into raw artifacts (ING-1)
  link     Link raw comments into review episodes (LNK-1…5; LLM opt-in)
  compile  Cluster episodes into rewrite recipes (RCP-1…4)
  suggest  Match recipes to a unified diff and rank suggestions (RET-2…5)
  recipes  List, explain, or suppress compiled recipes
  purge    Delete all artifact data for a repo (SAF-5)
  serve    Start MCP stdio server or HTTP GraphQL API (DEV-5)

Exit codes (TRD §9):
  0  ok
  1  usage / general error
  2  no data (GRAFT_NO_DATA — later stages)
  3  GitHub / auth failure`);
}

/** Map thrown errors to TRD §9 exit codes. */
export function cliExitCode(err: unknown): number {
  if (err instanceof GitHubAccessError) {
    return CLI_EXIT.GITHUB;
  }
  if (
    err instanceof GraftError &&
    err.code === GraftErrorCodes.GRAFT_NO_DATA
  ) {
    return CLI_EXIT.NO_DATA;
  }
  return CLI_EXIT.ERROR;
}

/** User-facing error text (no stack) for expected failures. */
export function formatCliErrorMessage(err: unknown): string {
  if (err instanceof GitHubAccessError || err instanceof GraftError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function parseConfigArgs(args: string[]): ConfigCliOptions {
  let repo: string | undefined;
  let init = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--init") {
      init = true;
      continue;
    }
    if (arg === "--repo") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--repo requires owner/name");
      }
      repo = value;
      i++;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { repo, init };
}

export function parseIngestArgs(args: string[]): IngestCliOptions {
  let repo: string | undefined;
  let maxPrs = 200;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--max-prs") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--max-prs requires a positive integer");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`--max-prs must be a positive integer; got ${value}`);
      }
      maxPrs = parsed;
      i++;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (repo !== undefined) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    repo = arg;
  }

  if (repo === undefined) {
    throw new Error("Missing repo; usage: graft ingest <owner/repo>");
  }

  // Validate slug early for clear errors.
  parseRepoSlug(repo);
  return { repo, maxPrs };
}

export function parseLinkArgs(args: string[]): LinkCliOptions {
  let repo: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (repo !== undefined) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    repo = arg;
  }

  if (repo === undefined) {
    throw new Error("Missing repo; usage: graft link <owner/repo>");
  }

  parseRepoSlug(repo);
  return { repo };
}

export function parseCompileArgs(args: string[]): CompileCliOptions {
  let repo: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (repo !== undefined) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    repo = arg;
  }

  if (repo === undefined) {
    throw new Error("Missing repo; usage: graft compile <owner/repo>");
  }

  parseRepoSlug(repo);
  return { repo };
}

export function parseSuggestArgs(args: string[]): SuggestCliOptions {
  let repo: string | undefined;
  let diffFile: string | undefined;
  let pathHint: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--diff") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--diff requires a file path or -");
      }
      diffFile = value;
      i++;
      continue;
    }
    if (arg === "--path") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--path requires a path hint");
      }
      pathHint = value;
      i++;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (repo !== undefined) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    repo = arg;
  }

  if (repo === undefined) {
    throw new Error("Missing repo; usage: graft suggest <owner/repo> [--diff file]");
  }

  parseRepoSlug(repo);
  const result: SuggestCliOptions = { repo };
  if (diffFile !== undefined) {
    result.diffFile = diffFile;
  }
  if (pathHint !== undefined) {
    result.pathHint = pathHint;
  }
  return result;
}

export function parseRecipesListArgs(args: string[]): RecipesListCliOptions {
  let repo: string | undefined;
  let pathPrefix: string | undefined;
  let language: string | undefined;
  let q: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--path") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--path requires a prefix");
      }
      pathPrefix = value;
      i++;
      continue;
    }
    if (arg === "--language") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--language requires a value");
      }
      language = value;
      i++;
      continue;
    }
    if (arg === "--q") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--q requires a query string");
      }
      q = value;
      i++;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (repo !== undefined) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    repo = arg;
  }

  if (repo === undefined) {
    throw new Error(
      "Missing repo; usage: graft recipes list <owner/repo> [--path prefix]",
    );
  }

  parseRepoSlug(repo);
  const result: RecipesListCliOptions = { repo };
  if (pathPrefix !== undefined) {
    result.path = pathPrefix;
  }
  if (language !== undefined) {
    result.language = language;
  }
  if (q !== undefined) {
    result.q = q;
  }
  return result;
}

export function parseRecipesExplainArgs(args: string[]): RecipesExplainCliOptions {
  let repo: string | undefined;
  let recipeId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (repo === undefined) {
      repo = arg;
      continue;
    }
    if (recipeId === undefined) {
      recipeId = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (repo === undefined) {
    throw new Error(
      "Missing repo; usage: graft recipes explain <owner/repo> <recipe-id>",
    );
  }
  if (recipeId === undefined) {
    throw new Error("Missing recipe id");
  }

  parseRepoSlug(repo);
  return { repo, recipeId };
}

export function parseRecipesSuppressArgs(
  args: string[],
): RecipesSuppressCliOptions {
  let repo: string | undefined;
  let recipeId: string | undefined;
  let unsuppress = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--unsuppress") {
      unsuppress = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (repo === undefined) {
      repo = arg;
      continue;
    }
    if (recipeId === undefined) {
      recipeId = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (repo === undefined) {
    throw new Error(
      "Missing repo; usage: graft recipes suppress <owner/repo> <recipe-id>",
    );
  }
  if (recipeId === undefined) {
    throw new Error("Missing recipe id");
  }

  parseRepoSlug(repo);
  const result: RecipesSuppressCliOptions = { repo, recipeId };
  if (unsuppress) {
    result.unsuppress = true;
  }
  return result;
}

export function parsePurgeArgs(args: string[]): PurgeCliOptions {
  let repo: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (repo !== undefined) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    repo = arg;
  }

  if (repo === undefined) {
    throw new Error("Missing repo; usage: graft purge <owner/repo>");
  }

  parseRepoSlug(repo);
  return { repo };
}

export function parseServeMcpArgs(args: string[]): ServeMcpCliOptions {
  let repo: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--repo") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--repo requires owner/name");
      }
      repo = value;
      i++;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (repo !== undefined) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    repo = arg;
  }

  if (repo !== undefined) {
    parseRepoSlug(repo);
  }
  const result: ServeMcpCliOptions = {};
  if (repo !== undefined) {
    result.repo = repo;
  }
  return result;
}

export function parseServeApiArgs(args: string[]): ServeApiCliOptions {
  let repo: string | undefined;
  let host: string | undefined;
  let port: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--repo") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--repo requires owner/name");
      }
      repo = value;
      i++;
      continue;
    }
    if (arg === "--host") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--host requires a hostname");
      }
      host = value;
      i++;
      continue;
    }
    if (arg === "--port") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--port requires a positive integer");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`--port must be a positive integer; got ${value}`);
      }
      port = parsed;
      i++;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (repo !== undefined) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    repo = arg;
  }

  if (repo !== undefined) {
    parseRepoSlug(repo);
  }
  const result: ServeApiCliOptions = {};
  if (repo !== undefined) {
    result.repo = repo;
  }
  if (host !== undefined) {
    result.host = host;
  }
  if (port !== undefined) {
    result.port = port;
  }
  return result;
}

function mergeIngestWatermark(
  previous: IngestCursor,
  next: IngestCursor | null,
): IngestCursor {
  if (next === null || next.lastMergedAt === null || next.lastPrNumber === null) {
    return previous;
  }
  if (previous.lastMergedAt === null) {
    return next;
  }
  if (next.lastMergedAt > previous.lastMergedAt) {
    return next;
  }
  if (next.lastMergedAt < previous.lastMergedAt) {
    return previous;
  }
  const prevNumber = previous.lastPrNumber ?? 0;
  return next.lastPrNumber >= prevNumber ? next : previous;
}

async function persistIngestWatermark(
  dataDir: string,
  owner: string,
  name: string,
  suggested: IngestCursor | null,
): Promise<Cursors> {
  const existing = (await readCursors(dataDir, owner, name)) ?? defaultCursors();
  const updated: Cursors = {
    ...existing,
    ingest: mergeIngestWatermark(existing.ingest, suggested),
  };
  await writeCursors(dataDir, owner, name, updated);
  return updated;
}

function formatIngestSummary(summary: IngestCliSummary): string {
  return JSON.stringify(summary, null, 2);
}

/**
 * Run `graft ingest` orchestration: fetch raw artifacts, update ingest watermark,
 * print structured counts (prs / comments / blobs / duration).
 */
export async function runIngest(
  options: RunIngestOptions,
): Promise<IngestCliSummary> {
  const maxPrs = options.maxPrs ?? 200;
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => console.log(line));
  const now = options.now ?? Date.now;

  const resolved = await resolveGraftConfig({
    repo: options.repo,
    env,
    init: true,
  });
  const { owner, name } = resolved.repo;
  const dataDir = resolved.paths.dataDir;

  const client = options.client ?? createGitHubClientFromEnv(env);

  const existing =
    (await readCursors(dataDir, owner, name)) ?? defaultCursors();
  const since = existing.ingest.lastMergedAt;

  const started = now();
  const result: IngestRepositoryResult = await ingestRepository({
    client,
    dataDir,
    owner,
    repo: name,
    maxPrs,
    since,
    onPrIngested: async ({ watermark }) => {
      // Advance cursor after each PR so an interrupt can resume via `since`.
      await persistIngestWatermark(dataDir, owner, name, watermark);
    },
  });
  const durationMs = Math.max(0, now() - started);

  const cursors = await persistIngestWatermark(
    dataDir,
    owner,
    name,
    result.watermark,
  );

  const summary: IngestCliSummary = {
    repo: `${owner}/${name}`,
    prs: result.prs,
    comments: result.comments,
    blobs: result.blobs,
    prsNew: result.prsNew,
    commentsNew: result.commentsNew,
    blobsNew: result.blobsNew,
    durationMs,
    ingestWatermark: cursors.ingest,
  };

  log(formatIngestSummary(summary));
  return summary;
}

async function runConfig(
  args: string[],
  options: MainOptions,
): Promise<void> {
  const opts = parseConfigArgs(args);
  const resolveOpts: Parameters<typeof resolveGraftConfig>[0] = {
    init: opts.init,
  };
  if (opts.repo !== undefined) {
    resolveOpts.repo = opts.repo;
  }
  if (options.env !== undefined) {
    resolveOpts.env = options.env;
  }

  const resolved = await resolveGraftConfig(resolveOpts);
  const printable = toPrintableResolvedConfig(resolved);
  console.log(JSON.stringify(printable, null, 2));
}

async function runIngestCommand(
  args: string[],
  options: MainOptions,
): Promise<void> {
  const opts = parseIngestArgs(args);
  const ingestOpts: RunIngestOptions = {
    repo: opts.repo,
    maxPrs: opts.maxPrs,
  };
  if (options.env !== undefined) {
    ingestOpts.env = options.env;
  }
  if (options.client !== undefined) {
    ingestOpts.client = options.client;
  }
  await runIngest(ingestOpts);
}

async function persistLinkWatermark(
  dataDir: string,
  owner: string,
  name: string,
  updatedAt: string,
): Promise<Cursors> {
  const existing = (await readCursors(dataDir, owner, name)) ?? defaultCursors();
  const updated: Cursors = {
    ...existing,
    link: { updatedAt },
  };
  await writeCursors(dataDir, owner, name, updated);
  return updated;
}

function formatLinkSummary(summary: LinkCliSummary): string {
  return JSON.stringify(summary, null, 2);
}

/**
 * Run `graft link` orchestration: raw → episodes/index, update link watermark.
 */
export async function runLink(
  options: RunLinkOptions,
): Promise<LinkCliSummary> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => console.log(line));
  const now = options.now ?? Date.now;

  const resolved = await resolveGraftConfig({
    repo: options.repo,
    env,
    init: true,
  });
  const { owner, name } = resolved.repo;
  const dataDir = resolved.paths.dataDir;

  // LLM validation is opt-in (SAF-2): flag + key + client; otherwise zero calls.
  const llmEnabled = resolved.env.llmEnabled;
  const llmApiKeyPresent = hasLlmApiKey(env);
  const llmClient =
    llmEnabled && llmApiKeyPresent
      ? createLinkLlmClientFromEnv(env)
      : undefined;

  const started = now();
  const result: LinkRepositoryResult = await linkRepository({
    dataDir,
    owner,
    name,
    now: () => new Date(now()),
    llmEnabled,
    llmApiKeyPresent,
    ...(llmClient !== undefined ? { llmClient } : {}),
  });
  const durationMs = Math.max(0, now() - started);

  const cursors = await persistLinkWatermark(
    dataDir,
    owner,
    name,
    result.updatedAt,
  );

  const summary: LinkCliSummary = {
    repo: result.repo,
    episodes: result.episodes,
    discards: result.discards,
    mediumOrHigher: result.mediumOrHigher,
    durationMs,
    linkWatermark: cursors.link,
    episodeLabels: result.episodeLabels,
  };

  log(formatLinkSummary(summary));
  return summary;
}

async function persistCompileWatermark(
  dataDir: string,
  owner: string,
  name: string,
  updatedAt: string,
  compileRunId: string,
): Promise<Cursors> {
  const existing = (await readCursors(dataDir, owner, name)) ?? defaultCursors();
  const updated: Cursors = {
    ...existing,
    compile: { updatedAt, compileRunId },
  };
  await writeCursors(dataDir, owner, name, updated);
  return updated;
}

function formatCompileSummary(summary: CompileCliSummary): string {
  return JSON.stringify(summary, null, 2);
}

/**
 * Run `graft compile` — episodes → recipes; updates compile watermark.
 */
export async function runCompile(
  options: RunCompileOptions,
): Promise<CompileCliSummary> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => console.log(line));
  const now = options.now ?? Date.now;

  const resolved = await resolveGraftConfig({
    repo: options.repo,
    env,
    init: true,
  });
  const { owner, name } = resolved.repo;
  const dataDir = resolved.paths.dataDir;

  const freshness = await getFreshnessSummary(dataDir, owner, name);
  const staleBanner = formatStaleBanner(freshness);

  const started = now();
  const result: CompileRepositoryResult = await compileRepository({
    dataDir,
    owner,
    name,
    minSupport: resolved.repoConfig.compile.minSupport,
    allowSingleHighConfidence:
      resolved.repoConfig.compile.allowSingleHighConfidence,
    now: () => new Date(now()),
  });
  const durationMs = Math.max(0, now() - started);

  const cursors = await persistCompileWatermark(
    dataDir,
    owner,
    name,
    result.updatedAt,
    result.compileRunId,
  );

  const summary: CompileCliSummary = {
    repo: result.repo,
    recipes: result.recipesWritten,
    eligibleEpisodes: result.eligibleEpisodes,
    inputEpisodes: result.inputEpisodes,
    clustersFormed: result.clustersFormed,
    durationMs,
    compileWatermark: cursors.compile,
    staleBanner,
  };

  if (staleBanner !== null) {
    log(staleBanner);
  }
  log(formatCompileSummary(summary));
  return summary;
}

async function readDiffInput(diffFile?: string): Promise<string> {
  if (diffFile === undefined) {
    throw new Error("--diff is required; usage: graft suggest <owner/repo> --diff file|-");
  }
  if (diffFile === "-") {
    const { stdin } = await import("node:process");
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  const { readFile } = await import("node:fs/promises");
  return readFile(diffFile, "utf8");
}

function formatSuggestSummary(summary: SuggestCliSummary): string {
  return JSON.stringify(summary, null, 2);
}

/**
 * Run `graft suggest` — match diff against recipes; evidence required.
 */
export async function runSuggest(
  options: RunSuggestOptions,
): Promise<SuggestCliSummary> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => console.log(line));

  const resolved = await resolveGraftConfig({
    repo: options.repo,
    env,
    init: false,
  });
  const { owner, name } = resolved.repo;
  const dataDir = resolved.paths.dataDir;

  const freshness = await getFreshnessSummary(dataDir, owner, name);
  const staleBanner = formatStaleBanner(freshness);

  const loaded = await loadRecipeIndex({ dataDir, owner, name });
  if (options.diff === undefined || options.diff.trim() === "") {
    throw new Error(
      "--diff is required; usage: graft suggest <owner/repo> --diff file|-",
    );
  }

  const result = await suggestGrafts({
    dataDir,
    owner,
    name,
    recipes: loaded.recipes,
    diff: options.diff,
    ...(options.pathHint !== undefined ? { pathHint: options.pathHint } : {}),
  });

  const summary: SuggestCliSummary = {
    repo: loaded.repo,
    suggestions: result.suggestions,
    warnings: result.warnings,
    staleBanner,
    freshness,
  };

  if (staleBanner !== null) {
    log(staleBanner);
  }
  log(formatSuggestSummary(summary));
  return summary;
}

function formatListSummary(result: ListRecipesResult & { repo: string; staleBanner: string | null }): string {
  return JSON.stringify(result, null, 2);
}

export async function runRecipesList(
  options: RecipesListCliOptions & { env?: NodeJS.ProcessEnv; log?: (line: string) => void },
): Promise<ListRecipesResult & { repo: string; staleBanner: string | null }> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => console.log(line));

  const resolved = await resolveGraftConfig({
    repo: options.repo,
    env,
    init: false,
  });
  const { owner, name } = resolved.repo;
  const dataDir = resolved.paths.dataDir;

  const freshness = await getFreshnessSummary(dataDir, owner, name);
  const staleBanner = formatStaleBanner(freshness);

  const loaded = await loadRecipeIndex({ dataDir, owner, name });
  const listOpts: Parameters<typeof listRecipes>[1] = {};
  if (options.path !== undefined) {
    listOpts.path = options.path;
  }
  if (options.language !== undefined) {
    listOpts.language = options.language;
  }
  if (options.q !== undefined) {
    listOpts.q = options.q;
  }

  const listed = listRecipes(loaded.recipes, listOpts);
  const output = { repo: loaded.repo, staleBanner, ...listed };

  if (staleBanner !== null) {
    log(staleBanner);
  }
  log(formatListSummary(output));
  return output;
}

export async function runRecipesExplain(
  options: RecipesExplainCliOptions & { env?: NodeJS.ProcessEnv; log?: (line: string) => void },
): Promise<ExplainRecipeResult> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => console.log(line));

  const resolved = await resolveGraftConfig({
    repo: options.repo,
    env,
    init: false,
  });
  const { owner, name } = resolved.repo;
  const dataDir = resolved.paths.dataDir;

  const result = await explainRecipe(
    dataDir,
    owner,
    name,
    options.recipeId,
  );
  log(JSON.stringify(result, null, 2));
  return result;
}

export async function runRecipesSuppress(
  options: RecipesSuppressCliOptions & {
    env?: NodeJS.ProcessEnv;
    log?: (line: string) => void;
  },
): Promise<SuppressRecipeResult> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => console.log(line));

  const resolved = await resolveGraftConfig({
    repo: options.repo,
    env,
    init: false,
  });
  const { owner, name } = resolved.repo;
  const dataDir = resolved.paths.dataDir;

  const result = await suppressRecipe(
    dataDir,
    owner,
    name,
    options.recipeId,
    options.unsuppress !== true,
  );
  log(JSON.stringify(result, null, 2));
  return result;
}

export async function runPurge(
  options: PurgeCliOptions & {
    env?: NodeJS.ProcessEnv;
    log?: (line: string) => void;
  },
): Promise<{ repo: string; removed: boolean; path: string }> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => console.log(line));

  const resolved = await resolveGraftConfig({
    repo: options.repo,
    env,
    init: false,
  });
  const { owner, name } = resolved.repo;
  const dataDir = resolved.paths.dataDir;

  const result = await purgeRepository(dataDir, owner, name);
  log(JSON.stringify(result, null, 2));
  return result;
}

async function runLinkCommand(
  args: string[],
  options: MainOptions,
): Promise<void> {
  const opts = parseLinkArgs(args);
  const linkOpts: RunLinkOptions = {
    repo: opts.repo,
  };
  if (options.env !== undefined) {
    linkOpts.env = options.env;
  }
  await runLink(linkOpts);
}

async function runCompileCommand(
  args: string[],
  options: MainOptions,
): Promise<void> {
  const opts = parseCompileArgs(args);
  const compileOpts: RunCompileOptions = { repo: opts.repo };
  if (options.env !== undefined) {
    compileOpts.env = options.env;
  }
  await runCompile(compileOpts);
}

async function runSuggestCommand(
  args: string[],
  options: MainOptions,
): Promise<void> {
  const opts = parseSuggestArgs(args);
  const diff =
    opts.diffFile !== undefined ? await readDiffInput(opts.diffFile) : undefined;
  const suggestOpts: RunSuggestOptions = { repo: opts.repo };
  if (options.env !== undefined) {
    suggestOpts.env = options.env;
  }
  if (diff !== undefined) {
    suggestOpts.diff = diff;
  }
  if (opts.pathHint !== undefined) {
    suggestOpts.pathHint = opts.pathHint;
  }
  await runSuggest(suggestOpts);
}

async function runRecipesCommand(
  args: string[],
  options: MainOptions,
): Promise<void> {
  const [sub, ...rest] = args;
  if (sub === "list") {
    const opts = parseRecipesListArgs(rest);
    const listOpts = { ...opts };
    if (options.env !== undefined) {
      Object.assign(listOpts, { env: options.env });
    }
    await runRecipesList(listOpts);
    return;
  }
  if (sub === "explain") {
    const opts = parseRecipesExplainArgs(rest);
    const explainOpts = { ...opts };
    if (options.env !== undefined) {
      Object.assign(explainOpts, { env: options.env });
    }
    await runRecipesExplain(explainOpts);
    return;
  }
  if (sub === "suppress") {
    const opts = parseRecipesSuppressArgs(rest);
    const suppressOpts = { ...opts };
    if (options.env !== undefined) {
      Object.assign(suppressOpts, { env: options.env });
    }
    await runRecipesSuppress(suppressOpts);
    return;
  }
  throw new Error(
    sub === undefined
      ? "Missing recipes subcommand; use list, explain, or suppress"
      : `Unknown recipes subcommand: ${sub}`,
  );
}

async function runPurgeCommand(
  args: string[],
  options: MainOptions,
): Promise<void> {
  const opts = parsePurgeArgs(args);
  const purgeOpts = { ...opts };
  if (options.env !== undefined) {
    Object.assign(purgeOpts, { env: options.env });
  }
  await runPurge(purgeOpts);
}

async function runServeCommand(
  args: string[],
  options: MainOptions,
): Promise<void> {
  const [sub, ...rest] = args;
  if (sub !== "mcp") {
    if (sub === "api") {
      const opts = parseServeApiArgs(rest);
      const serveOpts: Parameters<typeof runApiServer>[0] = {};
      if (options.env !== undefined) {
        serveOpts.env = options.env;
      }
      if (opts.repo !== undefined) {
        serveOpts.repo = opts.repo;
      }
      if (opts.host !== undefined) {
        serveOpts.host = opts.host;
      }
      if (opts.port !== undefined) {
        serveOpts.port = opts.port;
      }
      const started = await runApiServer(serveOpts);
      console.log(
        JSON.stringify(
          {
            status: "listening",
            host: started.host,
            port: started.port,
            graphql: `http://${started.host}:${started.port}/graphql`,
            health: `http://${started.host}:${started.port}/health`,
          },
          null,
          2,
        ),
      );
      await new Promise<void>(() => {
        /* block until signal */
      });
      return;
    }
    throw new Error(
      sub === undefined
        ? "Missing serve subcommand; use mcp or api"
        : `Unknown serve subcommand: ${sub}`,
    );
  }
  const opts = parseServeMcpArgs(rest);
  const serveOpts: Parameters<typeof runStdioServer>[0] = {};
  if (options.env !== undefined) {
    serveOpts.env = options.env;
  }
  if (opts.repo !== undefined) {
    serveOpts.repo = opts.repo;
  }
  await runStdioServer(serveOpts);
}

export async function main(
  argv: string[],
  options: MainOptions = {},
): Promise<number> {
  const error = options.error ?? ((line: string) => console.error(line));

  try {
    const [command, ...rest] = argv;

    if (command === undefined || command === "--help" || command === "-h") {
      printUsage(error);
      return command === undefined ? CLI_EXIT.ERROR : CLI_EXIT.OK;
    }

    if (command === "config") {
      await runConfig(rest, options);
      return CLI_EXIT.OK;
    }

    if (command === "ingest") {
      await runIngestCommand(rest, options);
      return CLI_EXIT.OK;
    }

    if (command === "link") {
      await runLinkCommand(rest, options);
      return CLI_EXIT.OK;
    }

    if (command === "compile") {
      await runCompileCommand(rest, options);
      return CLI_EXIT.OK;
    }

    if (command === "suggest") {
      await runSuggestCommand(rest, options);
      return CLI_EXIT.OK;
    }

    if (command === "recipes") {
      await runRecipesCommand(rest, options);
      return CLI_EXIT.OK;
    }

    if (command === "purge") {
      await runPurgeCommand(rest, options);
      return CLI_EXIT.OK;
    }

    if (command === "serve") {
      await runServeCommand(rest, options);
      return CLI_EXIT.OK;
    }

    error(`Unknown command: ${command}`);
    printUsage(error);
    return CLI_EXIT.ERROR;
  } catch (err: unknown) {
    error(formatCliErrorMessage(err));
    return cliExitCode(err);
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exit(code);
    },
    (err: unknown) => {
      // Defensive: main() already catches; keep process from hanging on bugs.
      const message = err instanceof Error ? err.message : String(err);
      console.error(message);
      process.exit(CLI_EXIT.ERROR);
    },
  );
}
