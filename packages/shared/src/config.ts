import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertRepoAllowed, parseRepoAllowlist } from "./allowlist.js";
import { GraftArtifactParseError } from "./errors.js";
import { parseArtifact } from "./parse.js";
import {
  DEFAULT_DATA_DIR,
  getDataDir,
  parseRepoSlug,
  repoDataRoot,
  repoScopedPath,
  type RepoRef,
} from "./paths.js";
import { RepoConfigSchema, type RepoConfig } from "./schemas.js";

/** Default compile support threshold when unset (TRD §5.1 / RCP-4). */
export const DEFAULT_MIN_SUPPORT = 2;

/** Privacy / determinism: LLM off unless explicitly enabled (Checkpoint 0). */
export const DEFAULT_LLM_ENABLED = false;

export type GraftEnv = {
  /** Present only when `GITHUB_TOKEN` is non-empty; never persisted to disk. */
  githubToken: string | undefined;
  dataDir: string;
  /** Default `owner/name` from `GRAFT_REPO`, if set. */
  graftRepo: string | undefined;
  minSupport: number;
  llmEnabled: boolean;
  /** True when `GRAFT_MIN_SUPPORT` was explicitly set in env. */
  minSupportFromEnv: boolean;
  /** Optional bearer token for `graft serve api` (P1). */
  apiToken: string | undefined;
  apiHost: string;
  apiPort: number;
  /** Optional webhook HMAC secret (ING-5). */
  webhookSecret: string | undefined;
  /** Comma-separated repo allowlist; null = unrestricted (Phase 8.5). */
  repoAllowlist: string[] | null;
};

export type ResolveGraftConfigOptions = {
  /** Explicit `owner/name`; falls back to `GRAFT_REPO`. */
  repo?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * When true and `config.json` is missing, write defaults under the
   * repo-scoped data path. Never writes tokens.
   */
  init?: boolean;
};

export type ResolvedGraftConfig = {
  repo: RepoRef;
  /** `owner/name` slug. */
  repoSlug: string;
  env: GraftEnv;
  /** Effective per-repo config (file + env overlays). */
  repoConfig: RepoConfig;
  /** Whether `config.json` existed on disk before this resolve. */
  configExisted: boolean;
  paths: {
    dataDir: string;
    repoRoot: string;
    configPath: string;
  };
};

function parseBooleanEnv(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(
    `Invalid boolean env value "${raw}"; expected true/false (or 1/0)`,
  );
}

function parsePositiveIntEnv(
  raw: string | undefined,
  defaultValue: number,
): { value: number; fromEnv: boolean } {
  if (raw === undefined || raw.trim() === "") {
    return { value: defaultValue, fromEnv: false };
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(
      `Invalid GRAFT_MIN_SUPPORT "${raw}"; expected a positive integer`,
    );
  }
  return { value: parsed, fromEnv: true };
}

/** Load Graft env vars with TRD defaults (`GRAFT_LLM_ENABLED` → false). */
export function loadGraftEnv(env: NodeJS.ProcessEnv = process.env): GraftEnv {
  const tokenRaw = env.GITHUB_TOKEN;
  const githubToken =
    tokenRaw !== undefined && tokenRaw.trim() !== "" ? tokenRaw : undefined;

  const repoRaw = env.GRAFT_REPO;
  const graftRepo =
    repoRaw !== undefined && repoRaw.trim() !== "" ? repoRaw.trim() : undefined;

  const { value: minSupport, fromEnv: minSupportFromEnv } = parsePositiveIntEnv(
    env.GRAFT_MIN_SUPPORT,
    DEFAULT_MIN_SUPPORT,
  );

  return {
    githubToken,
    dataDir: getDataDir(env),
    graftRepo,
    minSupport,
    llmEnabled: parseBooleanEnv(env.GRAFT_LLM_ENABLED, DEFAULT_LLM_ENABLED),
    minSupportFromEnv,
    apiToken:
      env.API_TOKEN !== undefined && env.API_TOKEN.trim() !== ""
        ? env.API_TOKEN.trim()
        : undefined,
    apiHost:
      env.API_HOST !== undefined && env.API_HOST.trim() !== ""
        ? env.API_HOST.trim()
        : "127.0.0.1",
    apiPort: parsePositiveIntEnv(env.API_PORT, 8787).value,
    webhookSecret:
      env.GITHUB_WEBHOOK_SECRET !== undefined &&
      env.GITHUB_WEBHOOK_SECRET.trim() !== ""
        ? env.GITHUB_WEBHOOK_SECRET.trim()
        : undefined,
    repoAllowlist: parseRepoAllowlist(env.GRAFT_REPO_ALLOWLIST),
  };
}

/** Default `config.json` body for a repo (TRD §5.2). */
export function defaultRepoConfig(owner: string, name: string): RepoConfig {
  return parseArtifact(
    RepoConfigSchema,
    { owner, name },
    "RepoConfig",
  );
}

