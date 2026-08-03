# Graft — Full Build Plan

**Companion docs:** [PRD.md](./PRD.md) · [TRD.md](./TRD.md)  
**Status:** Draft v1  
**Last updated:** 2026-08-03

---

## How to use this plan

- Work **phases in order**. Within a phase, work **steps in order** unless noted parallel.
- Do not start the next phase until the phase **checkpoint** passes.
- Each step has: deliverables, done criteria, and mapped requirement IDs from the PRD.
- Priority bands: **P0** = MVP (v0.1), **P1** = v0.2, **P2** = v0.3.

```
Phase 0  Foundation
Phase 1  Ingestion
Phase 2  Linking
Phase 3  Compile
Phase 4  Retrieval + CLI suggest
Phase 5  MCP + demo   ← MVP ship gate
Phase 6  API + suppress + incremental ingest
Phase 7  Editor Code Actions + apply preview
Phase 8  Soft diagnostics + dashboard + webhook + multi-repo + redaction
Phase 9  Hardening + polish
```

---



## Feature coverage map


| Feature area                                                  | PRD IDs               | Phase(s)        |
| ------------------------------------------------------------- | --------------------- | --------------- |
| Monorepo / shared types / config                              | —                     | 0               |
| GitHub merged-PR ingest                                       | ING-1–3, ING-6–7      | 1               |
| Incremental ingest                                            | ING-4                 | 6               |
| Webhook / background sync                                     | ING-5                 | 8               |
| Episode linking + confidence                                  | LNK-1–4, LNK-6        | 2               |
| Optional LLM link assist                                      | LNK-5                 | 2 (optional), 9 |
| Recipe compile + clustering                                   | RCP-1–4, RCP-6        | 3               |
| Single-evidence experimental recipes                          | RCP-5                 | 9               |
| Recipe suppress                                               | RCP-7                 | 6               |
| Retrieval + ranking + payload caps                            | RET-1–6               | 4               |
| MCP `list_recipes` / `suggest_grafts` / `explain_recipe`      | MCP-1–3, MCP-6        | 5               |
| MCP `apply_preview` / `freshness`                             | MCP-4–5               | 6–7             |
| CLI ingest / link / compile / suggest                         | DEV-1                 | 1–4             |
| HTTP/GraphQL API                                              | DEV-5                 | 6               |
| Editor Code Action preview/apply                              | DEV-2                 | 7               |
| Soft save/stage diagnostics                                   | DEV-3                 | 8               |
| Web recipe browser                                            | DEV-4                 | 8               |
| Repo scoping, no LLM by default, confidence labels, soft-only | SAF-1–2, SAF-4, SAF-6 | 0–5             |
| Secret redaction                                              | SAF-3                 | 8               |
| Purge                                                         | SAF-5                 | 6               |
| Postgres path                                                 | TRD §6.3              | 9 (optional)    |


---



## Phase 0 — Foundation

**Goal:** Empty repo becomes a buildable TypeScript monorepo with shared contracts and local data layout.

### Step 0.1 — Scaffold monorepo

- Create npm workspaces root, `.nvmrc` (22+), `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.env.example`.
- Create package stubs: `shared`, `ingestion`, `linking`, `compile`, `retrieval`, `mcp-server`, `cli`, `pipeline`.
- Wire root scripts: `build`, `typecheck`, `test`.

**Done when:** `npm install && npm run build && npm run test` succeed (tests may be empty smoke).

### Step 0.2 — Shared types and schemas

- Implement zod schemas for: `RawPullRequest`, `RawReviewComment`, `CodeSpan`, `ReviewEpisode`, `RewriteRecipe`, `GraftSuggestion`, cursors, config.
- Export error codes (`GRAFT_NO_DATA`, etc.).
- Add `DATA_DIR` path helpers + repo-scoped path builder (`data/repos/<owner>/<name>/...`).

**Done when:** Unit tests parse valid/invalid fixtures; invalid artifacts throw typed errors.

### Step 0.3 — Repo config + env loading

