# Graft — Technical Requirements Document

**Product name:** Graft  
**Document type:** TRD  
**Status:** Draft v1  
**Last updated:** 2026-08-03  
**Companion:** [PRD.md](./PRD.md)

---

## 1. Purpose

This TRD specifies how Graft is built: architecture, packages, data model, pipelines, APIs, MCP tools, storage, security, and test strategy. It implements the product requirements in `docs/PRD.md` without prescribing a particular third-party product to imitate.

---

## 2. System summary

Graft is a TypeScript monorepo that:

1. **Ingests** merged pull request review data from GitHub  
2. **Links** comments → rejected hunks → candidate accepted fixes  
3. **Compiles** linked episodes into rewrite recipes  
4. **Serves** recipes to agents (MCP) and developers (CLI, optional API/extension/web)

Packages communicate through **versioned JSON artifacts** under a data directory and/or a **Postgres** database — not via deep cross-package imports (except a shared types package).

```
GitHub merged PRs
       │
       ▼
┌─────────────┐     raw/          ┌─────────────┐     episodes/     ┌─────────────┐
│  ingestion  │ ───────────────► │   linking   │ ───────────────► │  compile    │
└─────────────┘                   └─────────────┘                   └─────────────┘
                                                                      │ recipes/
                                                                      ▼
                                                          ┌───────────────────────┐
                                                          │ retrieval / mcp / api │
                                                          └───────────────────────┘
```

---

## 3. Tech stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript (Node 22+) | Strict mode; shared `tsconfig` |
| Monorepo | npm workspaces | Simple for hackathon velocity |
| Runtime API | Node HTTP + GraphQL (optional in MVP) | Extension/web later |
| Agent interface | MCP (stdio and/or SSE) | Primary agent surface |
| Persistence (local) | JSON files under `DATA_DIR` | Default for MVP |
| Persistence (prod-shaped) | PostgreSQL + Prisma | Optional path; same logical schema |
| GitHub access | Octokit / REST+GraphQL | Token with `repo` read (or fine-grained read) |
| LLM (optional) | Anthropic / Gemini / OpenAI-compatible | Link validation + title paraphrase only |
| Tests | Vitest | Unit + golden fixtures |
| Editor | VS Code extension API | P1 |
| Web | Next.js (lightweight) | P2 |
| Containers | Docker Compose for Postgres | Local optional |

---

## 4. Repository layout

```
graft/
  docs/
    PRD.md
    TRD.md
    DATA_FORMAT.md          # artifact schemas (follow-on)
    PIPELINE.md             # stage ops (follow-on)
  packages/
    shared/                 # types, zod schemas, error codes
    ingestion/              # GitHub → raw artifacts
    linking/                # raw → review episodes
    compile/                # episodes → recipes
    retrieval/              # query + diff match + ranking
    mcp-server/             # MCP tools over retrieval
    api-server/             # GraphQL/HTTP (P1)
    cli/                    # graft ingest|compile|suggest
    vscode-extension/       # Code Actions (P1)
    pipeline/               # freshness cursors, stage runners
  dashboard/                # recipe browser (P2)
  data/                     # local artifact root (gitignored)
  scripts/
  compose.yaml
  package.json
  .env.example
  .nvmrc
```

**Dependency rule:** `ingestion`, `linking`, `compile`, `retrieval`, `mcp-server`, `api-server`, `cli` may depend on `@graft/shared` only. No package imports another package’s internals; they read/write agreed artifacts or call shared DB repositories behind interfaces.

---

## 5. Configuration

### 5.1 Environment

| Variable | Required | Description |
| --- | --- | --- |
| `GITHUB_TOKEN` | Yes (ingest) | Read access to target repo(s) |
| `DATA_DIR` | Yes | Artifact root (default `./data`) |
| `DATABASE_URL` | No | Postgres; if set, prefer DB over files for serving |
| `GRAFT_REPO` | Yes | Default `owner/name` |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / etc. | No | Optional LLM enrichment |
| `GRAFT_MIN_SUPPORT` | No | Default `2` |
| `GRAFT_LLM_ENABLED` | No | Default `false` |
| `API_HOST` / `API_PORT` | No | API bind (P1) |

### 5.2 Per-repo config file

