# Graft — MCP agent interface

Graft exposes rewrite recipes to coding agents via the [Model Context Protocol](https://modelcontextprotocol.io/) (stdio transport).

## Quick start

1. Ingest, link, and compile a repo (or use fixture data — see [demo script](../scripts/demo-mvp.sh)).
2. Set env vars:

```bash
export GRAFT_REPO=owner/name
export DATA_DIR=./data          # optional; default ./data
export GRAFT_LLM_ENABLED=false  # default; keep off for deterministic MVP
```

3. Start the server:

```bash
npm run build
npm run mcp
# or: npm run graft -- serve mcp [--repo owner/name]
```

## Cursor / Claude Desktop config

Add to your MCP settings (paths adjusted to your machine):

```json
{
  "mcpServers": {
    "graft": {
      "command": "node",
      "args": ["/absolute/path/to/rlchacks/packages/cli/dist/index.js", "serve", "mcp"],
      "env": {
        "GRAFT_REPO": "owner/name",
        "DATA_DIR": "/absolute/path/to/rlchacks/data",
        "GRAFT_LLM_ENABLED": "false"
      }
    }
  }
}
```

## Tools

### `list_recipes`

Browse evidence-backed rewrite recipes for the configured repo.

**Input**

| Field | Type | Description |
| --- | --- | --- |
| `path` | string? | Path prefix filter |
| `language` | string? | Language filter |
| `query` | string? | Free-text search |
| `limit` | number? | Default 8, max 20 |

**Output:** `{ recipes[], freshness, truncated?, warnings? }`

Each recipe card includes `confidence` (`high` | `medium` | `low`), `support`, truncated `before`/`after`, and `evidenceCount`.

### `suggest_grafts`

Match recipes to a unified diff or single-file snippet. **Does not write files.**

**Input**

| Field | Type | Description |
| --- | --- | --- |
| `diff` | string? | Unified diff |
| `code` | string? | File contents (requires `path`) |
| `path` | string? | Required when using `code` |
| `limit` | number? | Default 8, max 20 |

**Output:** `{ suggestions[], freshness, warnings? }`

Each suggestion includes `patch`, `confidence`, and `evidence[]` with GitHub comment URLs.

### `explain_recipe`

Full audit trail for one recipe.

**Input:** `{ recipeId: string }`

**Output:** `{ recipe, episodes[], freshness }`

Each episode includes `rejected`, `accepted`, `linkConfidence`, and `commentUrl`.

## Error codes

| Code | Meaning |
| --- | --- |
| `GRAFT_NO_DATA` | Repo not ingested / no recipes |
| `GRAFT_STALE` | Warning in `freshness` / `warnings` — data may be outdated |
| `GRAFT_NOT_FOUND` | Unknown recipe id |
| `GRAFT_INVALID_DIFF` | Diff parse failure or missing input |
| `GRAFT_BUDGET` | Response truncated for payload cap |

## Example agent prompts

- “Call `list_recipes` with `path: src/api` and summarize high-support recipes.”
- “I have a diff that reintroduces `any` in `src/types.ts`. Call `suggest_grafts` with this diff and cite the GitHub evidence link from the top suggestion.”
- “Explain recipe `<id>` with `explain_recipe` and show the rejected vs accepted spans.”

## Safety defaults

- **Repo scoping:** All reads are under `DATA_DIR/repos/<owner>/<name>/` for `GRAFT_REPO` only.
- **No silent writes:** MCP tools never modify workspace files.
- **Evidence required:** Suggestions without evidence pointers are refused (RET-5).
- **LLM off by default:** Set `GRAFT_LLM_ENABLED=true` only when you explicitly want LLM-assisted linking.

## P1 tools (not in MVP)

- `apply_preview` — unified diff preview for a suggestion (Phase 6–7)
- `freshness` — standalone freshness query (Phase 6)

Freshness summary is already included in `list_recipes` and `suggest_grafts` responses.
