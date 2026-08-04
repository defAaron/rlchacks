import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RawReviewCommentSchema, parseArtifact } from "@graft/shared";
import {
  assessActionability,
  DiscardReasons,
  isBotAuthor,
  isEmojiOnlyBody,
  normalizeCommentBody,
} from "./actionability.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesPath = path.join(
  here,
  "..",
  "testdata",
  "actionability",
  "cases.json",
);
const phase1CommentPath = path.join(
  here,
  "..",
  "..",
  "..",
  "testdata",
  "phase1-seed",
  "repos",
  "acme",
  "widgets",
  "raw",
  "comments",
  "PRRC_kwDOFixtureComment1.json",
);

type GoldenCase = {
  id: string;
  description: string;
  author: string;
  body: string;
  expected: {
    actionable: boolean;
    discardReason: string | null;
  };
};

describe("assessActionability — golden fixtures", () => {
  it("keeps actionable comments and discards noise with reasons", async () => {
    const cases = JSON.parse(await readFile(casesPath, "utf8")) as GoldenCase[];
    expect(cases.length).toBeGreaterThanOrEqual(20);

    const mismatches: string[] = [];
    for (const c of cases) {
      const result = assessActionability({ author: c.author, body: c.body });
      if (
        result.actionable !== c.expected.actionable ||
        result.discardReason !== c.expected.discardReason
      ) {
        mismatches.push(
          `${c.id}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(result)} (${c.description})`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("keeps the phase1-seed actionable comment", async () => {
    const raw = JSON.parse(await readFile(phase1CommentPath, "utf8")) as unknown;
    const comment = parseArtifact(
      RawReviewCommentSchema,
      raw,
      "RawReviewComment",
    );
    expect(assessActionability(comment)).toEqual({
      actionable: true,
      discardReason: null,
    });
  });
});

describe("assessActionability — options + helpers", () => {
  it("honors extra botAuthors", () => {
    expect(
      assessActionability(
        { author: "acme-review-bot", body: "Please rename this helper." },
        { botAuthors: ["acme-review-bot"] },
      ),
    ).toEqual({
      actionable: false,
      discardReason: DiscardReasons.BOT_AUTHOR,
    });
  });

  it("honors custom minBodyLength", () => {
    expect(
      assessActionability(
        { author: "human", body: "please rename" },
        { minBodyLength: 20 },
      ),
    ).toEqual({
      actionable: false,
      discardReason: DiscardReasons.TOO_SHORT,
    });
    expect(
      assessActionability(
        { author: "human", body: "please rename" },
        { minBodyLength: 5 },
      ),
    ).toEqual({
      actionable: true,
      discardReason: null,
    });
  });

  it("isBotAuthor detects [bot] suffix and defaults", () => {
    expect(isBotAuthor("dependabot[bot]")).toBe(true);
    expect(isBotAuthor("renovate[bot]")).toBe(true);
    expect(isBotAuthor("reviewer1")).toBe(false);
    expect(isBotAuthor("robotnik")).toBe(false);
  });

  it("isEmojiOnlyBody and normalizeCommentBody are stable", () => {
    expect(isEmojiOnlyBody("👍🎉")).toBe(true);
    expect(isEmojiOnlyBody(":shipit:")).toBe(true);
    expect(isEmojiOnlyBody("please fix")).toBe(false);
    expect(normalizeCommentBody("LGTM!!! :shipit:")).toBe("lgtm");
  });
});
