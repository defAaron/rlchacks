import { describe, expect, it } from "vitest";
import {
  assertRepoAllowed,
  parseRepoAllowlist,
} from "./allowlist.js";
import { GraftError, GraftErrorCodes } from "./errors.js";

describe("repo allowlist (SAF-1 / Phase 8.5)", () => {
  it("parses comma-separated allowlist", () => {
    expect(parseRepoAllowlist("acme/widgets,other/app")).toEqual([
      "acme/widgets",
      "other/app",
    ]);
  });

  it("returns null when unset", () => {
    expect(parseRepoAllowlist(undefined)).toBeNull();
    expect(parseRepoAllowlist("")).toBeNull();
  });

  it("allows listed repos", () => {
    expect(() =>
      assertRepoAllowed("acme/widgets", ["acme/widgets", "other/app"]),
    ).not.toThrow();
  });

  it("refuses unlisted repos", () => {
    expect(() =>
      assertRepoAllowed("evil/repo", ["acme/widgets"]),
    ).toThrow(GraftError);
    try {
      assertRepoAllowed("evil/repo", ["acme/widgets"]);
    } catch (err) {
      expect(err).toBeInstanceOf(GraftError);
      expect((err as GraftError).code).toBe(GraftErrorCodes.GRAFT_REPO_FORBIDDEN);
    }
  });

  it("allows any repo when allowlist is null", () => {
    expect(() => assertRepoAllowed("any/repo", null)).not.toThrow();
  });
});
