import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoDataRoot, repoScopedPath } from "@graft/shared";
import { createFixtureFetch } from "./fixture-fetch.js";
import { createGitHubClient } from "./github-client.js";
import {
  computeIngestWatermark,
  ingestRepository,
  sortPullRequestsOldestFirst,
} from "./ingest-repo.js";

/** Collect relative file paths under `root` (files only). */
async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        out.push(path.relative(root, abs));
      }
    }
  }
  await walk(root);
  return out.sort();
}

describe("ingestRepository — fixture backfill", () => {
  it("ingests merged PRs and reports new artifact counts", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-ingest-repo-"));
    const client = createGitHubClient({
      token: "ghp_fixture_token",
      fetch: createFixtureFetch(),
      pullsPerPage: 3,
    });

    const progressNumbers: number[] = [];
    const first = await ingestRepository({
      client,
      dataDir,
      owner: "acme",
      repo: "widgets",
      maxPrs: 2,
      onPrIngested: ({ pr }) => {
        progressNumbers.push(pr.number);
      },
    });

    // Fixture page-1: PR 101 (merged) + 102 (unmerged skipped) + 103 (merged).
    // Processed oldest-first so cursor advances are resume-safe.
    expect(first.prs).toBe(2);
    expect(first.pullRequests.map((pr) => pr.number)).toEqual([103, 101]);
    expect(progressNumbers).toEqual([103, 101]);
    expect(first.comments).toBe(1);
    expect(first.blobs).toBe(1);
    expect(first.prsNew).toBe(2);
    expect(first.commentsNew).toBe(1);
    expect(first.blobsNew).toBe(1);
    expect(first.watermark).toEqual({
      lastMergedAt: "2024-06-15T12:00:00Z",
      lastPrNumber: 101,
    });

    const rawRoot = repoScopedPath(dataDir, "acme", "widgets", "raw");
    expect((await readdir(path.join(rawRoot, "prs"))).sort()).toEqual([
      "101.json",
      "103.json",
    ]);
    expect(await readdir(path.join(rawRoot, "comments"))).toEqual([
      "PRRC_kwDOFixtureComment1.json",
    ]);
    expect(await readdir(path.join(rawRoot, "blobs"))).toEqual([
      "blobsha1111111111111111111111111111111111.txt",
    ]);
  });

  it("SAF-1: writes only under DATA_DIR/repos/<owner>/<name>/ (no cross-repo)", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-ingest-scope-"));
    const siblingRoot = repoDataRoot(dataDir, "other", "repo");
    await mkdir(path.join(siblingRoot, "raw", "prs"), { recursive: true });
    const sentinel = path.join(siblingRoot, "raw", "prs", "sentinel.json");
    await writeFile(sentinel, '{"keep":true}\n', "utf8");

    const client = createGitHubClient({
      token: "ghp_fixture_token",
      fetch: createFixtureFetch(),
      pullsPerPage: 3,
    });

    await ingestRepository({
      client,
      dataDir,
      owner: "acme",
      repo: "widgets",
      maxPrs: 2,
    });

    const repoRoot = path.resolve(repoDataRoot(dataDir, "acme", "widgets"));
    const repoPrefix = `${path.join("repos", "acme", "widgets")}${path.sep}`;
    const siblingRel = path.join(
      "repos",
      "other",
      "repo",
      "raw",
      "prs",
      "sentinel.json",
    );
    const allFiles = await listFilesRecursive(dataDir);
    const writtenByIngest = allFiles.filter((rel) => rel !== siblingRel);

    expect(writtenByIngest.length).toBeGreaterThan(0);
    for (const rel of writtenByIngest) {
      expect(rel.startsWith(repoPrefix)).toBe(true);
      expect(path.resolve(dataDir, rel).startsWith(`${repoRoot}${path.sep}`)).toBe(
        true,
      );
    }

    // Sibling repo artifacts must remain untouched (no cross-repo write).
    expect(await listFilesRecursive(siblingRoot)).toEqual([
      path.join("raw", "prs", "sentinel.json"),
    ]);
  });

  it("is idempotent: second run creates no new artifacts", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-ingest-idem-"));
    const client = createGitHubClient({
      token: "ghp_fixture_token",
      fetch: createFixtureFetch(),
      pullsPerPage: 3,
    });

    await ingestRepository({
      client,
      dataDir,
      owner: "acme",
      repo: "widgets",
      maxPrs: 2,
    });

    const second = await ingestRepository({
      client,
      dataDir,
      owner: "acme",
      repo: "widgets",
      maxPrs: 2,
    });

    expect(second.prs).toBe(2);
    expect(second.comments).toBe(1);
    expect(second.blobs).toBe(1);
    expect(second.prsNew).toBe(0);
    expect(second.commentsNew).toBe(0);
    expect(second.blobsNew).toBe(0);
    expect(second.watermark).toEqual({
      lastMergedAt: "2024-06-15T12:00:00Z",
      lastPrNumber: 101,
    });
  });

  it("resumes via since cursor after a simulated interruption", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-ingest-resume-"));
    const client = createGitHubClient({
      token: "ghp_fixture_token",
      fetch: createFixtureFetch(),
      pullsPerPage: 3,
    });

    let resumeCursor: { lastMergedAt: string; lastPrNumber: number } | null =
      null;

    await expect(
      ingestRepository({
        client,
        dataDir,
        owner: "acme",
        repo: "widgets",
        maxPrs: 2,
        onPrIngested: async ({ watermark, pr }) => {
          resumeCursor = {
            lastMergedAt: watermark.lastMergedAt!,
            lastPrNumber: watermark.lastPrNumber!,
          };
          if (pr.number === 103) {
            throw new Error("simulated interrupt");
          }
        },
      }),
    ).rejects.toThrow("simulated interrupt");

    expect(resumeCursor).toEqual({
      lastMergedAt: "2024-06-13T09:30:00Z",
      lastPrNumber: 103,
    });

    const rawRoot = repoScopedPath(dataDir, "acme", "widgets", "raw");
    expect(await readdir(path.join(rawRoot, "prs"))).toEqual(["103.json"]);

    const resumed = await ingestRepository({
      client,
      dataDir,
      owner: "acme",
      repo: "widgets",
      maxPrs: 2,
      since: resumeCursor!.lastMergedAt,
    });

    // Cursor excludes PR 103; only the newer PR 101 remains.
    expect(resumed.pullRequests.map((pr) => pr.number)).toEqual([101]);
    expect(resumed.prsNew).toBe(1);
    expect(resumed.commentsNew).toBe(1);
    expect(resumed.watermark).toEqual({
      lastMergedAt: "2024-06-15T12:00:00Z",
      lastPrNumber: 101,
    });
    expect((await readdir(path.join(rawRoot, "prs"))).sort()).toEqual([
      "101.json",
      "103.json",
    ]);
  });
});

