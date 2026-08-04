export const PKG = "@graft/api-server" as const;

export {
  resolveApiContext,
  type ApiContext,
  type ResolveApiContextOptions,
} from "./context.js";

export { typeDefs } from "./schema.js";
export { resolvers } from "./resolvers.js";

export {
  createApiHandler,
  runApiServer,
  type RunApiServerOptions,
} from "./server.js";

export { serveDashboard, isDashboardRequest, dashboardIndexPath } from "./dashboard.js";
