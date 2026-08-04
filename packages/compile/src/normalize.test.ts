import { describe, expect, it } from "vitest";
import {
  normalizeForClustering,
  stableNormalizeHash,
} from "./normalize.js";

describe("normalizeForClustering", () => {
  it("collapses whitespace and masks literals", () => {
    const input = '  setTimeout(() => {}, 1000);  ';
    expect(normalizeForClustering(input)).toBe(
      "setTimeout(() => {}, N);",
    );
  });

  it("produces stable hashes for identical inputs", () => {
    const a = stableNormalizeHash('foo("bar", 42)');
    const b = stableNormalizeHash('foo("bar", 42)');
    const c = stableNormalizeHash("foo(bar, qux)");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("masks short local identifiers when enabled", () => {
    const out = normalizeForClustering("const x = err;");
    expect(out).toContain("V");
  });
});
