export const PKG = "@graft/linking" as const;

export {
  DiscardReasons,
  DEFAULT_BOT_AUTHORS,
  DEFAULT_MIN_BODY_LENGTH,
  assessActionability,
  isBotAuthor,
  isEmojiOnlyBody,
  normalizeCommentBody,
  type ActionabilityResult,
  type AssessActionabilityInput,
  type AssessActionabilityOptions,
  type DiscardReason,
} from "./actionability.js";

export { normalizeCodeSpanText } from "./normalize-code.js";

export {
  RejectedSpanLinkReasons,
  extractRejectedSpan,
  normalizeCommentSide,
  parseDiffHunkRightLines,
  splitBlobLines,
  type ExtractRejectedSpanInput,
  type RejectedSpanExtraction,
  type RejectedSpanLinkReason,
  type RejectedSpanSource,
} from "./rejected-span.js";

export {
  AcceptedFixLinkReasons,
  COMPILE_ELIGIBLE_CONFIDENCES,
  DEFAULT_OVERLAP_WINDOW,
  computeLineHunks,
  defaultCompileEpisodes,
  extractCommentKeywords,
  extractSuggestionBlock,
  hasLexicalOverlap,
  isCompileEligible,
  linkAcceptedFix,
  type AcceptedFixLinkReason,
  type AcceptedFixLinkResult,
  type CompileEligibleConfidence,
  type LinkAcceptedFixInput,
} from "./accepted-fix.js";

export {
  parseUnifiedDiffHunk,
  reconstructBeforeFromTipAndHunk,
  resolveBeforeText,
  type ResolveBeforeTextInput,
  type ResolveBeforeTextResult,
} from "./before-text.js";

export { stableEpisodeId } from "./episode-id.js";

export { inferLanguageFromPath } from "./language.js";

export {
  blobIndexPath,
  listBlobShas,
  loadSingleBlobFallback,
  readBlobIndex,
  readBlobText,
  resolveBlobAtRef,
  type BlobIndex,
  type BlobIndexEntry,
  type ResolvedBlob,
} from "./blob-index.js";

export {
  discardDebugIndexPath,
  episodeIndexPath,
  episodePath,
  toIndexEntry,
  truncateBodyPreview,
  writeDiscardDebugIndex,
  writeEpisodeIndex,
  writeReviewEpisode,
  type DiscardDebugEntry,
  type DiscardDebugIndex,
  type EpisodeIndex,
  type EpisodeIndexEntry,
} from "./episode-store.js";

export {
  linkRepository,
  type LinkEpisodeLabel,
  type LinkRepositoryOptions,
  type LinkRepositoryResult,
} from "./link-repository.js";

export {
  LlmLinkReasons,
  applyLlmMediumValidation,
  shouldRunLlmValidation,
  type ApplyLlmMediumValidationOptions,
  type ApplyLlmMediumValidationResult,
  type LinkLlmClient,
  type LlmLinkReason,
  type LlmLinkValidationInput,
  type LlmLinkValidationResult,
} from "./llm-validate.js";

export {
  createHttpLinkLlmClient,
  createLinkLlmClientFromEnv,
  hasLlmApiKey,
  resolveLlmApiKey,
  type CreateHttpLinkLlmClientOptions,
  type LlmApiKeyProvider,
  type ResolvedLlmApiKey,
} from "./llm-client.js";