/** Absolute path to `config.json` under the repo data root. */
export function repoConfigPath(
  dataDir: string,
  owner: string,
  name: string,
): string {
  return repoScopedPath(dataDir, owner, name, "config.json");
}

/**
 * Read and validate `config.json` for a repo.
 * Returns `null` when the file does not exist.
 */
export async function readRepoConfig(
  dataDir: string,
  owner: string,
  name: string,
): Promise<RepoConfig | null> {
  const filePath = repoConfigPath(dataDir, owner, name);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: unknown }).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    throw new GraftArtifactParseError("RepoConfig", [
      {
        path: [],
        message: `Invalid JSON in ${filePath}`,
        code: "invalid_json",
      },
    ]);
  }

  const parsed = parseArtifact(RepoConfigSchema, json, "RepoConfig");
  if (parsed.owner !== owner || parsed.name !== name) {
    throw new Error(
      `config.json owner/name "${parsed.owner}/${parsed.name}" does not match repo path "${owner}/${name}"`,
    );
  }
  return parsed;
}

/**
 * Write validated `config.json` under the repo-scoped data path.
 * Creates parent directories. Never writes tokens or other secrets.
 */
export async function writeRepoConfig(
  dataDir: string,
  config: RepoConfig,
): Promise<string> {
  const validated = parseArtifact(RepoConfigSchema, config, "RepoConfig");
  const filePath = repoConfigPath(dataDir, validated.owner, validated.name);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  return filePath;
}

function resolveRepoSlug(
  options: ResolveGraftConfigOptions,
  graftEnv: GraftEnv,
): string {
  const fromOpt = options.repo?.trim();
  if (fromOpt) {
    return fromOpt;
  }
  if (graftEnv.graftRepo) {
    return graftEnv.graftRepo;
  }
  throw new Error(
    "No repo specified; pass --repo owner/name or set GRAFT_REPO",
  );
}

/**
 * Resolve env + per-repo `config.json` without network I/O.
 * Env `GRAFT_MIN_SUPPORT` overlays `repoConfig.compile.minSupport` when set.
 */
export async function resolveGraftConfig(
  options: ResolveGraftConfigOptions = {},
): Promise<ResolvedGraftConfig> {
  const envMap = options.env ?? process.env;
  const graftEnv = loadGraftEnv(envMap);
  const repoSlug = resolveRepoSlug(options, graftEnv);
  assertRepoAllowed(repoSlug, graftEnv.repoAllowlist);
  const { owner, name } = parseRepoSlug(repoSlug);

  const dataDir = graftEnv.dataDir;
  const configPath = repoConfigPath(dataDir, owner, name);
  const repoRoot = repoDataRoot(dataDir, owner, name);

  let repoConfig = await readRepoConfig(dataDir, owner, name);
  const configExisted = repoConfig !== null;
  if (repoConfig === null) {
    repoConfig = defaultRepoConfig(owner, name);
    if (options.init) {
      await writeRepoConfig(dataDir, repoConfig);
    }
  }

  if (graftEnv.minSupportFromEnv) {
    repoConfig = {
      ...repoConfig,
      compile: {
        ...repoConfig.compile,
        minSupport: graftEnv.minSupport,
      },
    };
  }

  return {
    repo: { owner, name },
    repoSlug: `${owner}/${name}`,
    env: graftEnv,
    repoConfig,
    configExisted,
    paths: {
      dataDir,
      repoRoot,
      configPath,
    },
  };
}

/**
 * JSON-serializable view for CLI printing.
 * Redacts `GITHUB_TOKEN` (TRD §13 — never echo secrets).
 */
export function toPrintableResolvedConfig(resolved: ResolvedGraftConfig): {
  repo: string;
  dataDir: string;
  repoRoot: string;
  configPath: string;
  configExisted: boolean;
  githubToken: "set" | "unset";
  llmEnabled: boolean;
  minSupport: number;
  defaults: {
    dataDir: string;
    minSupport: number;
    llmEnabled: boolean;
  };
  repoConfig: RepoConfig;
} {
  return {
    repo: resolved.repoSlug,
    dataDir: resolved.paths.dataDir,
    repoRoot: resolved.paths.repoRoot,
    configPath: resolved.paths.configPath,
    configExisted: resolved.configExisted,
    githubToken: resolved.env.githubToken !== undefined ? "set" : "unset",
    llmEnabled: resolved.env.llmEnabled,
    minSupport: resolved.repoConfig.compile.minSupport,
    defaults: {
      dataDir: DEFAULT_DATA_DIR,
      minSupport: DEFAULT_MIN_SUPPORT,
      llmEnabled: DEFAULT_LLM_ENABLED,
    },
    repoConfig: resolved.repoConfig,
  };
}
