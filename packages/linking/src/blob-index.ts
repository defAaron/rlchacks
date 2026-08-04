/**
 * Optional path→sha map for raw blobs.
 *
 * Phase 1 stores `raw/blobs/<sha>.txt` without path metadata. Linking reads
 * an optional `raw/blob-index.json` when present. Without an index, a single
 * blob in the directory is used as a last-resort fallback (fixture-friendly).
 */

import { readFile, readdir } from "node:fs/promises";
import { repoScopedPath } from "@graft/shared";

export type BlobIndexEntry = {
  /** Commit / merge-commit sha (or other ref identity). */
  ref: string;
  path: string;
  sha: string;
};

export type BlobIndex = {
  files: BlobIndexEntry[];
};

export function blobIndexPath(
  dataDir: string,
  owner: string,
  name: string,
): string {
  return repoScopedPath(dataDir, owner, name, "raw", "blob-index.json");
}

export function rawBlobsDir(
  dataDir: string,
  owner: string,
  name: string,
): string {
  return repoScopedPath(dataDir, owner, name, "raw", "blobs");
}

export async function readBlobIndex(
  dataDir: string,
  owner: string,
  name: string,
): Promise<BlobIndex | null> {
  const filePath = blobIndexPath(dataDir, owner, name);
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
    return null;
  }
  if (
    json === null ||
    typeof json !== "object" ||
    !("files" in json) ||
    !Array.isArray((json as { files: unknown }).files)
  ) {
    return null;
  }

  const files: BlobIndexEntry[] = [];
  for (const entry of (json as { files: unknown[] }).files) {
    if (entry === null || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    if (
      typeof rec.ref === "string" &&
      typeof rec.path === "string" &&
      typeof rec.sha === "string" &&
      rec.ref.trim() !== "" &&
      rec.path.trim() !== "" &&
      rec.sha.trim() !== ""
    ) {
      files.push({
        ref: rec.ref.trim(),
        path: rec.path.trim(),
        sha: rec.sha.trim(),
      });
    }
  }
  return { files };
}

export async function readBlobText(
  dataDir: string,
  owner: string,
  name: string,
  sha: string,
): Promise<string | null> {
  const filePath = repoScopedPath(
    dataDir,
    owner,
    name,
    "raw",
    "blobs",
    `${sha}.txt`,
  );
  try {
    return await readFile(filePath, "utf8");
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
}

/** List blob sha stems under `raw/blobs/` (filenames without `.txt`). */
export async function listBlobShas(
  dataDir: string,
  owner: string,
  name: string,
): Promise<string[]> {
  const dir = rawBlobsDir(dataDir, owner, name);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: unknown }).code === "ENOENT"
    ) {
      return [];
    }
    throw err;
  }
  return names
    .filter((n) => n.endsWith(".txt"))
    .map((n) => n.slice(0, -".txt".length))
    .filter((sha) => sha.length > 0);
}

export type ResolvedBlob = {
  sha: string;
  text: string;
  source: "blob_index" | "single_blob_fallback";
};

/**
 * Resolve file text for `path` at `ref` using blob-index, else single-blob fallback.
 */
export async function resolveBlobAtRef(options: {
  dataDir: string;
  owner: string;
  name: string;
  ref: string | null | undefined;
  path: string;
  index: BlobIndex | null;
  /** Cached single-blob fallback (sha + text), computed once per repo. */
  singleBlob?: ResolvedBlob | null;
}): Promise<ResolvedBlob | null> {
  const ref = options.ref?.trim() ?? "";
  if (ref !== "" && options.index !== null) {
    const hit = options.index.files.find(
      (f) => f.ref === ref && f.path === options.path,
    );
    if (hit !== undefined) {
      const text = await readBlobText(
        options.dataDir,
        options.owner,
        options.name,
        hit.sha,
      );
      if (text !== null) {
        return { sha: hit.sha, text, source: "blob_index" };
      }
    }
  }

  if (options.singleBlob !== null && options.singleBlob !== undefined) {
    return options.singleBlob;
  }
  return null;
}

export async function loadSingleBlobFallback(
  dataDir: string,
  owner: string,
  name: string,
): Promise<ResolvedBlob | null> {
  const shas = await listBlobShas(dataDir, owner, name);
  if (shas.length !== 1) return null;
  const sha = shas[0]!;
  const text = await readBlobText(dataDir, owner, name, sha);
  if (text === null) return null;
  return { sha, text, source: "single_blob_fallback" };
}
