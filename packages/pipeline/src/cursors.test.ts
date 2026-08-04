import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GraftArtifactParseError, repoScopedPath } from "@graft/shared";
import {
  cursorsPath,
  defaultCursors,
  readCursors,
  writeCursors,
} from "./cursors.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "graft-cursors-"));
  tempDirs.push(dir);
  return dir;
}

describe("cursors watermarks", () => {
  it("defaultCursors has null ingest/link/compile watermarks", () => {
    expect(defaultCursors()).toEqual({
      ingest: { lastMergedAt: null, lastPrNumber: null },
      link: { updatedAt: null },
      compile: { updatedAt: null, compileRunId: null },
    });
  });

  it("cursorsPath is repo-scoped under DATA_DIR", () => {
    const dataDir = "/tmp/graft-data";
    expect(cursorsPath(dataDir, "acme", "widgets")).toBe(
      repoScopedPath(dataDir, "acme", "widgets", "cursors.json"),
    );
  });

  it("write/read round-trips cursors.json watermarks", async () => {
    const dataDir = await makeTempDataDir();
    const cursors = {
      ingest: {
        lastMergedAt: "2024-06-15T12:34:56Z",
        lastPrNumber: 42,
      },
      link: { updatedAt: "2024-06-15T13:00:00Z" },
      compile: {
        updatedAt: "2024-06-16T00:00:00Z",
        compileRunId: "compile_run_1",
      },
    };

    const writtenPath = await writeCursors(
      dataDir,
      "acme",
      "widgets",
      cursors,
    );
    expect(writtenPath).toBe(cursorsPath(dataDir, "acme", "widgets"));
    expect(writtenPath).toContain(
      path.join("repos", "acme", "widgets", "cursors.json"),
    );

    const onDisk = JSON.parse(await readFile(writtenPath, "utf8"));
    expect(onDisk).toEqual(cursors);

    const readBack = await readCursors(dataDir, "acme", "widgets");
    expect(readBack).toEqual(cursors);
  });

  it("returns null when cursors.json is missing", async () => {
    const dataDir = await makeTempDataDir();
    expect(await readCursors(dataDir, "acme", "widgets")).toBeNull();
  });

  it("rejects invalid watermark shape on write", async () => {
    const dataDir = await makeTempDataDir();
    await expect(
      writeCursors(dataDir, "acme", "widgets", {
        ingest: { lastMergedAt: "not-a-date", lastPrNumber: 1 },
        link: { updatedAt: null },
        compile: { updatedAt: null, compileRunId: null },
      }),
    ).rejects.toBeInstanceOf(GraftArtifactParseError);
  });

  it("rejects invalid JSON on read", async () => {
    const dataDir = await makeTempDataDir();
    const filePath = cursorsPath(dataDir, "acme", "widgets");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{not json", "utf8");

    await expect(readCursors(dataDir, "acme", "widgets")).rejects.toBeInstanceOf(
      GraftArtifactParseError,
    );
  });
});
