# Graft — Checkpoint log

Record date, demo repo, recipe count, and known issues at each phase exit.

---

## Checkpoint 0 — 2026-08-03
- Phase: 0 (Scaffold)
- Pass / fail: **Docs check: pass**. Build / Isolation / Safety owned by other agents (status unknown here).
- Demo repo: _(n/a — scaffold)_
- Episodes / recipes: _(n/a)_
- LLM enabled: _(unknown — Safety check owned elsewhere)_
- Known issues: none for Docs
- Spot-check precision (if applicable): n/a
- Next phase: Phase 1 — Ingestion (after full Checkpoint 0 pass)

### Checks

| Check | Status | Notes |
| --- | --- | --- |
| Build | _pending_ | Other agent: `typecheck` + `test` green |
| Isolation | _pending_ | Other agent: packages depend only on `@graft/shared` (or nothing) |
| Safety default | _pending_ | Other agent: `GRAFT_LLM_ENABLED` defaults false |
| Docs | **pass** | README stub: name, thesis, links to PRD/TRD/BUILD_PLAN |

---

## Checkpoint 1 — 2026-08-03
- Phase: 1 (Ingestion)
- Pass / fail: **Scope check: pass**. Artifacts / Resume / Demo seed / Time owned by other agents (status unknown here).
- Demo repo: _(n/a for Scope)_
- Episodes / recipes: _(n/a)_
- LLM enabled: _(n/a)_
- Known issues: none for Scope
- Spot-check precision (if applicable): n/a
- Next phase: Phase 2 — Linking (after full Checkpoint 1 pass)

### Checks

| Check | Status | Notes |
| --- | --- | --- |
| Artifacts | _pending_ | Other agent: raw JSON validates against shared zod schemas |
| Scope | **pass** | SAF-1: writers use `repoScopedPath` → `DATA_DIR/repos/<owner>/<name>/…`; ingest isolation + traversal rejection tests green |
| Resume | **pass** | See Resume section below |
| Demo seed | _pending_ | Other agent: ≥ 1 public repo backfilled |
| Time | _pending_ | Other agent: mid-size backfill path documented |

---

## Checkpoint 1 — 2026-08-03
- Phase: 1 (Ingestion)
- Pass / fail: **Resume check: pass**. Other Checkpoint 1 checks owned elsewhere.
- Demo repo: _(n/a for Resume)_
- Episodes / recipes: _(n/a)_
- LLM enabled: _(n/a)_
- Known issues: none for Resume
- Spot-check precision (if applicable): n/a
- Next phase: Phase 2 — Linking (after full Checkpoint 1 pass)

### Checks

| Check | Status | Notes |
| --- | --- | --- |
| Artifacts | _pending_ | Other agent |
| Scope | _pending_ | Other agent |
| Resume | **pass** | Interrupted ingest continues via cursor: process oldest-first; persist ingest watermark after each PR; next run passes `since=lastMergedAt`. Offline evidence: `ingest-repo.test.ts` (“resumes via since cursor…”) + `cli/ingest.test.ts` (“resumes after interruption…”). Full suite 78/78 green. |
| Demo seed | _pending_ | Other agent |
| Time | _pending_ | Other agent |

---

## Checkpoint 1 — 2026-08-03
- Phase: 1 (Ingestion)
- Pass / fail: **Demo seed: partial**. Live public-repo backfill not run (`GITHUB_TOKEN` unset). Frozen fixture seed checked into `testdata/` for Phase 2. Other Checkpoint 1 checks owned elsewhere.
- Demo repo: fixture `acme/widgets` (interim); live public repo _blocked on token_
- Episodes / recipes: _(n/a — Phase 2+)_
- LLM enabled: _(not checked here)_
- Known issues: live Demo seed requires `GITHUB_TOKEN`; use fixtures until then
- Spot-check precision (if applicable): n/a
- Next phase: Phase 2 — Linking (after full Checkpoint 1 pass)

### Checks