- Support `GRAFT_REPO`, `GITHUB_TOKEN`, `DATA_DIR`, `GRAFT_MIN_SUPPORT`, `GRAFT_LLM_ENABLED` (default false).
- Write/read `config.json` per repo.

**Done when:** CLI (or small script) can print resolved config for a repo without network.

### Step 0.4 — Pipeline freshness stubs

- `cursors.json` shape: ingest / link / compile watermarks.
- `pipeline` helpers to read/write watermarks.

**Done when:** Watermark round-trip test passes.

### Checkpoint 0


| Check          | Pass criteria                                        |
| -------------- | ---------------------------------------------------- |
| Build          | `typecheck` + `test` green                           |
| Isolation      | Packages depend only on `@graft/shared` (or nothing) |
| Safety default | `GRAFT_LLM_ENABLED` defaults false                   |
| Docs           | README stub: name, thesis, link to PRD/TRD/this plan |


**Exit:** Begin Phase 1 only after Checkpoint 0 passes.

---



## Phase 1 — Ingestion (P0)

**Goal:** Pull merged PR review history for one repo into immutable raw artifacts.

### Step 1.1 — GitHub client

- Octokit wrapper with auth from `GITHUB_TOKEN`.
- List merged PRs with pagination; backoff on rate limits (ING-6).

**Done when:** Integration test against recorded fixtures lists N merged PRs (no live network in CI).

### Step 1.2 — Comment + blob fetch

- For each PR: fetch inline review comments (path, body, diff hunk, line/side, urls) (ING-2).
- Fetch file blobs at merge commit for commented paths; store by sha (ING-3, ING-7).

**Done when:** Fixture PR produces `raw/prs/`, `raw/comments/`, `raw/blobs/` files.

### Step 1.3 — CLI `graft ingest`

- `graft ingest <owner/repo> [--max-prs 200]` (ING-1, DEV-1).
- Idempotent re-runs; update ingest watermark.
- Structured logs: prs / comments / blobs / duration.

**Done when:** Live run against a public demo repo completes and prints counts; re-run adds nothing new.

### Step 1.4 — Empty / error UX

- Clear errors for missing token, 404 repo, rate limit exhausted (exit code 3).
- `GRAFT_NO_DATA` path documented for later stages.

**Done when:** Manual: bad token and bad repo each fail with actionable messages.

### Checkpoint 1


| Check     | Pass criteria                                                              |
| --------- | -------------------------------------------------------------------------- |
| Artifacts | Raw JSON validates against shared zod schemas                              |
| Scope     | Data written only under configured `owner/repo` (SAF-1)                    |
| Resume    | Interrupted ingest can continue via cursor                                 |
| Demo seed | ≥ 1 public repo backfilled with real review comments                       |
| Time      | Mid-size backfill path documented (target < 30 min to first recipes later) |


**Exit:** Phase 2 starts with a frozen fixture set checked into `testdata/`.

---



## Phase 2 — Linking (P0)

**Goal:** Turn raw comments into `ReviewEpisode`s with rejected/accepted spans and confidence.

### Step 2.1 — Actionability filter

- Drop praise / LGTM / emoji-only / bot authors / non-actionable nits (LNK-4).
- Persist `discardReason` for discarded items (debug index ok).

**Done when:** Golden fixtures: actionable kept, noise discarded with reasons.

### Step 2.2 — Rejected span extraction

- Prefer GitHub line/side + blob; fallback to `diffHunk` parse; else `linkConfidence: none` (LNK-1).

**Done when:** Golden cases cover all three paths.

### Step 2.3 — Accepted fix heuristics

- Suggestion blocks → high confidence.
- Overlapping line changes comment→merge → medium/high per TRD rules.
- Same-file only → low; no change → none (LNK-2, LNK-3).

**Done when:** Confidence matrix tests match TRD table; low/none never auto-promoted later by default (LNK-6).

### Step 2.4 — CLI `graft link` + episode index

- Write `episodes/*.json` + `index.json`; update link watermark.
- Every episode stores confidence + `linkReason` (SAF-4 data ready).

**Done when:** Running link on Phase 1 fixture yields inspectable episodes with before/after text where confidence ≥ medium.

