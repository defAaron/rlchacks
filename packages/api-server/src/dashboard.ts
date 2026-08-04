/**
 * Serve static dashboard assets (Phase 8.2 / DEV-4).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";

const DASHBOARD_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../../dashboard",
);

export function dashboardIndexPath(): string {
  return path.join(DASHBOARD_DIR, "index.html");
}

/** Serve `/dashboard` read-only recipe browser. */
export async function serveDashboard(
  res: ServerResponse,
): Promise<boolean> {
  try {
    const html = await readFile(dashboardIndexPath(), "utf8");
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);
    return true;
  } catch {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Dashboard not found" }));
    return true;
  }
}

export function isDashboardRequest(url: string): boolean {
  return url === "/dashboard" || url === "/dashboard/" || url.startsWith("/dashboard?");
}