| Check | Status | Notes |
| --- | --- | --- |
| Artifacts | _pending_ | Other agent |
| Scope | _pending_ | Other agent |
| Resume | _pending_ | Other agent |
| Demo seed | **partial** | Live ingest skipped — no `GITHUB_TOKEN`. Interim seed: `testdata/phase1-seed/repos/acme/widgets/raw/` (≥1 PR with real-shaped review comment + blob). API recordings: `testdata/github/` (mirrored from `packages/ingestion/testdata/github/`). See `testdata/README.md`. |
| Time | _pending_ | Other agent |

### Demo seed detail
- **Live:** not attempted (`GITHUB_TOKEN` unset). Do not treat as a live backfill pass.
- **Fixture seed (Phase 2 exit note):** `testdata/`
  - `phase1-seed/repos/acme/widgets/raw/prs/` — 101, 103, 105
  - `phase1-seed/repos/acme/widgets/raw/comments/PRRC_kwDOFixtureComment1.json` — actionable comment on `src/retry.ts`
  - `phase1-seed/repos/acme/widgets/raw/blobs/blobsha1111….txt` — merge-commit file text
  - `github/` — recorded list-PRs / review-comments / contents responses for offline ingest
- **Unblock live seed:** set `GITHUB_TOKEN`, run `npm run graft -- ingest <owner>/<repo> --max-prs 20`, confirm `raw/comments/` non-empty.

---

## Checkpoint 1 — 2026-08-03
- Phase: 1 (Ingestion)
- Pass / fail: **Time check: pass**. Artifacts / Scope / Resume / Demo seed owned by other agents (status unknown here).
- Demo repo: _(n/a for Time check)_
- Episodes / recipes: _(n/a — post-ingest linking/compile later)_
- LLM enabled: n/a
- Known issues: none for Time
- Spot-check precision (if applicable): n/a
- Next phase: Phase 2 — Linking (after full Checkpoint 1 pass)

### Checks

| Check | Status | Notes |
| --- | --- | --- |
| Artifacts | _pending_ | Other agent: raw JSON vs shared zod schemas |
| Scope | _pending_ | Other agent: writes only under configured `owner/repo` (SAF-1) |
| Resume | _pending_ | Other agent: interrupted ingest continues via cursor |
| Demo seed | _pending_ | Other agent: ≥ 1 public repo with real review comments |
| Time | **pass** | Mid-size backfill documented in [`docs/ingest.md`](ingest.md); capped `graft ingest owner/repo --max-prs N` (default 200; recommend 50–100 first); env `GITHUB_TOKEN` / `DATA_DIR`; path aims at PRD &lt; 30 min to first recipes once link+compile exist |

---

## Checkpoint 1 — 2026-08-03
- Phase: 1 (Ingestion)
- Pass / fail: **Artifacts check: pass**. Scope / Resume / Demo seed / Time owned by other agents (status unknown here).
- Demo repo: _(owned elsewhere)_
- Episodes / recipes: _(n/a — ingestion)_
- LLM enabled: _(n/a for Artifacts)_
- Known issues: none for Artifacts
- Spot-check precision (if applicable): n/a
- Next phase: Phase 2 — after full Checkpoint 1 pass

### Checks

| Check | Status | Notes |
| --- | --- | --- |
| Artifacts | **pass** | Offline fixture ingest + raw-store writers: `raw/prs` / `raw/comments` JSON re-parses via `parseArtifact` + `RawPullRequestSchema` / `RawReviewCommentSchema`. Blobs are UTF-8 `.txt` (no zod schema). Evidence: `packages/ingestion/src/ingest-pr.test.ts`, `packages/ingestion/src/raw-store.test.ts`, `packages/shared/src/index.test.ts` (31 tests green). |
| Scope | _pending_ | Other agent |
| Resume | _pending_ | Other agent |
| Demo seed | _pending_ | Other agent |
| Time | _pending_ | Other agent |

---

