/**
 * GitHub merge webhook HTTP server (Phase 8.3 / ING-5).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  loadGraftEnv,
  parseMergeWebhookPayload,
  verifyGitHubWebhookSignature,
  type ParsedMergeEvent,
} from "@graft/shared";

export type WebhookPipelineRunner = {
  runIngest: (repoSlug: string, maxPrs?: number) => Promise<void>;
  runLink: (repoSlug: string) => Promise<void>;
  runCompile: (repoSlug: string) => Promise<void>;
};

export type WebhookServerOptions = {
  host?: string;
  port?: number;
  env?: NodeJS.ProcessEnv;
  runner: WebhookPipelineRunner;
  log?: (line: string) => void;
};

export type WebhookHandleResult =
  | { status: "ignored"; reason: string }
  | { status: "queued"; repo: string; prNumber: number }
  | { status: "error"; message: string };

type QueuedJob = {
  merge: ParsedMergeEvent;
  resolve: () => void;
  reject: (err: unknown) => void;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Process merge events serially so concurrent webhooks do not corrupt stages. */
export class WebhookJobQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue(
    merge: ParsedMergeEvent,
    runner: WebhookPipelineRunner,
    log: (line: string) => void,
  ): Promise<void> {
    const job: QueuedJob = {
      merge,
      resolve: () => undefined,
      reject: () => undefined,
    };
    const run = this.tail.then(async () => {
      const { repoSlug, prNumber } = merge;
      log(
        JSON.stringify({
          stage: "webhook",
          event: "merge",
          repo: repoSlug,
          prNumber,
          status: "start",
        }),
      );
      try {
        await runner.runIngest(repoSlug, 5);
        await runner.runLink(repoSlug);
        await runner.runCompile(repoSlug);
        log(
          JSON.stringify({
            stage: "webhook",
            event: "merge",
            repo: repoSlug,
            prNumber,
            status: "ok",
          }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(
          JSON.stringify({
            stage: "webhook",
            event: "merge",
            repo: repoSlug,
            prNumber,
            status: "error",
            error: message,
          }),
        );
        throw err;
      }
    });
    this.tail = run.catch(() => {
      /* keep queue alive after failures */
    });
    return run;
  }
}

export async function handleWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: WebhookServerOptions & { queue: WebhookJobQueue },
): Promise<void> {
  const env = options.env ?? process.env;
  const graftEnv = loadGraftEnv(env);
  const log = options.log ?? ((line: string) => console.log(line));

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const url = req.url ?? "/";
  if (!url.startsWith("/webhook")) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: message }));
    return;
  }

  const signature = req.headers["x-hub-signature-256"];
  const sigHeader =
    typeof signature === "string" ? signature : signature?.[0];
  if (
    !verifyGitHubWebhookSignature(rawBody, sigHeader, graftEnv.webhookSecret)
  ) {
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Invalid webhook signature" }));
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody) as unknown;
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  const merge = parseMergeWebhookPayload(json);
  if (merge === null) {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "ignored", reason: "not_a_merge_close" }));
    return;
  }

  try {
    await options.queue.enqueue(merge, options.runner, log);
    res.statusCode = 202;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        status: "processed",
        repo: merge.repoSlug,
        prNumber: merge.prNumber,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "error", message }));
  }
}

export async function runWebhookServer(
  options: WebhookServerOptions,
): Promise<{ host: string; port: number; close: () => Promise<void> }> {
  const env = options.env ?? process.env;
  const graftEnv = loadGraftEnv(env);
  const host = options.host ?? graftEnv.apiHost;
  const port = options.port ?? graftEnv.apiPort + 1;
  const queue = new WebhookJobQueue();

  const server = createServer((req, res) => {
    void handleWebhookRequest(req, res, { ...options, queue });
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