describe("sortPullRequestsOldestFirst", () => {
  it("orders by mergedAt then PR number", () => {
    const sorted = sortPullRequestsOldestFirst([
      {
        id: "b",
        number: 20,
        mergedAt: "2024-06-01T00:00:00Z",
        mergeCommitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        baseRef: "main",
        headRef: "b",
        title: "b",
        url: "https://example.com/b",
      },
      {
        id: "a",
        number: 10,
        mergedAt: "2024-01-01T00:00:00Z",
        mergeCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        baseRef: "main",
        headRef: "a",
        title: "a",
        url: "https://example.com/a",
      },
      {
        id: "c",
        number: 21,
        mergedAt: "2024-06-01T00:00:00Z",
        mergeCommitSha: "cccccccccccccccccccccccccccccccccccccccc",
        baseRef: "main",
        headRef: "c",
        title: "c",
        url: "https://example.com/c",
      },
    ]);
    expect(sorted.map((pr) => pr.number)).toEqual([10, 20, 21]);
  });
});

describe("computeIngestWatermark", () => {
  it("returns null for an empty PR list", () => {
    expect(computeIngestWatermark([])).toBeNull();
  });

  it("picks the newest mergedAt, then highest PR number", () => {
    expect(
      computeIngestWatermark([
        {
          id: "a",
          number: 10,
          mergedAt: "2024-01-01T00:00:00Z",
          mergeCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          baseRef: "main",
          headRef: "a",
          title: "a",
          url: "https://example.com/a",
        },
        {
          id: "b",
          number: 20,
          mergedAt: "2024-06-01T00:00:00Z",
          mergeCommitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          baseRef: "main",
          headRef: "b",
          title: "b",
          url: "https://example.com/b",
        },
        {
          id: "c",
          number: 21,
          mergedAt: "2024-06-01T00:00:00Z",
          mergeCommitSha: "cccccccccccccccccccccccccccccccccccccccc",
          baseRef: "main",
          headRef: "c",
          title: "c",
          url: "https://example.com/c",
        },
      ]),
    ).toEqual({
      lastMergedAt: "2024-06-01T00:00:00Z",
      lastPrNumber: 21,
    });
  });
});
