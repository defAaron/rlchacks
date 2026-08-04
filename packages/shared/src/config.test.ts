import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LLM_ENABLED,
  DEFAULT_MIN_SUPPORT,
  defaultRepoConfig,
  loadGraftEnv,
  readRepoConfig,
  resolveGraftConfig,
  toPrintableResolvedConfig,
  writeRepoConfig,
} from "./config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "graft-config-"));
  tempDirs.push(dir);
  return dir;
}

describe("loadGraftEnv", () => {
  it("defaults LLM off and minSupport to 2", () => {
    const env = loadGraftEnv({});
    expect(env.llmEnabled).toBe(false);
    expect(DEFAULT_LLM_ENABLED).toBe(false);
    expect(env.minSupport).toBe(2);
    expect(DEFAULT_MIN_SUPPORT).toBe(2);
    expect(env.minSupportFromEnv).toBe(false);
    expect(env.dataDir).toBe("./data");
    expect(env.githubToken).toBeUndefined();
    expect(env.graftRepo).toBeUndefined();
  });

  it("parses supported env vars", () => {
    const env = loadGraftEnv({
      GITHUB_TOKEN: "ghp_test",
      GRAFT_REPO: "acme/widgets",
      DATA_DIR: "/tmp/graft-data",
      GRAFT_MIN_SUPPORT: "5",
      GRAFT_LLM_ENABLED: "true",
    });
    expect(env.githubToken).toBe("ghp_test");
    expect(env.graftRepo).toBe("acme/widgets");
    expect(env.dataDir).toBe("/tmp/graft-data");
    expect(env.minSupport).toBe(5);
    expect(env.minSupportFromEnv).toBe(true);
    expect(env.llmEnabled).toBe(true);
  });

  it("treats empty GRAFT_LLM_ENABLED as false", () => {
    expect(loadGraftEnv({ GRAFT_LLM_ENABLED: "" }).llmEnabled).toBe(false);
    expect(loadGraftEnv({ GRAFT_LLM_ENABLED: "false" }).llmEnabled).toBe(false);
    expect(loadGraftEnv({ GRAFT_LLM_ENABLED: "0" }).llmEnabled).toBe(false);
  });

  it("rejects invalid boolean / minSupport", () => {
    expect(() => loadGraftEnv({ GRAFT_LLM_ENABLED: "maybe" })).toThrow(
      /Invalid boolean/,
    );
    expect(() => loadGraftEnv({ GRAFT_MIN_SUPPORT: "0" })).toThrow(
      /GRAFT_MIN_SUPPORT/,
    );
  });
});

describe("repo config read/write", () => {
  it("writes and reads config.json under repo-scoped path", async () => {
    const dataDir = await makeTempDataDir();
    const config = defaultRepoConfig("acme", "widgets");
    const writtenPath = await writeRepoConfig(dataDir, config);

    expect(writtenPath).toBe(
      path.resolve(dataDir, "repos", "acme", "widgets", "config.json"),
    );

    const raw = await readFile(writtenPath, "utf8");
    expect(raw).not.toMatch(/GITHUB_TOKEN|ghp_/);

    const read = await readRepoConfig(dataDir, "acme", "widgets");
    expect(read).toEqual(config);
  });

  it("returns null when config.json is missing", async () => {
    const dataDir = await makeTempDataDir();
    expect(await readRepoConfig(dataDir, "acme", "widgets")).toBeNull();
  });

  it("rejects owner/name mismatch vs path", async () => {
    const dataDir = await makeTempDataDir();
    const { mkdir, writeFile } = await import("node:fs/promises");
    const badPath = path.join(
      dataDir,
      "repos",
      "acme",
      "widgets",
      "config.json",
    );
    await mkdir(path.dirname(badPath), { recursive: true });
    await writeFile(
      badPath,
      JSON.stringify(defaultRepoConfig("other", "repo")),
      "utf8",
    );

    await expect(readRepoConfig(dataDir, "acme", "widgets")).rejects.toThrow(
      /does not match/,
    );
  });
});

describe("resolveGraftConfig", () => {
  it("resolves from GRAFT_REPO without network and defaults LLM false", async () => {
    const dataDir = await makeTempDataDir();
    const resolved = await resolveGraftConfig({
      env: {
        GRAFT_REPO: "acme/widgets",
        DATA_DIR: dataDir,
      },
    });

    expect(resolved.repoSlug).toBe("acme/widgets");
    expect(resolved.env.llmEnabled).toBe(false);
    expect(resolved.configExisted).toBe(false);
    expect(resolved.repoConfig.compile.minSupport).toBe(2);
    expect(resolved.paths.configPath).toBe(
      path.resolve(dataDir, "repos", "acme", "widgets", "config.json"),
    );
  });

  it("overlays GRAFT_MIN_SUPPORT onto repoConfig and init writes file", async () => {
    const dataDir = await makeTempDataDir();
    const resolved = await resolveGraftConfig({
      repo: "acme/widgets",
      init: true,
      env: {
        DATA_DIR: dataDir,
        GRAFT_MIN_SUPPORT: "4",
      },
    });

    expect(resolved.repoConfig.compile.minSupport).toBe(4);
    expect(resolved.env.minSupport).toBe(4);

    const onDisk = await readRepoConfig(dataDir, "acme", "widgets");
    expect(onDisk).not.toBeNull();
    // File stores schema defaults; env overlay is applied at resolve time.
    expect(onDisk?.compile.minSupport).toBe(2);
  });

  it("prefers explicit --repo over GRAFT_REPO", async () => {
    const dataDir = await makeTempDataDir();
    const resolved = await resolveGraftConfig({
      repo: "other/lib",
      env: { GRAFT_REPO: "acme/widgets", DATA_DIR: dataDir },
    });
    expect(resolved.repoSlug).toBe("other/lib");
  });

  it("redacts token in printable view", async () => {
    const dataDir = await makeTempDataDir();
    const resolved = await resolveGraftConfig({
      repo: "acme/widgets",
      env: {
        DATA_DIR: dataDir,
        GITHUB_TOKEN: "ghp_secret",
        GRAFT_LLM_ENABLED: "false",
      },
    });
    const printable = toPrintableResolvedConfig(resolved);
    expect(printable.githubToken).toBe("set");
    expect(JSON.stringify(printable)).not.toContain("ghp_secret");
    expect(printable.llmEnabled).toBe(false);
    expect(printable.defaults.llmEnabled).toBe(false);
  });

  it("errors when repo is missing", async () => {
    await expect(resolveGraftConfig({ env: {} })).rejects.toThrow(/GRAFT_REPO/);
  });
});
