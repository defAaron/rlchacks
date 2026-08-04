# Graft — VS Code / Cursor extension

Human path for the editor surface (DEV-2). The extension talks to a local Graft API (`graft serve api`); it never invents recipes on its own.

Canonical package: `packages/vscode-extension/` (`graft-vscode`).

## Prerequisites

1. Build the monorepo (includes the extension `dist/`):

```bash
npm install
npm run build
```

2. Have compiled recipes under `DATA_DIR` (offline fixtures or live ingest — see root [README](../README.md) **Clean machine**).

3. Start the API (leave running):

```bash
export GRAFT_REPO=acme/widgets   # or owner/name from live ingest
export DATA_DIR=./data
export GRAFT_LLM_ENABLED=false
# Fixture recipes often need: export GRAFT_MIN_SUPPORT=1
npm run graft -- serve api --repo "$GRAFT_REPO"
```

Default listen: `http://127.0.0.1:8787`. Details: [API.md](API.md). One-shot fixture smoke before a long-lived server: `./scripts/demo-api.sh`.

## Settings

In Cursor / VS Code: **Settings → Extensions → Graft**, or workspace `.vscode/settings.json`:

| Setting | Default | Purpose |
| --- | --- | --- |
| `graft.apiBaseUrl` | `http://127.0.0.1:8787` | GraphQL API base (`graft serve api`) |
| `graft.apiToken` | `""` | Bearer token when server has `API_TOKEN` set |
| `graft.repo` | `""` | Repo slug hint (`owner/name`); keep aligned with the API’s `GRAFT_REPO` |
| `graft.diagnosticsOnSave` | `true` | Soft info diagnostics when high-support recipes match on save |
| `graft.diagnosticsMinSupport` | `2` | Minimum recipe support for those save hints |

Repo scope is enforced by the API process (`GRAFT_REPO` / `--repo`). Point `graft.apiBaseUrl` at that server.

## Load the extension

Build first so `packages/vscode-extension/dist/extension.js` exists.

**Install from location** (typical day-to-day):

1. Command Palette → **Extensions: Install from Location…**
2. Select `packages/vscode-extension/`
3. Reload the window if prompted

**Extension Development Host (F5):**

1. Open this repo (or the `packages/vscode-extension` folder) in VS Code / Cursor
2. Run **Debug: Start Debugging** / **F5** with an “Extension Development Host” launch that points at `packages/vscode-extension` (add a `launch.json` locally if none is present)
3. Exercise Graft commands in the new Host window

**VSIX (optional):**

```bash
cd packages/vscode-extension
npx @vscode/vsce package --no-dependencies
# then: Extensions → Install from VSIX…
```

## Suggest → Preview → Apply

Open a file whose path/content can match a compiled recipe (fixture example: patterns around `src/types` / the rejected-types style from `testdata/fixtures/rejected-types.diff`).

1. **Suggest** — Command Palette → **Graft: Suggest for current diff/selection**  
   - Uses selection if non-empty; otherwise the whole file  
   - Also available as Code Action **Graft: preview historical accept**  
   - Quick pick labels include **confidence** and **support** (SAF-4), plus evidence URL in the detail line

2. **Preview** — After picking a suggestion, Graft opens a preview document with title, confidence, support, rationale, evidence links, and a unified diff  
   - Preview does **not** write the workspace

3. **Apply** — Confirm **Apply graft**, then the modal **Apply**  
   - Or later: **Graft: Apply previewed graft** (requires a prior preview)  
   - Writes only after that explicit confirm — never on suggest/preview alone

## Confidence labels (SAF-4)

Every suggestion surface shows recipe `confidence` (`high` | `medium` | `low`) with support:

- Quick pick: `Title (confidence · support N)`
- Preview card: `Confidence: … · Support: …`
- Save diagnostics (when enabled): message includes support and confidence; **low** confidence is excluded from default save hints

## Degraded states

| Condition | What you see | Recovery |
| --- | --- | --- |
| API down / connection refused | “Graft API server not reachable. Start with: `graft serve api`” | Start API; check `graft.apiBaseUrl` |
| `GRAFT_NO_DATA` | No Graft data for this repo | `ingest → link → compile`, or fix `GRAFT_REPO` / data dir |
| Stale data | Warning with **Continue anyway** / **Dismiss** | Re-ingest/compile, or continue knowingly |
| Zero recipes | “No compiled recipes — run graft compile” | `graft compile` |
| No matches | “no matching historical accepts for this selection” | Different file/selection, or lower barriers / more data |
| Apply without preview | “nothing to apply — run preview first” | Run Suggest/Preview first |
| Unaligned hunk | Warning to apply manually from preview diff | Copy from preview; do not force silent write |

Auth failures when `API_TOKEN` is set: configure `graft.apiToken` to match.

## Safety

- **No silent apply** — workspace writes only after preview + explicit confirmation
- **Soft-only** — save diagnostics are info-level and never block save
- **Evidence** — suggestion detail / preview include GitHub comment URLs when present
- **LLM off by default** — keep `GRAFT_LLM_ENABLED=false` unless you intentionally enable it server-side

## Related

- [API.md](API.md) — `serve api`, GraphQL, `/dashboard`
- [MCP.md](MCP.md) — agent tools (also no silent file writes)
- Root [README](../README.md) — clean-machine runbook for all surfaces