### Step 2.5 — Optional LLM validation (off by default)

- If `GRAFT_LLM_ENABLED` + key: validate medium links; never invent episodes (LNK-5, SAF-2).
- On LLM failure, keep deterministic result.

**Done when:** Unit test with mocked LLM upgrades/downgrades; with flag false, zero network calls.

### Checkpoint 2


| Check              | Pass criteria                                                       |
| ------------------ | ------------------------------------------------------------------- |
| Spot check         | Manual sample ≥ 10 linked episodes; ≥ 70% accepted spans look right |
| Labels             | All UI/CLI output paths can print confidence                        |
| Quarantine         | `low` / `none` excluded from default compile input                  |
| Tests              | Golden link suite green in CI                                       |
| No secrets in logs | Comment bodies truncated in logs if needed                          |


**Exit:** Freeze a golden `episodes/` fixture for compile tests.

---



## Phase 3 — Compile recipes (P0)

**Goal:** Cluster episodes into evidence-backed rewrite recipes on disk.

### Step 3.1 — Normalization

- Whitespace collapse, optional literal/identifier masking for clustering (RCP-3).

**Done when:** Normalization unit tests; stable hashes for identical inputs.

### Step 3.2 — Clustering + exemplars

- Bucket by language + path prefix; Jaccard/greedy clusters (RCP-1).
- Medoid exemplar → `before` / `after` (RCP-2).
- `support`, `episodeIds`, `reviewers`, `beforeSignals` (RCP-2).

**Done when:** Fixture cluster of near-duplicate pairs becomes one recipe with `support ≥ 2`.

### Step 3.3 — Thresholds + titles

- Drop clusters below `GRAFT_MIN_SUPPORT` (default 2) (RCP-4).
- Deterministic title/rationale from comment keywords; optional LLM paraphrase later.

**Done when:** Changing minSupport changes recipe count predictably in tests.

### Step 3.4 — CLI `graft compile` + recompile

- Write `recipes/*.json` + index + `compile-meta.json` (RCP-6).
- Recompile overwrites recipes for same compile inputs; preserve suppressions file (empty for now).

**Done when:** End-to-end on demo repo: ingest → link → compile produces ≥ a few plausible recipes with evidence IDs.

### Checkpoint 3


| Check         | Pass criteria                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Yield         | On demo repo, usable recipe candidates from ≥ ~15% of actionable comments *or* documented why lower (noise-heavy repo) |
| Evidence      | Every recipe has ≥ 1 episode id + PR/comment pointers                                                                  |
| Under-suggest | No recipe from discarded noise fixtures                                                                                |
| Meta          | `compile-meta.json` records thresholds + drop histogram                                                                |
| Performance   | Link+compile on fixture finishes in seconds; demo repo < 5 min target                                                  |


**Exit:** Recipe index is the only input Phase 4 needs (plus episodes for explain).

---



## Phase 4 — Retrieval + CLI suggest (P0)

**Goal:** Query and match recipes against paths/diffs; rank; return patches + evidence.

### Step 4.1 — Recipe index loader

- Load recipes into memory; filter suppressed (noop until Phase 6); repo scope enforced (SAF-1).

**Done when:** Load test on demo recipe set < 200ms.

### Step 4.2 — `listRecipes`

- Filter by path prefix, language, text query; limit/cap payload (RET-1, RET-6).

**Done when:** CLI `graft recipes list --path ...` returns compact cards (title, before/after truncated, support, confidence, evidence count).

### Step 4.3 — Diff / code matching

- Parse unified diff; signal + similarity match; path scope (RET-2).
- Scoring formula per TRD (RET-4).
- Hard require evidence pointers (RET-5).

**Done when:** Golden: rejected sample → suggestion; accepted sample → no self-rewrite (behavioral test).

### Step 4.4 — Patch construction

- Build unified diff when line alignment works; else before/after block with warnings (RET-3).

**Done when:** `graft suggest --diff fixture.diff` prints ranked suggestions with PR links.

### Step 4.5 — CLI polish for empty/stale states

- No data → exit 2 + CTA to ingest.
- Ingest newer than compile → stale warning (banner text).

