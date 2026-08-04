/**
 * Purge repo artifact tree (Phase 6.4 / SAF-5).
 */

import { rm, stat } from "node:fs/promises";
import { repoDataRoot } from "@graft/shared";

export type PurgeRepositoryResult = {
  repo: string;
  removed: boolean;
  path: string;
};

/**
 * Delete all artifacts for one repo under DATA_DIR/repos/<owner>/<name>.
 * Does not touch sibling repos.
 */
export async function purgeRepository(
  dataDir: string,
  owner: string,
  name: string,
): Promise<PurgeRepositoryResult> {
  const repo = `${owner}/${name}`;
  const root = repoDataRoot(dataDir, owner, name);
  let removed = false;
  try {
    await stat(root);
    await rm(root, { recursive: true, force: true });
    removed = true;
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: unknown }).code === "ENOENT"
    ) {
      removed = false;
    } else {
      throw err;
    }
  }
  return { repo, removed, path: root };
}
