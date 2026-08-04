import { describe, expect, it, vi } from "vitest";
import type { CodeSpan } from "@graft/shared";
import {
  applyLlmMediumValidation,
  LlmLinkReasons,
  shouldRunLlmValidation,
  type LinkLlmClient,
} from "./llm-validate.js";

const rejected: CodeSpan = {
  path: "src/retry.ts",
  startLine: 8,
  endLine: 8,
  sha: "abc",
  text: "      lastError = err;\n",
  normalized: "lastError = err;",
};

const accepted: CodeSpan = {
  path: "src/retry.ts",
  startLine: 8,
  endLine: 9,
  sha: "def",
  text: "      if (i === attempts - 1) throw err;\n      lastError = err;\n",
  normalized: "if (i === attempts - 1) throw err; lastError = err;",
};

function mockClient(
  impl: LinkLlmClient["validateLink"],
): LinkLlmClient & { validateLink: ReturnType<typeof vi.fn> } {
  const validateLink = vi.fn(impl);
  return { validateLink };
}

describe("shouldRunLlmValidation", () => {
  it("is false when GRAFT_LLM_ENABLED is false", () => {
    expect(
      shouldRunLlmValidation({
        llmEnabled: false,
        llmApiKeyPresent: true,
        llmClient: mockClient(async () => ({
          addresses: true,
          rationale: "x",
        })),
        linkConfidence: "medium",
        accepted,
      }),
    ).toBe(false);
  });

  it("is false without API key even when enabled", () => {
    expect(
      shouldRunLlmValidation({
        llmEnabled: true,
        llmApiKeyPresent: false,
        llmClient: mockClient(async () => ({
          addresses: true,
          rationale: "x",
        })),
        linkConfidence: "medium",
        accepted,
      }),
    ).toBe(false);
  });

  it("is false for non-medium confidence", () => {
    expect(
      shouldRunLlmValidation({
        llmEnabled: true,
        llmApiKeyPresent: true,
        llmClient: mockClient(async () => ({
          addresses: true,
          rationale: "x",
        })),
        linkConfidence: "high",
        accepted,
      }),
    ).toBe(false);
  });
});

describe("applyLlmMediumValidation", () => {
  it("upgrades medium → high when mock LLM says addresses", async () => {
    const client = mockClient(async () => ({
      addresses: true,
      rationale: "fix matches comment",
    }));

    const result = await applyLlmMediumValidation({
      linkConfidence: "medium",
      linkReason: "rejected_span_blob+overlap_lexical",
      commentBody: "Please rethrow on last attempt",
      path: rejected.path,
      rejected,
      accepted,
      llmEnabled: true,
      llmApiKeyPresent: true,
      llmClient: client,
    });

    expect(result.llmCalled).toBe(true);
    expect(result.linkConfidence).toBe("high");
    expect(result.linkReason).toBe(
      `rejected_span_blob+overlap_lexical+${LlmLinkReasons.UPGRADE}`,
    );
    expect(client.validateLink).toHaveBeenCalledTimes(1);
    expect(client.validateLink).toHaveBeenCalledWith({
      commentBody: "Please rethrow on last attempt",
      rejectedText: rejected.text,
      acceptedText: accepted.text,
      path: rejected.path,
    });
  });

  it("downgrades medium → low when mock LLM says not addresses", async () => {
    const client = mockClient(async () => ({
      addresses: false,
      rationale: "unrelated whitespace change",
    }));

    const result = await applyLlmMediumValidation({
      linkConfidence: "medium",
      linkReason: "rejected_span_blob+overlap_lexical",
      commentBody: "Please rethrow on last attempt",
      path: rejected.path,
      rejected,
      accepted,
      llmEnabled: true,
      llmApiKeyPresent: true,
      llmClient: client,
    });

    expect(result.llmCalled).toBe(true);
    expect(result.linkConfidence).toBe("low");
    expect(result.linkReason).toContain(LlmLinkReasons.DOWNGRADE);
  });

  it("keeps deterministic result when LLM throws", async () => {
    const client = mockClient(async () => {
      throw new Error("network down");
    });

    const result = await applyLlmMediumValidation({
      linkConfidence: "medium",
      linkReason: "rejected_span_blob+overlap_lexical",
      commentBody: "Please rethrow on last attempt",
      path: rejected.path,
      rejected,
      accepted,
      llmEnabled: true,
      llmApiKeyPresent: true,
      llmClient: client,
    });

    expect(result.llmCalled).toBe(true);
    expect(result.linkConfidence).toBe("medium");
    expect(result.linkReason).toBe("rejected_span_blob+overlap_lexical");
  });

  it("makes zero client calls when GRAFT_LLM_ENABLED is false", async () => {
    const client = mockClient(async () => {
      throw new Error("should not be called — network forbidden");
    });

    const result = await applyLlmMediumValidation({
      linkConfidence: "medium",
      linkReason: "rejected_span_blob+overlap_lexical",
      commentBody: "Please rethrow on last attempt",
      path: rejected.path,
      rejected,
      accepted,
      llmEnabled: false,
      llmApiKeyPresent: true,
      llmClient: client,
    });

    expect(result.llmCalled).toBe(false);
    expect(result.linkConfidence).toBe("medium");
    expect(result.linkReason).toBe("rejected_span_blob+overlap_lexical");
    expect(client.validateLink).not.toHaveBeenCalled();
  });

  it("does not invent or alter accepted spans — only confidence", async () => {
    const client = mockClient(async () => ({
      addresses: true,
      rationale: "ok",
    }));

    const result = await applyLlmMediumValidation({
      linkConfidence: "medium",
      linkReason: "overlap_lexical",
      commentBody: "fix it",
      path: rejected.path,
      rejected,
      accepted,
      llmEnabled: true,
      llmApiKeyPresent: true,
      llmClient: client,
    });

    // Function returns confidence/reason only — no episode fabrication surface.
    expect(Object.keys(result).sort()).toEqual([
      "linkConfidence",
      "linkReason",
      "llmCalled",
    ]);
    expect(result.linkConfidence).toBe("high");
  });
});