**Done when:** Manual matrix of empty / stale / ok states verified.

### Checkpoint 4


| Check                | Pass criteria                                                             |
| -------------------- | ------------------------------------------------------------------------- |
| Ranking sanity       | Higher support + tighter path beats weak matches in fixtures              |
| Payload              | Default responses stay under ~32KB                                        |
| Confidence visible   | `low` never shown as certain                                              |
| Soft-only            | No commit-blocking exit codes (SAF-6)                                     |
| CLI complete for MVP | `ingest`, `link`, `compile`, `suggest`, `recipes list`, `recipes explain` |


**Exit:** Retrieval library API stable enough to wrap with MCP.

---



## Phase 5 — MCP server + MVP demo (P0)

**Goal:** Agents can call Graft; demo script proves the product thesis.

### Step 5.1 — MCP stdio server

- Tools: `list_recipes`, `suggest_grafts`, `explain_recipe` (MCP-1–3).
- Map retrieval errors to Graft error codes.
- Include freshness summary in responses (even if full `freshness` tool is P1).

**Done when:** MCP inspector / client invokes all three tools successfully against demo data.

### Step 5.2 — `graft serve mcp` + agent docs

- Document tool schemas + example prompts (MCP-6).
- Example Cursor/Claude MCP config snippet.

**Done when:** A coding agent in a clean session lists recipes for a path and cites evidence.

### Step 5.3 — Demo script

- Scripted walkthrough: ingest → link → compile → seed bad diff → `suggest_grafts` → show applyable rewrite.
- Include one low-confidence example correctly labeled.

**Done when:** Demo runs end-to-end in one terminal session on a public repo.

### Step 5.4 — MVP docs pass

- README: quick start, principles, non-goals.
- Optional `docs/DATA_FORMAT.md` + `docs/PIPELINE.md` stubs filled enough to operate.

**Done when:** New contributor can follow README without tribal knowledge.

### Checkpoint 5 — MVP SHIP GATE (v0.1)


| Check              | Pass criteria                                                   |
| ------------------ | --------------------------------------------------------------- |
| PRD MVP list       | All §9.1 items done                                             |
| Agent win          | Agent applies or cites a graft on a seeded bad diff             |
| Evidence law       | Zero suggestions without evidence                               |
| Deterministic path | Full pipeline works with LLM disabled                           |
| CI                 | `typecheck` + unit/golden tests green                           |
| Metrics snapshot   | Record recipe count, spot-check precision, time-to-first-recipe |


**Exit:** Tag `v0.1.0`. P1 work may begin.

---



## Phase 6 — API, suppress, incremental ingest, purge (P1)

**Goal:** Production-shaped serving + operator controls.

### Step 6.1 — Suppressions

- `suppressions.json` / mutation; compile + retrieval honor flag (RCP-7).
- CLI `graft recipes suppress <id>`.

**Done when:** Suppressed recipe disappears from list/suggest; still explainable by id for audit.

### Step 6.2 — Incremental ingest

- Cursor-based fetch of only new merged PRs (ING-4).
- Re-link / re-compile only new episodes (or full recompile if simpler — document choice).

**Done when:** Second ingest after a new merge (or simulated cursor) fetches delta only.

### Step 6.3 — HTTP/GraphQL API

- Queries: recipes, recipe, suggestGrafts, freshness (DEV-5).
- Mutation: suppressRecipe.
- `graft serve api`; optional bearer token.

**Done when:** curl/GraphQL playground returns same results as CLI for a fixture repo.

### Step 6.4 — MCP `freshness` + purge

- Tool `freshness` (MCP-5).
- `graft purge --repo` deletes artifact tree (SAF-5).

**Done when:** Purge removes data; subsequent serve returns `GRAFT_NO_DATA`.

### Checkpoint 6


| Check               | Pass criteria                                              |
| ------------------- | ---------------------------------------------------------- |
| API ↔ CLI parity    | Same suggestion IDs/scores on shared fixture               |
| Suppress round-trip | API + CLI                                                  |
| Incremental         | Log shows delta PR count < full backfill                   |
| Auth                | Token required when configured; local demo mode documented |
| Freshness           | `stale: true` after ingest without compile                 |


