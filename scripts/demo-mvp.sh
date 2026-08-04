#!/usr/bin/env bash
# Graft MVP demo — Phase 5 walkthrough (offline fixtures).
# Usage: ./scripts/demo-mvp.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEMO_DIR="$(mktemp -d "${TMPDIR:-/tmp}/graft-demo-XXXXXX")"
trap 'rm -rf "$DEMO_DIR"' EXIT

echo "== Graft MVP demo =="
echo "Demo data dir: $DEMO_DIR"
echo

cp -R testdata/golden-episodes/* "$DEMO_DIR/"
export DATA_DIR="$DEMO_DIR"
export GRAFT_REPO="acme/widgets"
export GRAFT_MIN_SUPPORT=1
export GRAFT_LLM_ENABLED=false

echo "1) Compile recipes from golden episodes..."
npm run graft -- compile acme/widgets 2>/dev/null | tail -n 5
echo

echo "2) List recipes for src/types (CLI)..."
npm run graft -- recipes list acme/widgets --path src/types 2>/dev/null | head -n 30
echo

echo "3) Suggest grafts for rejected-types.diff (CLI)..."
npm run graft -- suggest acme/widgets --diff testdata/fixtures/rejected-types.diff 2>/dev/null | head -n 40
echo

echo "4) MCP tool smoke (in-memory)..."
node --input-type=module <<'EOF'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGraftMcpServer, resolveMcpContext } from "@graft/mcp-server";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ctx = await resolveMcpContext({ env: process.env });
const { server } = createGraftMcpServer({ context: ctx });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "demo", version: "0.1.0" });
await server.connect(serverTransport);
await client.connect(clientTransport);

const listed = await client.callTool({ name: "list_recipes", arguments: { path: "src/types", limit: 3 } });
console.log("list_recipes:", listed.content[0]?.type === "text" ? JSON.parse(listed.content[0].text).recipes.map(r => ({ id: r.id, title: r.title, confidence: r.confidence })) : listed);

const diff = await readFile(path.join(process.cwd(), "testdata", "fixtures", "rejected-types.diff"), "utf8");
const suggested = await client.callTool({ name: "suggest_grafts", arguments: { diff } });
if (suggested.content[0]?.type === "text") {
  const body = JSON.parse(suggested.content[0].text);
  const top = body.suggestions?.[0];
  console.log("suggest_grafts top:", top ? { title: top.title, confidence: top.confidence, evidence: top.evidence.length, patchPreview: top.patch.slice(0, 80) } : body);
}

await client.close();
await server.close();
EOF

echo
echo "Done. Start MCP for agents with:"
echo "  export DATA_DIR=$DEMO_DIR GRAFT_REPO=acme/widgets"
echo "  npm run mcp"
echo "See docs/MCP.md for Cursor/Claude config."
