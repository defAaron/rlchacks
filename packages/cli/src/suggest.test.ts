import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLI_EXIT, graftNoDataError } from "@graft/shared";
import {
  cliExitCode,
  main,
  parseSuggestArgs,
  runCompile,
  runRecipesList,
  runSuggest,
} from "./index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenRoot = path.join(
  here,
  "..",
  "..",
  "..",
  "testdata",
  "golden-episodes",
);
const rejectedDiff = path.join(
  here,
  "..",
  "..",
  "..",
  "testdata",
  "fixtures",
  "rejected-types.diff",
);

async function copyGolden(): Promise<string> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "graft-cli-suggest-"));
  await cp(goldenRoot, dataDir, { recursive: true });
  return dataDir;
}

describe("parseSuggestArgs", () => {
  it("parses repo and --diff", () => {
    expect(
      parseSuggestArgs(["acme/widgets", "--diff", "fixture.diff"]),
    ).toEqual({
      repo: "acme/widgets",
      diffFile: "fixture.diff",
      pathHint: undefined,
    });
  });
});

describe("runSuggest + recipes list — offline", () => {
  it("lists recipes and suggests graft for rejected diff with evidence", async () => {
    const dataDir = await copyGolden();
    const env = { DATA_DIR: dataDir, GRAFT_MIN_SUPPORT: "1" };

    await runCompile({
      repo: "acme/widgets",
      env,
      now: () => 3_000_000,
      log: () => {},
    });

    const listLines: string[] = [];
    const listed = await runRecipesList({
      repo: "acme/widgets",
      env,
      log: (line) => listLines.push(line),
    });
    expect(listed.recipes.length).toBeGreaterThan(0);
    expect(listed.recipes[0]!.confidence).toMatch(/high|medium|low/);

    const diff = await readFile(rejectedDiff, "utf8");
    const suggestLines: string[] = [];
    const suggested = await runSuggest({
      repo: "acme/widgets",
      env,
      diff,
      log: (line) => suggestLines.push(line),
    });

    expect(suggested.suggestions.length).toBeGreaterThanOrEqual(1);
    const top = suggested.suggestions[0]!;
    expect(top.evidence.length).toBeGreaterThan(0);
    expect(top.confidence).toMatch(/high|medium|low/);
    expect(top.patch).toContain("unknown");
  });

  it("main returns NO_DATA when recipes missing", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-no-recipes-"));
    await cp(goldenRoot, dataDir, { recursive: true });
    const code = await main(
      ["suggest", "acme/widgets", "--diff", rejectedDiff],
      { env: { DATA_DIR: dataDir }, error: () => {} },
    );
    expect(code).toBe(CLI_EXIT.NO_DATA);
    expect(cliExitCode(graftNoDataError("acme/widgets"))).toBe(CLI_EXIT.NO_DATA);
  });
});
