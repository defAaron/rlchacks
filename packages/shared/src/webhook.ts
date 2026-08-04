/**
 * GitHub webhook payload helpers (Phase 8.3 / ING-5).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { parseRepoSlug } from "./paths.js";

export type GitHubPullRequestEvent = {
  action: string;
  pull_request?: {
    merged?: boolean;
    number?: number;
  };
  repository?: {
    full_name?: string;
    name?: string;
    owner?: { login?: string };
  };
};

export type ParsedMergeEvent = {
  owner: string;
  repo: string;
  repoSlug: string;
  prNumber: number;
};

/** Parse JSON body; returns null when not a merged pull_request event. */
export function parseMergeWebhookPayload(
  body: unknown,
): ParsedMergeEvent | null {
  if (body === null || typeof body !== "object") {
    return null;
  }
  const event = body as GitHubPullRequestEvent;
  if (event.action !== "closed") {
    return null;
  }
  if (event.pull_request?.merged !== true) {
    return null;
  }
  const prNumber = event.pull_request.number;
  if (prNumber === undefined || !Number.isInteger(prNumber) || prNumber < 1) {
    return null;
  }
  const fullName = event.repository?.full_name;
  if (fullName !== undefined && fullName.includes("/")) {
    const { owner, name } = parseRepoSlug(fullName);
    return { owner, repo: name, repoSlug: `${owner}/${name}`, prNumber };
  }
  const ownerLogin = event.repository?.owner?.login;
  const repoName = event.repository?.name;
  if (
    ownerLogin !== undefined &&
    repoName !== undefined &&
    ownerLogin.trim() !== "" &&
    repoName.trim() !== ""
  ) {
    const { owner, name } = parseRepoSlug(`${ownerLogin}/${repoName}`);
    return { owner, repo: name, repoSlug: `${owner}/${name}`, prNumber };
  }
  return null;
}

/**
 * Verify GitHub webhook `X-Hub-Signature-256` header.
 * When secret is unset, verification is skipped (dev mode only).
 */
export function verifyGitHubWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string | undefined,
): boolean {
  if (secret === undefined || secret.trim() === "") {
    return true;
  }
  if (signatureHeader === undefined || !signatureHeader.startsWith("sha256=")) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  if (expected.length !== provided.length) {
    return false;
  }
  try {
    return timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(provided, "utf8"),
    );
  } catch {
    return false;
  }
}
