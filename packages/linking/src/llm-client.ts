/**
 * Optional HTTP LinkLlmClient (no paid SDK dependency).
 * Used only when GRAFT_LLM_ENABLED + key; CI uses mocks instead.
 */

import type {
  LinkLlmClient,
  LlmLinkValidationInput,
  LlmLinkValidationResult,
} from "./llm-validate.js";

const OPENAI_COMPAT_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export type LlmApiKeyProvider = "openai" | "anthropic" | "gemini";

export type ResolvedLlmApiKey = {
  provider: LlmApiKeyProvider;
  apiKey: string;
};

/** Detect first configured LLM API key (SAF-2 opt-in keys). */
export function resolveLlmApiKey(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLlmApiKey | undefined {
  const anthropic = env.ANTHROPIC_API_KEY?.trim();
  if (anthropic) {
    return { provider: "anthropic", apiKey: anthropic };
  }
  const openai = env.OPENAI_API_KEY?.trim();
  if (openai) {
    return { provider: "openai", apiKey: openai };
  }
  const gemini = env.GEMINI_API_KEY?.trim();
  if (gemini) {
    return { provider: "gemini", apiKey: gemini };
  }
  return undefined;
}

export function hasLlmApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveLlmApiKey(env) !== undefined;
}

function buildValidationPrompt(input: LlmLinkValidationInput): string {
  return [
    "Does the accepted (after) code span address the review comment about the rejected (before) span?",
    "Reply with JSON only: {\"addresses\": boolean, \"rationale\": string}",
    "",
    `Path: ${input.path}`,
    "",
    "Comment:",
    input.commentBody,
    "",
    "Rejected span:",
    input.rejectedText,
    "",
    "Accepted span:",
    input.acceptedText,
  ].join("\n");
}

function parseValidationJson(raw: string): LlmLinkValidationResult {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("LLM response missing JSON object");
  }
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
    addresses?: unknown;
    rationale?: unknown;
  };
  if (typeof parsed.addresses !== "boolean") {
    throw new Error("LLM response missing boolean addresses");
  }
  return {
    addresses: parsed.addresses,
    rationale:
      typeof parsed.rationale === "string" ? parsed.rationale : "llm_validation",
  };
}

export type CreateHttpLinkLlmClientOptions = {
  apiKey: string;
  provider: LlmApiKeyProvider;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  model?: string;
};

/**
 * Minimal fetch-based client. Prefer injecting a mock in unit tests.
 * Gemini uses the OpenAI-compatible Generative Language endpoint shape.
 */
export function createHttpLinkLlmClient(
  options: CreateHttpLinkLlmClientOptions,
): LinkLlmClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async validateLink(
      input: LlmLinkValidationInput,
    ): Promise<LlmLinkValidationResult> {
      const prompt = buildValidationPrompt(input);

      if (options.provider === "anthropic") {
        const res = await fetchImpl(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": options.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: options.model ?? "claude-3-5-haiku-latest",
            max_tokens: 256,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!res.ok) {
          throw new Error(`Anthropic HTTP ${res.status}`);
        }
        const body = (await res.json()) as {
          content?: Array<{ type?: string; text?: string }>;
        };
        const text = body.content?.find((c) => c.type === "text")?.text;
        if (typeof text !== "string") {
          throw new Error("Anthropic response missing text");
        }
        return parseValidationJson(text);
      }

      const url =
        options.provider === "gemini"
          ? `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
          : OPENAI_COMPAT_URL;
      const model =
        options.model ??
        (options.provider === "gemini" ? "gemini-2.0-flash" : "gpt-4o-mini");

      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You validate code-review links. Respond with JSON only.",
            },
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`OpenAI-compatible HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("OpenAI-compatible response missing content");
      }
      return parseValidationJson(content);
    },
  };
}

/**
 * Build a client when an API key is present; otherwise `undefined`.
 * Callers must still gate on `GRAFT_LLM_ENABLED` before invoking.
 */
export function createLinkLlmClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): LinkLlmClient | undefined {
  const resolved = resolveLlmApiKey(env);
  if (resolved === undefined) {
    return undefined;
  }
  return createHttpLinkLlmClient({
    apiKey: resolved.apiKey,
    provider: resolved.provider,
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
  });
}
