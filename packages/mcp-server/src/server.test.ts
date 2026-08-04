import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileRepository } from "@graft/compile";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { GraftErrorCodes, graftNoDataError } from "@graft/shared";
import {
  createGraftMcpServer,
  handleListRecipes,
  handleSuggestGrafts,
  resolveMcpContext,
  type McpServerContext,
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

async function seedCompiledData(): Promise<{
  dataDir: string;
  ctx: McpServerContext;
}> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "graft-mcp-"));
  await cp(goldenRoot, dataDir, { recursive: true });
  const env = { DATA_DIR: dataDir, GRAFT_REPO: "acme/widgets" };
  const ctx = await resolveMcpContext({ env, repo: "acme/widgets" });
  await compileRepository({
    dataDir,
    owner: ctx.owner,
    name: ctx.name,
    minSupport: 1,
    allowSingleHighConfidence: true,
    now: () => new Date(3_000_000),
  });
  return { dataDir, ctx };
}

describe("MCP handlers — offline", () => {
  it("list_recipes returns cards with confidence and freshness", async () => {
    const { dataDir, ctx } = await seedCompiledData();
    const { loadRecipeIndex } = await import("@graft/retrieval");
    const loaded = await loadRecipeIndex({
      dataDir,
      owner: ctx.owner,
      name: ctx.name,
    });

    const result = await handleListRecipes(ctx, loaded.recipes, {
      path: "src/types",
    });

    expect(result.recipes.length).toBeGreaterThan(0);
    expect(result.recipes[0]!.confidence).toMatch(/high|medium|low/);
    expect(result.recipes[0]!.evidenceCount).toBeGreaterThan(0);
    expect(result.freshness.recipes).toBeGreaterThan(0);
    expect(result.freshness.stale).toBe(false);
  });

  it("suggest_grafts returns evidence-backed patch for rejected diff", async () => {
    const { dataDir, ctx } = await seedCompiledData();
    const { loadRecipeIndex } = await import("@graft/retrieval");
    const loaded = await loadRecipeIndex({
      dataDir,
      owner: ctx.owner,
      name: ctx.name,
    });
    const diff = await readFile(rejectedDiff, "utf8");

    const result = await handleSuggestGrafts(ctx, loaded.recipes, { diff });

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
    const top = result.suggestions[0]!;
    expect(top.evidence.length).toBeGreaterThan(0);
    expect(top.confidence).toMatch(/high|medium|low/);
    expect(top.patch).toContain("unknown");
  });

  it("suggest_grafts rejects missing diff and code", async () => {
    const { ctx } = await seedCompiledData();
    await expect(
      handleSuggestGrafts(ctx, [], {}),
    ).rejects.toMatchObject({ code: GraftErrorCodes.GRAFT_INVALID_DIFF });
  });
});

describe("MCP server — tool registration", () => {
  it("invokes list_recipes and suggest_grafts via in-memory transport", async () => {
    const { dataDir, ctx } = await seedCompiledData();
    const { server } = createGraftMcpServer({ context: ctx, env: { DATA_DIR: dataDir, GRAFT_REPO: "acme/widgets" } });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.1" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const listed = await client.callTool({
      name: "list_recipes",
      arguments: { path: "src/types", limit: 5 },
    });
    expect(listed.isError).not.toBe(true);
    const listText = listed.content[0];
    expect(listText?.type).toBe("text");
    if (listText?.type === "text") {
      const parsed = JSON.parse(listText.text) as { recipes: unknown[] };
      expect(parsed.recipes.length).toBeGreaterThan(0);
    }

    const diff = await readFile(rejectedDiff, "utf8");
    const suggested = await client.callTool({
      name: "suggest_grafts",
      arguments: { diff },
    });
    expect(suggested.isError).not.toBe(true);
    const suggestText = suggested.content[0];
    if (suggestText?.type === "text") {
      const parsed = JSON.parse(suggestText.text) as {
        suggestions: Array<{ evidence: unknown[]; confidence: string }>;
      };
      expect(parsed.suggestions.length).toBeGreaterThanOrEqual(1);
      expect(parsed.suggestions[0]!.evidence.length).toBeGreaterThan(0);
      expect(parsed.suggestions[0]!.confidence).toMatch(/high|medium|low/);
    }

    await client.close();
    await server.close();
  });

  it("explain_recipe returns episode evidence", async () => {
    const { dataDir, ctx } = await seedCompiledData();
    const { loadRecipeIndex } = await import("@graft/retrieval");
    const loaded = await loadRecipeIndex({
      dataDir,
      owner: ctx.owner,
      name: ctx.name,
    });
    const recipeId = loaded.recipes[0]!.id;

    const { server } = createGraftMcpServer({ context: ctx });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.1" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const explained = await client.callTool({
      name: "explain_recipe",
      arguments: { recipeId },
    });
    expect(explained.isError).not.toBe(true);
    const text = explained.content[0];
    if (text?.type === "text") {
      const parsed = JSON.parse(text.text) as {
        episodes: Array<{ linkConfidence: string; commentUrl: string }>;
      };
      expect(parsed.episodes.length).toBeGreaterThan(0);
      expect(parsed.episodes[0]!.linkConfidence).toMatch(/high|medium|low|none/);
      expect(parsed.episodes[0]!.commentUrl).toContain("github.com");
    }

    await client.close();
    await server.close();
  });

  it("maps GRAFT_NO_DATA to tool error", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-mcp-empty-"));
    await cp(goldenRoot, dataDir, { recursive: true });
    const ctx = await resolveMcpContext({
      env: { DATA_DIR: dataDir, GRAFT_REPO: "acme/widgets" },
    });
    const { server } = createGraftMcpServer({ context: ctx });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.1" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "list_recipes",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = result.content[0];
    if (text?.type === "text") {
      const parsed = JSON.parse(text.text) as { code: string };
      expect(parsed.code).toBe(graftNoDataError().code);
    }

    await client.close();
    await server.close();
  });
});
