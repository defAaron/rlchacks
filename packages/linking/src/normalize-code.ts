/**
 * Clustering-oriented normalization for code spans (TRD §7.3 basics).
 * Full clustering lives in compile; linking stores `CodeSpan.normalized` early.
 */

/** Mask string / template literals as `S`. */
const STRING_LITERAL_RE =
  /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

/** Mask numeric literals as `N`. */
const NUMBER_LITERAL_RE = /\b\d+(?:\.\d+)?\b/g;

/**
 * Normalize code text for later clustering:
 * trim lines, mask string/number literals, strip remaining whitespace.
 */
export function normalizeCodeSpanText(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(STRING_LITERAL_RE, "S")
        .replace(NUMBER_LITERAL_RE, "N")
        .replace(/\s+/g, ""),
    )
    .join("\n");
}
