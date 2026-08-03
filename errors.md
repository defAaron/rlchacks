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

_None yet._

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

Next id: **E-001**
