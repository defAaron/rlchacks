import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GitHubFetch } from "./github-client.js";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const GITHUB_FIXTURE_ROOT = path.join(packageRoot, "testdata", "github");

export const LIST_MERGED_PRS_FIXTURE_DIR = path.join(
  GITHUB_FIXTURE_ROOT,
  "list-merged-prs",
);

export const PULL_REVIEW_COMMENTS_FIXTURE_DIR = path.join(
  GITHUB_FIXTURE_ROOT,
  "pull-review-comments",
);

export const CONTENTS_FIXTURE_DIR = path.join(GITHUB_FIXTURE_ROOT, "contents");

export type FixtureFetchOptions = {
  /** Directory containing `page-N.json` recorded GitHub pulls responses. */
  fixtureDir?: string;
  /** Directory containing `<pullNumber>.json` review-comment list fixtures. */
  commentsFixtureDir?: string;
  /**
   * Directory containing `<ref>/<path>.json` contents API fixtures
   * (file path segments preserved under the ref folder).
   */
  contentsFixtureDir?: string;
  /**
   * Optional sequence of scripted responses before serving fixtures.
   * Useful for rate-limit backoff tests (e.g. one 403, then fixtures).
   */
  preamble?: Array<() => Promise<Response> | Response>;
};

/**
 * Build a `fetch` implementation that serves recorded GitHub API responses.
 * Throws if a non-fixture URL is requested (guards against live network).
 */
export function createFixtureFetch(
  options: FixtureFetchOptions = {},
): GitHubFetch {
  const pullsDir = options.fixtureDir ?? LIST_MERGED_PRS_FIXTURE_DIR;
  const commentsDir =
    options.commentsFixtureDir ?? PULL_REVIEW_COMMENTS_FIXTURE_DIR;
  const contentsDir = options.contentsFixtureDir ?? CONTENTS_FIXTURE_DIR;
  const preamble = [...(options.preamble ?? [])];

  return async (input, init) => {
    if (preamble.length > 0) {
      const next = preamble.shift();
      if (next !== undefined) {
        return next();
      }
    }

    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );

    if (url.hostname !== "api.github.com") {
      throw new Error(
        `Fixture fetch refused non-GitHub host: ${url.hostname}`,
      );
    }

    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      throw new Error(`Fixture fetch only supports GET; got ${method}`);
    }

    const pullsMatch = url.pathname.match(
      /^\/repos\/([^/]+)\/([^/]+)\/pulls$/,
    );
    if (pullsMatch !== null) {
      return servePullsPage(pullsDir, url);
    }

    const commentsMatch = url.pathname.match(
      /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/comments$/,
    );
    if (commentsMatch !== null) {
      const pullNumber = commentsMatch[3];
      if (pullNumber === undefined) {
        throw new Error(`Invalid pull comments path: ${url.pathname}`);
      }
      return serveJsonFile(
        path.join(commentsDir, `${pullNumber}.json`),
        "[]",
      );
    }

    const contentsMatch = url.pathname.match(
      /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/,
    );
    if (contentsMatch !== null) {
      const filePath = decodeURIComponent(contentsMatch[3] ?? "");
      const ref = url.searchParams.get("ref");
      if (ref === null || ref.trim() === "") {
        throw new Error(
          `Fixture contents request missing ref query: ${url.pathname}`,
        );
      }
      const recorded = path.join(contentsDir, ref, `${filePath}.json`);
      try {
        return await serveJsonFile(recorded);
      } catch (err) {
        if (
          err !== null &&
          typeof err === "object" &&
          "status" in err &&
          (err as { status: unknown }).status === 404
        ) {
          return new Response(JSON.stringify({ message: "Not Found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        throw err;
      }
    }

    throw new Error(`Fixture fetch has no recording for ${url.pathname}`);
  };
}

async function servePullsPage(fixtureDir: string, url: URL): Promise<Response> {
  const page = Number(url.searchParams.get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`Invalid page query: ${url.searchParams.get("page")}`);
  }

  const filePath = path.join(fixtureDir, `page-${page}.json`);
  return serveJsonFile(filePath, "[]");
}

async function serveJsonFile(
  filePath: string,
  missingBody?: string,
): Promise<Response> {
  let body: string;
  try {
    body = await readFile(filePath, "utf8");
  } catch {
    if (missingBody !== undefined) {
      body = missingBody;
    } else {
      const notFound = new Error(`Missing fixture file: ${filePath}`) as Error & {
        status: number;
      };
      notFound.status = 404;
      throw notFound;
    }
  }

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-limit": "5000",
    },
  });
}

/** Recorded 403 primary rate-limit response (ING-6). */
export function rateLimitForbiddenResponse(retryAfterSeconds = 0): Response {
  return new Response(
    JSON.stringify({
      message: "API rate limit exceeded",
      documentation_url:
        "https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting",
    }),
    {
      status: 403,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-limit": "5000",
        "x-ratelimit-reset": String(
          Math.floor(Date.now() / 1000) + retryAfterSeconds,
        ),
        "retry-after": String(retryAfterSeconds),
      },
    },
  );
}

/** Recorded 404 for missing / inaccessible repo (Step 1.4). */
export function notFoundResponse(): Response {
  return new Response(JSON.stringify({ message: "Not Found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

/** Recorded 401 bad credentials (Step 1.4). */
export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ message: "Bad credentials" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
