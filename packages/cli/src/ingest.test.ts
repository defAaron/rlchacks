import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createFixtureFetch,
  createGitHubClient,
  GitHubAccessError,
  notFoundResponse,
  rateLimitForbiddenResponse,
  unauthorizedResponse,
} from "@graft/ingestion";
import { readCursors } from "@graft/pipeline";
import {
  CLI_EXIT,
  graftNoDataError,
  repoScopedPath,
} from "@graft/shared";
import {
  cliExitCode,
  formatCliErrorMessage,
  main,
  parseIngestArgs,
  runIngest,
} from "./index.js";

describe("parseIngestArgs", () => {
  it("parses owner/repo and --max-prs", () => {
    expect(parseIngestArgs(["acme/widgets", "--max-prs", "5"])).toEqual({
      repo: "acme/widgets",
      maxPrs: 5,
    });
  });

  it("defaults max-prs to 200", () => {
    expect(parseIngestArgs(["acme/widgets"])).toEqual({
      repo: "acme/widgets",
      maxPrs: 200,
    });
  });

  it("rejects missing repo", () => {
    expect(() => parseIngestArgs([])).toThrow(/Missing repo/);
  });

  it("rejects invalid --max-prs", () => {
    expect(() => parseIngestArgs(["acme/widgets", "--max-prs", "0"])).toThrow(
      /positive integer/,
    );
  });
});

describe("runIngest — offline fixtures", () => {
  it("writes raw artifacts, updates watermark, and is idempotent on re-run", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-cli-ingest-"));
    const client = createGitHubClient({
      token: "ghp_fixture_token",
      fetch: createFixtureFetch(),
      pullsPerPage: 3,
    });
    const lines: string[] = [];
    let clock = 1_000;
    const now = () => {
      clock += 250;
      return clock;
    };

    const first = await runIngest({
      repo: "acme/widgets",
      maxPrs: 2,
      env: {
        DATA_DIR: dataDir,
        GITHUB_TOKEN: "ghp_fixture_token",
      },
      client,
      now,
      log: (line) => lines.push(line),
    });

    expect(first).toMatchObject({
      repo: "acme/widgets",
      prs: 2,
      comments: 1,
      blobs: 1,
      prsNew: 2,
      commentsNew: 1,
      blobsNew: 1,
      durationMs: 250,
      ingestWatermark: {
        lastMergedAt: "2024-06-15T12:00:00Z",
        lastPrNumber: 101,
      },
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      prs: 2,
      comments: 1,
      blobs: 1,
      durationMs: 250,
    });

    const cursors = await readCursors(dataDir, "acme", "widgets");
    expect(cursors?.ingest).toEqual({
      lastMergedAt: "2024-06-15T12:00:00Z",
      lastPrNumber: 101,
    });
    expect(cursors?.link.updatedAt).toBeNull();
    expect(cursors?.compile.updatedAt).toBeNull();

    const rawRoot = repoScopedPath(dataDir, "acme", "widgets", "raw");
    expect((await readdir(path.join(rawRoot, "prs"))).sort()).toEqual([
      "101.json",
      "103.json",
    ]);

    lines.length = 0;
    const second = await runIngest({
      repo: "acme/widgets",
      maxPrs: 2,
      env: {
        DATA_DIR: dataDir,
        GITHUB_TOKEN: "ghp_fixture_token",
      },
      client,
      now,
      log: (line) => lines.push(line),
    });

    // Resume uses ingest watermark as `since` — no PRs newer than the cursor.
    expect(second.prs).toBe(0);
    expect(second.prsNew).toBe(0);
    expect(second.commentsNew).toBe(0);
    expect(second.blobsNew).toBe(0);
    expect(second.ingestWatermark).toEqual({
      lastMergedAt: "2024-06-15T12:00:00Z",
      lastPrNumber: 101,
    });
  });

  it("resumes after interruption via persisted ingest cursor", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-cli-resume-"));
    const base = createGitHubClient({
      token: "ghp_fixture_token",
      fetch: createFixtureFetch(),
      pullsPerPage: 3,
    });

    let commentFetches = 0;
    const interruptingClient = {
      ...base,
      listPullReviewComments: async (
        opts: Parameters<typeof base.listPullReviewComments>[0],
      ) => {
        commentFetches += 1;
        // Oldest-first: PR 103 (empty comments) then PR 101. Fail on 101.
        if (opts.pullNumber === 101) {
          throw new Error("simulated interrupt");
        }
        return base.listPullReviewComments(opts);
      },
    };

    await expect(
      runIngest({
        repo: "acme/widgets",
        maxPrs: 2,
        env: {
          DATA_DIR: dataDir,
          GITHUB_TOKEN: "ghp_fixture_token",
        },
        client: interruptingClient,
        log: () => undefined,
      }),
    ).rejects.toThrow("simulated interrupt");

    const mid = await readCursors(dataDir, "acme", "widgets");
    expect(mid?.ingest).toEqual({
      lastMergedAt: "2024-06-13T09:30:00Z",
      lastPrNumber: 103,
    });

    const rawRoot = repoScopedPath(dataDir, "acme", "widgets", "raw");
    expect(await readdir(path.join(rawRoot, "prs"))).toEqual(["103.json"]);
    expect(commentFetches).toBe(2);

    const resumed = await runIngest({
      repo: "acme/widgets",
      maxPrs: 2,
      env: {
        DATA_DIR: dataDir,
        GITHUB_TOKEN: "ghp_fixture_token",
      },
      client: base,
      log: () => undefined,
    });

    expect(resumed.prs).toBe(1);
    expect(resumed.prsNew).toBe(1);
    expect(resumed.commentsNew).toBe(1);
    expect(resumed.ingestWatermark).toEqual({
      lastMergedAt: "2024-06-15T12:00:00Z",
      lastPrNumber: 101,
    });
    expect((await readdir(path.join(rawRoot, "prs"))).sort()).toEqual([
      "101.json",
      "103.json",
    ]);
  });
});

