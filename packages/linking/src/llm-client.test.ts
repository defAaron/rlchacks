import { describe, expect, it } from "vitest";
import {
  createLinkLlmClientFromEnv,
  hasLlmApiKey,
  resolveLlmApiKey,
} from "./llm-client.js";

describe("resolveLlmApiKey / hasLlmApiKey", () => {
  it("returns undefined when no keys are set", () => {
    expect(resolveLlmApiKey({})).toBeUndefined();
    expect(hasLlmApiKey({})).toBe(false);
  });

  it("prefers Anthropic, then OpenAI, then Gemini", () => {
    expect(
      resolveLlmApiKey({
        ANTHROPIC_API_KEY: "a",
        OPENAI_API_KEY: "o",
        GEMINI_API_KEY: "g",
      }),
    ).toEqual({ provider: "anthropic", apiKey: "a" });

    expect(resolveLlmApiKey({ OPENAI_API_KEY: "o", GEMINI_API_KEY: "g" })).toEqual({
      provider: "openai",
      apiKey: "o",
    });

    expect(resolveLlmApiKey({ GEMINI_API_KEY: "g" })).toEqual({
      provider: "gemini",
      apiKey: "g",
    });
  });

  it("ignores blank keys", () => {
    expect(resolveLlmApiKey({ OPENAI_API_KEY: "  " })).toBeUndefined();
  });
});

describe("createLinkLlmClientFromEnv", () => {
  it("returns undefined without a key (no network client)", () => {
    expect(createLinkLlmClientFromEnv({})).toBeUndefined();
  });
});