## Checkpoint 2 — 2026-08-03
- Phase: 2 (Linking)
- Pass / fail: **Spot check: pass**. Labels / Quarantine / Tests / Secrets owned by other agents.
- Demo repo: fixture `acme/widgets` via `testdata/checkpoint2-seed/`
- Episodes / recipes: 12 linked episodes (7 high, 5 medium); golden freeze under `testdata/golden-episodes/`
- LLM enabled: false (deterministic link only)
- Known issues: none for Spot check; phase1-seed alone has only 1 actionable episode — use checkpoint2-seed for ≥10 sample
- Spot-check precision: **12/12 (100%)** accepted spans look right (≥70% required)
- Next phase: Phase 3 — Compile (after full Checkpoint 2 pass)

### Checks

| Check | Status | Notes |
| --- | --- | --- |
| Spot check | **pass** | Sampled all 12 linked episodes from `DATA_DIR=testdata/checkpoint2-seed npm run graft -- link acme/widgets`. Judged accepted spans vs comment intent: 12/12 look right (suggestion/exact-replace/overlap cases). |
| Labels | _pending_ | Other agent |
| Quarantine | _pending_ | Other agent |
| Tests | _pending_ | Other agent |
| No secrets in logs | _pending_ | Other agent |

### Spot-check detail

| # | Path | Confidence | Reason (accepted) | Verdict |
| --- | --- | --- | --- | --- |
| 1 | `src/retry.ts` | medium | overlap_lexical | pass — early-return throw captured |
| 2 | `src/api/client.ts` | high | suggestion_block_applied | pass — withRetry matches suggestion |
| 3 | `src/run.ts` | high | exact_span_replacement | pass — nested try → return |
| 4 | `src/cache.ts` | medium | overlap_lexical | pass — sharedCache.memoize |
| 5 | `src/config.ts` | high | exact_span_replacement | pass — let → const |
| 6 | `src/user.ts` | high | exact_span_replacement | pass — optional chaining |
| 7 | `src/parse.ts` | medium | overlap_lexical | pass — null guard inserted |
| 8 | `src/batch.ts` | medium | overlap_lexical | pass — Promise.all |
| 9 | `src/index-map.ts` | medium | overlap_lexical | pass — Map lookup |
| 10 | `src/status.ts` | high | exact_span_replacement | pass — default throw |
| 11 | `src/types.ts` | high | exact_span_replacement | pass — any → unknown |
| 12 | `src/form.ts` | high | exact_span_replacement | pass — validateEmail helper |

### Exit note (golden episodes)
- Frozen: `testdata/golden-episodes/repos/acme/widgets/episodes/` (12 × `ep_*.json` + `index.json` + `discards.json`)
- Raw source for regenerate: `testdata/checkpoint2-seed/`
- Schema: all 12 episodes parse via `ReviewEpisodeSchema`

---

## Checkpoint 2 — 2026-08-03
- Phase: 2 (Linking)
- Pass / fail: **Labels check: pass**. Spot check / Quarantine / Tests / No secrets in logs owned by other agents (status unknown here).
- Demo repo: fixture `acme/widgets` (phase1-seed)
- Episodes / recipes: link CLI prints per-episode `linkConfidence` + `linkReason` in structured JSON (`episodeLabels`); no web UI yet
- LLM enabled: _(not checked here)_
- Known issues: none for Labels
- Spot-check precision (if applicable): n/a for Labels
- Next phase: Phase 3 — Recipes (after full Checkpoint 2 pass)

### Checks

| Check | Status | Notes |
| --- | --- | --- |
| Spot check | _pending_ | Other agent |
| Labels | **pass** | `graft link` summary JSON includes `episodeLabels[]` with `linkConfidence` + `linkReason` for every episode (SAF-4). Data also on `episodes/index.json` + episode files. Evidence: `packages/cli/src/link.test.ts` (printed summary asserts labels). No web UI output path yet. |
| Quarantine | _pending_ | Other agent |
| Tests | _pending_ | Other agent |
| No secrets in logs | _pending_ | Other agent |