**Exit:** Extension can depend on API.

---



## Phase 7 — Editor Code Actions + apply preview (P1)

**Goal:** Developers preview/apply grafts in the editor without leaving the workflow.

### Step 7.1 — MCP/API `apply_preview`

- Input recipe + location → unified diff, no write (MCP-4).
- Warnings when alignment fuzzy.

**Done when:** Preview matches CLI suggest patch for golden case.

### Step 7.2 — VS Code / Cursor extension scaffold

- Package `vscode-extension`; configure API base URL / local server.
- Command: “Graft: Suggest for current diff/selection”.

**Done when:** Extension activates and shows a suggestion pick list.

### Step 7.3 — Code Action + apply

- Code Action: “Graft: preview historical accept” (DEV-2).
- Preview diff UX → workspace edit apply on confirm (explicit apply).
- Suggestion card fields: title, before/after, why, support, confidence, evidence links.

**Done when:** Manual: bad helper pattern → preview → apply → file matches historical accept style.

### Step 7.4 — Empty/degraded extension states

- No server / no data / stale banners.
- Confidence labels always visible (SAF-4).

**Done when:** Each degraded state has a non-blank message and recovery CTA.

### Checkpoint 7 — v0.2 SHIP GATE


| Check          | Pass criteria                                   |
| -------------- | ----------------------------------------------- |
| PRD v0.2       | Editor apply, API, suppress, incremental ingest |
| Explicit apply | No silent rewrite                               |
| Evidence links | Clickable to GitHub comment                     |
| Regression     | MVP MCP/CLI demos still pass                    |
| Tag            | `v0.2.0`                                        |


---



## Phase 8 — Soft diagnostics, dashboard, webhook, multi-repo, redaction (P2)

**Goal:** Continuous freshness, team visibility, safer storage, broader scope.

### Step 8.1 — Soft diagnostics on save/stage

- Info-level diagnostics when high-support recipe matches (DEV-3).
- Never fail save; optional stage hint via CLI hook doc (no hard gate default) (SAF-6).

**Done when:** Matching file shows dismissable diagnostic; non-match stays clean.

### Step 8.2 — Web recipe browser

- Next.js read-only list + detail + suppress toggle (DEV-4).
- Filters: path, language, support, confidence.
- Empty states per PRD §8.2.

**Done when:** Lead can suppress a bad recipe from UI and see list update.

### Step 8.3 — Merge webhook / background sync

- Merge-only webhook or extension background sync (ING-5).
- Triggers ingest → link → compile for that repo (queue or serial).

**Done when:** Merge event (or simulated payload) updates recipes without full manual CLI.

### Step 8.4 — Secret redaction

- Heuristic scrubber on persist for tokens/keys (SAF-3).
- Tests with synthetic secrets.

**Done when:** Scrubbed fixtures never store raw `ghp_` / private key blocks.

### Step 8.5 — Multi-repo allowlist

- Config allowlist; MCP/API require repo param or workspace mapping.
- Hard refuse cross-repo reads (SAF-1).

**Done when:** Two repos ingested; queries never mix recipes.

### Checkpoint 8 — v0.3 SHIP GATE


| Check     | Pass criteria                                               |
| --------- | ----------------------------------------------------------- |
| PRD v0.3  | Diagnostics, dashboard, webhook/sync, redaction, multi-repo |
| Soft-only | Diagnostics are information severity                        |
| Privacy   | Redaction tests green; LLM still opt-in                     |
| Ops       | Webhook failure doesn’t corrupt cursors                     |
| Tag       | `v0.3.0`                                                    |


---



## Phase 9 — Hardening and optional stretch

**Goal:** Raise precision, operability, and optional persistence — not new product surface area.

### Step 9.1 — Precision tuning

- Calibrate clustering thresholds on 2–3 real repos.
- Optional single high-confidence recipes flagged experimental (RCP-5).
- Reviewer-diversity display on recipe cards.



### Step 9.2 — Behavioral replay suite

