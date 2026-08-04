import { describe, expect, it } from "vitest";
import {
  containsRedactableSecrets,
  redactSecrets,
} from "./redact.js";

describe("redactSecrets (SAF-3)", () => {
  it("redacts GitHub personal access tokens", () => {
    const raw = "token ghp_1234567890abcdefghijklmnopqrstuvwxyz here";
    const out = redactSecrets(raw);
    expect(out).not.toContain("ghp_1234567890abcdefghijklmnopqrstuvwxyz");
    expect(out).toContain("ghp_[REDACTED]");
  });

  it("redacts github_pat_ tokens", () => {
    const raw = "auth github_pat_11AAAAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    expect(redactSecrets(raw)).toContain("github_pat_[REDACTED]");
  });

  it("redacts OpenAI-style sk- keys", () => {
    const raw = "key=sk-1234567890abcdefghijklmnop";
    expect(redactSecrets(raw)).toContain("sk-[REDACTED]");
  });

  it("redacts AWS access key ids", () => {
    const raw = "AKIAIOSFODNN7EXAMPLE";
    expect(redactSecrets(raw)).toBe("AKIA[REDACTED]");
  });

  it("redacts PEM private key blocks", () => {
    const raw = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAfake
-----END RSA PRIVATE KEY-----`;
    expect(redactSecrets(raw)).toBe("[REDACTED_PRIVATE_KEY]");
  });

  it("redacts assignment-style secrets", () => {
    const raw = 'API_KEY=supersecretvalue123';
    const out = redactSecrets(raw);
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("supersecretvalue123");
  });

  it("leaves benign code unchanged", () => {
    const code = `function retry() {\n  return fetch(url);\n}`;
    expect(redactSecrets(code)).toBe(code);
  });

  it("detects redactable content", () => {
    expect(containsRedactableSecrets("ghp_fixture_token")).toBe(false);
    expect(
      containsRedactableSecrets("ghp_1234567890abcdefghijklmnopqrstuvwxyz"),
    ).toBe(true);
  });
});
