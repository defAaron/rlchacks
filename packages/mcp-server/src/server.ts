/**
 * MCP stdio server registration (Phase 5.1 / MCP-1–3).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  RecipeIndexCache,
  resolveMcpContext,
  type McpServerContext,
  type ResolveMcpContextOptions,
} from "./context.js";
import { toMcpToolError } from "./errors.js";
import {
  handleApplyPreview,
  handleExplainRecipe,
  handleFreshness,
  handleListRecipes,
  handleSuggestGrafts,
  MAX_LIST_LIMIT,
} from "./handlers.js";

export const MCP_SERVER_NAME = "graft";
export const MCP_SERVER_VERSION = "0.1.0";

export type CreateMcpServerOptions = ResolveMcpContextOptions & {
  /** Pre-resolved context (tests). */
  context?: McpServerContext;
  /** Shared recipe cache (tests). */
  cache?: RecipeIndexCache;
};

function toolJsonResult(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function toolErrorResult(err: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const body = toMcpToolError(err);
  return {
    content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
    isError: true,
  };
}

export function createGraftMcpServer(
  options: CreateMcpServerOptions = {},
): { server: McpServer; context: McpServerContext; cache: RecipeIndexCache } {
  let contextPromise: Promise<McpServerContext> | null =
    options.context !== undefined
      ? Promise.resolve(options.context)
      : null;
  const cache = options.cache ?? new RecipeIndexCache();

  async function ctx(): Promise<McpServerContext> {
    if (contextPromise === null) {
      contextPromise = resolveMcpContext(options);
    }
    return contextPromise;
  }

  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.registerTool(
    "list_recipes",
    {
      description:
        "List rewrite recipes for the configured repo (GRAFT_REPO). Filter by path prefix, language, or text query. Returns evidence-backed cards with confidence labels.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Path prefix filter, e.g. src/api"),
        language: z.string().optional().describe("Language filter"),
        query: z
          .string()
          .optional()
          .describe("Free-text search in title/rationale/code"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIST_LIMIT)
          .optional()
          .describe(`Max recipes (default 8, max ${MAX_LIST_LIMIT})`),
      },
    },
    async (args) => {
      try {
        const c = await ctx();
        const loaded = await cache.get(c);
        const result = await handleListRecipes(c, loaded.recipes, {
          ...(args.path !== undefined ? { path: args.path } : {}),
          ...(args.language !== undefined ? { language: args.language } : {}),
          ...(args.query !== undefined ? { query: args.query } : {}),
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
        });
        return toolJsonResult(result);
      } catch (err) {
        return toolErrorResult(err);
      }
    },
  );

  server.registerTool(
    "suggest_grafts",
    {
      description:
        "Match historical rewrite recipes to a unified diff or single-file code snippet. Returns ranked suggestions with patches, confidence labels, and GitHub evidence links. Does not write files.",
      inputSchema: {
        diff: z
          .string()
          .optional()
          .describe("Unified diff to match against recipes"),
        code: z
          .string()
          .optional()
          .describe("Single-file contents when diff is absent"),
        path: z
          .string()
          .optional()
          .describe("File path (required with code)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIST_LIMIT)
          .optional()
          .describe(`Max suggestions (default 8, max ${MAX_LIST_LIMIT})`),
      },
    },
    async (args) => {
      try {
        const c = await ctx();
        const loaded = await cache.get(c);
        const result = await handleSuggestGrafts(c, loaded.recipes, {
          ...(args.diff !== undefined ? { diff: args.diff } : {}),
          ...(args.code !== undefined ? { code: args.code } : {}),
          ...(args.path !== undefined ? { path: args.path } : {}),
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
        });
        return toolJsonResult(result);
      } catch (err) {
        return toolErrorResult(err);
      }
    },
  );

  server.registerTool(
    "explain_recipe",
    {
      description:
        "Full evidence for one recipe: linked PR comments, rejected/accepted code spans, and link confidence labels.",
      inputSchema: {
        recipeId: z.string().min(1).describe("Recipe id from list_recipes"),
      },
    },
    async (args) => {
      try {
        const c = await ctx();
        const result = await handleExplainRecipe(c, {
          recipeId: args.recipeId,
        });
        return toolJsonResult(result);
      } catch (err) {
        return toolErrorResult(err);
      }
    },
  );

  server.registerTool(
    "freshness",
    {
      description:
        "Report ingest/compile watermarks and whether suggestions may be stale (MCP-5).",
      inputSchema: {},
    },
    async () => {
      try {
        const c = await ctx();
        const result = await handleFreshness(c);
        return toolJsonResult(result);
      } catch (err) {
        return toolErrorResult(err);
      }
    },
  );

  server.registerTool(
    "apply_preview",
    {
      description:
        "Preview unified diff for a recipe at a location. Does not write files — explicit apply only via editor (MCP-4).",
      inputSchema: {
        recipeId: z.string().optional().describe("Recipe id"),
        path: z.string().optional().describe("Target file path"),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        matchPath: z
          .string()
          .optional()
          .describe("Path from suggest_grafts match"),
        matchRange: z
          .object({
            startLine: z.number().int().positive(),
            endLine: z.number().int().positive(),
          })
          .optional()
          .nullable(),
      },
    },
    async (args) => {
      try {
        const c = await ctx();
        const input: Parameters<typeof handleApplyPreview>[1] = {};
        if (args.recipeId !== undefined) {
          input.recipeId = args.recipeId;
        }
        if (args.path !== undefined) {
          input.path = args.path;
        }
        if (args.startLine !== undefined) {
          input.startLine = args.startLine;
        }
        if (args.endLine !== undefined) {
          input.endLine = args.endLine;
        }
        if (args.matchPath !== undefined) {
          input.matchPath = args.matchPath;
        }
        if (args.matchRange !== undefined) {
          input.matchRange = args.matchRange;
        }
        const result = await handleApplyPreview(c, input);
        return toolJsonResult(result);
      } catch (err) {
        return toolErrorResult(err);
      }
    },
  );

  return {
    server,
    context: options.context ?? (null as unknown as McpServerContext),
    cache,
  };
}

export type RunStdioServerOptions = ResolveMcpContextOptions;

/**
 * Start the Graft MCP server on stdio (blocks until transport closes).
 * Requires GRAFT_REPO and compiled recipes under DATA_DIR.
 */
export async function runStdioServer(
  options: RunStdioServerOptions = {},
): Promise<void> {
  const context = await resolveMcpContext(options);
  const { server } = createGraftMcpServer({ ...options, context });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
