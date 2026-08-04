import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import {
  handleWebhookRequest,
  WebhookJobQueue,
  type WebhookPipelineRunner,
} from "./webhook-server.js";

function mockRequest(
  method: string,
  url: string,
  body: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  return {
    method,
    url,
    headers,
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data") {
        handler(Buffer.from(body, "utf8"));
      }
      if (event === "end") {
        handler();
      }
    },
  } as unknown as IncomingMessage;
}

function mockResponse(): ServerResponse & {
  statusCode: number;
  body: string;
} {
  const res = {
    statusCode: 200,
    body: "",
    setHeader() {
      return res;
    },
    end(chunk?: string) {
      if (chunk !== undefined) {
        res.body = chunk;
      }
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string };
}

describe("webhook server (ING-5)", () => {
  it("ignores non-merge events", async () => {
    const res = mockResponse();
    const queue = new WebhookJobQueue();
    const runner: WebhookPipelineRunner = {
      runIngest: async () => undefined,
      runLink: async () => undefined,
      runCompile: async () => undefined,
    };
    await handleWebhookRequest(
      mockRequest(
        "POST",
        "/webhook",
        JSON.stringify({ action: "opened", pull_request: { merged: false } }),
      ),
      res,
      { runner, queue, env: {} },
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      status: "ignored",
    });
  });

  it("runs ingest → link → compile on merge close", async () => {
    const stages: string[] = [];
    const runner: WebhookPipelineRunner = {
      runIngest: async (repo) => {
        stages.push(`ingest:${repo}`);
      },
      runLink: async (repo) => {
        stages.push(`link:${repo}`);
      },
      runCompile: async (repo) => {
        stages.push(`compile:${repo}`);
      },
    };
    const queue = new WebhookJobQueue();
    const res = mockResponse();
    await handleWebhookRequest(
      mockRequest(
        "POST",
        "/webhook",
        JSON.stringify({
          action: "closed",
          pull_request: { merged: true, number: 7 },
          repository: { full_name: "acme/widgets" },
        }),
      ),
      res,
      { runner, queue, env: {} },
    );
    expect(res.statusCode).toBe(202);
    expect(stages).toEqual([
      "ingest:acme/widgets",
      "link:acme/widgets",
      "compile:acme/widgets",
    ]);
  });

  it("does not advance later stages when ingest fails", async () => {
    const stages: string[] = [];
    const runner: WebhookPipelineRunner = {
      runIngest: async () => {
        stages.push("ingest");
        throw new Error("ingest failed");
      },
      runLink: async () => {
        stages.push("link");
      },
      runCompile: async () => {
        stages.push("compile");
      },
    };
    const queue = new WebhookJobQueue();
    const res = mockResponse();
    await handleWebhookRequest(
      mockRequest(
        "POST",
        "/webhook",
        JSON.stringify({
          action: "closed",
          pull_request: { merged: true, number: 1 },
          repository: { full_name: "acme/widgets" },
        }),
      ),
      res,
      { runner, queue, env: {} },
    );
    expect(res.statusCode).toBe(500);
    expect(stages).toEqual(["ingest"]);
  });
});
