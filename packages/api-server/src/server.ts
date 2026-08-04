/**
 * HTTP + GraphQL server (Phase 6.3 / DEV-5).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { createHandler } from "graphql-http/lib/use/node";
import { GraphQLError } from "graphql";
import { resolveGraftConfig } from "@graft/shared";
import { resolveApiContext, type ApiContext } from "./context.js";
import { resolvers } from "./resolvers.js";
import { typeDefs } from "./schema.js";

export type RunApiServerOptions = {
  repo?: string;
  env?: NodeJS.ProcessEnv;
  /** Pre-resolved context (tests). */
  context?: ApiContext;
  /** Override listen port (default from env API_PORT). */
  port?: number;
  /** Override host (default from env API_HOST). */
  host?: string;
};

function unauthorized(): GraphQLError {
  return new GraphQLError("Unauthorized", {
    extensions: { code: "UNAUTHORIZED" },
  });
}

function readBearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (header === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim();
}

export function createApiHandler(
  options: RunApiServerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  let contextPromise: Promise<ApiContext> | null =
    options.context !== undefined ? Promise.resolve(options.context) : null;

  async function getContext(): Promise<ApiContext> {
    if (contextPromise === null) {
      contextPromise = resolveApiContext(options);
    }
    return contextPromise;
  }

  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const graphqlHandler = createHandler({
    schema,
    context: async () => getContext(),
  });

  return async (req, res) => {
    const env = options.env ?? process.env;
    const apiCtx = await getContext();
    const config = await resolveGraftConfig({
      repo: apiCtx.repo,
      env,
      init: false,
    });
    const requiredToken = config.env.apiToken;
    if (requiredToken !== undefined) {
      const bearer = readBearer(req);
      if (bearer !== requiredToken) {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            errors: [{ message: unauthorized().message, code: "UNAUTHORIZED" }],
          }),
        );
        return;
      }
    }

    const url = req.url ?? "/";
    if (req.method === "GET" && (url === "/" || url.startsWith("/health"))) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "ok", repo: config.repoSlug }));
      return;
    }

    if (url.startsWith("/graphql")) {
      await graphqlHandler(req, res);
      return;
    }

    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Not found" }));
  };
}

/**
 * Start the Graft GraphQL API (blocks until server closes).
 */
export async function runApiServer(
  options: RunApiServerOptions = {},
): Promise<{ port: number; host: string; close: () => Promise<void> }> {
  const env = options.env ?? process.env;
  const config = await resolveGraftConfig({
    ...(options.repo !== undefined ? { repo: options.repo } : {}),
    env,
    init: false,
  });

  const host = options.host ?? config.env.apiHost;
  const port = options.port ?? config.env.apiPort;
  const handler = createApiHandler(options);

  const server = createServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  const boundPort =
    address !== null && typeof address === "object" ? address.port : port;

  return {
    host,
    port: boundPort,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
