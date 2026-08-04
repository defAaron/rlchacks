/**
 * Graft VS Code / Cursor extension (Phase 7.2–7.4 / DEV-2).
 */

import * as vscode from "vscode";
import { GraftApiClient, type GraftSuggestion } from "./apiClient";
import { parseUnifiedDiffHunk, showPreviewDiff } from "./preview";

let lastPreview: {
  suggestion: GraftSuggestion;
  unifiedDiff: string;
  warnings: string[];
} | null = null;

function getClient(): GraftApiClient {
  const config = vscode.workspace.getConfiguration("graft");
  const baseUrl = config.get<string>("apiBaseUrl", "http://127.0.0.1:8787");
  const token = config.get<string>("apiToken", "");
  return new GraftApiClient(baseUrl, token);
}

function degradedMessage(err: unknown): string {
  const code =
    err !== null && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : undefined;
  if (code === "GRAFT_NO_DATA") {
    return "No Graft data for this repo. Run graft ingest → link → compile, or check graft.repo / API server.";
  }
  if (err instanceof Error && /fetch|ECONNREFUSED|unreachable/i.test(err.message)) {
    return "Graft API server not reachable. Start with: graft serve api";
  }
  return err instanceof Error ? err.message : String(err);
}

async function ensureFreshness(client: GraftApiClient): Promise<void> {
  const fresh = await client.freshness();
  if (fresh.stale) {
    const reason = fresh.reason ?? "Data may be stale";
    const choice = await vscode.window.showWarningMessage(
      `Graft: ${reason}`,
      "Continue anyway",
      "Dismiss",
    );
    if (choice !== "Continue anyway") {
      throw new Error("Cancelled due to stale Graft data");
    }
  }
  if (fresh.recipes === 0) {
    throw new Error("No compiled recipes — run graft compile");
  }
}

async function pickSuggestion(
  suggestions: GraftSuggestion[],
): Promise<GraftSuggestion | undefined> {
  if (suggestions.length === 0) {
    await vscode.window.showInformationMessage(
      "Graft: no matching historical accepts for this selection.",
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    suggestions.map((s) => ({
      label: `${s.title} (${s.confidence} · support ${s.support})`,
      description: s.matchPath,
      detail: `${s.rationale} — evidence: ${s.evidence[0]?.commentUrl ?? "n/a"}`,
      suggestion: s,
    })),
    { placeHolder: "Select a Graft suggestion" },
  );
  return picked?.suggestion;
}

async function suggestForEditor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    await vscode.window.showErrorMessage("Graft: open a file to suggest grafts.");
    return;
  }

  const client = getClient();
  try {
    await client.health();
    await ensureFreshness(client);
  } catch (err) {
    await vscode.window.showErrorMessage(`Graft: ${degradedMessage(err)}`);
    return;
  }

  const selection = editor.selection;
  const code = editor.document.getText(
    selection.isEmpty ? undefined : selection,
  );
  const path = vscode.workspace.asRelativePath(editor.document.uri);

  let suggestions: GraftSuggestion[];
  try {
    suggestions = await client.suggestGrafts({ code, path, limit: 8 });
  } catch (err) {
    await vscode.window.showErrorMessage(`Graft: ${degradedMessage(err)}`);
    return;
  }

  const picked = await pickSuggestion(suggestions);
  if (picked === undefined) {
    return;
  }

  await previewSuggestion(picked);
}

async function previewSuggestion(suggestion: GraftSuggestion): Promise<void> {
  const client = getClient();
  let preview;
  try {
    preview = await client.applyPreview({
      recipeId: suggestion.recipeId,
      path: suggestion.matchPath,
    });
  } catch (err) {
    await vscode.window.showErrorMessage(`Graft preview failed: ${degradedMessage(err)}`);
    return;
  }

  lastPreview = {
    suggestion,
    unifiedDiff: preview.unifiedDiff,
    warnings: preview.warnings,
  };

  const warningText =
    preview.warnings.length > 0
      ? `\n\nWarnings:\n- ${preview.warnings.join("\n- ")}`
      : "";

  const card = [
    `# ${preview.title}`,
    `Confidence: ${suggestion.confidence} · Support: ${suggestion.support}`,
    "",
    "## Why",
    preview.rationale,
    "",
    "## Evidence",
    ...suggestion.evidence.map(
      (e) => `- PR #${e.prNumber}: ${e.commentUrl}`,
    ),
    warningText,
    "",
    "## Unified diff (preview only — apply explicitly)",
    preview.unifiedDiff,
  ].join("\n");

  await showPreviewDiff(preview.title, card);

  const apply = await vscode.window.showInformationMessage(
    `Preview ready: ${preview.title} (${suggestion.confidence})`,
    "Apply graft",
    "Cancel",
  );
  if (apply === "Apply graft") {
    await applyLastPreview();
  }
}

async function applyLastPreview(): Promise<void> {
  if (lastPreview === null) {
    await vscode.window.showErrorMessage("Graft: nothing to apply — run preview first.");
    return;
  }

  const edit = parseUnifiedDiffHunk(
    lastPreview.unifiedDiff,
    lastPreview.suggestion.matchPath,
  );
  if (edit === null) {
    await vscode.window.showWarningMessage(
      "Graft: could not parse aligned hunk — apply manually from preview diff.",
    );
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    "Apply Graft preview to workspace? This writes files explicitly.",
    { modal: true },
    "Apply",
    "Cancel",
  );
  if (confirmed !== "Apply") {
    return;
  }

  const ok = await vscode.workspace.applyEdit(edit);
  if (ok) {
    await vscode.window.showInformationMessage("Graft: applied preview to workspace.");
  } else {
    await vscode.window.showErrorMessage("Graft: workspace edit failed.");
  }
}

class GraftCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    const action = new vscode.CodeAction(
      "Graft: preview historical accept",
      vscode.CodeActionKind.RefactorRewrite,
    );
    action.command = {
      command: "graft.suggest",
      title: "Graft: preview historical accept",
    };
    action.isPreferred = false;
    action.diagnostics = [];
    return [action];
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("graft.suggest", () => {
      void suggestForEditor();
    }),
    vscode.commands.registerCommand("graft.previewSuggestion", () => {
      void suggestForEditor();
    }),
    vscode.commands.registerCommand("graft.applyPreview", () => {
      void applyLastPreview();
    }),
    vscode.languages.registerCodeActionsProvider(
      [{ scheme: "file" }],
      new GraftCodeActionProvider(),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite],
      },
    ),
  );
}

export function deactivate(): void {
  lastPreview = null;
}
