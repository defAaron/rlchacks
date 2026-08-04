# Graft

> Remember what code had to become to get merged, and graft that rewrite onto the next change.

Graft turns merged pull request history into **rewrite recipes** — paired evidence of rejected code, the review feedback that blocked it, and the accepted code that eventually shipped. Coding agents and developers query Graft before (or while) writing changes and receive concrete, evidence-backed patches they can apply.

## Principles

- **Evidence-backed** — every suggestion links to real PR review comments
- **Deterministic by default** — LLM is opt-in (`GRAFT_LLM_ENABLED=false`)
- **Soft-only** — suggestions, never hard commit gates
- **Explicit apply** — MCP/CLI never silently rewrite files; editor apply requires confirm

## Quick start

```bash
npm install
npm run build

# Configure (requires GITHUB_TOKEN for live ingest)
export GRAFT_REPO=owner/name
export GITHUB_TOKEN=ghp_...

# Pipeline
npm run graft -- ingest owner/name --max-prs 50
npm run graft -- link owner/name
npm run graft -- compile owner/name

# CLI suggest on a diff
npm run graft -- suggest owner/name --diff path/to/changes.diff

# MCP server for agents (stdio)
export GRAFT_REPO=owner/name
npm run mcp
```

## Clean machine

Exercise every MVP surface from a fresh clone. Node ≥ 22.

```bash
npm install
npm run build
```

### 1) Offline demo (no GitHub token)

Compiles golden episodes, lists recipes, suggests on a fixture diff, and smokes MCP in-memory:

```bash
chmod +x scripts/demo-mvp.sh
./scripts/demo-mvp.sh
```

Uses a temp `DATA_DIR` (deleted on exit) and `GRAFT_MIN_SUPPORT=1` so fixture recipes compile. For a **persistent** local tree (API / dashboard / editor), seed `./data` yourself:

```bash
rm -rf data && cp -R testdata/golden-episodes/. data/
export DATA_DIR=./data
export GRAFT_REPO=acme/widgets
export GRAFT_MIN_SUPPORT=1
export GRAFT_LLM_ENABLED=false
npm run graft -- compile acme/widgets
npm run graft -- suggest acme/widgets --diff testdata/fixtures/rejected-types.diff
```

`graft link` prints per-episode `linkConfidence` / `linkReason` (SAF-4).

### 2) Live ingest path

```bash
export GITHUB_TOKEN=ghp_...          # public_repo or repo read
export GRAFT_REPO=owner/name
export DATA_DIR=./data
export GRAFT_LLM_ENABLED=false

npm run graft -- ingest owner/name --max-prs 50
npm run graft -- link owner/name     # inspect episodeLabels / confidence
npm run graft -- compile owner/name
npm run graft -- suggest owner/name --diff path/to/changes.diff
```

Pick a repo with real PR review comments. Second ingest resumes from the watermark (newer merges only). See [docs/ingest.md](docs/ingest.md).

### 3) MCP in Cursor

Point Cursor at the built CLI as an MCP server (`serve mcp`). Full config, tools, and example prompts: **[docs/MCP.md](docs/MCP.md)**.

```bash
export GRAFT_REPO=owner/name   # or acme/widgets with fixture data
export DATA_DIR=./data
npm run mcp
# or: npm run graft -- serve mcp --repo owner/name
```

MCP tools never write workspace files.

### 4) API server + dashboard

With compiled data under `DATA_DIR`:

```bash
export GRAFT_REPO=owner/name   # or acme/widgets
export DATA_DIR=./data
npm run graft -- serve api [--repo owner/name] [--host 127.0.0.1] [--port 8787]
```

- Offline API smoke (seed golden episodes, compile, curl `/health` + GraphQL, tear down): `./scripts/demo-api.sh`
- Health: `http://127.0.0.1:8787/health`
- GraphQL: `POST /graphql` — see [docs/API.md](docs/API.md)
- Dashboard: `http://127.0.0.1:8787/dashboard` (read-only recipe browser)

Optional: set `API_TOKEN` and send `Authorization: Bearer …`.

### 5) Editor extension

Human runbook: **[docs/EXTENSION.md](docs/EXTENSION.md)** (settings, load via Install from Location / F5 / VSIX, Suggest → Preview → Apply, degraded states, confidence labels).

Short path:

1. Keep `graft serve api` running for the same `GRAFT_REPO` / `DATA_DIR`
2. Build (step 0), then install `packages/vscode-extension` from location (or F5 Extension Development Host)
3. Set `graft.apiBaseUrl` (default `http://127.0.0.1:8787`)
4. **Graft: Suggest for current diff/selection** → pick a card (shows confidence) → preview → confirm **Apply**

No silent apply: workspace writes only after explicit confirm.

## Docs

- [Product Requirements (PRD)](docs/PRD.md)
- [Technical Requirements (TRD)](docs/TRD.md)
- [Build Plan](docs/BUILD_PLAN.md)
- [MCP agent interface](docs/MCP.md)
- [HTTP / GraphQL API](docs/API.md)
- [Editor extension](docs/EXTENSION.md)
- [Pipeline overview](docs/PIPELINE.md)
- [Data format](docs/DATA_FORMAT.md)
- [Ingest / mid-size backfill](docs/ingest.md)

## MCP tools (MVP)

| Tool | Purpose |
| --- | --- |
| `list_recipes` | Browse recipes by path / query |
| `suggest_grafts` | Match recipes to a diff or code snippet |
| `explain_recipe` | Full evidence for one recipe |

See [docs/MCP.md](docs/MCP.md) for Cursor/Claude config and example prompts (`apply_preview`, `freshness`, etc.).

## Non-goals (MVP)

- No automatic file writes from MCP
- No hard commit blockers
- No cross-repo recipe mixing
- No LLM unless explicitly enabled

## CLI exit codes

Per [TRD §9](docs/TRD.md):

| Code | Meaning |
| --- | --- |
| `0` | Ok |
| `1` | Usage / general error |
| `2` | No data — `GRAFT_NO_DATA` (repo not ingested; used by later serve/suggest/MCP stages) |
| `3` | GitHub / auth failure (missing `GITHUB_TOKEN`, bad token, 404 repo, rate limit exhausted) |

`GRAFT_NO_DATA` is exported from `@graft/shared` as `GraftErrorCodes.GRAFT_NO_DATA` with helper `graftNoDataError(repo?)` for stages that read recipes before ingest.
