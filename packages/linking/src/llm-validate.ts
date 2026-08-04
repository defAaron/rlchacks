/**
 * Optional LLM validation for medium-confidence links (TRD §7.2, LNK-5, SAF-2).
 *
 * - Off unless `GRAFT_LLM_ENABLED` + API key + injectable client.
 * - Only adjusts confidence on existing deterministic medium candidates.
 * - Never invents episodes or accepted spans.
 * - On LLM failure, keep the deterministic result.
 */

import type { CodeSpan, LinkConfidence } from "@graft/shared";

export const LlmLinkReasons = {
  UPGRADE: "llm_upgrade",
  DOWNGRADE: "llm_downgrade",
} as const;

export type LlmLinkReason =
  (typeof LlmLinkReasons)[keyof typeof LlmLinkReasons];

/** Prompt payload: comment + rejected + accepted (TRD §7.2). */
export type LlmLinkValidationInput = {
  commentBody: string;
  rejectedText: string;
  acceptedText: string;
  path: string;
};

/** LLM response shape: `{ addresses, rationale }`. */
export type LlmLinkValidationResult = {
  addresses: boolean;
  rationale: string;
};

/**
 * Injectable LLM client (mock in tests; optional HTTP provider in CLI).
 * Must not be called when `GRAFT_LLM_ENABLED` is false.
 */
export type LinkLlmClient = {
  validateLink(input: LlmLinkValidationInput): Promise<LlmLinkValidationResult>;
};

export type ApplyLlmMediumValidationOptions = {
  linkConfidence: LinkConfidence;
  linkReason: string;
  commentBody: string;
  path: string;
  rejected: CodeSpan;
  accepted: CodeSpan | null;
  /** From `GRAFT_LLM_ENABLED` (default false). */
  llmEnabled: boolean;
  /** True when a provider API key is present in env. */
  llmApiKeyPresent: boolean;
  /** Injectable client; required to actually call when enabled + key. */
  llmClient?: LinkLlmClient;
};

export type ApplyLlmMediumValidationResult = {
  linkConfidence: LinkConfidence;
  linkReason: string;
  /** Whether `llmClient.validateLink` was invoked. */
  llmCalled: boolean;
};

/**
 * True when optional LLM validation is allowed to run (SAF-2).
 * Flag alone is not enough — needs key + client.
 */
export function shouldRunLlmValidation(options: {
  llmEnabled: boolean;
  llmApiKeyPresent: boolean;
  llmClient?: LinkLlmClient;
  linkConfidence: LinkConfidence;
  accepted: CodeSpan | null;
}): boolean {
  return (
    options.llmEnabled &&
    options.llmApiKeyPresent &&
    options.llmClient !== undefined &&
    options.linkConfidence === "medium" &&
    options.accepted !== null
  );
}

/**
 * Validate a deterministic medium link via LLM.
 * Upgrades medium→high when `addresses`, downgrades to low otherwise.
 * On any failure, returns the original deterministic confidence/reason.
 */
export async function applyLlmMediumValidation(
  options: ApplyLlmMediumValidationOptions,
): Promise<ApplyLlmMediumValidationResult> {
  const {
    linkConfidence,
    linkReason,
    commentBody,
    path,
    rejected,
    accepted,
    llmEnabled,
    llmApiKeyPresent,
    llmClient,
  } = options;

  if (
    !shouldRunLlmValidation({
      llmEnabled,
      llmApiKeyPresent,
      linkConfidence,
      accepted,
      ...(llmClient !== undefined ? { llmClient } : {}),
    })
  ) {
    return { linkConfidence, linkReason, llmCalled: false };
  }

  // Narrowed by shouldRunLlmValidation.
  const client = llmClient!;
  const acceptedSpan = accepted!;

  try {
    const result = await client.validateLink({
      commentBody,
      rejectedText: rejected.text,
      acceptedText: acceptedSpan.text,
      path,
    });

    if (result.addresses) {
      return {
        linkConfidence: "high",
        linkReason: `${linkReason}+${LlmLinkReasons.UPGRADE}`,
        llmCalled: true,
      };
    }
    return {
      linkConfidence: "low",
      linkReason: `${linkReason}+${LlmLinkReasons.DOWNGRADE}`,
      llmCalled: true,
    };
  } catch {
    // NFR-5 / TRD: graceful degradation — keep deterministic result.
    return { linkConfidence, linkReason, llmCalled: true };
  }
}
