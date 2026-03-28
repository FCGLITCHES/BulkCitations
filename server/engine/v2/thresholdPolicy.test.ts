import { describe, expect, it } from 'vitest';
import { SPLIT_PENALTY_BY_FLAG, V2_THRESHOLD_POLICY } from './thresholdPolicy.js';

describe('thresholdPolicy', () => {
  it('keeps split-penalty aliases aligned with the central policy', () => {
    expect(SPLIT_PENALTY_BY_FLAG.header_bleed_suspected).toBe(V2_THRESHOLD_POLICY.extract.splitPenalty.headerBleed);
    expect(SPLIT_PENALTY_BY_FLAG.page_artifact_present).toBe(V2_THRESHOLD_POLICY.extract.splitPenalty.pageArtifact);
    expect(SPLIT_PENALTY_BY_FLAG.multiline_truncation_suspected).toBe(V2_THRESHOLD_POLICY.extract.splitPenalty.multilineTruncation);
    expect(SPLIT_PENALTY_BY_FLAG.oversized_chunk).toBe(V2_THRESHOLD_POLICY.extract.splitPenalty.oversizedChunk);
    expect(SPLIT_PENALTY_BY_FLAG.doi_orphan).toBe(V2_THRESHOLD_POLICY.extract.splitPenalty.doiOrphan);
  });
});
