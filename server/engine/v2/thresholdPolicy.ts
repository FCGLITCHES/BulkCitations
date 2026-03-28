export const V2_THRESHOLD_POLICY = {
  split: {
    openerThreshold: 0.58,
    oversizedWorkingChunkChars: 800,
    oversizedWorkingChunkLines: 12,
    suspectedMultiCitationChars: 2000,
  },
  detect: {
    mixedStylePenalty: 0.12,
    ocrNoisePenalty: 0.12,
    longProsePenalty: 0.06,
    footnotePenalty: 0.06,
    lowConfidenceHint: 0.55,
  },
  extract: {
    styleLockConfidence: 0.88,
    llmCriticalFieldFloor: 0.45,
    weakSelectionScore: 8,
    mediumBatchWeakSelectionScore: 6,
    grobidTimeoutMs: 3000,
    grobidCooldownMs: 30000,
    splitPenaltyCap: 0.28,
    splitPenalty: {
      headerBleed: 0.08,
      pageArtifact: 0.07,
      multilineTruncation: 0.10,
      oversizedChunk: 0.12,
      doiOrphan: 0.16,
    },
  },
  score: {
    cleanUnresolvedReadyThreshold: 0.83,
    duplicateAutoReadyThreshold: 0.83,
    requiredFieldReadyFloor: 0.88,
    unresolvedAuthorFloor: 0.84,
    localReadyFloor: 0.9,
    missingRequiredCap: 0.59,
    confirmedSplitCap: 0.49,
    malformedAuthorCap: 0.45,
    conflictCap: 0.52,
  },
} as const;

export const SPLIT_PENALTY_BY_FLAG = {
  header_bleed_suspected: V2_THRESHOLD_POLICY.extract.splitPenalty.headerBleed,
  page_artifact_present: V2_THRESHOLD_POLICY.extract.splitPenalty.pageArtifact,
  multiline_truncation_suspected: V2_THRESHOLD_POLICY.extract.splitPenalty.multilineTruncation,
  oversized_chunk: V2_THRESHOLD_POLICY.extract.splitPenalty.oversizedChunk,
  doi_orphan: V2_THRESHOLD_POLICY.extract.splitPenalty.doiOrphan,
} as const;