---

## Checkpoint 2 — 2026-08-03
- Phase: 2 (Linking)
- Pass / fail: **Quarantine check: pass**. Spot check / Labels / Tests / No secrets owned by other agents (status unknown here).
- Demo repo: _(n/a for Quarantine)_
- Episodes / recipes: quarantine API ready; Phase 3 compile still stub
- LLM enabled: _(n/a for Quarantine)_
- Known issues: none for Quarantine; `@graft/compile` is stub — filter via linking API until Phase 3
- Spot-check precision (if applicable): n/a
- Next phase: Phase 3 — Compile (after full Checkpoint 2 pass)

### Checks

| Check | Status | Notes |
| --- | --- | --- |
| Spot check | _pending_ | Other agent |
| Labels | _pending_ | Other agent |
| Quarantine | **pass** | LNK-6: `isCompileEligible` true only for `high`/`medium`; `defaultCompileEpisodes` excludes `low`/`none` from default compile input. Exported from `@graft/linking`. Tests: `accepted-fix.test.ts` (`isCompileEligible — LNK-6`, `defaultCompileEpisodes — Checkpoint 2 Quarantine`). |
| Tests | _pending_ | Other agent: golden link suite |
| No secrets in logs | _pending_ | Other agent |

### Quarantine detail
- **API:** `isCompileEligible(confidence)`, `defaultCompileEpisodes(episodes)`, `COMPILE_ELIGIBLE_CONFIDENCES` in `packages/linking/src/accepted-fix.ts` (re-exported from `@graft/linking`).
- **Contract:** default compile input = episodes whose `linkConfidence` ∈ {`high`,`medium`}; `low`/`none` persist for later improvement but are never auto-promoted.
- **Phase 3 note:** `@graft/compile` remains a stub; pipeline/CLI (or compile when implemented) must call `defaultCompileEpisodes` (or equivalent) before recipe compilation.

---

## Checkpoint 2 — 2026-08-03
- Phase: 2 (Linking)
- Pass / fail: **No secrets in logs: pass**. Spot check / Labels / Quarantine / Tests owned by other agents (status unknown here).
- Demo repo: _(n/a for this check)_
- Episodes / recipes: _(owned elsewhere)_
- LLM enabled: _(n/a)_
- Known issues: none for No secrets in logs
- Spot-check precision (if applicable): n/a
- Next phase: Phase 3 — Compile recipes (after full Checkpoint 2 pass)

### Checks

| Check | Status | Notes |
| --- | --- | --- |
| Spot check | _pending_ | Other agent |
| Labels | _pending_ | Other agent |
| Quarantine | _pending_ | Other agent |
| Tests | _pending_ | Other agent |
| No secrets in logs | **pass** | CLI ingest/link summaries emit counts/watermarks only (no `commentBody`). Discard debug uses `truncateBodyPreview` (160 chars + `…`). `GITHUB_TOKEN` redacted via `toPrintableResolvedConfig` (`set`/`unset`). Evidence: `episode-store.test.ts` (truncate helper), `link.test.ts` (summary has no bodies/tokens), `config.test.ts` (token redaction). |

### No secrets in logs detail
- **Log helpers:** `packages/linking/src/episode-store.ts` → `truncateBodyPreview` (collapse whitespace; max 160 + ellipsis).
- **Consumers:** `link-repository.ts` writes `bodyPreview` on all discard debug rows (`episodes/discards.json`).
- **CLI structured logs:** `formatIngestSummary` / `formatLinkSummary` — repo counts + watermarks only.
- **Tokens:** `graft config` printable view never echoes `GITHUB_TOKEN` value.

---

## Checkpoint 2 — 2026-08-03
- Phase: 2 (Linking)
- Pass / fail: **Tests check: pass**. Spot check / Labels / Quarantine / No secrets owned by other agents (status unknown here).
- Demo repo: _(n/a for Tests)_
- Episodes / recipes: _(owned elsewhere)_
- LLM enabled: _(n/a)_
- Known issues: none for Tests
- Spot-check precision (if applicable): n/a
- Next phase: Phase 3 — Compile recipes (after full Checkpoint 2 pass)

