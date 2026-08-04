/**
 * Soft save diagnostics (Phase 8.1 / DEV-3, SAF-6).
 * Info-level hints when high-support recipes match — never block save.
 */

import * as vscode from "vscode";
import { GraftApiClient, type GraftSuggestion } from "./apiClient";

const DIAGNOSTIC_SOURCE = "graft";

export class GraftSaveDiagnostics {
  private readonly collection =
    vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);

  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly getClient: () => GraftApiClient,
    private readonly getMinSupport: () => number,
    private readonly isEnabled: () => boolean,
  ) {}

  attach(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      this.collection,
      vscode.workspace.onDidSaveTextDocument((doc) => {
        void this.scheduleCheck(doc);
      }),
    );
  }

  private scheduleCheck(document: vscode.TextDocument): void {
    if (!this.isEnabled() || document.uri.scheme !== "file") {
      return;
    }
    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        void this.checkDocument(document);
      }, 300),
    );
  }

  private async checkDocument(document: vscode.TextDocument): Promise<void> {
    const uri = document.uri;
    const relativePath = vscode.workspace.asRelativePath(uri);
    const minSupport = this.getMinSupport();

    try {
      const client = this.getClient();
      await client.health();
      const suggestions = await client.suggestGrafts({
        code: document.getText(),
        path: relativePath,
        limit: 5,
      });
      const highSupport = suggestions.filter(
        (s) => s.support >= minSupport && !this.isLowOnly(s),
      );
      if (highSupport.length === 0) {
        this.collection.delete(uri);
        return;
      }
      const diagnostics = highSupport.map((s) =>
        this.toDiagnostic(s, document, minSupport),
      );
      this.collection.set(uri, diagnostics);
    } catch {
      /* Degraded: no diagnostics rather than blocking save */
      this.collection.delete(uri);
    }
  }

  private isLowOnly(s: GraftSuggestion): boolean {
    return s.confidence === "low";
  }

  private toDiagnostic(
    suggestion: GraftSuggestion,
    document: vscode.TextDocument,
    minSupport: number,
  ): vscode.Diagnostic {
    const line = Math.max(0, document.lineCount - 1);
    const range = new vscode.Range(line, 0, line, 1);
    const diag = new vscode.Diagnostic(
      range,
      `Graft: historical accept "${suggestion.title}" (support ${suggestion.support}, ${suggestion.confidence}) — preview via Graft command`,
      vscode.DiagnosticSeverity.Information,
    );
    diag.source = DIAGNOSTIC_SOURCE;
    diag.code = suggestion.recipeId;
    diag.tags = [vscode.DiagnosticTag.Unnecessary];
    if (suggestion.support < minSupport) {
      diag.severity = vscode.DiagnosticSeverity.Hint;
    }
    return diag;
  }

  dispose(): void {
    this.collection.dispose();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}
