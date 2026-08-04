# Graft — Data format (stub)

Artifacts live under `DATA_DIR/repos/<owner>/<name>/`.

| Path | Description |
| --- | --- |
| `config.json` | Per-repo settings (minSupport, etc.) |
| `cursors.json` | Ingest / link / compile watermarks |
| `raw/prs/` | Merged PR metadata |
| `raw/comments/` | Inline review comments |
| `raw/blobs/` | File snapshots at merge commit |
| `episodes/` | Linked review episodes + index |
| `recipes/` | Compiled rewrite recipes + index |
| `recipes/suppressions.json` | Suppressed recipe ids (Phase 6) |

Schemas are defined in `@graft/shared` (`packages/shared/src/schemas.ts`).

See [TRD §6](TRD.md) for full field definitions.
