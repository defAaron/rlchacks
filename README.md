# Graft

> Remember what code had to become to get merged, and graft that rewrite onto the next change.

Graft turns merged pull request history into **rewrite recipes** — paired evidence of rejected code, the review feedback that blocked it, and the accepted code that eventually shipped. Coding agents and developers query Graft before (or while) writing changes and receive concrete, evidence-backed patches they can apply.

## Principles

- **Evidence-backed** — every suggestion links to real PR review comments
- **Deterministic by default** — LLM is opt-in (`GRAFT_LLM_ENABLED=false`)
- **Soft-only** — suggestions, never hard commit gates
- **Explicit apply** — MCP/CLI never silently rewrite files

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

**Offline demo** (no GitHub token):

```bash
chmod +x scripts/demo-mvp.sh
./scripts/demo-mvp.sh
```

## Docs

- [Product Requirements (PRD)](docs/PRD.md)
- [Technical Requirements (TRD)](docs/TRD.md)
- [Build Plan](docs/BUILD_PLAN.md)
- [MCP agent interface](docs/MCP.md)
- [Pipeline overview](docs/PIPELINE.md)
- [Data format](docs/DATA_FORMAT.md)
- [Ingest / mid-size backfill](docs/ingest.md)

## MCP tools (MVP)

| Tool | Purpose |
| --- | --- |
| `list_recipes` | Browse recipes by path / query |
| `suggest_grafts` | Match recipes to a diff or code snippet |
| `explain_recipe` | Full evidence for one recipe |

See [docs/MCP.md](docs/MCP.md) for Cursor/Claude config and example prompts.

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
