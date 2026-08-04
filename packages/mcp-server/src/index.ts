export const PKG = "@graft/mcp-server" as const;

export {
  RecipeIndexCache,
  resolveMcpContext,
  type McpServerContext,
  type ResolveMcpContextOptions,
} from "./context.js";

export { toMcpToolError, type McpToolErrorBody } from "./errors.js";

export { toMcpFreshness, type McpFreshness } from "./freshness.js";

export {
  handleExplainRecipe,
  handleListRecipes,
  handleSuggestGrafts,
  MAX_LIST_LIMIT,
  type ExplainEpisode,
  type ExplainRecipeInput,
  type ExplainRecipeOutput,
  type ListRecipesInput,
  type ListRecipesOutput,
  type SuggestGraftsInput,
  type SuggestGraftsOutput,
} from "./handlers.js";

export {
  createGraftMcpServer,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  runStdioServer,
  type CreateMcpServerOptions,
  type RunStdioServerOptions,
} from "./server.js";
