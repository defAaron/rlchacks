/**
 * Clustering normalization (TRD §7.3 / Phase 3.1).
 * Extends linking's literal masking with optional local-identifier masking.
 */

import { createHash } from "node:crypto";

/** Mask string / template literals as `S`. */
const STRING_LITERAL_RE =
  /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

/** Mask numeric literals as `N`. */
const NUMBER_LITERAL_RE = /\b\d+(?:\.\d+)?\b/g;

/** Language keywords / common API tokens to preserve during identifier masking. */
const PRESERVE_IDENTIFIERS = new Set([
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "Promise",
  "Map",
  "Set",
  "JSON",
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Error",
  "Date",
  "Math",
  "console",
  "parse",
  "stringify",
]);

/** Heuristic: short lowercase identifiers likely locals → `V`. */
const LOCAL_IDENT_RE = /\b[a-z_][a-z0-9_]{0,2}\b/g;

export type NormalizeOptions = {
  /** When true, mask short local-like identifiers (default true). */
  maskIdentifiers?: boolean;
};

/**
 * Normalize code for clustering: trim lines, collapse whitespace runs,
 * mask literals, optionally mask local identifiers.
 */
export function normalizeForClustering(
  text: string,
  options: NormalizeOptions = {},
): string {
  const maskIdentifiers = options.maskIdentifiers !== false;

  return text
    .split("\n")
    .map((line) => {
      let out = line.trim();
      out = out.replace(STRING_LITERAL_RE, "S");
      out = out.replace(NUMBER_LITERAL_RE, "N");
      if (maskIdentifiers) {
        out = out.replace(LOCAL_IDENT_RE, (ident) =>
          PRESERVE_IDENTIFIERS.has(ident) ? ident : "V",
        );
      }
      return out.replace(/\s+/g, " ").trim();
    })
    .join("\n")
    .trim();
}

/** Stable sha256 hex digest of normalized clustering form. */
export function stableNormalizeHash(
  text: string,
  options?: NormalizeOptions,
): string {
  const normalized = normalizeForClustering(text, options);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/** Pair key for clustering: rejected + accepted normalized forms. */
export function clusterPairKey(
  rejectedNormalized: string,
  acceptedNormalized: string,
): string {
  return `${rejectedNormalized}\0${acceptedNormalized}`;
}