- Expand goldens: rejected caught, accepted clean, path mismatch ignored.
- Track false-positive rate from manual dismissals (log metric).



### Step 9.3 — Optional Postgres + Prisma

- Same logical schema as files; repository port in retrieval/API.
- Docker Compose path documented.



### Step 9.4 — LLM enrichment quality bar

- Title paraphrase + link validation eval set.
- Automatic disable on high error rate.



### Step 9.5 — Performance + observability

- Meet TRD budgets; structured logs dashboards (even if just local JSON).
- Compile budget for huge monorepos (path include/exclude).



### Checkpoint 9


| Check          | Pass criteria                                                      |
| -------------- | ------------------------------------------------------------------ |
| Link precision | ≥ 70% on new sampled set                                           |
| Perf           | `suggest_grafts` < 1s on mid-size diff locally                     |
| Store port     | File and DB backends pass same retrieval tests (if DB implemented) |
| No scope creep | Still no hard gates / convention-catalog product pivot             |


---



## Cross-cutting work (every phase)


| Track          | Rule                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| Tests          | New logic ships with unit or golden coverage                                                                |
| Schemas        | Artifact changes bump a format version field                                                                |
| Safety         | No LLM calls unless explicitly enabled                                                                      |
| Evidence       | Refuse to serve suggestions without evidence                                                                |
| DX             | CLI help text updated when commands change                                                                  |
| Checkpoint log | Record date, demo repo, recipe count, known issues in `docs/checkpoints.md` (create when first phase exits) |


---



## Suggested calendar (hackathon-compressed)


| Day | Focus                  | End-of-day checkpoint                                           |
| --- | ---------------------- | --------------------------------------------------------------- |
| 1   | Phase 0 + 1            | Raw artifacts for demo repo                                     |
| 2   | Phase 2 + 3            | First real recipes on disk                                      |
| 3   | Phase 4 + 5            | MCP demo + MVP ship gate                                        |
| 4   | Phase 6 + 7 (thin)     | Suppress + apply preview in editor or CLI-only if time          |
| 5   | Phase 8 slice + polish | Dashboard *or* webhook *or* diagnostics — pick one; harden demo |


For a longer build, keep phase order and spend ~1 week per phase through Phase 7, then Phase 8 as a second milestone.

---



## Demo checklist (reuse at every ship gate)

1. [ ] Ingest public or sanctioned private repo
2. [ ] Show episode with rejected → accepted and confidence label
3. [ ] Show recipe with support ≥ 2 and evidence links
4. [ ] Seed a “bad” diff matching a known rejection
5. [ ] Agent or CLI returns graft suggestion with patch
6. [ ] Apply or display after-code that matches historical accept
7. [ ] Show a low-confidence / suppressed example handled safely
8. [ ] LLM disabled path still works

---



## Risk checkpoints (trigger a pause)


| Trigger                            | Action                                                     |
| ---------------------------------- | ---------------------------------------------------------- |
| Link precision < 50% on spot check | Stop feature work; improve heuristics before MCP demo      |
| Recipes mostly noise               | Raise minSupport; tighten actionability filter             |
| Agent ignores MCP tools            | Shrink payloads; add copy-paste prompt; rely on CLI/editor |
| Rate limits block demo             | Switch to recorded fixtures + prebuilt `data/` for stage   |
| Scope pressure to “block commits”  | Reject by default; keep soft-only unless explicit config   |


---



## Definition of done (whole product)

Graft is “feature complete” against the current PRD when:

- Phases 0–8 checkpoints have passed  
- P0/P1/P2 requirement IDs in the feature coverage map are checked off or explicitly deferred in writing  
- Demo checklist passes on a clean machine from README  
- Non-goals in PRD §1.4 remain true

---



## Checkpoint sign-off template

Copy into `docs/checkpoints.md` at each phase exit:

```md
## Checkpoint N — YYYY-MM-DD
- Phase: 
- Pass / fail: 
- Demo repo: 
- Episodes / recipes: 
- LLM enabled: yes/no
- Known issues: 
- Spot-check precision (if applicable): 
- Next phase: 
```

