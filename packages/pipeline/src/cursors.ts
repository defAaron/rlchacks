import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CursorsSchema,
  GraftArtifactParseError,
  parseArtifact,
  repoScopedPath,
  type Cursors,
} from "@graft/shared";

/** Empty watermarks for a repo that has never been ingested/linked/compiled. */
export function defaultCursors(): Cursors {
  return parseArtifact(
    CursorsSchema,
    {
      ingest: { lastMergedAt: null, lastPrNumber: null },
      link: { updatedAt: null },
      compile: { updatedAt: null, compileRunId: null },
    },
    "Cursors",
  );
}

/** Absolute path to `cursors.json` under the repo data root (TRD §6.2). */
export function cursorsPath(
  dataDir: string,
  owner: string,
  name: string,
): string {
  return repoScopedPath(dataDir, owner, name, "cursors.json");
}

/**
 * Read and validate `cursors.json` for a repo.
 * Returns `null` when the file does not exist.
 */
export async function readCursors(
  dataDir: string,
  owner: string,
  name: string,
): Promise<Cursors | null> {
  const filePath = cursorsPath(dataDir, owner, name);
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
    throw new GraftArtifactParseError("Cursors", [
      {
        path: [],
        message: `Invalid JSON in ${filePath}`,
        code: "invalid_json",
      },
    ]);
  }

  return parseArtifact(CursorsSchema, json, "Cursors");
}

/**
 * Write validated `cursors.json` under the repo-scoped data path.
 * Creates parent directories. Never reads outside the repo root.
 */
export async function writeCursors(
  dataDir: string,
  owner: string,
  name: string,
  cursors: Cursors,
): Promise<string> {
  const validated = parseArtifact(CursorsSchema, cursors, "Cursors");
  const filePath = cursorsPath(dataDir, owner, name);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  return filePath;
}
