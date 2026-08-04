# Graft — Ingest

Phase 1 pulls merged PR review history from GitHub into repo-scoped raw artifacts under `DATA_DIR`. Linking and compile (recipes) come in later phases; this page covers the **mid-size backfill path** aimed at PRD time-to-first-recipe (&lt; 30 minutes empty → first browsable recipes once those stages exist).

## Prerequisites

| Item | Notes |
| --- | --- |
| Node | `>= 22` (see `.nvmrc`) |
| Build | `npm install && npm run build` so `npm run graft` can run |
| Token | `GITHUB_TOKEN` with read access to the target repo (required for live ingest) |
| Data dir | `DATA_DIR` (default `./data`); artifacts land under `data/repos/<owner>/<name>/` |

Optional: copy `.env.example` → `.env` and set `GITHUB_TOKEN`, `DATA_DIR`, and `GRAFT_REPO`.

## Mid-size backfill (recommended)

Cap the first pull so you are not waiting on a full-history crawl:

```bash
export GITHUB_TOKEN=ghp_...
export DATA_DIR=./data   # optional; default ./data

npm run graft -- ingest owner/repo --max-prs 50
```

| Flag / default | Behavior |
| --- | --- |
| `--max-prs N` | Cap merged PRs fetched (newest-first). Default **200** if omitted. |
| Idempotent re-run | Already-written raw files are skipped; structured log reports `prs` / `comments` / `blobs` and `*New` deltas plus `durationMs`. |
| Watermark | Successful run updates ingest cursor in `cursors.json` under the repo data root. |

**Suggested first pass for a mid-size public demo repo:** `--max-prs 50` (or `100` if comments are sparse). Widen later (`--max-prs 200` or higher) once the pipeline path is proven.

### Toward &lt; 30 minutes to first recipes

After Phase 2–3 land, the intended operator loop is:

1. **Ingest** (this phase) with a capped `--max-prs` as above  
2. **Link** episodes  
3. **Compile** recipes  

Stay under the PRD budget by keeping step 1 bounded (do not start with unbounded full-repo history), using a PAT with normal authenticated rate limits, and only expanding the backfill window after the first recipe set appears. Incremental ingest (delta-only) is Phase 6; until then, re-runs remain safe but still scan up to `--max-prs`.

## Errors (exit codes)

| Code | Meaning |
| --- | --- |
| `0` | Ok |
| `1` | Usage / general error |
| `3` | GitHub / auth (missing/bad token, missing repo, rate limit exhausted) |

On rate-limit exhaustion, wait for the reset window and re-run the same command; watermark + on-disk raw files allow progress without rewriting completed PRs.
