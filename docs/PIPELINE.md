# Graft — Pipeline (stub)

```
ingest → link → compile → serve (CLI / MCP)
```

| Stage | CLI | Output |
| --- | --- | --- |
| Ingest | `graft ingest owner/repo` | `raw/` artifacts |
| Link | `graft link owner/repo` | `episodes/` |
| Compile | `graft compile owner/repo` | `recipes/` |
| Suggest | `graft suggest owner/repo --diff file` | stdout JSON |
| MCP | `graft serve mcp` | stdio MCP tools |

Watermarks in `cursors.json` enable resume and stale detection.

**Stale:** ingest or link newer than last compile — re-run `graft compile`.

See [ingest.md](ingest.md) for backfill guidance and [BUILD_PLAN.md](BUILD_PLAN.md) for phase checkpoints.
