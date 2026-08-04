/**
 * Deterministic actionability filter (TRD §7.2, LNK-4 / Step 2.1).
 *
 * Marks review comments non-actionable when they are praise, LGTM, emoji-only,
 * bot-authored, too short without a code fence, or empty nits.
 */

export const DiscardReasons = {
  BOT_AUTHOR: "bot_author",
  EMOJI_ONLY: "emoji_only",
  LGTM: "lgtm",
  THANKS: "thanks",
  PRAISE: "praise",
  NON_ACTIONABLE_NIT: "non_actionable_nit",
  TOO_SHORT: "too_short",
} as const;

export type DiscardReason =
  (typeof DiscardReasons)[keyof typeof DiscardReasons];

export type ActionabilityResult = {
  actionable: boolean;
  discardReason: DiscardReason | null;
};

export type AssessActionabilityInput = {
  body: string;
  author: string;
};

export type AssessActionabilityOptions = {
  /** Extra bot logins (case-insensitive). Merged with defaults. */
  botAuthors?: readonly string[];
  /** Min trimmed body length when no code fence is present. Default 12. */
  minBodyLength?: number;
};

/** Well-known GitHub App / bot logins (exact, case-insensitive). */
export const DEFAULT_BOT_AUTHORS: readonly string[] = [
  "dependabot[bot]",
  "renovate[bot]",
  "github-actions[bot]",
  "codecov[bot]",
  "sonarcloud[bot]",
  "coderabbitai[bot]",
  "copilot-pull-request-reviewer[bot]",
  "imgbot[bot]",
  "greenkeeper[bot]",
  "snyk-bot",
  "vercel[bot]",
  "netlify[bot]",
  "ghost",
];

export const DEFAULT_MIN_BODY_LENGTH = 12;

const CODE_FENCE_RE = /```/;

/** Exact normalized bodies that are LGTM-only. */
const LGTM_PHRASES = new Set([
  "lgtm",
  "looks good",
  "looks good to me",
  "lg tm",
  "ship it",
  "shipit",
  "approved",
  "approve",
  "sg",
  "sounds good",
  "+1",
  "plus one",
  "r+",
]);

/** Exact normalized bodies that are thanks-only. */
const THANKS_PHRASES = new Set([
  "thanks",
  "thank you",
  "thanks a lot",
  "thanks so much",
  "thx",
  "ty",
]);

/** Exact normalized bodies that are pure praise. */
const PRAISE_PHRASES = new Set([
  "nice",
  "nice work",
  "nice one",
  "great",
  "great work",
  "great job",
  "awesome",
  "awesome work",
  "perfect",
  "well done",
  "good job",
  "good work",
  "excellent",
  "excellent work",
  "love it",
  "beautiful",
  "clean",
  "clean pr",
  "solid",
  "solid work",
  "fantastic",
  "amazing",
]);

function discarded(reason: DiscardReason): ActionabilityResult {
  return { actionable: false, discardReason: reason };
}

function kept(): ActionabilityResult {
  return { actionable: true, discardReason: null };
}

function normalizeAuthor(author: string): string {
  return author.trim().toLowerCase();
}

/**
 * True when the author looks like a bot: configurable list, `[bot]` suffix,
 * or common `*-bot` GitHub App style logins.
 */
export function isBotAuthor(
  author: string,
  extraBotAuthors: readonly string[] = [],
): boolean {
  const login = normalizeAuthor(author);
  if (!login) return false;

  if (login.endsWith("[bot]")) return true;

  const known = new Set(
    [...DEFAULT_BOT_AUTHORS, ...extraBotAuthors].map((a) =>
      normalizeAuthor(a),
    ),
  );
  if (known.has(login)) return true;

  // e.g. snyk-bot, renovate-bot — but not human names that merely contain "bot"
  if (/^[a-z0-9_-]+-bot$/.test(login)) return true;

  return false;
}

/** Strip emoji / shortcodes / punctuation for phrase matching. */
export function normalizeCommentBody(body: string): string {
  return body
    .normalize("NFKC")
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/:[a-z0-9_+-]+:/gi, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[\uFE0F\u200D]/g, "")
    .replace(/[^a-z0-9+\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripEmojiAndShortcodes(body: string): string {
  return body
    .normalize("NFKC")
    .replace(/:[a-z0-9_+-]+:/gi, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uFE0F\u200D]/g, "")
    .trim();
}

/** Body is only emoji, emoji shortcodes, and light punctuation/whitespace. */
export function isEmojiOnlyBody(body: string): boolean {
  const withoutEmoji = stripEmojiAndShortcodes(body);
  if (withoutEmoji.length === 0) {
    // Must have had *some* emoji/shortcode content (not empty/whitespace)
    const hadVisual =
      /\p{Extended_Pictographic}/u.test(body) || /:[a-z0-9_+-]+:/i.test(body);
    return hadVisual;
  }
  // Leftover is only punctuation / symbols / whitespace
  return /^[\s\p{P}\p{S}]*$/u.test(withoutEmoji);
}

function hasCodeFence(body: string): boolean {
  return CODE_FENCE_RE.test(body);
}

/**
 * Pure nit acknowledgments with no actionable guidance
 * (e.g. "nit", "nit 👍", "nits:", "nit: lol").
 */
function isNonActionableNit(body: string, normalized: string): boolean {
  if (!/^(nit|nits)\b/.test(normalized)) return false;

  // "nit: please extract this helper" — keep
  const afterNit = normalized.replace(/^(nit|nits)\s*/, "").trim();
  if (afterNit.length === 0) return true;

  // Remaining is only filler / tiny non-guidance
  if (
    /^(typo|spacing|whitespace|style|formatting|nits?|lol|lgtm|ok|okay|fine|np|sg)$/.test(
      afterNit,
    )
  ) {
    return true;
  }

  // "nit 🔥" / "nit!!!" after emoji strip
  const stripped = stripEmojiAndShortcodes(body)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(nit|nits)$/.test(stripped)) return true;

  return false;
}

/**
 * Assess whether a raw review comment is actionable for episode linking.
 * First matching discard rule wins; otherwise the comment is kept.
 */
export function assessActionability(
  input: AssessActionabilityInput,
  options: AssessActionabilityOptions = {},
): ActionabilityResult {
  const minBodyLength = options.minBodyLength ?? DEFAULT_MIN_BODY_LENGTH;
  const body = input.body ?? "";
  const trimmed = body.trim();

  if (isBotAuthor(input.author, options.botAuthors ?? [])) {
    return discarded(DiscardReasons.BOT_AUTHOR);
  }

  if (trimmed.length === 0) {
    return discarded(DiscardReasons.TOO_SHORT);
  }

  if (isEmojiOnlyBody(trimmed)) {
    return discarded(DiscardReasons.EMOJI_ONLY);
  }

  const normalized = normalizeCommentBody(trimmed);

  if (LGTM_PHRASES.has(normalized)) {
    return discarded(DiscardReasons.LGTM);
  }

  if (THANKS_PHRASES.has(normalized)) {
    return discarded(DiscardReasons.THANKS);
  }

  if (PRAISE_PHRASES.has(normalized)) {
    return discarded(DiscardReasons.PRAISE);
  }

  if (isNonActionableNit(trimmed, normalized)) {
    return discarded(DiscardReasons.NON_ACTIONABLE_NIT);
  }

  // Short body with no code fence → non-actionable (TRD: length threshold)
  if (!hasCodeFence(trimmed) && trimmed.length < minBodyLength) {
    return discarded(DiscardReasons.TOO_SHORT);
  }

  return kept();
}
