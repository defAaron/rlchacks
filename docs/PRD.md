# Graft — Product Requirements Document

**Product name:** Graft  
**Tagline:** Historical accepted rewrites, ready to apply  
**Document type:** PRD  
**Status:** Draft v1  
**Last updated:** 2026-08-03

---

## 1. Overview

### 1.1 Problem

Engineering teams repeatedly rediscover the same review outcomes. A reviewer rejects a pattern, the author lands an accepted fix, and that knowledge evaporates once the PR merges. The next contributor — human or coding agent — makes a similar mistake, burns another review cycle, and the loop continues.

Static style guides and linters only capture what someone bothered to write down. The richest signal — **what code had to become to get merged** — lives as unstructured history in pull request threads and never becomes reusable guidance.

### 1.2 Solution

**Graft** turns merged pull request history into **rewrite recipes**: paired evidence of rejected code, the review feedback that blocked it, and the accepted code that eventually shipped. Coding agents and developers query Graft before (or while) writing changes and receive **concrete, evidence-backed patches** they can apply — not abstract rules.

### 1.3 Product thesis

> Remember what code had to become to get merged, and graft that rewrite onto the next change.

### 1.4 Non-goals (v1)

- Organization-wide “convention” catalogs as the primary UX
- Hard pre-commit blockers that fail commits by default
- Replacing human code review
- Training or shipping a proprietary foundation model as the product identity
- Multi-tenant SaaS billing, SSO, or enterprise admin consoles
- Automatic silent rewriting of user code without explicit apply

---

## 2. Goals and success metrics

### 2.1 Goals

| Priority | Goal |
| --- | --- |
| P0 | Ingest merged PR review history for a single repository |
| P0 | Link review comments to rejected hunks and likely accepted fixes |
| P0 | Cluster evidence into rewrite recipes with support counts |
| P0 | Expose recipes to coding agents via MCP tools |
| P1 | Let developers browse recipes and apply suggested patches in the editor |
| P1 | Suggest rewrites against a local or proposed diff |
| P2 | Soft warnings on save/stage when a high-support recipe matches |
| P2 | Lightweight web view of recipes and evidence |

### 2.2 Success metrics

| Metric | Definition | Target (hackathon / early) |
| --- | --- | --- |
| Recipe yield | % of ingested review comments that produce a usable recipe candidate | ≥ 15% after filtering noise |
| Link precision (spot check) | Human-judged “accepted fix actually addresses the comment” | ≥ 70% on sampled links |
| Agent usefulness | Agent applies or cites a Graft suggestion in a task | Qualitative demo win |
| False-positive rate | Soft matches that developers dismiss as irrelevant | Track; prefer under-suggesting |
| Time-to-first-recipe | Empty repo → first browsable recipe | < 30 minutes for a mid-size public repo |

### 2.3 Anti-metrics

- Volume of recipes alone (noise is worse than silence)
- Aggressive blocking that trains users to ignore Graft

---

## 3. Users and personas

### 3.1 Primary: Coding agent operator

Uses Cursor, Claude Code, or similar. Wants the agent to produce diffs that already look like what this repo has historically accepted.

**Jobs to be done**
- Before generating code: “What rewrites has this path historically required?”
- After drafting a diff: “Which hunks look like past rejections, and what was the accepted fix?”

### 3.2 Primary: Individual contributor

Writes code in VS Code / Cursor. Remembers being told the same thing across PRs.

**Jobs to be done**
- See a suggested patch with links to prior PRs
- Apply a rewrite without re-deriving the fix from scratch
- Browse “what this folder usually becomes after review”

### 3.3 Secondary: Tech lead / reviewer

Wants fewer repeat comments and a shared, evidence-backed memory of accepted outcomes.

**Jobs to be done**
- See which rewrite patterns recur most often
- Spot-check that Graft’s links are trustworthy
- Suppress bad recipes

---

## 4. Product principles

1. **Patches over prose** — Prefer a before/after rewrite over a natural-language rule.
2. **Evidence or silence** — Every suggestion cites PR(s), comment(s), and code. No citation → no suggestion.
3. **Apply is explicit** — Graft proposes; humans/agents choose to apply.
4. **Under-suggest** — False positives destroy trust faster than missed matches.
5. **Weak links stay weak** — Ambiguous accepted-fix linkage is labeled, never presented as certain.
6. **Works without LLM keys** — Deterministic linking and matching are the baseline; LLMs are optional enrichment.
7. **Local-first, repo-scoped** — v1 is one repository (or a small allowlist), not a global knowledge graph.

---

## 5. Core concepts

| Concept | Definition |
| --- | --- |
| **Review episode** | One review comment (or thread) plus the code context it targets and any linked post-review change |
| **Rejected hunk** | Code span associated with the reviewer’s objection |
| **Accepted fix** | Nearby change in the eventually merged commit that appears to address the comment |
| **Rewrite recipe** | Clustered pattern: trigger context + before template + after template + evidence set + support score |
| **Graft suggestion** | A concrete patch proposed against a working tree or diff, backed by one or more recipes |
| **Link confidence** | How strongly Graft believes the accepted fix answers that comment (`high` / `medium` / `low`) |

