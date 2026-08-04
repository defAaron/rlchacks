import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./diff-parser.js";

const FIXTURE_DIFF = `diff --git a/src/types.ts b/src/types.ts
index 1111111..2222222 100644
--- a/src/types.ts
+++ b/src/types.ts
@@ -1 +1 @@
-export function handle(value: any) {
+export function handle(value: unknown) {
`;

describe("parseUnifiedDiff", () => {
  it("parses file path and hunk lines", () => {
    const parsed = parseUnifiedDiff(FIXTURE_DIFF);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0]!.path).toBe("src/types.ts");
    expect(parsed.hunks[0]!.newLines.some((l) => l.includes("unknown"))).toBe(
      true,
    );
  });

  it("rejects empty diff", () => {
    expect(() => parseUnifiedDiff("   ")).toThrow(/Empty diff/);
  });
});
