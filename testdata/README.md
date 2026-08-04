# Graft frozen fixtures (Phase 1 → 2)

Interim Checkpoint 1 **Demo seed** for Phase 2 linking.

Live `graft ingest` against a public GitHub repo was **not** run: `GITHUB_TOKEN` was unset in the verification environment.

## Layout

| Path | Purpose |
| --- | --- |
| `github/` | Recorded GitHub REST responses (source of offline ingest; mirrored from `packages/ingestion/testdata/github/`) |
| `phase1-seed/` | Materialized `DATA_DIR` tree — raw PR / comment / blob artifacts for Phase 2 linking (small smoke seed) |
| `checkpoint2-seed/` | Expanded raw seed (≥12 actionable before/after pairs) for Checkpoint 2 spot-check |
| `golden-episodes/` | Frozen `episodes/` output for Phase 3 compile tests (Checkpoint 2 exit) |

## Seed repo (fixture)

- Owner/repo: `acme/widgets`
- Merged PRs with review comments: PR **101** (“Extract retry helper”)
- Actionable comment on `src/retry.ts` (line 7) with diff hunk
- Non-actionable `LGTM` comment for discard-debug coverage
- Blobs:
  - `blobsha1111…` — **merge tip** (accepted early-return fix)
  - `blobsha2222…` — **comment-commit** before text (nested try/catch)
- `raw/blob-index.json` — maps merge tip + comment commit → blob shas (Phase 1 ingest alone does not write this; seed is hand-enhanced for Step 2.4)

### beforeText limitations

Live tip-only ingest has no comment-commit blob. The linker then best-effort reverse-applies `diffHunk` onto the tip, or falls back to tip-as-before (often `no_change` / `none`). This seed includes a comment-commit blob + index so ≥1 episode reaches **medium+** with inspectable before/after.

## Link offline

```bash
npm run build
DATA_DIR=testdata/phase1-seed npm run graft -- link acme/widgets
# inspect: testdata/phase1-seed/repos/acme/widgets/episodes/

# Checkpoint 2 spot-check / regenerate golden episodes
DATA_DIR=testdata/checkpoint2-seed npm run graft -- link acme/widgets
# freeze: copy episodes/ → testdata/golden-episodes/repos/acme/widgets/episodes/
```

### Golden episodes (compile freeze)

- Path: `testdata/golden-episodes/repos/acme/widgets/episodes/`
- 12 linked episodes (all medium/high) + `index.json` + `discards.json`
- Source seed: `testdata/checkpoint2-seed/` (distinct comment-commit + merge-tip blobs per case)

## Regenerate (raw tip only)

From repo root (requires built workspaces). Regenerated trees **omit** the comment-commit blob, blob-index, and LGTM discard comment — re-apply those Phase 2 enhancements after:

```bash
node --input-type=module <<'NODE'
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createFixtureFetch, createGitHubClient, ingestRepository } from "@graft/ingestion";

const dataDir = path.resolve("testdata/phase1-seed");
await mkdir(dataDir, { recursive: true });
const client = createGitHubClient({
  token: "ghp_fixture_token",
  fetch: createFixtureFetch(),
  pullsPerPage: 3,
});
console.log(await ingestRepository({
  client, dataDir, owner: "acme", repo: "widgets", maxPrs: 3,
}));
NODE
```

Live demo seed (when token available):

```bash
export GITHUB_TOKEN=...   # classic PAT with public_repo / repo read
npm run graft -- ingest <owner>/<repo> --max-prs 20
npm run graft -- link <owner>/<repo>
```

Choose a public repo known to have PR review comments; confirm `DATA_DIR/repos/<owner>/<repo>/raw/comments/` is non-empty.
