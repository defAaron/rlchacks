/**
 * Parse unified diff hunk into workspace edit (explicit apply only).
 */

import * as vscode from "vscode";

export function parseUnifiedDiffHunk(
  unifiedDiff: string,
  fallbackPath: string,
): vscode.WorkspaceEdit | null {
  const lines = unifiedDiff.split("\n");
  const plusPath = lines.find((l) => l.startsWith("+++ b/"));
  const hunk = lines.find((l) => l.startsWith("@@"));
  if (plusPath === undefined || hunk === undefined) {
    return null;
  }

  const pathMatch = /^\+\+\+ b\/(.+)$/.exec(plusPath);
  const hunkMatch = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(hunk);
  if (pathMatch === null || hunkMatch === null) {
    return null;
  }

  const filePath = pathMatch[1] ?? fallbackPath;
  const startLine = Number.parseInt(hunkMatch[3]!, 10);
  const addedCount = Number.parseInt(hunkMatch[4]!, 10);

  const body = lines.slice(lines.indexOf(hunk) + 1);
  const newText = body
    .filter((l) => l.startsWith("+") || l.startsWith(" "))
    .map((l) => l.slice(1))
    .join("\n");

  const edit = new vscode.WorkspaceEdit();
  const uri = vscode.Uri.file(
    vscode.workspace.workspaceFolders?.[0]
      ? `${vscode.workspace.workspaceFolders[0].uri.fsPath}/${filePath}`
      : filePath,
  );
  const endLine = startLine + Math.max(addedCount, 1) - 1;
  edit.replace(
    uri,
    new vscode.Range(
      Math.max(0, startLine - 1),
      0,
      Math.max(0, endLine - 1),
      Number.MAX_SAFE_INTEGER,
    ),
    newText,
  );
  return edit;
}

export async function showPreviewDiff(
  title: string,
  unifiedDiff: string,
): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: "diff",
    content: unifiedDiff,
  });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
  await vscode.window.showInformationMessage(`Graft preview: ${title}`);
}