### Checks

| Check | Status | Notes |
| --- | --- | --- |
| Spot check | _pending_ | Other agent |
| Labels | _pending_ | Other agent |
| Quarantine | _pending_ | Other agent |
| Tests | **pass** | `npm run build && npm run typecheck && npm test` green: 16 files / 130 tests. Golden link suites: `actionability` 6, `rejected-span` 8, `accepted-fix` 12, `link-repository` 5 (all green). No fixes required. |
| No secrets in logs | _pending_ | Other agent |

---

## Checkpoint 5 — 2026-08-03
- Phase: 5 (MCP + demo — MVP ship gate)
- Pass / fail: **pass**
- Demo repo: fixture `acme/widgets` (golden-episodes + compile)
- Episodes / recipes: 12 episodes → multiple recipes after compile (minSupport=1 for demo)
- LLM enabled: no (`GRAFT_LLM_ENABLED=false`)
- Known issues: live public-repo ingest still requires `GITHUB_TOKEN`; `apply_preview` / standalone `freshness` tool deferred to Phase 6–7
- Spot-check precision (if applicable): MCP suggest on `rejected-types.diff` returns evidence-backed graft with `unknown` patch (matches CLI)
- Next phase: Phase 6 — API, suppress, incremental ingest (not started)

### Checks

| Check | Status | Notes |
| --- | --- | --- |
| PRD MVP list | **pass** | MCP-1–3, MCP-6 partial; CLI ingest/link/compile/suggest/recipes; SAF defaults |
| Agent win | **pass** | `suggest_grafts` on seeded bad diff returns ranked patch + GitHub evidence |
| Evidence law | **pass** | Handlers refuse suggestions without evidence; tests assert `evidence.length > 0` |
| Deterministic path | **pass** | Demo + tests with `GRAFT_LLM_ENABLED=false` |
| CI | **pass** | `npm run build && npm run typecheck && npm run test` — 25 files / 157 tests green |
| Metrics snapshot | **pass** | Demo: ≥1 recipe for `src/types`; suggest top confidence high/medium/low labeled |

### Deliverables
- `@graft/mcp-server`: stdio MCP with `list_recipes`, `suggest_grafts`, `explain_recipe`
- CLI: `graft serve mcp [--repo owner/name]`; root `npm run mcp`
- Docs: `docs/MCP.md`, README quick start, `docs/DATA_FORMAT.md`, `docs/PIPELINE.md` stubs
- Demo: `scripts/demo-mvp.sh`

---

## Checkpoint 8 — 2026-08-03
- Phase: 8 (Soft diagnostics, dashboard, webhook, multi-repo, redaction — v0.3 SHIP GATE)
- Pass / fail: **pass**
- Demo repo: fixture `acme/widgets`
- Episodes / recipes: unchanged golden fixtures; multi-repo isolation tested synthetically
- LLM enabled: no (`GRAFT_LLM_ENABLED=false`)
- Known issues: live webhook requires `GITHUB_TOKEN` + `GITHUB_WEBHOOK_SECRET`; dashboard served at `/dashboard` via API server (static HTML, not Next.js)
- Next phase: Phase 9 — Hardening (not started)

### Checks

| Check | Status | Notes |
| --- | --- | --- |
| PRD v0.3 | **pass** | DEV-3, DEV-4, ING-5, SAF-3, multi-repo allowlist |
| Soft-only | **pass** | VS Code save diagnostics use Information severity; never block save |
| Privacy | **pass** | Redaction tests green; LLM still opt-in |
| Ops | **pass** | Webhook serial queue; failed ingest skips link/compile |
| Tag | _pending_ | User to tag `v0.3.0` when ready |
| Tests | **pass** | 34 files / 196 tests green |

