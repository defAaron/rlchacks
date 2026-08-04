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
  parseLinkArgs,
  runLink,
} from "./index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const phase1SeedRoot = path.join(
  here,
  "..",
  "..",
  "..",
  "testdata",
  "phase1-seed",
);

async function copyPhase1Seed(): Promise<string> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "graft-cli-link-"));
  await cp(phase1SeedRoot, dataDir, { recursive: true });
  return dataDir;
}

describe("parseLinkArgs", () => {
  it("parses owner/repo", () => {
    expect(parseLinkArgs(["acme/widgets"])).toEqual({
      repo: "acme/widgets",
    });
  });

  it("rejects missing repo", () => {
    expect(() => parseLinkArgs([])).toThrow(/Missing repo/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseLinkArgs(["acme/widgets", "--nope"])).toThrow(
      /Unknown argument/,
    );
  });
});

describe("runLink — offline phase1-seed", () => {
  it("writes episodes/index, updates link watermark, and is re-runnable", async () => {
    const dataDir = await copyPhase1Seed();
    const lines: string[] = [];
    let clock = 1_000_000;
    const now = () => {
      clock += 100;
      return clock;
    };

    const first = await runLink({
      repo: "acme/widgets",
      env: { DATA_DIR: dataDir },
      now,
      log: (line) => lines.push(line),
    });

    expect(first.repo).toBe("acme/widgets");
    expect(first.episodes).toBeGreaterThanOrEqual(1);
    expect(first.mediumOrHigher).toBeGreaterThanOrEqual(1);
    expect(first.discards).toBeGreaterThanOrEqual(1);
    expect(first.linkWatermark.updatedAt).not.toBeNull();
    expect(lines).toHaveLength(1);
    // Structured CLI summary: counts only — no comment bodies / tokens.
    expect(lines[0]).not.toMatch(/commentBody|bodyPreview|ghp_/);

    // Checkpoint 2 Labels / SAF-4: CLI JSON always exposes linkConfidence (+ reason).
    expect(first.episodeLabels.length).toBe(first.episodes);
    expect(
      first.episodeLabels.every(
        (e) =>
          typeof e.linkConfidence === "string" &&
          e.linkConfidence.length > 0 &&
          typeof e.linkReason === "string" &&
          e.linkReason.length > 0,
      ),
    ).toBe(true);
    const printed = JSON.parse(lines[0]!) as {
      episodeLabels: Array<{ linkConfidence: string; linkReason: string }>;
    };
    expect(printed.episodeLabels.length).toBe(first.episodes);
    expect(
      printed.episodeLabels.every(
        (e) => e.linkConfidence.length > 0 && e.linkReason.length > 0,
      ),
    ).toBe(true);

    const cursors = await readCursors(dataDir, "acme", "widgets");
    expect(cursors?.link.updatedAt).toBe(first.linkWatermark.updatedAt);

    const indexPath = path.join(
      dataDir,
      "repos",
      "acme",
      "widgets",
      "episodes",
      "index.json",
    );
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      episodes: Array<{ id: string; linkConfidence: string }>;
    };
    expect(
      index.episodes.some(
        (e) => e.linkConfidence === "medium" || e.linkConfidence === "high",
      ),
    ).toBe(true);

    const second = await runLink({
      repo: "acme/widgets",
      env: { DATA_DIR: dataDir },
      now,
      log: () => {},
    });
    expect(second.episodes).toBe(first.episodes);
    expect(second.mediumOrHigher).toBe(first.mediumOrHigher);
  });

  it("maps GRAFT_NO_DATA via main when raw is empty", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-cli-link-empty-"));
    const errors: string[] = [];
    const code = await main(["link", "acme/widgets"], {
      env: { DATA_DIR: dataDir },
      error: (line) => errors.push(line),
    });
    expect(code).toBe(CLI_EXIT.NO_DATA);
    expect(errors.join("\n")).toMatch(/GRAFT_NO_DATA/);
    expect(cliExitCode(graftNoDataError("acme/widgets"))).toBe(
      CLI_EXIT.NO_DATA,
    );
  });
});