`data/repos/<owner>/<name>/config.json`

```json
{
  "owner": "acme",
  "name": "widgets",
  "defaultBranch": "main",
  "backfill": { "maxPrs": 200, "since": null },
  "compile": { "minSupport": 2, "allowSingleHighConfidence": false },
  "paths": { "include": [], "exclude": ["**/vendor/**", "**/dist/**"] }
}
```

---

## 6. Data model

### 6.1 Logical entities

#### `RawPullRequest`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | GitHub node/REST id |
| `number` | number | PR number |
| `mergedAt` | iso datetime | Only merged PRs retained |
| `mergeCommitSha` | string | |
| `baseRef` / `headRef` | string | |
| `title` | string | |
| `url` | string | |

#### `RawReviewComment`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `prNumber` | number | |
| `path` | string | file path |
| `body` | string | |
| `author` | string | |
| `createdAt` | iso datetime | |
| `diffHunk` | string \| null | GitHub-provided hunk |
| `line` / `originalLine` / `side` | number/string \| null | position metadata |
| `commitId` | string \| null | |
| `htmlUrl` | string | permalink |

#### `ReviewEpisode`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | stable hash |
| `repo` | string | `owner/name` |
| `prNumber` | number | |
| `commentId` | string | |
| `path` | string | |
| `language` | string \| null | inferred from extension |
| `commentBody` | string | |
| `rejected` | `CodeSpan` | |
| `accepted` | `CodeSpan` \| null | |
| `linkConfidence` | `high` \| `medium` \| `low` \| `none` | |
| `linkReason` | string | machine reason code |
| `actionable` | boolean | |
| `discardReason` | string \| null | if not actionable |
| `reviewer` | string \| null | |
| `mergedAt` | iso datetime | |

#### `CodeSpan`

| Field | Type | Notes |
| --- | --- | --- |
| `path` | string | |
| `startLine` | number | 1-based |
| `endLine` | number | |
| `sha` | string | blob/commit identity |
| `text` | string | exact slice |
| `normalized` | string | clustering form |

#### `RewriteRecipe`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `repo` | string | |
| `title` | string | short intent |
| `rationale` | string | one sentence |
| `scope` | `RecipeScope` | path prefixes, languages |
| `before` | string | representative rejected template |
| `after` | string | representative accepted template |
| `beforeSignals` | string[] | substrings / normalized tokens for match |
| `support` | number | episode count |
| `episodeIds` | string[] | |
| `reviewers` | string[] | distinct |
| `avgLinkConfidence` | number | 0–1 |
| `suppressed` | boolean | |
| `createdAt` / `updatedAt` | iso datetime | |
| `compileRunId` | string | |

#### `RecipeScope`

```ts
type RecipeScope = {
  pathPrefixes: string[];
  languages: string[];
  // optional future: symbols, package names
};
```

#### `GraftSuggestion`

| Field | Type | Notes |
| --- | --- | --- |
| `recipeId` | string | |
| `rank` | number | |
| `score` | number | |
| `matchPath` | string | |
| `matchRange` | `{ startLine; endLine }` \| null | |
| `patch` | string | unified diff snippet |
| `title` | string | |
| `rationale` | string | |
| `support` | number | |
| `confidence` | `high` \| `medium` \| `low` | |
| `evidence` | `{ prNumber; commentUrl; episodeId }[]` | |

### 6.2 Artifact layout (file mode)

```
data/
  repos/acme/widgets/
    config.json
    cursors.json              # ingest/compile watermarks
    raw/
      prs/<number>.json
      comments/<commentId>.json
      blobs/<sha>.txt
    episodes/
      <episodeId>.json
      index.json
    recipes/
      <recipeId>.json
      index.json
    suppressions.json
    compile-meta.json
```

### 6.3 Postgres schema (logical)

Tables mirror entities: `pull_requests`, `review_comments`, `episodes`, `recipes`, `recipe_episodes`, `suppressions`, `cursors`.  
Prisma (or equivalent) models live in `packages/api-server` or `packages/shared/db`. File mode remains the MVP default so demos work without Docker.

---

## 7. Pipeline stages

### 7.1 Ingestion (`packages/ingestion`)

**Input:** `GRAFT_REPO`, token, backfill config  
**Output:** raw PR + comment + blob artifacts; updated ingest cursor

