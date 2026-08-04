import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RawPullRequestSchema,
  RawReviewCommentSchema,
  parseArtifact,
  repoScopedPath,
} from "@graft/shared";
import { createFixtureFetch } from "./fixture-fetch.js";
import { createGitHubClient } from "./github-client.js";
import { ingestPullRequest } from "./ingest-pr.js";

describe("ingestPullRequest — comment + blob fetch (fixtures)", () => {
  it("writes raw/prs, raw/comments, and raw/blobs for a fixture PR", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-ingest-"));
    const client = createGitHubClient({
      token: "ghp_fixture_token",
      fetch: createFixtureFetch(),
      pullsPerPage: 3,
    });

    const prs = await client.listMergedPullRequests({
      owner: "acme",
      repo: "widgets",
      maxPrs: 1,
    });
    expect(prs).toHaveLength(1);
    const pr = prs[0]!;

    const result = await ingestPullRequest({
      client,
      dataDir,
      owner: "acme",
      repo: "widgets",
      pr,
    });

    const expectedPrPath = repoScopedPath(
      dataDir,
      "acme",
      "widgets",
      "raw",
      "prs",
      "101.json",
    );
    const expectedCommentPath = repoScopedPath(
      dataDir,
      "acme",
      "widgets",
      "raw",
      "comments",
      "PRRC_kwDOFixtureComment1.json",
    );
    const expectedBlobPath = repoScopedPath(
      dataDir,
      "acme",
      "widgets",
      "raw",
      "blobs",
      "blobsha1111111111111111111111111111111111.txt",
    );

    expect(result.prPath).toBe(expectedPrPath);
    expect(result.commentPaths).toEqual([expectedCommentPath]);
    expect(result.blobPaths).toEqual([expectedBlobPath]);
    expect(result.prCreated).toBe(true);
    expect(result.commentsCreated).toBe(1);
    expect(result.blobsCreated).toBe(1);

    const writtenPr = parseArtifact(
      RawPullRequestSchema,
      JSON.parse(await readFile(expectedPrPath, "utf8")),
      "RawPullRequest",
    );
    expect(writtenPr.number).toBe(101);
    expect(writtenPr.mergeCommitSha).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );

    const writtenComment = parseArtifact(
      RawReviewCommentSchema,
      JSON.parse(await readFile(expectedCommentPath, "utf8")),
      "RawReviewComment",
    );
    expect(writtenComment).toMatchObject({
      id: "PRRC_kwDOFixtureComment1",
      prNumber: 101,
      path: "src/retry.ts",
      body: "Prefer early return: throw on the last attempt instead of nested try/catch.",
      author: "reviewer1",
      line: 7,
      side: "RIGHT",
      htmlUrl: "https://github.com/acme/widgets/pull/101#discussion_r9001",
    });
    expect(writtenComment.diffHunk).toContain("export async function retry");

    const blobText = await readFile(expectedBlobPath, "utf8");
    expect(blobText).toContain("export async function retry");

    const rawRoot = repoScopedPath(dataDir, "acme", "widgets", "raw");
    expect(await readdir(path.join(rawRoot, "prs"))).toEqual(["101.json"]);
    expect(await readdir(path.join(rawRoot, "comments"))).toEqual([
      "PRRC_kwDOFixtureComment1.json",
    ]);
    expect(await readdir(path.join(rawRoot, "blobs"))).toEqual([
      "blobsha1111111111111111111111111111111111.txt",
    ]);
  });
});
