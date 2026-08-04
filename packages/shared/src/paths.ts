import { readdir } from "node:fs/promises";
import path from "node:path";

/** Default artifact root when `DATA_DIR` is unset (TRD §5.1). */
export const DEFAULT_DATA_DIR = "./data";

const REPO_SEGMENT = /^[A-Za-z0-9._-]+$/;

export type RepoRef = {
  owner: string;
  name: string;
};

/** Resolve the artifact root from env (or an explicit override map). */
export function getDataDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.DATA_DIR;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_DATA_DIR;
  }
  return raw;
}

/** Parse `owner/name` into segments; rejects traversal and empty parts. */
export function parseRepoSlug(repo: string): RepoRef {
  const trimmed = repo.trim();
  const parts = trimmed.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid repo slug "${repo}"; expected owner/name`);
  }
  const [owner, name] = parts;
  if (owner === undefined || name === undefined) {
    throw new Error(`Invalid repo slug "${repo}"; expected owner/name`);
  }
  assertRepoSegment(owner, "owner");
  assertRepoSegment(name, "name");
  return { owner, name };
}

function assertRepoSegment(value: string, label: string): void {
  if (!value || value === "." || value === ".." || !REPO_SEGMENT.test(value)) {
    throw new Error(
      `Invalid repo ${label} "${value}"; expected a single path-safe segment`,
    );
  }
}

/** Absolute or relative root for one repo: `<DATA_DIR>/repos/<owner>/<name>`. */
export function repoDataRoot(
  dataDir: string,
  owner: string,
  name: string,
): string {
  assertRepoSegment(owner, "owner");
  assertRepoSegment(name, "name");
  return path.join(dataDir, "repos", owner, name);
}

/**
 * Build a path under a repo's data root.
 * Rejects `..` segments and any resolved path that escapes the repo root
 * (recurring watchlist: no cross-repo reads).
 */
export function repoScopedPath(
  dataDir: string,
  owner: string,
  name: string,
  ...segments: string[]
): string {
  const root = path.resolve(repoDataRoot(dataDir, owner, name));
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`Illegal path segment "${segment}"`);
    }
    if (segment.includes("\0")) {
      throw new Error("Illegal null byte in path segment");
    }
    // Disallow absolute segments and Windows drive escapes
    if (path.isAbsolute(segment)) {
      throw new Error(`Absolute path segment not allowed: "${segment}"`);
    }
    const normalized = path.normalize(segment);
    if (
      normalized === ".." ||
      normalized.startsWith(`..${path.sep}`) ||
      normalized.includes(`${path.sep}..${path.sep}`) ||
      normalized.endsWith(`${path.sep}..`)
    ) {
      throw new Error(`Path escapes repo root via segment "${segment}"`);
    }
  }

  const candidate = path.resolve(root, ...segments);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) {
    throw new Error(
      `Path "${candidate}" escapes repo data root "${root}"`,
    );
  }
  return candidate;
}

/** Convenience: slug form → repo-scoped path under DATA_DIR. */
export function repoScopedPathFromSlug(
  dataDir: string,
  repo: string,
  ...segments: string[]
): string {
  const { owner, name } = parseRepoSlug(repo);
  return repoScopedPath(dataDir, owner, name, ...segments);
}

/** List `owner/name` slugs with data directories under `DATA_DIR/repos/`. */
export async function listIngestedRepos(dataDir: string): Promise<string[]> {
  const reposRoot = path.join(dataDir, "repos");
  let owners: string[];
  try {
    owners = await readdir(reposRoot);
  } catch {
    return [];
  }
  const slugs: string[] = [];
  for (const owner of owners) {
    if (owner.startsWith(".")) {
      continue;
    }
    let names: string[];
    try {
      names = await readdir(path.join(reposRoot, owner));
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.startsWith(".")) {
        continue;
      }
      try {
        parseRepoSlug(`${owner}/${name}`);
        slugs.push(`${owner}/${name}`);
      } catch {
        /* skip invalid directory names */
      }
    }
  }
  return slugs.sort();
}
