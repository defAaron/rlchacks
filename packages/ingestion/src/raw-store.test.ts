import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RawPullRequestSchema,
  RawReviewCommentSchema,
  parseArtifact,
} from "@graft/shared";
import {
  rawBlobPath,
  rawPullRequestPath,
  rawReviewCommentPath,
  writeRawBlob,
  writeRawPullRequest,
  writeRawReviewComment,
} from "./raw-store.js";

const samplePr = parseArtifact(
  RawPullRequestSchema,
  {
    id: "PR_kwDOFixtureA",
    number: 101,
    mergedAt: "2024-06-15T12:00:00Z",
    mergeCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    baseRef: "main",
    headRef: "feat/retry-helper",
    title: "Extract retry helper",
    url: "https://github.com/acme/widgets/pull/101",
  },
  "RawPullRequest",
);

const sampleComment = parseArtifact(
  RawReviewCommentSchema,
  {
    id: "PRRC_kwDOFixtureComment1",
    prNumber: 101,
    path: "src/retry.ts",
    body: "Prefer early return.",
    author: "reviewer1",
    createdAt: "2024-06-14T10:00:00Z",
    diffHunk: "@@ -1,1 +1,1 @@",
    line: 12,
    originalLine: 12,
    side: "RIGHT",
    commitId: "dddddddddddddddddddddddddddddddddddddddd",
    htmlUrl: "https://github.com/acme/widgets/pull/101#discussion_r9001",
  },
  "RawReviewComment",
);

describe("raw-store paths + writers", () => {
  it("builds repo-scoped raw artifact paths", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-raw-"));
    expect(rawPullRequestPath(dataDir, "acme", "widgets", 101)).toBe(
      path.join(dataDir, "repos", "acme", "widgets", "raw", "prs", "101.json"),
    );
    expect(
      rawReviewCommentPath(
        dataDir,
        "acme",
        "widgets",
        "PRRC_kwDOFixtureComment1",
      ),
    ).toBe(
      path.join(
        dataDir,
        "repos",
        "acme",
        "widgets",
        "raw",
        "comments",
        "PRRC_kwDOFixtureComment1.json",
      ),
    );
    expect(rawBlobPath(dataDir, "acme", "widgets", "abc123")).toBe(
      path.join(
        dataDir,
        "repos",
        "acme",
        "widgets",
        "raw",
        "blobs",
        "abc123.txt",
      ),
    );
  });

  it("persists validated JSON and blob text", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-raw-"));

    const prWrite = await writeRawPullRequest(
      dataDir,
      "acme",
      "widgets",
      samplePr,
    );
    const commentWrite = await writeRawReviewComment(
      dataDir,
      "acme",
      "widgets",
      sampleComment,
    );
    const blobWrite = await writeRawBlob(
      dataDir,
      "acme",
      "widgets",
      "abc123",
      "hello blob\n",
    );

    expect(prWrite.created).toBe(true);
    expect(commentWrite.created).toBe(true);
    expect(blobWrite.created).toBe(true);

    expect(
      parseArtifact(
        RawPullRequestSchema,
        JSON.parse(await readFile(prWrite.path, "utf8")),
        "RawPullRequest",
      ),
    ).toEqual(samplePr);
    expect(
      parseArtifact(
        RawReviewCommentSchema,
        JSON.parse(await readFile(commentWrite.path, "utf8")),
        "RawReviewComment",
      ),
    ).toEqual(sampleComment);
    expect(await readFile(blobWrite.path, "utf8")).toBe("hello blob\n");

    const prRewrite = await writeRawPullRequest(
      dataDir,
      "acme",
      "widgets",
      samplePr,
    );
    expect(prRewrite.created).toBe(false);
    expect(prRewrite.path).toBe(prWrite.path);
  });

  it("SAF-1: rejects path traversal / cross-repo owner, name, and segments", () => {
    const dataDir = "/tmp/graft-data";

    expect(() => rawPullRequestPath(dataDir, "..", "widgets", 1)).toThrow(
      /Invalid repo/,
    );
    expect(() => rawPullRequestPath(dataDir, "acme", "..", 1)).toThrow(
      /Invalid repo/,
    );
    expect(() =>
      rawPullRequestPath(dataDir, "acme/evil", "widgets", 1),
    ).toThrow(/Invalid repo/);
    expect(() =>
      rawReviewCommentPath(dataDir, "acme", "widgets", "../other-repo/x"),
    ).toThrow(/Illegal path segment|escapes|Path escapes/);
    expect(() =>
      rawBlobPath(dataDir, "acme", "widgets", "../../other/sha"),
    ).toThrow(/Illegal path segment|escapes|Path escapes/);
    expect(() =>
      rawBlobPath(dataDir, "acme", "widgets", "/etc/passwd"),
    ).toThrow(/Absolute path segment|escapes|Path escapes/);
  });
});