describe("ingest error UX (Step 1.4)", () => {
  it("maps GitHubAccessError to exit 3 and GRAFT_NO_DATA to exit 2", () => {
    const missing = new GitHubAccessError(
      "missing_token",
      "GITHUB_TOKEN is not set.",
    );
    expect(cliExitCode(missing)).toBe(CLI_EXIT.GITHUB);
    expect(formatCliErrorMessage(missing)).toMatch(/GITHUB_TOKEN/);

    const noData = graftNoDataError("acme/widgets");
    expect(cliExitCode(noData)).toBe(CLI_EXIT.NO_DATA);
    expect(formatCliErrorMessage(noData)).toMatch(/GRAFT_NO_DATA/);

    expect(cliExitCode(new Error("usage boom"))).toBe(CLI_EXIT.ERROR);
  });

  it("exits 3 with actionable message when GITHUB_TOKEN is missing", async () => {
    const errors: string[] = [];
    const code = await main(["ingest", "acme/widgets"], {
      env: { DATA_DIR: await mkdtemp(path.join(tmpdir(), "graft-cli-notoken-")) },
      error: (line) => errors.push(line),
    });

    expect(code).toBe(3);
    expect(errors.join("\n")).toMatch(/GITHUB_TOKEN is not set/);
    expect(errors.join("\n")).toMatch(/export GITHUB_TOKEN=/);
  });

  it("exits 3 when GitHub returns 404 for the repo", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-cli-404-"));
    const client = createGitHubClient({
      token: "ghp_fixture_token",
      fetch: createFixtureFetch({
        preamble: [() => notFoundResponse()],
      }),
      pullsPerPage: 3,
    });
    const errors: string[] = [];

    const code = await main(["ingest", "acme/missing-repo"], {
      env: { DATA_DIR: dataDir, GITHUB_TOKEN: "ghp_fixture_token" },
      client,
      error: (line) => errors.push(line),
    });

    expect(code).toBe(3);
    expect(errors.join("\n")).toMatch(/not found \(HTTP 404\)/i);
    expect(errors.join("\n")).toMatch(/acme\/missing-repo/);
  });

  it("exits 3 when GitHub rejects the token (401)", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-cli-401-"));
    const client = createGitHubClient({
      token: "ghp_bad_token",
      fetch: createFixtureFetch({
        preamble: [() => unauthorizedResponse()],
      }),
      pullsPerPage: 3,
    });
    const errors: string[] = [];

    const code = await main(["ingest", "acme/widgets"], {
      env: { DATA_DIR: dataDir, GITHUB_TOKEN: "ghp_bad_token" },
      client,
      error: (line) => errors.push(line),
    });

    expect(code).toBe(3);
    expect(errors.join("\n")).toMatch(/HTTP 401/);
    expect(errors.join("\n")).toMatch(/GITHUB_TOKEN/);
  });

  it("exits 3 when rate limit is exhausted after retries", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-cli-ratelimit-"));
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
    const errors: string[] = [];

    const code = await main(["ingest", "acme/widgets"], {
      env: { DATA_DIR: dataDir, GITHUB_TOKEN: "ghp_fixture_token" },
      client,
      error: (line) => errors.push(line),
    });

    expect(code).toBe(3);
    expect(errors.join("\n")).toMatch(/rate limit/i);
    expect(errors.join("\n")).toMatch(/graft ingest/);
    expect(sleep).toHaveBeenCalled();
  });
});
