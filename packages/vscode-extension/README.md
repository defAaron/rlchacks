# Graft — VS Code / Cursor extension

Preview and apply historical code-review grafts from the Graft API inside the editor.

## Prerequisites

1. **Node.js ≥ 22** and a built monorepo (`npm install` at repo root).
2. **Graft API server** running locally (default port **8787**):

   ```bash
   # From repo root — set repo + data dir for your linked corpus
   export GRAFT_REPO=owner/name
   export DATA_DIR=./data
   npm run build
   npm run graft -- serve api --repo owner/name --port 8787
   ```

3. Corpus must already be ingested / linked / compiled (`graft ingest` → `graft link` → `graft compile`), or suggestions will fail with a no-data / no-recipes message.

## Install / run

### Option A — F5 (Extension Development Host)

1. Open this repository root in Cursor or VS Code.
2. Press **F5** (or Run → Start Debugging → **Extension: Graft**).
   - A preLaunch task builds `packages/vscode-extension` first.
3. In the new Extension Development Host window, open a workspace file and use the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).

If F5 configs are missing (`.vscode/` may be gitignored in this repo), copy or recreate `.vscode/launch.json` and `.vscode/tasks.json` from the Graft checkout, or build then use Option B / C.

### Option B — Install from VSIX

```bash
cd packages/vscode-extension
npm run build
npm run package
```

This writes `graft-graft-vscode-<version>.vsix` in the package directory.

- **VS Code / Cursor:** Extensions view → `⋯` → **Install from VSIX…** → select the `.vsix`.
- Or CLI: `code --install-extension graft-graft-vscode-*.vsix` (or `cursor --install-extension …`).

### Option C — Install Extension from Location

1. Build: `npm run build -w graft-vscode` (from repo root).
2. Extensions view → `⋯` → **Install from Location…** (wording varies by editor).
3. Choose `packages/vscode-extension` (folder containing `package.json` with `"main": "./dist/extension.js"`).

Reload the window after installing.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `graft.apiBaseUrl` | `http://127.0.0.1:8787` | Graft GraphQL API base URL |
| `graft.repo` | `""` | Repo slug `owner/name` (workspace hint if empty) |
| `graft.apiToken` | `""` | Bearer token when API runs with `API_TOKEN` |
| `graft.diagnosticsOnSave` | `true` | Soft info diagnostics for high-support recipes on save |
| `graft.diagnosticsMinSupport` | `2` | Minimum support count for save diagnostics |

Open Settings UI and search **Graft**, or edit `settings.json`.

## Commands

| Command Palette title | ID |
| --- | --- |
| Graft: Suggest for current diff/selection | `graft.suggest` |
| Graft: Preview historical accept | `graft.previewSuggestion` |
| Graft: Apply previewed graft | `graft.applyPreview` |

Also available as a Code Action: **Graft: preview historical accept** (Refactor).

Typical flow: open a file → select code (or use whole file) → **Graft: Suggest…** → pick a suggestion (confidence + support shown) → preview → confirm **Apply**.

## Degraded-state messages / CTAs

| Situation | What you see | Recovery |
| --- | --- | --- |
| API down / connection refused | “Graft API server not reachable. Start with: `graft serve api`” | Start the API (see Prerequisites) |
| No data for repo | “No Graft data… Run `graft ingest` → `link` → `compile`, or check `graft.repo` / API server.” | Fix `graft.repo` / `GRAFT_REPO`, then ingest → link → compile |
| No compiled recipes | “No compiled recipes — run `graft compile`” | Run compile against `DATA_DIR` |
| Stale data | Warning with **Continue anyway** / **Dismiss** | Re-ingest/compile, or continue consciously |
| No matching suggestions | Info: no matching historical accepts | Try another selection/path or enrich the corpus |
| Nothing to apply | “nothing to apply — run preview first” | Run suggest/preview before apply |

Confidence labels are always shown in the suggestion picker and preview card (SAF-4).

## Develop

```bash
npm run build -w graft-vscode
npm run typecheck -w graft-vscode
npm run package -w graft-vscode   # after build; needs @vscode/vsce
```

Publisher is set to `graft` for local/private packaging only — this package is `"private": true` and is not published to the Marketplace by default.