---

## 6. User journeys

### 6.1 First-time setup (operator)

1. Provide GitHub auth with read access to the target repo.
2. Run ingest for merged PRs (backfill window configurable).
3. Run recipe compilation.
4. Start MCP server (and optionally API + editor extension).
5. Open a file or ask an agent: Graft returns ranked rewrite suggestions with evidence.

### 6.2 Agent pre-write check

1. Agent is about to edit `packages/api/src/routes/users.ts`.
2. Agent calls Graft MCP: recipes for that path / language / symbols.
3. Graft returns compact rewrite recipes (before/after + why + PR links).
4. Agent writes code that already reflects historical accepts.

### 6.3 Diff validation

1. Developer or agent has a proposed diff.
2. They call `suggest_grafts(diff)`.
3. Graft returns matched hunks with proposed patches and evidence.
4. User applies selected grafts or ignores low-confidence ones.

### 6.4 Editor apply

1. Developer edits a file that matches a high-support recipe.
2. Editor shows a Code Action / lightbulb: “Apply historical accept (3 PRs)”.
3. Preview diff → apply → optional deep link to evidence.

### 6.5 Recipe browser

1. Lead opens the web view.
2. Filters by path prefix, language, support count.
3. Inspects before/after and originating PRs.
4. Suppresses a bad recipe.

---

## 7. Functional requirements

### 7.1 Ingestion

| ID | Requirement | Priority |
| --- | --- | --- |
| ING-1 | Ingest merged PRs for a configured `owner/repo` | P0 |
| ING-2 | Capture review comments, inline positions, file paths, and diff hunks | P0 |
| ING-3 | Capture final merged commit tree / file snapshots needed for accepted-fix linking | P0 |
| ING-4 | Support incremental re-ingest (only new merged PRs since last cursor) | P1 |
| ING-5 | Optional webhook or background sync on merge for continuous update | P2 |
| ING-6 | Respect GitHub rate limits; resume after interruption | P0 |
| ING-7 | Store raw artifacts immutably for reprocessing | P0 |

### 7.2 Episode linking

| ID | Requirement | Priority |
| --- | --- | --- |
| LNK-1 | Associate each actionable comment with a rejected code span when position data exists | P0 |
| LNK-2 | Propose an accepted-fix span from post-comment commits / merge tip near the same locus | P0 |
| LNK-3 | Assign link confidence (`high` / `medium` / `low`) with an explicit reason code | P0 |
| LNK-4 | Drop or quarantine episodes that are pure praise, nit emoji, or non-actionable | P0 |
| LNK-5 | Optional LLM assist: “does this after-span address the comment?” — never sole authority | P1 |
| LNK-6 | Persist unresolved / low-confidence links for later improvement; do not promote them to recipes by default | P0 |

### 7.3 Recipe compilation

| ID | Requirement | Priority |
| --- | --- | --- |
| RCP-1 | Cluster similar rejected→accepted pairs into rewrite recipes | P0 |
| RCP-2 | Each recipe includes: scope (repo/path/lang), before, after, support count, evidence IDs | P0 |
| RCP-3 | Normalize whitespace/identifiers enough to cluster without erasing meaning | P0 |
| RCP-4 | Prefer recipes with ≥ N supporting episodes (configurable; default 2) | P0 |
| RCP-5 | Allow single-evidence recipes only when link confidence is `high` and marked experimental | P1 |
| RCP-6 | Recompile on demand when ingest is fresher than recipes | P0 |
| RCP-7 | Support suppress / unsuppress recipe by ID | P1 |

### 7.4 Retrieval and suggestion

| ID | Requirement | Priority |
| --- | --- | --- |
| RET-1 | Query recipes by path prefix, language, and optional symbol/context | P0 |
| RET-2 | Match a proposed diff or file contents against recipe before-signals | P0 |
| RET-3 | Return ranked Graft suggestions with patches + evidence links | P0 |
| RET-4 | Ranking uses support count, link confidence, path specificity, and recency | P0 |
| RET-5 | Never return a suggestion without at least one evidence pointer | P0 |
| RET-6 | Cap payload size for agent consumption (compact summaries + optional expand) | P0 |

### 7.5 Agent interface (MCP)

| ID | Requirement | Priority |
| --- | --- | --- |
| MCP-1 | Tool: `list_recipes` — recipes for a path / query | P0 |
| MCP-2 | Tool: `suggest_grafts` — match recipes to a diff or code snippet | P0 |
| MCP-3 | Tool: `explain_recipe` — full evidence for one recipe ID | P0 |
| MCP-4 | Tool: `apply_preview` — unified diff preview for a suggestion (no write) | P1 |
| MCP-5 | Tool: `freshness` — ingest vs compile staleness | P1 |
| MCP-6 | Document tool schemas and example agent prompts in product docs | P0 |

### 7.6 Developer surfaces

