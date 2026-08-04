# Graft — Error & Bug Log

Running log of mistakes, bugs, and footguns encountered while building Graft.  
**Read this before starting any new task.** Add an entry whenever something breaks or a wrong assumption wastes time.

---

## How to use

1. **Before a task:** skim open + recurring items below; avoid repeating the same failure mode.
2. **When something goes wrong:** append a new entry (template at bottom). Do not delete old entries — mark them `resolved` instead.
3. **When fixing a class of bug:** update the entry’s status and add a short “prevention” note.

Status values: `open` · `resolved` · `wontfix`

---

## Open

_None yet._

---

## Resolved

### E-004 — CLI `graft link` summary omitted per-episode confidence
- **Status:** resolved
- **Date:** 2026-08-03
- **Phase / task:** Checkpoint 2 — Labels (SAF-4)
- **Symptom:** `graft link` printed only aggregate counts (`mediumOrHigher`); stdout JSON had no `linkConfidence` / `linkReason` per episode.
- **Cause:** Labels lived on disk (`episodes/*.json`, `index.json`) but were not included in the CLI output path.
- **Fix:** `LinkRepositoryResult.episodeLabels` + `LinkCliSummary.episodeLabels` (id, linkConfidence, linkReason) printed in structured link summary JSON.
- **Prevention:** Any new CLI/UI surface that shows link results must include confidence labels (SAF-4); do not rely on on-disk artifacts alone.
- **Related files:** `packages/linking/src/link-repository.ts`, `packages/cli/src/index.ts`, `packages/cli/src/link.test.ts`

### E-003 — Phase 1 tip-only seed cannot reach medium+ without before snapshot
- **Status:** resolved
- **Date:** 2026-08-03
- **Phase / task:** Phase 2 Step 2.4 — CLI `graft link` + episode index
- **Symptom:** Linking the original tip-only phase1 seed always yielded `no_change` / `none`, or (after tip was updated to the fix) `same_file_only` / `low` when comment keywords did not appear in the edit hunk text.
- **Cause:** (1) Merge-tip blob alone means `beforeText === afterText`. (2) `overlap_lexical` checks keywords against the *edit hunk*, not the whole file — “try/catch/return” in unchanged context do not count.
- **Fix:** Enhanced seed with comment-commit blob + `raw/blob-index.json`; comment body includes keywords present in the accepted change (`throw` / `attempt`). Documented tip-only best-effort reverse-hunk fallback in `link-repository.ts` / `testdata/README.md`.
- **Prevention:** For medium+ fixture episodes, ship distinct before/after blobs (or a reverse-applicable hunk) and ensure comment keywords appear in the accepted hunk text.
- **Related files:** `packages/linking/src/link-repository.ts`, `packages/linking/src/before-text.ts`, `testdata/phase1-seed/`

### E-002 — Ingest watermark unusable for resume if PRs processed newest-first
- **Status:** resolved
- **Date:** 2026-08-03
- **Phase / task:** Checkpoint 1 — Resume
- **Symptom:** Watermark was only written at end of `runIngest`, and `since` was never passed — interrupted runs re-fetched from scratch. Naively applying `since=lastMergedAt` after processing newest-first would skip older unfinished PRs.
- **Cause:** GitHub list is newest-first; ingest cursor `{ lastMergedAt, lastPrNumber }` is a lower bound for *newer* merges, so resume requires chronological (oldest-first) processing plus per-PR cursor advances.
- **Fix:** Sort PRs oldest-first; `onPrIngested` persists watermark after each PR; `runIngest` passes `since` from existing ingest cursor; fetch-before-write in `ingestPullRequest` avoids partial PR artifacts.
- **Prevention:** Never advance ingest `since` after newest-first work; keep oldest-first + per-PR watermark for interrupt-safe resume.
- **Related files:** `packages/ingestion/src/ingest-repo.ts`, `packages/ingestion/src/ingest-pr.ts`, `packages/cli/src/index.ts`

### E-001 — Workspace build races before `@graft/shared` dist exists
- **Status:** resolved
- **Date:** 2026-08-03
- **Phase / task:** Phase 0 Step 0.3 — Repo config + env loading
- **Symptom:** `npm run build` failed in `@graft/cli` with `Module '"@graft/shared"' has no exported member 'resolveGraftConfig'` even though the exports existed in source.
- **Cause:** npm workspaces run package builds in parallel; `@graft/cli` typechecks against `@graft/shared`'s emitted `dist/` before shared finishes compiling.
- **Fix:** Root `build` / `typecheck` scripts run `npm run build -w @graft/shared` first, then the remaining workspaces.
- **Prevention:** Any package that imports `@graft/shared` must not assume a cold parallel workspace build order; keep shared first in root scripts (or use project references).
- **Related files:** `package.json`, `packages/cli/package.json`, `packages/shared/src/config.ts`

---

---

## Recurring watchlist

Patterns to keep in mind even after individual bugs are fixed:

| Pattern | Why it matters |
| --- | --- |
| Serving suggestions without evidence pointers | Violates product law; never ship |
| LLM calls when `GRAFT_LLM_ENABLED` is false | Privacy / determinism default |
| Promoting `low` / `none` link confidence into default recipes | False-positive grafts |
| Cross-repo reads from `DATA_DIR` | Scope / safety breach |
| Silent file writes from MCP | Apply must be explicit |
| Hard commit blockers by default | Soft-only unless user opts in |
| Parallel workspace build before `@graft/shared` dist | CLI/other packages fail typecheck on cold build |
| Newest-first ingest + `since` watermark | Skips older unfinished PRs; process oldest-first and advance cursor per PR |
| Tip-only blobs for accepted-fix linking | `before === after` → `none`; need comment-commit blob, reverse-hunk, or enhanced seed |
| Lexical overlap vs whole-file keywords | `overlap_lexical` scores the edit hunk only — fixture comments must mention tokens in the fix |
| CLI/UI omits link confidence | SAF-4 — every output path that shows links must print `linkConfidence` (prefer `linkReason` too) |

---

## Entry template

Copy under **Open** (or append under **Resolved** if fixed in the same session):

```md
### E-XXX — short title
- **Status:** open
- **Date:** YYYY-MM-DD
- **Phase / task:** e.g. Phase 2 linking
- **Symptom:** what you saw
- **Cause:** root cause if known
- **Fix:** what changed (or “pending”)
- **Prevention:** how to not repeat this
- **Related files:** paths if useful
```

Next id: **E-005**