**Algorithm**
1. List merged PRs (newest first or since cursor) up to `maxPrs`.
2. For each PR, fetch review comments (inline) and issue comments if needed (inline preferred).
3. Persist comment metadata + `diffHunk`.
4. Fetch file contents at merge commit for commented paths (blob store by sha).
5. Write cursor `{ lastMergedAt, lastPrNumber }`.

**Requirements**
- Idempotent writes (same id overwrites immutably-equivalent payload)
- Retry with backoff on 403/502 rate limits
- Skip drafts / unmerged
- Log counts: prs, comments, blobs

### 7.2 Linking (`packages/linking`)

**Input:** raw artifacts  
**Output:** `ReviewEpisode` records

**Actionability filter (deterministic)**
Discard or mark non-actionable when body matches:
- Thanks / LGTM / nit emoji-only
- Length below threshold without code fence
- Bot authors (configurable list)

**Rejected span extraction**
1. Prefer GitHub line + side + path against commit blob.  
2. Else parse `diffHunk` for the right-side lines.  
3. Else mark `linkConfidence: none`.

**Accepted fix heuristics (ordered)**
1. Same path; lines overlapping ± window between comment commit and merge tip; prefer smallest non-empty change.  
2. Same path; reviewer suggestion block (` ```suggestion ` ) if present — treat as strong accepted candidate.  
3. File-level change with no line overlap → `low` confidence.  
4. No change on path → `accepted: null`, `linkConfidence: none`.

**Confidence rules**

| Condition | Confidence |
| --- | --- |
| Suggestion block applied or exact span replacement | `high` |
| Overlapping line change + lexical overlap with comment keywords | `medium` |
| Same-file change only | `low` |
| No candidate | `none` |

**Optional LLM validation** (if `GRAFT_LLM_ENABLED`)
- Prompt: comment + rejected + accepted → `{ addresses: boolean, rationale }`  
- May upgrade `medium`→`high` or downgrade to `low`  
- Must not create episodes from scratch  
- On failure, keep deterministic result

### 7.3 Compile (`packages/compile`)

**Input:** actionable episodes with `accepted != null` and confidence ∈ {`high`,`medium`} (include `low` only if config allows)  
**Output:** `RewriteRecipe[]`

**Normalization for clustering**
- Strip leading/trailing whitespace per line
- Collapse runs of whitespace
- Optionally mask string literals and numeric literals
- Optionally mask identifiers that look like locals (heuristic) — keep API names

**Clustering**
1. Bucket by `(language, top-level path segment or configured prefix)`.  
2. Within bucket, similarity on `(normalized rejected, normalized accepted)` using token Jaccard + length ratio.  
3. Greedy cluster merge above threshold.  
4. Cluster exemplar = medoid by similarity to others.  
5. `support = cluster.size`; drop if `< minSupport` (unless single high-confidence experimental flag).  
6. Generate `title` / `rationale`: deterministic heuristic from comment TF keywords; optional LLM paraphrase.  
7. Derive `beforeSignals` as distinctive rejected substrings (≥ N chars, not only punctuation).

**Suppressions**
- `suppressions.json` / table filters recipes at serve time and compile time.

### 7.4 Retrieval (`packages/retrieval`)

**Queries**
- `listRecipes({ path?, language?, q?, limit })`
- `suggestGrafts({ diff | files[], pathHint?, limit })`
- `explainRecipe(id)`

**Diff matching**
1. Parse unified diff into file hunks.  
2. For each hunk, test recipe `beforeSignals` and normalized before similarity.  
3. Require path scope match (prefix).  
4. Score:

```
score =
  0.35 * supportNorm +
  0.25 * linkConfidenceNorm +
  0.20 * pathSpecificity +
  0.10 * recency +
  0.10 * signalMatchStrength
```

5. Build unified patch from recipe `after` aligned to matched lines when possible; else return before/after block with apply instructions.  
6. Hard filter: `suppressed`, missing evidence, `support < min` (runtime config).

**Payload budget**
- Default list: ≤ 8 recipes, truncated code slices (e.g. 40 lines max each)  
- `explain_recipe` returns full evidence set

### 7.5 Freshness (`packages/pipeline`)

Track:
- `ingestWatermark`
- `linkWatermark`
- `compileWatermark`

`freshness` tool reports whether suggest/list are stale relative to ingest.

---

## 8. MCP server

### 8.1 Transport

- MVP: stdio MCP server  
- P1: optional HTTP/SSE for remote agents

### 8.2 Tools

#### `list_recipes`

```ts
input: {
  path?: string;
  language?: string;
  query?: string;
  limit?: number; // default 8, max 20
}
output: {
  recipes: Array<{
    id: string;
    title: string;
    rationale: string;
    before: string;
    after: string;
    support: number;
    confidence: "high" | "medium" | "low";
    pathPrefixes: string[];
    evidenceCount: number;
  }>;
  freshness: Freshness;
}
```

#### `suggest_grafts`

```ts
input: {
  diff?: string;          // unified diff
  code?: string;          // single-file contents
  path?: string;          // required if code
  limit?: number;
}
output: {
  suggestions: GraftSuggestion[];
  freshness: Freshness;
}
```

#### `explain_recipe`

```ts
input: { recipeId: string }
output: {
  recipe: RewriteRecipe;
  episodes: Array<{
    id: string;
    prNumber: number;
    commentUrl: string;
    commentBody: string;
    rejected: string;
    accepted: string | null;
    linkConfidence: string;
  }>;
}
```

#### `apply_preview` (P1)

```ts
input: { suggestionId | { recipeId, path, startLine, endLine } }
output: { unifiedDiff: string; warnings: string[] }
```

#### `freshness` (P1)

```ts
output: {
  ingestAt: string | null;
  compileAt: string | null;
  episodes: number;
  recipes: number;
  stale: boolean;
}
```

### 8.3 Error codes

| Code | Meaning |
| --- | --- |
| `GRAFT_NO_DATA` | Repo not ingested |
| `GRAFT_STALE` | Warning only; still returns data |
| `GRAFT_NOT_FOUND` | Unknown recipe id |
| `GRAFT_INVALID_DIFF` | Diff parse failure |
| `GRAFT_BUDGET` | Truncation applied |

---

## 9. CLI

```bash
graft ingest <owner/repo> [--max-prs 200]
graft link [--repo owner/repo]
graft compile [--repo owner/repo]
graft suggest [--diff file|-] [--staged]
graft recipes list [--path pkg/api]
graft recipes explain <id>
graft recipes suppress <id>
graft serve mcp
graft serve api          # P1
```

Exit codes: `0` ok, `1` usage/error, `2` no data, `3` GitHub/auth failure.

---

## 10. HTTP / GraphQL API (P1)

### 10.1 Responsibilities

- Feed VS Code extension and dashboard  
- Read recipes/episodes; mutate suppressions  
- Health + freshness

### 10.2 Example GraphQL types

```graphql
type Recipe {
  id: ID!
  title: String!
  rationale: String!
  before: String!
  after: String!
  support: Int!
  confidence: Confidence!
  pathPrefixes: [String!]!
  suppressed: Boolean!
  evidence: [Evidence!]!
}

type Query {
  recipes(path: String, limit: Int): [Recipe!]!
  recipe(id: ID!): Recipe
  suggestGrafts(diff: String, path: String, code: String): [Suggestion!]!
  freshness: Freshness!
}

type Mutation {
  suppressRecipe(id: ID!, suppressed: Boolean!): Recipe!
}
```

Auth for local demo: none or shared bearer token in `.env`.

---

## 11. VS Code extension (P1)

| Feature | Behavior |
| --- | --- |
| Code Action | On selection/hunk: “Graft: preview historical accept” |
| Apply | Apply workspace edit from `apply_preview` |
| Diagnostic (P2) | Info-level soft warning when high-support recipe matches |
| Sync (P2) | Background ingest for open workspace remote |

Uses local API or invokes CLI/retrieval library via Node.

---

## 12. Dashboard (P2)

Read-only Next.js app:
- Recipe table: title, support, path, confidence
- Detail: before/after, evidence list
- Suppress toggle

No analytics vanity charts required for v1.

---

## 13. Security and privacy

| Requirement | Implementation |
| --- | --- |
| Repo scope | All paths keyed by `owner/repo`; refuse cross-repo reads |
| Secret redaction | Heuristic scrubber on persist (`AWS…`, `ghp_…`, private keys) |
| LLM opt-in | Disabled unless keys + `GRAFT_LLM_ENABLED=true` |
| Token storage | Env / OS secret store; never write tokens into `data/` |
| Purge | `graft purge --repo` deletes artifact tree / DB rows |
| Patch apply | No automatic write from MCP; preview only unless editor user confirms |

---

## 14. Performance budgets

| Operation | Budget |
| --- | --- |
| Ingest 200 PRs | < 20 minutes typical (rate-limit dependent) |
| Link + compile 200 PRs | < 5 minutes CPU-bound on laptop |
| `list_recipes` | < 200ms local file index |
| `suggest_grafts` on mid-size diff | < 1s |
| MCP payload | < 32KB default response |

Indexes: in-memory recipe index loaded at process start; reload on compile watermark change.

---

## 15. Observability

- Structured JSON logs: `stage`, `repo`, `counts`, `durationMs`, `errorCode`
- Compile meta: cluster thresholds, drop reasons histogram
- No PII beyond GitHub usernames already in PR data

---

## 16. Testing strategy

| Layer | What |
| --- | --- |
| Unit | normalization, confidence rules, diff parse, scoring |
| Golden | fixture PR comment → episode → recipe snapshots |
| Integration | ingest against recorded HTTP fixtures (no live network in CI) |
| MCP | tool schema validation + sample invocations |
| Manual | demo script on a fixed public repo |

**Behavioral acceptance (critical):** for a golden episode, `suggest_grafts` on the rejected text must surface the recipe whose `after` matches the accepted fix; running on the accepted text must not suggest the same rewrite.

---

## 17. Build, run, quality gates

```bash
npm install
cp .env.example .env
npm run build
npm run typecheck
npm run test
npm run graft -- ingest owner/repo
npm run graft -- link
npm run graft -- compile
npm run graft -- serve mcp
```

CI: typecheck + unit/golden tests on PR.  
Node version pinned via `.nvmrc` (22+).

---

## 18. MVP implementation order

1. `@graft/shared` types + zod schemas  
2. `ingestion` + CLI `ingest`  
3. `linking` + CLI `link`  
4. `compile` + CLI `compile`  
5. `retrieval` + CLI `suggest`  
6. `mcp-server` tools (`list_recipes`, `suggest_grafts`, `explain_recipe`)  
7. Demo fixtures + docs walkthrough  
8. (P1) api-server + vscode Code Action  
9. (P2) dashboard + soft diagnostics + webhook

---

## 19. Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | Deterministic pipeline runnable with zero LLM keys |
| NFR-2 | Idempotent stage re-runs |
| NFR-3 | All served suggestions include evidence pointers |
| NFR-4 | Type-safe boundaries via zod parse at artifact read |
| NFR-5 | Graceful degradation when GitHub or LLM is unavailable |
| NFR-6 | Clear stale-data signaling to clients |

---

## 20. Open technical decisions

| Decision | Options | Recommendation |
| --- | --- | --- |
| Default store | Files vs Postgres | Files for MVP; Postgres interface behind repo port |
| Clustering | Embeddings vs lexical | Lexical Jaccard first; embeddings optional later |
| Diff apply alignment | Exact line replace vs fuzzy | Exact when spans align; else show manual before/after |
| MCP transport | stdio only vs +HTTP | stdio first |
| Monorepo tooling | npm vs pnpm/turbo | npm workspaces for simplicity |

---

## 21. Out of scope (technical)

- Custom model training / adapters  
- Cross-company shared recipe marketplace  
- Automatic PR posting as a bot reviewer  
- Language-specific full AST rewrite engines (may be explored later per language)  
- Real-time collaborative multi-user editing of recipes

---

## 22. Traceability (PRD → TRD)

| PRD area | TRD section |
| --- | --- |
| Ingestion (ING-*) | §7.1 |
| Linking (LNK-*) | §7.2 |
| Recipes (RCP-*) | §7.3 |
| Retrieval (RET-*) | §7.4 |
| MCP (MCP-*) | §8 |
| CLI / editor / web (DEV-*) | §9–12 |
| Safety (SAF-*) | §13 |
| MVP scope | §18 |
