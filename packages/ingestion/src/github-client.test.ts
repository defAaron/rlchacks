import { describe, expect, it, vi } from "vitest";
import {
  createFixtureFetch,
  notFoundResponse,
  rateLimitForbiddenResponse,
} from "./fixture-fetch.js";
import {
  createGitHubClient,
  createGitHubClientFromEnv,
  isRetryableGitHubError,
  toRawPullRequest,
} from "./github-client.js";
import { GitHubAccessError } from "./github-errors.js";
import { RequestError } from "@octokit/request-error";

describe("GitHub client — list merged PRs (recorded fixtures)", () => {
  it("lists N merged PRs across paginated fixture pages (no live network)", async () => {
    const fetch = createFixtureFetch();
    const client = createGitHubClient({
      token: "ghp_fixture_token",
      fetch,
      pullsPerPage: 3,
    });

    const prs = await client.listMergedPullRequests({
      owner: "acme",
      repo: "widgets",
    });

    expect(prs).toHaveLength(3);
    expect(prs.map((pr) => pr.number)).toEqual([101, 103, 105]);
    expect(prs[0]).toEqual({
      id: "PR_kwDOFixtureA",
      number: 101,
      mergedAt: "2024-06-15T12:00:00Z",
      mergeCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      baseRef: "main",
      headRef: "feat/retry-helper",
      title: "Extract retry helper",
      url: "https://github.com/acme/widgets/pull/101",
    });
  });

  it("honors maxPrs and skips unmerged / draft PRs", async () => {
    const client = createGitHubClient({
      token: "ghp_fixture_token",
      fetch: createFixtureFetch(),
      pullsPerPage: 3,
    });

    const prs = await client.listMergedPullRequests({
      owner: "acme",
      repo: "widgets",
      maxPrs: 2,
    });

    expect(prs).toHaveLength(2);
    expect(prs.map((pr) => pr.number)).toEqual([101, 103]);
  });

  it("filters by since watermark", async () => {
    const client = createGitHubClient({
      token: "ghp_fixture_token",
      fetch: createFixtureFetch(),
      pullsPerPage: 3,
    });

    const prs = await client.listMergedPullRequests({
      owner: "acme",
      repo: "widgets",
      since: "2024-06-13T09:30:00Z",
    });

    expect(prs.map((pr) => pr.number)).toEqual([101]);
  });

  it("reads auth from GITHUB_TOKEN via createGitHubClientFromEnv", async () => {
    const client = createGitHubClientFromEnv(
      { GITHUB_TOKEN: "ghp_from_env" },
      { fetch: createFixtureFetch(), pullsPerPage: 3 },
    );

    expect(client.token).toBe("ghp_from_env");
    const prs = await client.listMergedPullRequests({
      owner: "acme",
      repo: "widgets",
      maxPrs: 1,
    });
    expect(prs).toHaveLength(1);
  });

  it("backs off and retries on rate-limit 403 (ING-6)", async () => {
    const sleep = vi.fn(async () => undefined);
    const client = createGitHubClient({
      token: "ghp_fixture_token",
      fetch: createFixtureFetch({
        preamble: [() => rateLimitForbiddenResponse(0)],
      }),
      sleep,
      pullsPerPage: 3,
      backoffBaseMs: 10,
    });

    const prs = await client.listMergedPullRequests({
      owner: "acme",
      repo: "widgets",
      maxPrs: 1,
    });

    expect(prs).toHaveLength(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("refuses missing GITHUB_TOKEN with GitHubAccessError", () => {
    expect(() => createGitHubClientFromEnv({ GITHUB_TOKEN: "" })).toThrow(
      GitHubAccessError,
    );
    try {
      createGitHubClientFromEnv({ GITHUB_TOKEN: "" });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubAccessError);
      expect((err as GitHubAccessError).kind).toBe("missing_token");
      expect((err as GitHubAccessError).exitCode).toBe(3);
      expect((err as GitHubAccessError).message).toMatch(/GITHUB_TOKEN is not set/);
    }
  });

  it("maps repo 404 to GitHubAccessError", async () => {
    const client = createGitHubClient({
      token: "ghp_fixture_token",
      fetch: createFixtureFetch({
        preamble: [() => notFoundResponse()],
      }),
      pullsPerPage: 3,
    });

    await expect(
      client.listMergedPullRequests({ owner: "acme", repo: "missing" }),
    ).rejects.toMatchObject({
      name: "GitHubAccessError",
      kind: "repo_not_found",
      status: 404,
      exitCode: 3,
    });
  });

  it("maps exhausted rate-limit retries to GitHubAccessError", async () => {
    const sleep = vi.fn(async () => undefined);
    const client = createGitHubClient({
      token: "ghp_fixture_token",
      fetch: createFixtureFetch({
        preamble: [
          () => rateLimitForbiddenResponse(0),
          () => rateLimitForbiddenResponse(0),
        ],
      }),
      sleep,
      maxRetries: 1,
      pullsPerPage: 3,
      backoffBaseMs: 1,
    });

    await expect(
      client.listMergedPullRequests({ owner: "acme", repo: "widgets" }),
    ).rejects.toMatchObject({
      name: "GitHubAccessError",
      kind: "rate_limit_exhausted",
      exitCode: 3,
    });
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

describe("toRawPullRequest", () => {
  it("skips drafts and unmerged pulls", () => {
    expect(
      toRawPullRequest({
        id: 1,
        number: 1,
        title: "draft",
        html_url: "https://github.com/acme/widgets/pull/1",
        merged_at: "2024-01-01T00:00:00Z",
        merge_commit_sha: "abc",
        draft: true,
        base: { ref: "main" },
        head: { ref: "x" },
      }),
    ).toBeUndefined();

    expect(
      toRawPullRequest({
        id: 2,
        number: 2,
        title: "closed",
        html_url: "https://github.com/acme/widgets/pull/2",
        merged_at: null,
        merge_commit_sha: null,
        draft: false,
        base: { ref: "main" },
        head: { ref: "x" },
      }),
    ).toBeUndefined();
  });
});

describe("isRetryableGitHubError", () => {
  it("treats rate-limit 403 and 502 as retryable", () => {
    const rateLimited = new RequestError("API rate limit exceeded", 403, {
      request: {
        method: "GET",
        url: "https://api.github.com/repos/a/b/pulls",
        headers: {},
      },
      response: {
        status: 403,
        url: "https://api.github.com/repos/a/b/pulls",
        data: {},
        headers: { "x-ratelimit-remaining": "0" },
      },
    });
    expect(isRetryableGitHubError(rateLimited)).toBe(true);

    const badGateway = new RequestError("Bad gateway", 502, {
      request: {
        method: "GET",
        url: "https://api.github.com/repos/a/b/pulls",
        headers: {},
      },
    });
    expect(isRetryableGitHubError(badGateway)).toBe(true);

    const notFound = new RequestError("Not Found", 404, {
      request: {
        method: "GET",
        url: "https://api.github.com/repos/a/b/pulls",
        headers: {},
      },
    });
    expect(isRetryableGitHubError(notFound)).toBe(false);
  });
});
