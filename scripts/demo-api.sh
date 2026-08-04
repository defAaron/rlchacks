#!/usr/bin/env bash
# Graft API demo — Phase 6 walkthrough (offline fixtures, no GITHUB_TOKEN).
# Starts graft serve api briefly, curls /health + GraphQL, tears down, then
# prints VS Code / Cursor extension next steps.
# Usage: ./scripts/demo-api.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOST="127.0.0.1"
PORT="${GRAFT_DEMO_API_PORT:-8787}"
BASE="http://${HOST}:${PORT}"
_TMP="${TMPDIR:-/tmp}"
DEMO_DIR="${_TMP%/}/graft-demo-api"
API_PID=""

die() {
  echo "ERROR: $*" >&2
  exit 1
}

cta_build() {
  die "CLI not built. Run: npm run build"
}

cta_port() {
  die "Port ${PORT} already in use on ${HOST}. Free it, or set GRAFT_DEMO_API_PORT=<free-port> and retry."
}

cta_health() {
  die "API did not become healthy at ${BASE}/health. Check that 'graft serve api' started (npm run build first)."
}

cta_graphql() {
  die "GraphQL check failed ($1). Ensure recipes compiled (GRAFT_MIN_SUPPORT=1) and DATA_DIR has golden episodes."
}

cleanup() {
  if [[ -n "${API_PID}" ]] && kill -0 "${API_PID}" 2>/dev/null; then
    kill "${API_PID}" 2>/dev/null || true
    wait "${API_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "== Graft API demo =="
echo "Demo data dir: $DEMO_DIR"
echo "API base:      $BASE"
echo

[[ -f packages/cli/dist/index.js ]] || cta_build
[[ -d testdata/golden-episodes ]] || die "Missing testdata/golden-episodes. See testdata/README.md."
[[ -f testdata/fixtures/rejected-types.diff ]] || die "Missing testdata/fixtures/rejected-types.diff."

# Stable fixture tree (idempotent re-seed)
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"
cp -R testdata/golden-episodes/* "$DEMO_DIR/"

export DATA_DIR="$DEMO_DIR"
export GRAFT_REPO="acme/widgets"
export GRAFT_MIN_SUPPORT=1
export GRAFT_LLM_ENABLED=false
# Local demo: leave API_TOKEN unset
unset API_TOKEN || true

echo "1) Compile recipes from golden episodes..."
npm run graft -- compile acme/widgets 2>/dev/null | tail -n 5
echo

if curl -sf --max-time 1 "${BASE}/health" >/dev/null 2>&1; then
  cta_port
fi

echo "2) Start API server in background (host=${HOST} port=${PORT})..."
npm run graft -- serve api --repo acme/widgets --host "$HOST" --port "$PORT" \
  >"${DEMO_DIR}/api-server.log" 2>&1 &
API_PID=$!

ready=0
for _ in $(seq 1 40); do
  if ! kill -0 "${API_PID}" 2>/dev/null; then
    echo "--- api-server.log ---" >&2
    cat "${DEMO_DIR}/api-server.log" >&2 || true
    cta_health
  fi
  if curl -sf --max-time 1 "${BASE}/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.15
done
[[ "$ready" -eq 1 ]] || {
  echo "--- api-server.log ---" >&2
  cat "${DEMO_DIR}/api-server.log" >&2 || true
  cta_health
}

echo "3) GET /health..."
HEALTH="$(curl -sf --max-time 5 "${BASE}/health")"
echo "$HEALTH"
echo "$HEALTH" | grep -q '"status":"ok"' || die "Unexpected /health body: $HEALTH"
echo

echo "4) GraphQL: recipes + freshness..."
RECIPES_RESP="$(curl -sf --max-time 10 "${BASE}/graphql" \
  -H 'content-type: application/json' \
  -d '{"query":"{ recipes(limit: 5) { id title confidence support suppressed } freshness { stale reason episodes recipes } }"}')"
echo "$RECIPES_RESP" | head -c 2000
echo
echo "$RECIPES_RESP" | grep -q '"recipes"' || cta_graphql "recipes"
# At least one recipe id present
echo "$RECIPES_RESP" | grep -Eq '"id"[[:space:]]*:[[:space:]]*"' || cta_graphql "empty recipes list"
echo

echo "5) GraphQL: suggestGrafts (rejected-types.diff)..."
SUGGEST_RESP="$(
  node --input-type=module <<EOF
import { readFile } from "node:fs/promises";
import path from "node:path";

const diff = await readFile(
  path.join(process.cwd(), "testdata", "fixtures", "rejected-types.diff"),
  "utf8",
);
const body = JSON.stringify({
  query:
    "query(\$d:String!){ suggestGrafts(diff:\$d){ recipeId score confidence evidence{ commentUrl } } }",
  variables: { d: diff },
});
const res = await fetch("${BASE}/graphql", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});
const text = await res.text();
if (!res.ok) {
  console.error(text);
  process.exit(1);
}
process.stdout.write(text);
EOF
)"
echo "$SUGGEST_RESP" | head -c 2000
echo
echo "$SUGGEST_RESP" | grep -q 'suggestGrafts' || cta_graphql "suggestGrafts"
echo "$SUGGEST_RESP" | grep -Eq '"recipeId"[[:space:]]*:[[:space:]]*"' || cta_graphql "empty suggestions"
echo

echo "6) Tear down API server (pid=${API_PID})..."
cleanup
API_PID=""
echo "Server stopped."
echo
echo "Done. API served fixtures end-to-end (health + recipes/freshness + suggestGrafts)."
echo
echo "== Next steps: VS Code / Cursor extension =="
echo "1) Re-start the API against the same fixture data:"
echo "     export DATA_DIR=$DEMO_DIR GRAFT_REPO=acme/widgets GRAFT_MIN_SUPPORT=1 GRAFT_LLM_ENABLED=false"
echo "     npm run graft -- serve api --repo acme/widgets --host 127.0.0.1 --port 8787"
echo "2) Point the extension at the API (default already matches):"
echo "     Settings → graft.apiBaseUrl = http://127.0.0.1:8787"
echo "     Optional: graft.repo = acme/widgets"
echo "3) Load the extension from packages/vscode-extension (F5 / Install from VSIX / workspace extension)."
echo "4) Open a file under a path like src/types and run: Graft: Suggest for current diff/selection"
echo
echo "See docs/API.md for GraphQL examples. Offline CLI/MCP demo: ./scripts/demo-mvp.sh"
