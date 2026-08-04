import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseMergeWebhookPayload,
  verifyGitHubWebhookSignature,
} from "./webhook.js";

describe("GitHub webhook helpers (ING-5)", () => {
  it("parses merged pull_request closed events", () => {
    const parsed = parseMergeWebhookPayload({
      action: "closed",
      pull_request: { merged: true, number: 42 },
      repository: { full_name: "acme/widgets" },
    });
    expect(parsed).toEqual({
      owner: "acme",
      repo: "widgets",
      repoSlug: "acme/widgets",
      prNumber: 42,
    });
  });

  it("ignores non-merge closes", () => {
    expect(
      parseMergeWebhookPayload({
        action: "closed",
        pull_request: { merged: false, number: 1 },
        repository: { full_name: "acme/widgets" },
      }),
    ).toBeNull();
  });

  it("ignores non-closed actions", () => {
    expect(
      parseMergeWebhookPayload({
        action: "opened",
        pull_request: { merged: true, number: 1 },
        repository: { full_name: "acme/widgets" },
      }),
    ).toBeNull();
  });

  it("verifies HMAC signature when secret is set", () => {
    const body = '{"action":"closed"}';
    const secret = "test-secret";
    const sig =
      "sha256=" +
      createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifyGitHubWebhookSignature(body, sig, secret)).toBe(true);
    expect(verifyGitHubWebhookSignature(body, "sha256=bad", secret)).toBe(
      false,
    );
  });

  it("skips verification when secret is unset", () => {
    expect(verifyGitHubWebhookSignature("{}", undefined, undefined)).toBe(
      true,
    );
  });
});
