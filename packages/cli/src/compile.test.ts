import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readCursors } from "@graft/pipeline";
import { CLI_EXIT, graftNoDataError } from "@graft/shared";
import {
  cliExitCode,
  main,
  parseCompileArgs,
  runCompile,
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

async function copyGolden(): Promise<string> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "graft-cli-compile-"));
  await cp(goldenRoot, dataDir, { recursive: true });
  return dataDir;
}

describe("parseCompileArgs", () => {
  it("parses owner/repo", () => {
    expect(parseCompileArgs(["acme/widgets"])).toEqual({
      repo: "acme/widgets",
    });
  });
});

describe("runCompile — offline golden episodes", () => {
  it("writes recipes with minSupport=1 and updates compile watermark", async () => {
    const dataDir = await copyGolden();
    const lines: string[] = [];

    const summary = await runCompile({
      repo: "acme/widgets",
      env: { DATA_DIR: dataDir, GRAFT_MIN_SUPPORT: "1" },
      now: () => 2_000_000,
      log: (line) => lines.push(line),
    });

    expect(summary.recipes).toBe(12);
    expect(summary.compileWatermark.updatedAt).not.toBeNull();
    expect(summary.compileWatermark.compileRunId).not.toBeNull();

    const cursors = await readCursors(dataDir, "acme", "widgets");
    expect(cursors?.compile.updatedAt).not.toBeNull();

    const index = JSON.parse(
      await readFile(
        path.join(dataDir, "repos/acme/widgets/recipes/index.json"),
        "utf8",
      ),
    ) as { recipes: unknown[] };
    expect(index.recipes).toHaveLength(12);
  });

  it("main maps GRAFT_NO_DATA to exit 2", async () => {
    const code = await main(["compile", "acme/missing"], {
      env: { DATA_DIR: await mkdtemp(path.join(tmpdir(), "graft-empty-")) },
      error: () => {},
    });
    expect(code).toBe(CLI_EXIT.NO_DATA);
    expect(cliExitCode(graftNoDataError())).toBe(CLI_EXIT.NO_DATA);
  });
});
