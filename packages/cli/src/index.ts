#!/usr/bin/env node
import { pathToFileURL } from "node:url";
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
  CLI_EXIT,
  GraftError,
  GraftErrorCodes,
  parseRepoSlug,
  resolveGraftConfig,
  toPrintableResolvedConfig,
  type Cursors,
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

Commands:
  config   Print resolved Graft config for a repo (no network)
  ingest   Fetch merged PR review history into raw artifacts (ING-1)
  link     Link raw comments into review episodes (LNK-1…5; LLM opt-in)

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