| ID | Requirement | Priority |
| --- | --- | --- |
| DEV-1 | CLI: ingest, compile, suggest against staged/working diff | P0 |
| DEV-2 | Editor extension: Code Action to preview/apply a graft | P1 |
| DEV-3 | Editor: soft diagnostic when a high-support recipe matches on save | P2 |
| DEV-4 | Web recipe browser (read-only + suppress) | P2 |
| DEV-5 | Optional GraphQL/HTTP API for extension and browser | P1 |

### 7.7 Trust, safety, privacy

| ID | Requirement | Priority |
| --- | --- | --- |
| SAF-1 | Scope data to configured repositories only | P0 |
| SAF-2 | Do not send private code to third-party LLMs unless user opts in with keys | P0 |
| SAF-3 | Redact secrets-looking strings from stored snippets where feasible | P1 |
| SAF-4 | Label low-confidence links in all UIs | P0 |
| SAF-5 | Provide delete/purge for a repo’s stored data | P1 |
| SAF-6 | Default soft suggestions; hard gate only if user explicitly enables | P0 |

---

## 8. UX requirements

### 8.1 Suggestion card (canonical unit)

Every Graft suggestion shown to a human or summarized for an agent must include:

1. **Title** — short rewrite intent (e.g., “Inline single-use helper”)
2. **Before / after** — focused code slices
3. **Why** — one sentence from or paraphrasing the review evidence
4. **Support** — “Seen in N PRs”
5. **Confidence** — recipe + link confidence
6. **Evidence links** — PR number + comment permalinks
7. **Actions** — Preview patch / Apply / Dismiss / Suppress recipe

### 8.2 Empty and degraded states

| State | UX |
| --- | --- |
| No ingest yet | Clear CTA to run ingest |
| Ingest done, no recipes | Explain filters; suggest widening backfill or lowering support threshold |
| LLM unavailable | Continue with deterministic path; badge “deterministic only” |
| Stale recipes | Banner: new PRs ingested since last compile |

### 8.3 Tone

Practical and terse. No gamification. No fake certainty.

---

## 9. Scope by release

### 9.1 MVP (hackathon / v0.1)

- Single-repo GitHub backfill
- Episode linking with confidence labels
- Recipe compile + local storage
- MCP tools: `list_recipes`, `suggest_grafts`, `explain_recipe`
- CLI for ingest / compile / suggest
- Minimal docs + demo script on a public repo

### 9.2 v0.2

- Editor Code Actions + apply preview
- HTTP/GraphQL API
- Recipe suppress
- Incremental ingest

### 9.3 v0.3

- Soft save/stage diagnostics
- Web recipe browser
- Merge webhook / background sync
- Secret redaction pass
- Multi-repo allowlist

---

## 10. Competitive positioning (category, not vendors)

| Approach | Limitation | Graft difference |
| --- | --- | --- |
| Linters / formatters | Only encode explicit rules | Learns accepted outcomes from history |
| Style guides | Drift and incomplete | Evidence-backed, path-scoped rewrites |
| Raw RAG over PR comments | Dumps prose; hard to apply | Returns patches grounded in accepted code |
| Generic AI review | Not repo-specific | Recipes tied to this repo’s merges |

---

## 11. Risks and open questions

| Risk / question | Mitigation |
| --- | --- |
| Accepted-fix linking is wrong | Confidence labels; under-promote low links; human suppress |
| Recipes overfit to one reviewer preference | Prefer multi-PR support; show reviewer diversity when available |
| Noisy nits become recipes | Actionability filter; minimum support threshold |
| Private code leakage to LLMs | Opt-in keys; deterministic default |
| Agents ignore tools | Keep payloads tiny; demo prompts; editor path as backup |
| Large monorepos | Path scoping; incremental ingest; compile budgets |

**Open questions**
1. Default support threshold: 2 vs 3?
2. Should single-reviewer recipes be visually distinct?
3. How aggressively to normalize identifiers for clustering?
4. First editor target: VS Code/Cursor only, or CLI-first demo?

---

## 12. Launch / demo criteria

A successful demo of Graft shows:

1. Ingest of a real public repository’s merged PR reviews.
2. At least several high-quality rewrite recipes with clickable evidence.
3. An agent (via MCP) receiving a graft suggestion on a seeded “bad” diff.
4. Applying or displaying the before→after patch that matches historical accepts.
5. A low-confidence example correctly labeled and not over-sold.

---

## 13. Glossary

| Term | Meaning |
| --- | --- |
| Graft | Product name; also a suggested applyable rewrite |
| Recipe | Reusable clustered rewrite pattern |
| Episode | Single review-linked evidence unit |
| Support | Number of episodes backing a recipe |
| Compile | Process that turns episodes into recipes |

---

## 14. Document owners

| Role | Responsibility |
| --- | --- |
| Product | Prioritize journeys, metrics, non-goals |
| Engineering | Feasibility, TRD alignment, MVP cuts |
| Design | Suggestion card, empty states, apply flow |
