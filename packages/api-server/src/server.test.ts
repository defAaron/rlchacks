import { cp, mkdtemp, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileRepository } from "@graft/compile";
import { graftNoDataError } from "@graft/shared";
import { describe, expect, it } from "vitest";
import { createApiHandler, resolveApiContext } from "./index.js";

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

async function seedApiFixture(): Promise<{
  dataDir: string;
  ctx: Awaited<ReturnType<typeof resolveApiContext>>;
  recipeId: string;
}> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "graft-api-"));
  await cp(goldenRoot, dataDir, { recursive: true });
  await compileRepository({
    dataDir,
    owner: "acme",
    name: "widgets",
    minSupport: 1,
    allowSingleHighConfidence: true,
    now: () => new Date(3_000_000),
  });
  const env = { DATA_DIR: dataDir, GRAFT_REPO: "acme/widgets" };
  const ctx = await resolveApiContext({ env });
  const { loadRecipeIndex } = await import("@graft/retrieval");
  const loaded = await loadRecipeIndex({
    dataDir,
    owner: "acme",
    name: "widgets",
  });
  return { dataDir, ctx, recipeId: loaded.recipes[0]!.id };
}

async function graphql(
  port: number,
  query: string,
  variables?: Record<string, unknown>,
  token?: string,
): Promise<{ data?: unknown; errors?: unknown[]; status: number }> {
  const body = JSON.stringify({ query, variables });
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token !== undefined) {
    headers.authorization = `Bearer ${token}`;
  }

  const res = await fetch(`http://127.0.0.1:${port}/graphql`, {
    method: "POST",
    headers,
    body,
  });
  const json = (await res.json()) as { data?: unknown; errors?: unknown[] };
  return { ...json, status: res.status };
}

async function withTestServer(
  options: Parameters<typeof createApiHandler>[0],
  run: (port: number) => Promise<void>,
): Promise<void> {
  const handler = createApiHandler(options);
  const server: Server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port =
    address !== null && typeof address === "object" ? address.port : 8787;
  try {
    await run(port);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

describe("API server — GraphQL", () => {
  it("lists recipes and suggests grafts with CLI parity fields", async () => {
    const { ctx } = await seedApiFixture();
    await withTestServer({ context: ctx }, async (port) => {
      const list = await graphql(
        port,
        `query { recipes(limit: 5) { id title confidence support evidenceCount } }`,
      );
      const recipes = (list.data as { recipes: Array<{ id: string }> }).recipes;
      expect(recipes.length).toBeGreaterThan(0);
      expect(recipes[0]!.id.length).toBeGreaterThan(0);

      const diff = await readFile(rejectedDiff, "utf8");
      const suggest = await graphql(
        port,
        `query($diff: String!) { suggestGrafts(diff: $diff) { recipeId score confidence evidence { commentUrl } } }`,
        { diff },
      );
      const suggestions = (
        suggest.data as {
          suggestGrafts: Array<{ recipeId: string; evidence: unknown[] }>;
        }
      ).suggestGrafts;
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]!.evidence.length).toBeGreaterThan(0);
      expect(suggestions[0]!.recipeId.length).toBeGreaterThan(0);
    });
  });

  it("suppressRecipe mutation round-trips", async () => {
    const { ctx, recipeId } = await seedApiFixture();
    await withTestServer({ context: ctx }, async (port) => {
      const suppressed = await graphql(
        port,
        `mutation($id: ID!) { suppressRecipe(id: $id, suppressed: true) { id suppressed } }`,
        { id: recipeId },
      );
      expect(
        (suppressed.data as { suppressRecipe: { suppressed: boolean } })
          .suppressRecipe.suppressed,
      ).toBe(true);

      const list = await graphql(port, `query { recipes { id } }`);
      const ids = (list.data as { recipes: Array<{ id: string }> }).recipes.map(
        (r) => r.id,
      );
      expect(ids).not.toContain(recipeId);

      const explain = await graphql(
        port,
        `query($id: ID!) { recipe(id: $id) { id evidence { commentUrl } } }`,
        { id: recipeId },
      );
      expect((explain.data as { recipe: { id: string } }).recipe.id).toBe(
        recipeId,
      );
    });
  });

  it("freshness reports stale after ingest without compile", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graft-api-stale-"));
    await cp(goldenRoot, dataDir, { recursive: true });
    const { writeCursors, defaultCursors } = await import("@graft/pipeline");
    await writeCursors(dataDir, "acme", "widgets", {
      ...defaultCursors(),
      link: { updatedAt: "2026-01-01T00:00:00.000Z" },
    });
    const env = { DATA_DIR: dataDir, GRAFT_REPO: "acme/widgets" };
    const ctx = await resolveApiContext({ env });
    await withTestServer({ context: ctx }, async (port) => {
      const fresh = await graphql(
        port,
        `query { freshness { stale reason } }`,
      );
      expect(
        (fresh.data as { freshness: { stale: boolean } }).freshness.stale,
      ).toBe(true);

      await compileRepository({
        dataDir,
        owner: "acme",
        name: "widgets",
        minSupport: 1,
        allowSingleHighConfidence: true,
      });
      await writeCursors(dataDir, "acme", "widgets", {
        ...defaultCursors(),
        link: { updatedAt: "2026-01-01T00:00:00.000Z" },
        compile: {
          updatedAt: "2026-01-02T00:00:00.000Z",
          compileRunId: "test-run",
        },
      });
      const after = await graphql(port, `query { freshness { stale } }`);
      expect(
        (after.data as { freshness: { stale: boolean } }).freshness.stale,
      ).toBe(false);
    });
  });

  it("requires bearer token when API_TOKEN configured", async () => {
    const { ctx } = await seedApiFixture();
    await withTestServer(
      { context: ctx, env: { API_TOKEN: "secret-token" } },
      async (port) => {
        const denied = await graphql(port, `query { health }`);
        expect(denied.status).toBe(401);

        const ok = await graphql(
          port,
          `query { health }`,
          undefined,
          "secret-token",
        );
        expect(ok.status).toBe(200);
      },
    );
  });

  it("returns GRAFT_NO_DATA after purge", async () => {
    const { ctx, dataDir } = await seedApiFixture();
    const { purgeRepository } = await import("@graft/pipeline");
    await purgeRepository(dataDir, "acme", "widgets");
    await withTestServer({ context: ctx }, async (port) => {
      const result = await graphql(port, `query { recipes { id } }`);
      expect(result.errors).toBeDefined();
      expect(JSON.stringify(result.errors)).toContain("GRAFT_NO_DATA");
    });
  });
});
