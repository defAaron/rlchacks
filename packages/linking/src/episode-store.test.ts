import { describe, expect, it } from "vitest";
import { truncateBodyPreview } from "./episode-store.js";

/** Must match `BODY_PREVIEW_MAX` in episode-store.ts. */
const BODY_PREVIEW_MAX = 160;

describe("truncateBodyPreview", () => {
  it("returns short bodies unchanged (after whitespace collapse)", () => {
    expect(truncateBodyPreview("Please throw on the last attempt.")).toBe(
      "Please throw on the last attempt.",
    );
  });

  it("collapses whitespace to a single line", () => {
    expect(truncateBodyPreview("line one\n\n  line   two\t")).toBe(
      "line one line two",
    );
  });

  it("truncates long bodies with an ellipsis at the max length", () => {
    const long = "a".repeat(BODY_PREVIEW_MAX + 40);
    const preview = truncateBodyPreview(long);
    expect(preview.length).toBe(BODY_PREVIEW_MAX);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.startsWith("a".repeat(BODY_PREVIEW_MAX - 1))).toBe(true);
    expect(preview).not.toContain(long);
  });

  it("does not truncate when length equals the max", () => {
    const exact = "b".repeat(BODY_PREVIEW_MAX);
    expect(truncateBodyPreview(exact)).toBe(exact);
    expect(truncateBodyPreview(exact).endsWith("…")).toBe(false);
  });
});
