import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDefaultAdapters } from '../server/engine/v2/adapters.js';
import type { V2AdapterBundle } from '../server/engine/v2/contracts.js';
import { processV2Conversion } from '../server/engine/v2/pipeline.js';
import {
  bestVenue,
  buildBatchContent,
  chunkRecords,
  cleanText,
  exactNormalizedMatch,
  firstAuthor,
  formatMs,
  formatPercent,
  mean,
  median,
  normalizeComparisonText,
  normalizeOutputForIdentity,
  normalizePages,
  normalizedLevenshteinRatio,
  percentile,
  similarityPercent,
  toPercent,
  type BenchmarkCorpus,
  type BenchmarkInputStyle,
  type BenchmarkRecord,
  type BenchmarkSourceType,
} from './academicBenchmarkShared.js';

const CORPUS_PATH = path.resolve('scripts/data/academic-benchmark-corpus-1000.json');
const OUTPUT_JSON = path.resolve('output/academic-benchmark-1000-report.json');
const OUTPUT_MD = path.resolve('output/academic-benchmark-1000-report.md');
const BATCH_SIZES = [50, 100, 200] as const;
const DEFAULT_REPEATS = 3;
const LEGACY_METHODOLOGY_VERSION = '1.0';
const METHODOLOGY_FROZEN_AT = '2026-03-27';

type IdentityContaminationCategory =
  | 'shifted_prev'
  | 'shifted_next'
  | 'multiwork_merged_output'
  | 'duplicate_output_reuse'
  | 'dedup_field_substitution';

type FailureBreakdownCategory =
  | 'author_order'
  | 'venue_abbreviation'
  | 'locator_misclassified'
  | 'doi_parse'
  | 'reference_type'
  | 'identity_contamination'
  | 'empty_output';

type ActionNeededReasonCode =
  | 'missing_authors'
  | 'malformed_authors'
  | 'weak_first_author'
  | 'weak_venue'
  | 'weak_reference_type'
  | 'multi_field_low_confidence'
  | 'empty_output'
  | 'identity_contamination';

type BenchmarkModeId = 'primary_benchmark';

type DominantFailureBucket =
  | 'missing_output'
  | 'identity_contamination'
  | 'conference_container_type'
  | 'report_institution_type'
  | 'ieee_author_order'
  | 'apa_author_order'
  | 'venue_cleanup'
  | 'pages_locator'
  | 'residual_other';

type NearPassBlockingField =
  | 'referenceType'
  | 'year'
  | 'title'
  | 'firstAuthor'
  | 'venue'
  | 'output'
  | 'identity';

type SliceMetrics = {
  count: number;
  strictEssentialPass: number;
  legacyFieldPass: number;
  legacyFieldTotal: number;
  fieldPass: number;
  fieldTotal: number;
  renderScores: number[];
};

type FieldMetric = {
  pass: number;
  total: number;
};

type CitationFailure = {
  batchSize: number;
  repeat: number;
  recordId: string;
  sourceType: BenchmarkSourceType;
  inputStyle: BenchmarkInputStyle;
  perturbation: string;
  expectedTitle: string;
  actualTitle: string;
  expectedVenue: string;
  actualVenue: string;
  expectedApa: string;
  actualApa: string;
  mismatches: string[];
  renderSimilarityPct: number;
  identityContaminationCategory?: IdentityContaminationCategory;
  selectionMode?: string;
  winnerAdapterId?: string;
  selectionReason?: string;
};

type BatchAlignment = {
  matched: Array<{ record: BenchmarkRecord; recordIndex: number; citation: any; citationIndex: number }>;
  missing: Array<{ record: BenchmarkRecord; recordIndex: number }>;
};

type BatchRunSummary = {
  batchIndex: number;
  batchSize: number;
  repeat: number;
  expectedCount: number;
  actualCount: number;
  durationMs: number;
  msPerCitation: number;
  citationsPerSecond: number;
  partialResult: boolean;
};

type BatchSizeSummary = {
  batchSize: number;
  repeats: number;
  totalBatches: number;
  expectedCitations: number;
  actualCitations: number;
  strictEssentialAccuracyPct: number;
  legacyFieldAveragePct: number;
  fieldAccuracyPct: number;
  countIntegrityPct: number;
  nonEmptyOutputPct: number;
  identityIntegrityPct: number;
  identityContaminationCount: number;
  identityContaminationByCategory: Record<IdentityContaminationCategory, number>;
  partialBatchRatePct: number;
  consistencyPct: number;
  exactBatchConsistencyPct: number;
  averageRenderSimilarityPct: number;
  speed: {
    meanBatchMs: number;
    medianBatchMs: number;
    p95BatchMs: number;
    meanMsPerCitation: number;
    medianMsPerCitation: number;
    throughputCitationsPerSecond: number;
  };
};

type OverallSummary = {
  corpusSize: number;
  repeatCount: number;
  retrievalDate: string;
  fieldAccuracyPct: number;
  consistencyPct: number;
  averageRenderSimilarityPct: number;
};

type ActionNeededReasonCounts = {
  overall: Record<ActionNeededReasonCode, number>;
  ieee: Record<ActionNeededReasonCode, number>;
  nearPass: Record<ActionNeededReasonCode, number>;
};

type FallbackRoutingSummary = {
  llmEnabled: boolean;
  llmUsedInRun: boolean;
  directModelCallCount: number;
  directAcceptedCount: number;
  clusterReuseAcceptedCount: number;
  acceptedCitationCount: number;
  rejectedCount: number;
  budgetSkippedCount: number;
  acceptedWithFieldImprovementsCount: number;
  acceptedWithOutputCount: number;
  acceptedWithStrictPassLiftCount: number;
  totalStrictPassDelta: number;
  directModelCallRatePct: number;
  directAcceptRatePct: number;
  acceptedCitationRatePct: number;
  rejectedRatePct: number;
  improvedFieldCounts: Record<string, number>;
};

type FallbackReasonCounts = {
  attempted: Record<string, number>;
  accepted: Record<string, number>;
  rejected: Record<string, number>;
};

type LedgerBucketSummary<TBucket extends string> = Array<{
  bucket: TBucket;
  count: number;
  shareOfStrictFailsPct: number;
  sourceTypes: Record<string, number>;
  inputStyles: Record<string, number>;
  sampleRecordIds: string[];
}>;

type WeightedLiftProjectionEntry = {
  key: string;
  count: number;
  corpusSharePct: number;
  strictEssentialAccuracyPct: number;
  weightedContributionPct: number;
  weightedHeadroomPct: number;
};

type WeightedLiftModel = {
  targetStrictExternalAccuracyPct: number;
  currentStrictExternalAccuracyPct: number;
  remainingGapPct: number;
  bySourceType: WeightedLiftProjectionEntry[];
  byInputStyle: WeightedLiftProjectionEntry[];
};

type LedgerAccumulator<TBucket extends string> = Map<TBucket, {
  count: number;
  sourceTypes: Record<string, number>;
  inputStyles: Record<string, number>;
  sampleRecordIds: string[];
}>;

type BenchmarkModeSummary = {
  mode: BenchmarkModeId;
  llmExtractEnabled: boolean;
  corpusSize: number;
  ieeeCorpusCount: number;
  repeats: number;
  strict_external: {
    essentialAccuracyPct: number;
    countIntegrityPct: number;
    nonEmptyOutputPct: number;
    identityIntegrityPct: number;
    identityContaminationCount: number;
    identityContaminationByCategory: Record<IdentityContaminationCategory, number>;
    averageRenderSimilarityPct: number;
    consistencyPct: number;
  };
  legacy_comparable: {
    methodologyVersion: string;
    frozenAt: string;
    fieldAveragePct: number;
    includedFields: string[];
    matchRules: Record<string, string>;
    renderSimilarityIncluded: false;
  };
  overall: OverallSummary;
  countIntegrityPct: number;
  nonEmptyOutputPct: number;
  identityIntegrityPct: number;
  identityContaminationCount: number;
  identityContaminationByCategory: Record<IdentityContaminationCategory, number>;
  ieeeFailureBreakdown: Record<FailureBreakdownCategory, number>;
  actionNeededReasonCounts: ActionNeededReasonCounts;
  validationIssueCounts: Record<string, number>;
  missingRequiredFieldCounts: Record<string, number>;
  dominantFailureLedger: LedgerBucketSummary<DominantFailureBucket>;
  nearPassLedger: LedgerBucketSummary<NearPassBlockingField>;
  weightedLiftModel: WeightedLiftModel;
  fallbackRouting: FallbackRoutingSummary;
  fallbackReasonCounts: FallbackReasonCounts;
  typeConfusionMatrix: Array<{
    expectedReferenceType: string;
    actualReferenceType: string;
    count: number;
  }>;
  selectorDiagnostics: {
    selectorModes: Record<string, number>;
    selectionModes: Record<string, number>;
    topWinnerAdapters: Array<{ adapterId: string; count: number }>;
    topSelectionReasons: Array<{ reason: string; count: number }>;
  };
  byBatchSize: BatchSizeSummary[];
  bySourceType: Array<{
    sourceType: string;
    strictEssentialAccuracyPct: number;
    legacyFieldAveragePct: number;
    fieldAccuracyPct: number;
    averageRenderSimilarityPct: number;
    count: number;
  }>;
  byInputStyle: Array<{
    inputStyle: string;
    strictEssentialAccuracyPct: number;
    legacyFieldAveragePct: number;
    fieldAccuracyPct: number;
    averageRenderSimilarityPct: number;
    count: number;
  }>;
  byField: Array<{
    field: string;
    accuracyPct: number;
    pass: number;
    total: number;
  }>;
  sampleFailures: CitationFailure[];
  strengths: string[];
  weaknesses: string[];
  pros: string[];
  cons: string[];
  recommendedExternalPilot: string[];
  batchRuns: BatchRunSummary[];
};

export type AcademicBenchmarkReport = {
  generatedAt: string;
  corpusPath: string;
  corpusSize: number;
  ieeeCorpusCount: number;
  repeats: number;
  methodology: {
    source: string;
    frozenAt: string;
    groundTruth: string;
    scope: string[];
    notes: string[];
  };
  strict_external: {
    essentialAccuracyPct: number;
    countIntegrityPct: number;
    nonEmptyOutputPct: number;
    identityIntegrityPct: number;
    identityContaminationCount: number;
    identityContaminationByCategory: Record<IdentityContaminationCategory, number>;
    averageRenderSimilarityPct: number;
    consistencyPct: number;
  };
  legacy_comparable: {
    methodologyVersion: string;
    frozenAt: string;
    fieldAveragePct: number;
    includedFields: string[];
    matchRules: Record<string, string>;
    renderSimilarityIncluded: false;
  };
  overall: OverallSummary;
  countIntegrityPct: number;
  nonEmptyOutputPct: number;
  identityIntegrityPct: number;
  identityContaminationCount: number;
  identityContaminationByCategory: Record<IdentityContaminationCategory, number>;
  actionNeededReasonCounts: ActionNeededReasonCounts;
  validationIssueCounts: Record<string, number>;
  missingRequiredFieldCounts: Record<string, number>;
  dominantFailureLedger: LedgerBucketSummary<DominantFailureBucket>;
  nearPassLedger: LedgerBucketSummary<NearPassBlockingField>;
  weightedLiftModel: WeightedLiftModel;
  fallbackRouting: FallbackRoutingSummary;
  fallbackReasonCounts: FallbackReasonCounts;
  ieeeFailureBreakdown: Record<FailureBreakdownCategory, number>;
  typeConfusionMatrix: Array<{
    expectedReferenceType: string;
    actualReferenceType: string;
    count: number;
  }>;
  selectorDiagnostics: {
    selectorModes: Record<string, number>;
    selectionModes: Record<string, number>;
    topWinnerAdapters: Array<{ adapterId: string; count: number }>;
    topSelectionReasons: Array<{ reason: string; count: number }>;
  };
  byBatchSize: BatchSizeSummary[];
  bySourceType: Array<{
    sourceType: string;
    strictEssentialAccuracyPct: number;
    legacyFieldAveragePct: number;
    fieldAccuracyPct: number;
    averageRenderSimilarityPct: number;
    count: number;
  }>;
  byInputStyle: Array<{
    inputStyle: string;
    strictEssentialAccuracyPct: number;
    legacyFieldAveragePct: number;
    fieldAccuracyPct: number;
    averageRenderSimilarityPct: number;
    count: number;
  }>;
  byField: Array<{
    field: string;
    accuracyPct: number;
    pass: number;
    total: number;
  }>;
  sampleFailures: CitationFailure[];
  strengths: string[];
  weaknesses: string[];
  pros: string[];
  cons: string[];
  recommendedExternalPilot: string[];
  batchRuns: BatchRunSummary[];
};

function createIdentityBuckets(): Record<IdentityContaminationCategory, number> {
  return {
    shifted_prev: 0,
    shifted_next: 0,
    multiwork_merged_output: 0,
    duplicate_output_reuse: 0,
    dedup_field_substitution: 0,
  };
}

function createIeeeBreakdown(): Record<FailureBreakdownCategory, number> {
  return {
    author_order: 0,
    venue_abbreviation: 0,
    locator_misclassified: 0,
    doi_parse: 0,
    reference_type: 0,
    identity_contamination: 0,
    empty_output: 0,
  };
}

function createActionNeededReasonCounts(): Record<ActionNeededReasonCode, number> {
  return {
    missing_authors: 0,
    malformed_authors: 0,
    weak_first_author: 0,
    weak_venue: 0,
    weak_reference_type: 0,
    multi_field_low_confidence: 0,
    empty_output: 0,
    identity_contamination: 0,
  };
}

function isTruthyEnv(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value ?? '');
}

function isAcademicBenchmarkLlmEnabled(): boolean {
  return isTruthyEnv(process.env.ACADEMIC_BENCHMARK_ENABLE_LLM);
}

function isAcademicBenchmarkEnrichEnabled(): boolean {
  return isTruthyEnv(process.env.ACADEMIC_BENCHMARK_ENABLE_ENRICH);
}

function getAcademicBenchmarkRepeats(): number {
  const parsed = Number.parseInt(process.env.ACADEMIC_BENCHMARK_REPEATS ?? '', 10);
  if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  return DEFAULT_REPEATS;
}

function createSlice(): SliceMetrics {
  return {
    count: 0,
    strictEssentialPass: 0,
    legacyFieldPass: 0,
    legacyFieldTotal: 0,
    fieldPass: 0,
    fieldTotal: 0,
    renderScores: [],
  };
}

function updateSlice(slice: SliceMetrics, evaluation: {
  strictEssentialPassed: boolean;
  legacyFieldPass: number;
  legacyFieldTotal: number;
  fieldPass: number;
  fieldTotal: number;
  renderSimilarityPct: number;
}): void {
  slice.count += 1;
  if (evaluation.strictEssentialPassed) slice.strictEssentialPass += 1;
  slice.legacyFieldPass += evaluation.legacyFieldPass;
  slice.legacyFieldTotal += evaluation.legacyFieldTotal;
  slice.fieldPass += evaluation.fieldPass;
  slice.fieldTotal += evaluation.fieldTotal;
  slice.renderScores.push(evaluation.renderSimilarityPct);
}

function incrementCount(map: Map<string, number>, key: string | null | undefined): void {
  const normalized = cleanText(key ?? '');
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) ?? 0) + 1);
}

function incrementRecordCount<T extends string>(record: Record<T, number>, key: T): void {
  record[key] = (record[key] ?? 0) + 1;
}

function incrementNestedCount(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function rankedCounts(map: Map<string, number>) {
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function fieldValue<T>(field: { value: T } | undefined): T | undefined {
  return field?.value;
}

function actualFirstAuthor(citation: any): string {
  const authors = Array.isArray(citation?.authors?.value) ? citation.authors.value : [];
  const author = authors[0];
  if (!author) return '';
  return cleanText(author.last ?? author.literal ?? author.first ?? '');
}

function actualVenue(citation: any): string {
  return cleanText(
    fieldValue(citation.journal)
      ?? fieldValue(citation.conferenceTitle)
      ?? fieldValue(citation.bookTitle)
      ?? fieldValue(citation.publisher)
      ?? fieldValue(citation.institution)
      ?? '',
  );
}

function normalizeDoi(value: string | undefined | null): string {
  return normalizeComparisonText(value)
    .replace(/^https doi org /, '')
    .replace(/^doi /, '')
    .replace(/\s+/g, '');
}

function createEmptyCitation(raw = ''): any {
  return {
    raw,
    referenceType: 'unknown',
    title: { value: '' },
    year: { value: null },
    authors: { value: [] },
    journal: { value: '' },
    conferenceTitle: { value: '' },
    bookTitle: { value: '' },
    publisher: { value: '' },
    institution: { value: '' },
    volume: { value: '' },
    issue: { value: '' },
    pages: { value: '' },
    doi: { value: '' },
    rendered: { formatted: '' },
    duplicate: null,
    stageDebug: undefined,
  };
}

function createLedgerAccumulator<TBucket extends string>(buckets: readonly TBucket[]): LedgerAccumulator<TBucket> {
  return new Map<TBucket, {
    count: number;
    sourceTypes: Record<string, number>;
    inputStyles: Record<string, number>;
    sampleRecordIds: string[];
  }>(buckets.map((bucket) => [bucket, {
    count: 0,
    sourceTypes: {},
    inputStyles: {},
    sampleRecordIds: [],
  }]));
}

function recordLedgerHit<TBucket extends string>(
  accumulator: LedgerAccumulator<TBucket>,
  bucket: TBucket,
  record: BenchmarkRecord,
): void {
  const entry = accumulator.get(bucket);
  if (!entry) return;
  entry.count += 1;
  incrementNestedCount(entry.sourceTypes, record.sourceType);
  incrementNestedCount(entry.inputStyles, record.inputStyle);
  if (entry.sampleRecordIds.length < 12) entry.sampleRecordIds.push(record.id);
}

function recordLedgerVote<TBucket extends string>(
  votes: Map<string, Map<TBucket, number>>,
  recordId: string,
  bucket: TBucket,
): void {
  const entry = votes.get(recordId) ?? new Map<TBucket, number>();
  entry.set(bucket, (entry.get(bucket) ?? 0) + 1);
  votes.set(recordId, entry);
}

function materializeLedgerVotes<TBucket extends string>(
  votes: Map<string, Map<TBucket, number>>,
  recordsById: Map<string, BenchmarkRecord>,
  accumulator: LedgerAccumulator<TBucket>,
): number {
  let total = 0;
  for (const [recordId, bucketVotes] of votes.entries()) {
    const record = recordsById.get(recordId);
    if (!record || bucketVotes.size === 0) continue;
    const winner = Array.from(bucketVotes.entries())
      .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))[0]?.[0];
    if (!winner) continue;
    recordLedgerHit(accumulator, winner, record);
    total += 1;
  }
  return total;
}

function finalizeLedger<TBucket extends string>(
  accumulator: LedgerAccumulator<TBucket>,
  totalStrictFails: number,
): LedgerBucketSummary<TBucket> {
  return Array.from(accumulator.entries())
    .map(([bucket, entry]) => ({
      bucket,
      count: entry.count,
      shareOfStrictFailsPct: totalStrictFails > 0 ? toPercent(entry.count, totalStrictFails) : 0,
      sourceTypes: Object.fromEntries(Object.entries(entry.sourceTypes).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))),
      inputStyles: Object.fromEntries(Object.entries(entry.inputStyles).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))),
      sampleRecordIds: entry.sampleRecordIds,
    }))
    .sort((left, right) => right.count - left.count || left.bucket.localeCompare(right.bucket));
}

function classifyDominantFailure(
  record: BenchmarkRecord,
  evaluation: ReturnType<typeof evaluateCitation>,
  identityContaminationCategory: IdentityContaminationCategory | undefined,
): DominantFailureBucket | null {
  if (evaluation.strictEssentialPassed) return null;
  if (!evaluation.outputPresent) return 'missing_output';
  if (identityContaminationCategory) return 'identity_contamination';
  if (record.sourceType === 'conference' && (evaluation.mismatches.includes('referenceType') || evaluation.mismatches.includes('venue'))) {
    return 'conference_container_type';
  }
  if (record.sourceType === 'report' && (evaluation.mismatches.includes('referenceType') || evaluation.mismatches.includes('venue') || evaluation.mismatches.includes('firstAuthor'))) {
    return 'report_institution_type';
  }
  if (record.inputStyle === 'ieee' && evaluation.mismatches.includes('firstAuthor')) return 'ieee_author_order';
  if (record.inputStyle === 'apa' && evaluation.mismatches.includes('firstAuthor')) return 'apa_author_order';
  if (evaluation.mismatches.includes('venue')) return 'venue_cleanup';
  if (evaluation.mismatches.includes('pages')) return 'pages_locator';
  return 'residual_other';
}

function classifyNearPassBlockingField(
  evaluation: ReturnType<typeof evaluateCitation>,
): NearPassBlockingField | null {
  if (evaluation.strictEssentialPassed) return null;
  const blockers = evaluation.mismatches.filter((field): field is NearPassBlockingField =>
    ['referenceType', 'year', 'title', 'firstAuthor', 'venue', 'output', 'identity'].includes(field),
  );
  return blockers.length === 1 ? blockers[0] : null;
}

function buildWeightedLiftProjection(
  entries: Array<{ key: string; count: number; strictEssentialAccuracyPct: number }>,
  corpusSize: number,
): WeightedLiftProjectionEntry[] {
  return entries
    .map((entry) => {
      const share = entry.count / Math.max(corpusSize, 1);
      return {
        key: entry.key,
        count: entry.count,
        corpusSharePct: toPercent(entry.count, corpusSize),
        strictEssentialAccuracyPct: entry.strictEssentialAccuracyPct,
        weightedContributionPct: Number((share * entry.strictEssentialAccuracyPct).toFixed(2)),
        weightedHeadroomPct: Number((share * Math.max(100 - entry.strictEssentialAccuracyPct, 0)).toFixed(2)),
      };
    })
    .sort((left, right) => right.weightedHeadroomPct - left.weightedHeadroomPct || left.key.localeCompare(right.key));
}

function alignBatch(records: readonly BenchmarkRecord[], citations: readonly any[]): BatchAlignment {
  const matched: BatchAlignment['matched'] = [];
  const missing: BatchAlignment['missing'] = [];
  let expectedIndex = 0;

  for (let citationIndex = 0; citationIndex < citations.length; citationIndex += 1) {
    const citation = citations[citationIndex];
    if (expectedIndex >= records.length) break;

    let bestIndex = expectedIndex;
    let bestScore = -1;
    const searchLimit = Math.min(records.length, expectedIndex + 40);

    for (let candidateIndex = expectedIndex; candidateIndex < searchLimit; candidateIndex += 1) {
      const candidate = records[candidateIndex];
      const score = similarityPercent(citation.raw ?? '', candidate?.rawInput ?? '');
      if (score > bestScore) {
        bestScore = score;
        bestIndex = candidateIndex;
      }
      if (score >= 98) break;
    }

    while (expectedIndex < bestIndex) {
      const missingRecord = records[expectedIndex];
      if (missingRecord) missing.push({ record: missingRecord, recordIndex: expectedIndex });
      expectedIndex += 1;
    }

    const matchedRecord = records[bestIndex];
    if (matchedRecord) {
      matched.push({
        record: matchedRecord,
        recordIndex: bestIndex,
        citation,
        citationIndex,
      });
    }
    expectedIndex = bestIndex + 1;
  }

  while (expectedIndex < records.length) {
    const missingRecord = records[expectedIndex];
    if (missingRecord) missing.push({ record: missingRecord, recordIndex: expectedIndex });
    expectedIndex += 1;
  }

  return { matched, missing };
}

function fieldPass(left: string | undefined | null, right: string | undefined | null, threshold: number): boolean {
  return similarityPercent(left, right) >= threshold;
}

function exactFieldPass(left: string | undefined | null, right: string | undefined | null): boolean {
  return exactNormalizedMatch(left, right);
}

function pageFieldPass(left: string | undefined | null, right: string | undefined | null): boolean {
  return normalizePages(left) === normalizePages(right);
}

function titleSignature(title: string | undefined | null): string {
  const normalized = normalizeComparisonText(title);
  return normalized
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 6)
    .join(' ');
}

function detectIdentityContamination(
  records: readonly BenchmarkRecord[],
  citations: readonly any[],
  recordIndex: number,
  citationIndex: number,
  seenOutputs: Map<string, number>,
): IdentityContaminationCategory | undefined {
  const citation = citations[citationIndex];
  if (!citation) return undefined;

  const actualTitle = cleanText(fieldValue(citation.title) ?? '');
  const actualOutput = cleanText(citation.rendered?.formatted ?? '');
  const actualTitleBasis = actualTitle || actualOutput;
  if (!actualTitleBasis) return undefined;

  const ownTitle = records[recordIndex]?.expected.title ?? '';
  const ownSimilarity = normalizedLevenshteinRatio(actualTitleBasis, ownTitle);
  const neighborCandidates = [
    { offset: -2, record: records[recordIndex - 2] },
    { offset: -1, record: records[recordIndex - 1] },
    { offset: 1, record: records[recordIndex + 1] },
    { offset: 2, record: records[recordIndex + 2] },
  ].filter((candidate) => Boolean(candidate.record)) as Array<{ offset: number; record: BenchmarkRecord }>;

  const bestNeighbor = neighborCandidates
    .map((candidate) => ({
      ...candidate,
      similarity: normalizedLevenshteinRatio(actualTitleBasis, candidate.record.expected.title),
    }))
    .sort((left, right) => right.similarity - left.similarity)[0];

  if (bestNeighbor && bestNeighbor.similarity >= 0.85 && bestNeighbor.similarity > ownSimilarity) {
    return bestNeighbor.offset < 0 ? 'shifted_prev' : 'shifted_next';
  }

  const normalizedOutput = normalizeOutputForIdentity(actualOutput || actualTitleBasis);
  const previousOutputIndex = normalizedOutput ? seenOutputs.get(normalizedOutput) : undefined;
  if (previousOutputIndex != null && previousOutputIndex !== recordIndex) {
    const previousExpected = records[previousOutputIndex]?.expected.title ?? '';
    if (normalizedLevenshteinRatio(previousExpected, ownTitle) < 0.85) {
      return 'duplicate_output_reuse';
    }
  }

  const outputBasis = normalizeComparisonText(`${actualTitle} ${actualOutput}`);
  const candidateTitles = [records[recordIndex], ...neighborCandidates.map((candidate) => candidate.record)]
    .filter(Boolean)
    .map((record) => titleSignature(record.expected.title))
    .filter(Boolean);
  if (candidateTitles.filter((signature) => outputBasis.includes(signature)).length >= 2) {
    return 'multiwork_merged_output';
  }

  const dedupSnapshot = citation.stageDebug?.dedup as Record<string, unknown> | undefined;
  if (
    dedupSnapshot
    && dedupSnapshot.preDedupSnapshot
    && dedupSnapshot.postDedupSnapshot
    && dedupSnapshot.fieldSubstitution === true
  ) {
    return 'dedup_field_substitution';
  }

  return undefined;
}

function evaluateCitation(
  record: BenchmarkRecord,
  citation: any,
  identityContaminationCategory: IdentityContaminationCategory | undefined,
) {
  const expectedVenue = bestVenue(record.expected);
  const actualTitle = cleanText(fieldValue(citation.title) ?? '');
  const actualVenueValue = actualVenue(citation);
  const output = cleanText(citation.rendered?.formatted ?? '');
  const renderSimilarityPct = similarityPercent(output, record.expectedApa);

  const referenceTypePassed = citation.referenceType === record.expected.referenceType;
  const yearPassed = Number(fieldValue(citation.year) ?? NaN) === record.expected.year;
  const titlePassed = fieldPass(actualTitle, record.expected.title, 90);
  const firstAuthorPassed = fieldPass(actualFirstAuthor(citation), firstAuthor(record.expected), 90);
  const venuePassed = expectedVenue ? fieldPass(actualVenueValue, expectedVenue, 85) : true;
  const outputPresent = output.length > 0;
  const identityPassed = !identityContaminationCategory;

  const strictChecks: Array<{ field: string; passed: boolean }> = [
    { field: 'referenceType', passed: referenceTypePassed },
    { field: 'year', passed: yearPassed },
    { field: 'title', passed: titlePassed },
    { field: 'firstAuthor', passed: firstAuthorPassed },
    { field: 'venue', passed: venuePassed },
  ];

  if (record.expected.volume) {
    strictChecks.push({ field: 'volume', passed: fieldPass(String(fieldValue(citation.volume) ?? ''), record.expected.volume, 95) });
  }
  if (record.expected.issue) {
    strictChecks.push({ field: 'issue', passed: fieldPass(String(fieldValue(citation.issue) ?? ''), record.expected.issue, 95) });
  }
  if (record.expected.pages) {
    strictChecks.push({
      field: 'pages',
      passed: pageFieldPass(String(fieldValue(citation.pages) ?? ''), record.expected.pages)
        || fieldPass(String(fieldValue(citation.pages) ?? ''), record.expected.pages, 95),
    });
  }
  if (record.expected.doi) {
    strictChecks.push({
      field: 'doi',
      passed: normalizeDoi(String(fieldValue(citation.doi) ?? '')) === normalizeDoi(record.expected.doi),
    });
  }

  const legacyChecks: Array<{ field: string; passed: boolean }> = [
    { field: 'title', passed: fieldPass(actualTitle, record.expected.title, 90) },
    { field: 'firstAuthor', passed: fieldPass(actualFirstAuthor(citation), firstAuthor(record.expected), 90) },
    { field: 'year', passed: exactFieldPass(String(fieldValue(citation.year) ?? ''), String(record.expected.year)) },
  ];

  if (expectedVenue) {
    legacyChecks.push({ field: 'venue', passed: fieldPass(actualVenueValue, expectedVenue, 90) });
  }
  if (record.expected.volume) {
    legacyChecks.push({ field: 'volume', passed: exactFieldPass(String(fieldValue(citation.volume) ?? ''), record.expected.volume) });
  }
  if (record.expected.issue) {
    legacyChecks.push({ field: 'issue', passed: exactFieldPass(String(fieldValue(citation.issue) ?? ''), record.expected.issue) });
  }
  if (record.expected.pages) {
    legacyChecks.push({ field: 'pages', passed: pageFieldPass(String(fieldValue(citation.pages) ?? ''), record.expected.pages) });
  }
  if (record.expected.doi) {
    legacyChecks.push({
      field: 'doi',
      passed: normalizeDoi(String(fieldValue(citation.doi) ?? '')) === normalizeDoi(record.expected.doi),
    });
  }

  const mismatches = [
    ...strictChecks.filter((check) => !check.passed).map((check) => check.field),
    ...(identityPassed ? [] : ['identity']),
    ...(outputPresent ? [] : ['output']),
  ];

  return {
    actualTitle,
    actualVenue: actualVenueValue,
    actualApa: output,
    coreFieldPass: [referenceTypePassed, yearPassed, titlePassed, firstAuthorPassed, venuePassed].filter(Boolean).length,
    coreFieldTotal: 5,
    fieldPass: strictChecks.filter((check) => check.passed).length,
    fieldTotal: strictChecks.length,
    fieldResults: strictChecks,
    legacyFieldPass: legacyChecks.filter((check) => check.passed).length,
    legacyFieldTotal: legacyChecks.length,
    strictEssentialPassed:
      [referenceTypePassed, yearPassed, titlePassed, firstAuthorPassed, venuePassed, outputPresent, identityPassed].every(Boolean),
    outputPresent,
    identityPassed,
    renderSimilarityPct,
    mismatches,
  };
}

function classifyActionNeededReasons(
  citation: any,
  evaluation: ReturnType<typeof evaluateCitation>,
  identityContaminationCategory: IdentityContaminationCategory | undefined,
): ActionNeededReasonCode[] {
  const reasons = new Set<ActionNeededReasonCode>();
  const authors = Array.isArray(citation.authors?.value) ? citation.authors.value : [];
  const validationCodes = new Set(
    Array.isArray(citation.validationIssues)
      ? citation.validationIssues.map((issue: any) => String(issue.code ?? '')).filter(Boolean)
      : [],
  );
  const qualityFlags = new Set(Array.isArray(citation.quality?.flags) ? citation.quality.flags.map((flag: any) => String(flag)) : []);
  const missingRequired = Array.isArray(citation.quality?.missingRequired)
    ? citation.quality.missingRequired.map((field: any) => String(field))
    : [];

  if (!evaluation.outputPresent) reasons.add('empty_output');
  if (identityContaminationCategory) reasons.add('identity_contamination');
  if (authors.length === 0 || missingRequired.includes('authors')) reasons.add('missing_authors');
  if (
    qualityFlags.has('malformed_authors')
    || validationCodes.has('connector_as_author')
    || validationCodes.has('author_structure_unstable')
    || validationCodes.has('initials_as_surname')
  ) {
    reasons.add('malformed_authors');
  }
  if (evaluation.mismatches.includes('firstAuthor') && authors.length > 0) reasons.add('weak_first_author');
  if (evaluation.mismatches.includes('venue')) reasons.add('weak_venue');
  if (evaluation.mismatches.includes('referenceType')) reasons.add('weak_reference_type');
  if (
    reasons.size === 0
    || (evaluation.mismatches.filter((field) => ['referenceType', 'year', 'title', 'firstAuthor', 'venue'].includes(field)).length >= 2)
  ) {
    reasons.add('multi_field_low_confidence');
  }

  return [...reasons];
}

function sortSliceMap<T extends string>(map: Map<T, SliceMetrics>) {
  return Array.from(map.entries())
    .map(([key, slice]) => ({
      key,
      count: slice.count,
      strictEssentialAccuracyPct: toPercent(slice.strictEssentialPass, slice.count),
      legacyFieldAveragePct: toPercent(slice.legacyFieldPass, slice.legacyFieldTotal),
      fieldAccuracyPct: toPercent(slice.fieldPass, slice.fieldTotal),
      averageRenderSimilarityPct: mean(slice.renderScores),
    }))
    .sort((left, right) => right.strictEssentialAccuracyPct - left.strictEssentialAccuracyPct || left.key.localeCompare(right.key));
}

function classifyIeeeFailure(record: BenchmarkRecord, failure: CitationFailure): FailureBreakdownCategory {
  if (failure.identityContaminationCategory) return 'identity_contamination';
  if (!failure.actualApa) return 'empty_output';
  if (failure.mismatches.includes('referenceType')) return 'reference_type';
  if (failure.mismatches.includes('doi')) return 'doi_parse';
  if (failure.mismatches.includes('pages')) return 'locator_misclassified';
  if (failure.mismatches.includes('venue')) return 'venue_abbreviation';
  if (failure.mismatches.includes('firstAuthor')) return 'author_order';
  if (normalizedLevenshteinRatio(failure.actualTitle, record.expected.title) < 0.6) return 'author_order';
  return 'venue_abbreviation';
}

function renderMarkdown(report: AcademicBenchmarkReport): string {
  const lines: string[] = [];
  lines.push('# Academic Benchmark Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Frozen corpus: ${report.methodology.frozenAt}`);
  lines.push(`Corpus size: ${report.corpusSize} real citations`);
  lines.push(`IEEE slice: ${report.ieeeCorpusCount} citations per corpus run`);
  lines.push(`Machine-readable report: ${OUTPUT_JSON}`);
  lines.push('');
  lines.push('## Executive summary');
  lines.push('');
  lines.push(`This internal benchmark evaluates ${report.corpusSize} real-world academic references across journals, conferences, books, chapters, reports, and theses. It runs the current v2 engine in 50, 100, and 200 citation batches to mirror institutional use while separating strict external readiness from a legacy internal-compatibility score.`);
  lines.push('');
  lines.push('## External Readiness Score (Primary)');
  lines.push('');
  lines.push(`- Strict essential accuracy: ${formatPercent(report.strict_external.essentialAccuracyPct)}`);
  lines.push(`- Count integrity: ${formatPercent(report.strict_external.countIntegrityPct)}`);
  lines.push(`- Non-empty output rate: ${formatPercent(report.strict_external.nonEmptyOutputPct)}`);
  lines.push(`- Identity integrity: ${formatPercent(report.strict_external.identityIntegrityPct)}`);
  lines.push(`- Identity contamination count: ${report.strict_external.identityContaminationCount}`);
  lines.push(`- Consistency: ${formatPercent(report.strict_external.consistencyPct)}`);
  lines.push(`- Average APA render similarity: ${formatPercent(report.strict_external.averageRenderSimilarityPct)}`);
  lines.push(`- Direct LLM call rate: ${formatPercent(report.fallbackRouting.directModelCallRatePct)}`);
  lines.push('');
  lines.push('## LLM Fallback Diagnostics');
  lines.push('');
  lines.push(`- Enrichment opt-in: ${isAcademicBenchmarkEnrichEnabled() ? 'enabled' : 'disabled'}`);
  lines.push(`- LLM extract opt-in: ${report.fallbackRouting.llmEnabled ? 'enabled' : 'disabled'}`);
  lines.push(`- LLM actually used in this run: ${report.fallbackRouting.llmUsedInRun ? 'yes' : 'no'}`);
  lines.push(`- Direct model calls recorded: ${report.fallbackRouting.directModelCallCount}`);
  lines.push(`- Direct model accepts: ${report.fallbackRouting.directAcceptedCount}`);
  lines.push(`- Cluster-reused LLM accepts: ${report.fallbackRouting.clusterReuseAcceptedCount}`);
  lines.push(`- Total citations that accepted LLM-derived fields: ${report.fallbackRouting.acceptedCitationCount}`);
  lines.push(`- Rejected fallback attempts: ${report.fallbackRouting.rejectedCount}`);
  lines.push(`- Budget-skipped fallback attempts: ${report.fallbackRouting.budgetSkippedCount}`);
  lines.push(`- Accepted fallbacks with improved fields: ${report.fallbackRouting.acceptedWithFieldImprovementsCount}`);
  lines.push(`- Accepted fallbacks with non-empty output: ${report.fallbackRouting.acceptedWithOutputCount}`);
  lines.push(`- Accepted fallbacks that increased strict pass coverage: ${report.fallbackRouting.acceptedWithStrictPassLiftCount}`);
  lines.push(`- Total strict-pass delta from accepted fallbacks: ${report.fallbackRouting.totalStrictPassDelta}`);
  if (Object.keys(report.fallbackRouting.improvedFieldCounts).length > 0) {
    for (const [field, count] of Object.entries(report.fallbackRouting.improvedFieldCounts)) {
      lines.push(`- Improved field ${field}: ${count}`);
    }
  } else {
    lines.push('- Improved fields: none recorded in this run');
  }
  if (Object.keys(report.fallbackReasonCounts.rejected).length > 0) {
    for (const [reason, count] of Object.entries(report.fallbackReasonCounts.rejected).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
      lines.push(`- Rejected ${reason}: ${count}`);
    }
  } else {
    lines.push('- Rejected reasons: none recorded in this run');
  }
  if (Object.keys(report.fallbackReasonCounts.accepted).length > 0) {
    for (const [reason, count] of Object.entries(report.fallbackReasonCounts.accepted).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
      lines.push(`- Accepted ${reason}: ${count}`);
    }
  } else {
    lines.push('- Accepted reasons: none recorded in this run');
  }
  lines.push('');
  lines.push('## Internal Compatibility Reference (Secondary)');
  lines.push('');
  lines.push(`- Legacy-comparable field average: ${formatPercent(report.legacy_comparable.fieldAveragePct)}`);
  lines.push(`- Methodology version: ${report.legacy_comparable.methodologyVersion}`);
  lines.push(`- Frozen at: ${report.legacy_comparable.frozenAt}`);
  lines.push('');
  lines.push('Footnote: The primary score uses strict citation-level pass/fail on core fields plus identity and output integrity. The secondary score is a frozen internal field-average reference for historical comparison only and must not be cited as the external readiness number.');
  lines.push('');
  lines.push('## Action Needed Reasons');
  lines.push('');
  for (const [reason, count] of Object.entries(report.actionNeededReasonCounts.overall).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
    lines.push(`- Overall ${reason}: ${count}`);
  }
  lines.push('');
  for (const [reason, count] of Object.entries(report.actionNeededReasonCounts.ieee).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
    lines.push(`- IEEE ${reason}: ${count}`);
  }
  lines.push('');
  for (const [reason, count] of Object.entries(report.actionNeededReasonCounts.nearPass).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
    lines.push(`- Near-pass ${reason}: ${count}`);
  }
  lines.push('');
  lines.push('## Dominant Failure Ledger');
  lines.push('');
  for (const entry of report.dominantFailureLedger.slice(0, 9)) {
    lines.push(`- ${entry.bucket}: ${entry.count} (${formatPercent(entry.shareOfStrictFailsPct)})`);
  }
  lines.push('');
  lines.push('## Near-Pass Ledger');
  lines.push('');
  for (const entry of report.nearPassLedger) {
    lines.push(`- ${entry.bucket}: ${entry.count} (${formatPercent(entry.shareOfStrictFailsPct)})`);
  }
  lines.push('');
  lines.push('## Weighted Lift Model');
  lines.push('');
  lines.push(`- Current strict external accuracy: ${formatPercent(report.weightedLiftModel.currentStrictExternalAccuracyPct)}`);
  lines.push(`- Target strict external accuracy: ${formatPercent(report.weightedLiftModel.targetStrictExternalAccuracyPct)}`);
  lines.push(`- Remaining gap: ${formatPercent(report.weightedLiftModel.remainingGapPct)}`);
  for (const entry of report.weightedLiftModel.bySourceType.slice(0, 6)) {
    lines.push(`- Source ${entry.key}: share ${formatPercent(entry.corpusSharePct)}, strict ${formatPercent(entry.strictEssentialAccuracyPct)}, weighted headroom ${formatPercent(entry.weightedHeadroomPct)}`);
  }
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  for (const note of report.methodology.notes) {
    lines.push(`- ${note}`);
  }
  lines.push('');
  lines.push('## Batch results');
  lines.push('');
  for (const summary of report.byBatchSize) {
    lines.push(`### Batch size ${summary.batchSize}`);
    lines.push('');
    lines.push(`- Strict essential accuracy: ${formatPercent(summary.strictEssentialAccuracyPct)}`);
    lines.push(`- Legacy field average: ${formatPercent(summary.legacyFieldAveragePct)}`);
    lines.push(`- Count integrity: ${formatPercent(summary.countIntegrityPct)}`);
    lines.push(`- Non-empty output rate: ${formatPercent(summary.nonEmptyOutputPct)}`);
    lines.push(`- Identity integrity: ${formatPercent(summary.identityIntegrityPct)}`);
    lines.push(`- Identity contamination count: ${summary.identityContaminationCount}`);
    lines.push(`- Consistency: ${formatPercent(summary.consistencyPct)}`);
    lines.push(`- Mean batch time: ${formatMs(summary.speed.meanBatchMs)}`);
    lines.push(`- Median batch time: ${formatMs(summary.speed.medianBatchMs)}`);
    lines.push(`- P95 batch time: ${formatMs(summary.speed.p95BatchMs)}`);
    lines.push(`- Mean ms per citation: ${formatMs(summary.speed.meanMsPerCitation)}`);
    lines.push(`- Throughput: ${summary.speed.throughputCitationsPerSecond.toFixed(2)} citations/sec`);
    lines.push('');
  }
  lines.push('## IEEE failure breakdown');
  lines.push('');
  for (const [category, count] of Object.entries(report.ieeeFailureBreakdown)) {
    lines.push(`- ${category}: ${count}`);
  }
  lines.push('');
  lines.push('## Selector diagnostics');
  lines.push('');
  for (const [mode, count] of Object.entries(report.selectorDiagnostics.selectionModes)) {
    lines.push(`- selection mode ${mode}: ${count}`);
  }
  for (const entry of report.selectorDiagnostics.topWinnerAdapters.slice(0, 5)) {
    lines.push(`- top winner adapter ${entry.adapterId}: ${entry.count}`);
  }
  lines.push('');
  lines.push('## Type confusion matrix');
  lines.push('');
  for (const entry of report.typeConfusionMatrix.slice(0, 10)) {
    lines.push(`- ${entry.expectedReferenceType} -> ${entry.actualReferenceType}: ${entry.count}`);
  }
  lines.push('');
  lines.push('## Strengths');
  lines.push('');
  for (const strength of report.strengths) {
    lines.push(`- ${strength}`);
  }
  lines.push('');
  lines.push('## Weaknesses');
  lines.push('');
  for (const weakness of report.weaknesses) {
    lines.push(`- ${weakness}`);
  }
  lines.push('');
  lines.push('## Pros');
  lines.push('');
  for (const pro of report.pros) {
    lines.push(`- ${pro}`);
  }
  lines.push('');
  lines.push('## Cons');
  lines.push('');
  for (const con of report.cons) {
    lines.push(`- ${con}`);
  }
  lines.push('');
  lines.push('## Suggested external pilot');
  lines.push('');
  for (const step of report.recommendedExternalPilot) {
    lines.push(`- ${step}`);
  }
  lines.push('');
  lines.push('## Sample failures');
  lines.push('');
  if (report.sampleFailures.length === 0) {
    lines.push('- No failures captured in the retained sample set.');
  } else {
    for (const failure of report.sampleFailures) {
      lines.push(`- ${failure.recordId} [batch ${failure.batchSize}, repeat ${failure.repeat}] mismatches: ${failure.mismatches.join(', ') || 'none'}; render similarity: ${formatPercent(failure.renderSimilarityPct)}${failure.identityContaminationCategory ? `; identity: ${failure.identityContaminationCategory}` : ''}${failure.winnerAdapterId ? `; winner: ${failure.winnerAdapterId}` : ''}${failure.selectionMode ? `; mode: ${failure.selectionMode}` : ''}`);
      lines.push(`  Expected: ${failure.expectedApa}`);
      lines.push(`  Actual: ${failure.actualApa}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function runAcademicBenchmarkMode(
  mode: BenchmarkModeId,
  options?: { adapters?: V2AdapterBundle },
): Promise<BenchmarkModeSummary> {
  const corpus = JSON.parse(await readFile(CORPUS_PATH, 'utf8')) as BenchmarkCorpus;
  const adapters = options?.adapters ?? createDefaultAdapters();
  const repeats = getAcademicBenchmarkRepeats();
  const corpusRecordById = new Map(corpus.records.map((record) => [record.id, record]));
  const sourceTypeCorpusCounts = new Map<BenchmarkSourceType, number>();
  const inputStyleCorpusCounts = new Map<BenchmarkInputStyle, number>();
  for (const record of corpus.records) {
    sourceTypeCorpusCounts.set(record.sourceType, (sourceTypeCorpusCounts.get(record.sourceType) ?? 0) + 1);
    inputStyleCorpusCounts.set(record.inputStyle, (inputStyleCorpusCounts.get(record.inputStyle) ?? 0) + 1);
  }
  const previousLlmExtractor = process.env.ENABLE_LLM_EXTRACTOR;
  const previousGrobidExtractor = process.env.ENABLE_GROBID_EXTRACTOR;
  const previousEnrichConcurrency = process.env.V2_ENRICH_CONCURRENCY;
  const previousEnrichCitationTimeoutMs = process.env.V2_ENRICH_CITATION_TIMEOUT_MS;
  const previousEnrichTimeoutMs = process.env.V2_ENRICH_TIMEOUT_MS;
  const previousTruthConcurrency = process.env.V2_TRUTH_CONCURRENCY;
  const previousProviderMaxRetries = process.env.V2_PROVIDER_MAX_RETRIES;
  const previousProviderMaxRetryAfterMs = process.env.V2_PROVIDER_MAX_RETRY_AFTER_MS;
  const enrichEnabled = isAcademicBenchmarkEnrichEnabled();
  const batchRuns: BatchRunSummary[] = [];
  const bySourceType = new Map<BenchmarkSourceType, SliceMetrics>();
  const byInputStyle = new Map<BenchmarkInputStyle, SliceMetrics>();
  const fieldMetrics = new Map<string, FieldMetric>();
  const sampleFailures: CitationFailure[] = [];
  const batchSummaries: BatchSizeSummary[] = [];
  const overallIdentityBuckets = createIdentityBuckets();
  const ieeeFailureBreakdown = createIeeeBreakdown();
  const typeConfusionCounts = new Map<string, number>();
  const selectorModeCounts = new Map<string, number>();
  const selectionModeCounts = new Map<string, number>();
  const winnerAdapterCounts = new Map<string, number>();
  const selectionReasonCounts = new Map<string, number>();
  const ieeeCorpusCount = corpus.records.filter((record) => record.inputStyle === 'ieee').length;
  const validationIssueCounts = new Map<string, number>();
  const missingRequiredFieldCounts = new Map<string, number>();
  const dominantFailureLedgerAccumulator = createLedgerAccumulator([
    'missing_output',
    'identity_contamination',
    'conference_container_type',
    'report_institution_type',
    'ieee_author_order',
    'apa_author_order',
    'venue_cleanup',
    'pages_locator',
    'residual_other',
  ] as const);
  const nearPassLedgerAccumulator = createLedgerAccumulator([
    'referenceType',
    'year',
    'title',
    'firstAuthor',
    'venue',
    'output',
    'identity',
  ] as const);
  const dominantFailureVotes = new Map<string, Map<DominantFailureBucket, number>>();
  const nearPassVotes = new Map<string, Map<NearPassBlockingField, number>>();
  const actionNeededReasonCounts: ActionNeededReasonCounts = {
    overall: createActionNeededReasonCounts(),
    ieee: createActionNeededReasonCounts(),
    nearPass: createActionNeededReasonCounts(),
  };
  let llmFallbackAttemptedCount = 0;
  let llmFallbackAcceptedCount = 0;
  let llmFallbackRejectedCount = 0;
  let llmFallbackBudgetSkippedCount = 0;
  let llmFallbackClusterReuseAcceptedCount = 0;
  let llmFallbackDirectAcceptedCount = 0;
  let llmFallbackAcceptedWithFieldImprovementsCount = 0;
  let llmFallbackAcceptedWithOutputCount = 0;
  let llmFallbackAcceptedWithStrictPassLiftCount = 0;
  let llmFallbackTotalStrictPassDelta = 0;
  const llmFallbackAttemptReasons = new Map<string, number>();
  const llmFallbackAcceptedReasons = new Map<string, number>();
  const llmFallbackRejectedReasons = new Map<string, number>();
  const llmFallbackImprovedFieldCounts = new Map<string, number>();

  const llmEnabled = isAcademicBenchmarkLlmEnabled();
  process.env.ENABLE_GROBID_EXTRACTOR = '0';
  process.env.ENABLE_LLM_EXTRACTOR = llmEnabled ? '1' : '0';
  if (enrichEnabled) {
    if (!previousEnrichConcurrency) process.env.V2_ENRICH_CONCURRENCY = '8';
    if (!previousEnrichCitationTimeoutMs) process.env.V2_ENRICH_CITATION_TIMEOUT_MS = '500';
    if (!previousEnrichTimeoutMs) process.env.V2_ENRICH_TIMEOUT_MS = '6000';
    if (!previousTruthConcurrency) process.env.V2_TRUTH_CONCURRENCY = '1';
    if (!previousProviderMaxRetries) process.env.V2_PROVIDER_MAX_RETRIES = '0';
    if (!previousProviderMaxRetryAfterMs) process.env.V2_PROVIDER_MAX_RETRY_AFTER_MS = '1000';
  }

  try {
  for (const batchSize of BATCH_SIZES) {
    const batches = chunkRecords(corpus.records, batchSize);
    const baselineOutputs = new Map<number, string[]>();
    const baselineExactTypes = new Map<number, string[]>();

    let expectedCitations = 0;
    let actualCitations = 0;
    let strictEssentialPass = 0;
    let legacyFieldPass = 0;
    let legacyFieldTotal = 0;
    let allFieldPass = 0;
    let allFieldTotal = 0;
    let nonEmptyOutputCount = 0;
    let identityIntegrityCount = 0;
    let identityContaminationCount = 0;
    const identityBuckets = createIdentityBuckets();
    let partialBatches = 0;
    const renderScores: number[] = [];
    const durationMs: number[] = [];
    const perCitationMs: number[] = [];
    let identicalOutputComparisons = 0;
    let totalOutputComparisons = 0;
    let exactBatchMatches = 0;
    let totalBatchComparisons = 0;

    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const records = batches[batchIndex] ?? [];
        const content = buildBatchContent(records);
        const progressPrefix = `[academic-benchmark:${mode}] batchSize=${batchSize} repeat=${repeat}/${repeats} batch=${batchIndex + 1}/${batches.length}`;
        console.log(`${progressPrefix} starting`);
        const start = performance.now();
        const { response } = await processV2Conversion({
          sourceType: 'text',
          content,
          inputStyle: 'auto',
          outputStyle: 'apa',
          enrich: enrichEnabled,
          dedup: false,
          group: false,
          debug: repeat === 1,
        }, {
          adapters,
          executionMode: 'sync',
        });
        const duration = performance.now() - start;
        const actualCount = response.citations.length;
        console.log(
          `${progressPrefix} done durationMs=${duration.toFixed(2)} actual=${actualCount}/${records.length} partial=${response.processingPath.partialResult ? 'yes' : 'no'}`,
        );

        batchRuns.push({
          batchIndex,
          batchSize,
          repeat,
          expectedCount: records.length,
          actualCount,
          durationMs: Number(duration.toFixed(2)),
          msPerCitation: Number((duration / Math.max(records.length, 1)).toFixed(2)),
          citationsPerSecond: Number((records.length / Math.max(duration / 1000, 0.001)).toFixed(2)),
          partialResult: response.processingPath.partialResult ?? false,
        });

        expectedCitations += records.length;
        actualCitations += actualCount;
        durationMs.push(Number(duration.toFixed(2)));
        perCitationMs.push(Number((duration / Math.max(records.length, 1)).toFixed(2)));
        if (response.processingPath.partialResult) partialBatches += 1;

        const normalizedOutputs = response.citations.map((citation: any) => normalizeOutputForIdentity(citation.rendered?.formatted ?? ''));
        const exactTypes = response.citations.map((citation: any) => String(citation.referenceType ?? ''));

        if (repeat === 1) {
          baselineOutputs.set(batchIndex, normalizedOutputs);
          baselineExactTypes.set(batchIndex, exactTypes);
        } else {
          const baseline = baselineOutputs.get(batchIndex) ?? [];
          const baselineTypes = baselineExactTypes.get(batchIndex) ?? [];
          let batchMatch = baseline.length === normalizedOutputs.length && baselineTypes.length === exactTypes.length;
          const count = Math.min(baseline.length, normalizedOutputs.length);
          for (let index = 0; index < count; index += 1) {
            const outputMatch = baseline[index] === normalizedOutputs[index];
            const typeMatch = baselineTypes[index] === exactTypes[index];
            if (outputMatch && typeMatch) identicalOutputComparisons += 1;
            else batchMatch = false;
            totalOutputComparisons += 1;
          }
          totalBatchComparisons += 1;
          if (batchMatch) exactBatchMatches += 1;
        }

        if (repeat !== 1) continue;

        const alignment = alignBatch(records, response.citations);
        const seenOutputs = new Map<string, number>();

        for (const pair of alignment.matched) {
          const { record, recordIndex, citation, citationIndex } = pair;
          const identityContaminationCategory = detectIdentityContamination(records, response.citations, recordIndex, citationIndex, seenOutputs);
          const normalizedOutput = normalizeOutputForIdentity(citation.rendered?.formatted ?? citation.title?.value ?? '');
          if (normalizedOutput) seenOutputs.set(normalizedOutput, recordIndex);
          incrementCount(typeConfusionCounts, `${record.expected.referenceType}=>${String(citation.referenceType ?? 'unknown')}`);
          incrementCount(selectorModeCounts, String(citation.extraction?.selectorMode ?? ''));
          incrementCount(selectionModeCounts, String(citation.extraction?.selectionMode ?? ''));
          incrementCount(winnerAdapterCounts, String(citation.extraction?.winnerAdapterId ?? ''));
          incrementCount(selectionReasonCounts, String(citation.extraction?.selectionReason ?? ''));

          if (identityContaminationCategory) {
            identityContaminationCount += 1;
            identityBuckets[identityContaminationCategory] += 1;
            overallIdentityBuckets[identityContaminationCategory] += 1;
          }

          const evaluation = evaluateCitation(record, citation, identityContaminationCategory);
          if (evaluation.outputPresent) nonEmptyOutputCount += 1;
          if (evaluation.identityPassed && evaluation.outputPresent) identityIntegrityCount += 1;
          if (evaluation.strictEssentialPassed) strictEssentialPass += 1;
          const dominantFailure = classifyDominantFailure(record, evaluation, identityContaminationCategory);
          if (dominantFailure) recordLedgerVote(dominantFailureVotes, record.id, dominantFailure);
          const nearPassField = classifyNearPassBlockingField(evaluation);
          if (nearPassField) recordLedgerVote(nearPassVotes, record.id, nearPassField);
          if (citation.extraction?.llmFallbackAttempted) {
            llmFallbackAttemptedCount += 1;
            incrementCount(llmFallbackAttemptReasons, String(citation.extraction?.llmFallbackReason ?? 'unknown'));
          }
          if (citation.extraction?.llmFallbackAccepted) {
            llmFallbackAcceptedCount += 1;
            incrementCount(llmFallbackAcceptedReasons, String(citation.extraction?.llmFallbackReason ?? 'unknown'));
            if (citation.extraction?.llmFallbackReusedFromCluster) llmFallbackClusterReuseAcceptedCount += 1;
            else llmFallbackDirectAcceptedCount += 1;
            if (evaluation.outputPresent) llmFallbackAcceptedWithOutputCount += 1;
            if (Array.isArray(citation.extraction?.llmFallbackFieldsImproved) && citation.extraction.llmFallbackFieldsImproved.length > 0) {
              llmFallbackAcceptedWithFieldImprovementsCount += 1;
              for (const field of citation.extraction.llmFallbackFieldsImproved) {
                incrementCount(llmFallbackImprovedFieldCounts, String(field));
              }
            }
            const strictPassDelta = Number(citation.extraction?.llmFallbackStrictPassDelta ?? 0);
            if (strictPassDelta > 0) llmFallbackAcceptedWithStrictPassLiftCount += 1;
            llmFallbackTotalStrictPassDelta += strictPassDelta;
          }
          if (citation.extraction?.llmFallbackAttempted && !citation.extraction?.llmFallbackAccepted) {
            llmFallbackRejectedCount += 1;
            incrementCount(llmFallbackRejectedReasons, String(citation.extraction?.llmFallbackReason ?? 'unknown'));
          }
          if (citation.extraction?.llmFallbackSkippedByBudget) llmFallbackBudgetSkippedCount += 1;
          if (Array.isArray(citation.validationIssues)) {
            for (const issue of citation.validationIssues) incrementCount(validationIssueCounts, issue?.code);
          }
          if (Array.isArray(citation.quality?.missingRequired)) {
            for (const field of citation.quality.missingRequired) incrementCount(missingRequiredFieldCounts, String(field));
          }
          if (citation.quality?.bucket === 'action_needed') {
            const reasonCodes = classifyActionNeededReasons(citation, evaluation, identityContaminationCategory);
            for (const reason of reasonCodes) {
              incrementRecordCount(actionNeededReasonCounts.overall, reason);
              if (record.inputStyle === 'ieee') incrementRecordCount(actionNeededReasonCounts.ieee, reason);
              if (evaluation.coreFieldPass >= 3 && evaluation.outputPresent && evaluation.identityPassed) {
                incrementRecordCount(actionNeededReasonCounts.nearPass, reason);
              }
            }
          }
          legacyFieldPass += evaluation.legacyFieldPass;
          legacyFieldTotal += evaluation.legacyFieldTotal;
          allFieldPass += evaluation.fieldPass;
          allFieldTotal += evaluation.fieldTotal;
          renderScores.push(evaluation.renderSimilarityPct);

          const sourceSlice = bySourceType.get(record.sourceType) ?? createSlice();
          updateSlice(sourceSlice, evaluation);
          bySourceType.set(record.sourceType, sourceSlice);

          const styleSlice = byInputStyle.get(record.inputStyle) ?? createSlice();
          updateSlice(styleSlice, evaluation);
          byInputStyle.set(record.inputStyle, styleSlice);

          for (const field of evaluation.fieldResults) {
            const metric = fieldMetrics.get(field.field) ?? { pass: 0, total: 0 };
            metric.total += 1;
            if (field.passed) metric.pass += 1;
            fieldMetrics.set(field.field, metric);
          }

          if (record.inputStyle === 'ieee' && !evaluation.strictEssentialPassed) {
            const failure: CitationFailure = {
              batchSize,
              repeat,
              recordId: record.id,
              sourceType: record.sourceType,
              inputStyle: record.inputStyle,
              perturbation: record.perturbation,
              expectedTitle: record.expected.title,
              actualTitle: evaluation.actualTitle,
              expectedVenue: bestVenue(record.expected),
              actualVenue: evaluation.actualVenue,
              expectedApa: record.expectedApa,
              actualApa: evaluation.actualApa,
              mismatches: evaluation.mismatches,
              renderSimilarityPct: evaluation.renderSimilarityPct,
              identityContaminationCategory,
              selectionMode: citation.extraction?.selectionMode,
              winnerAdapterId: citation.extraction?.winnerAdapterId,
              selectionReason: citation.extraction?.selectionReason,
            };
            ieeeFailureBreakdown[classifyIeeeFailure(record, failure)] += 1;
          }

          if ((evaluation.mismatches.length > 0 || identityContaminationCategory) && sampleFailures.length < 40) {
            sampleFailures.push({
              batchSize,
              repeat,
              recordId: record.id,
              sourceType: record.sourceType,
              inputStyle: record.inputStyle,
              perturbation: record.perturbation,
              expectedTitle: record.expected.title,
              actualTitle: evaluation.actualTitle,
              expectedVenue: bestVenue(record.expected),
              actualVenue: evaluation.actualVenue,
              expectedApa: record.expectedApa,
              actualApa: evaluation.actualApa,
              mismatches: evaluation.mismatches,
              renderSimilarityPct: evaluation.renderSimilarityPct,
              identityContaminationCategory,
              selectionMode: citation.extraction?.selectionMode,
              winnerAdapterId: citation.extraction?.winnerAdapterId,
              selectionReason: citation.extraction?.selectionReason,
            });
          }
        }

        for (const { record } of alignment.missing) {
          incrementCount(typeConfusionCounts, `${record.expected.referenceType}=>missing`);
          const evaluation = evaluateCitation(record, createEmptyCitation(record.rawInput), undefined);
          const dominantFailure = classifyDominantFailure(record, evaluation, undefined);
          if (dominantFailure) recordLedgerVote(dominantFailureVotes, record.id, dominantFailure);
          const nearPassField = classifyNearPassBlockingField(evaluation);
          if (nearPassField) recordLedgerVote(nearPassVotes, record.id, nearPassField);
          incrementRecordCount(actionNeededReasonCounts.overall, 'empty_output');
          incrementRecordCount(actionNeededReasonCounts.overall, 'multi_field_low_confidence');
          incrementRecordCount(actionNeededReasonCounts.overall, 'missing_authors');
          if (record.inputStyle === 'ieee') {
            incrementRecordCount(actionNeededReasonCounts.ieee, 'empty_output');
            incrementRecordCount(actionNeededReasonCounts.ieee, 'multi_field_low_confidence');
            incrementRecordCount(actionNeededReasonCounts.ieee, 'missing_authors');
          }
          incrementCount(missingRequiredFieldCounts, 'authors');
          incrementCount(missingRequiredFieldCounts, 'title');
          incrementCount(missingRequiredFieldCounts, 'year');
          incrementCount(missingRequiredFieldCounts, 'venue');
          incrementCount(missingRequiredFieldCounts, 'referenceType');
          legacyFieldPass += evaluation.legacyFieldPass;
          legacyFieldTotal += evaluation.legacyFieldTotal;
          allFieldPass += evaluation.fieldPass;
          allFieldTotal += evaluation.fieldTotal;
          renderScores.push(evaluation.renderSimilarityPct);

          const sourceSlice = bySourceType.get(record.sourceType) ?? createSlice();
          updateSlice(sourceSlice, evaluation);
          bySourceType.set(record.sourceType, sourceSlice);

          const styleSlice = byInputStyle.get(record.inputStyle) ?? createSlice();
          updateSlice(styleSlice, evaluation);
          byInputStyle.set(record.inputStyle, styleSlice);

          for (const field of evaluation.fieldResults) {
            const metric = fieldMetrics.get(field.field) ?? { pass: 0, total: 0 };
            metric.total += 1;
            if (field.passed) metric.pass += 1;
            fieldMetrics.set(field.field, metric);
          }

          if (record.inputStyle === 'ieee') {
            const failure: CitationFailure = {
              batchSize,
              repeat,
              recordId: record.id,
              sourceType: record.sourceType,
              inputStyle: record.inputStyle,
              perturbation: record.perturbation,
              expectedTitle: record.expected.title,
              actualTitle: '',
              expectedVenue: bestVenue(record.expected),
              actualVenue: '',
              expectedApa: record.expectedApa,
              actualApa: '',
              mismatches: evaluation.mismatches,
              renderSimilarityPct: evaluation.renderSimilarityPct,
              selectionMode: 'missing',
              winnerAdapterId: 'missing',
              selectionReason: 'missing_output',
            };
            ieeeFailureBreakdown[classifyIeeeFailure(record, failure)] += 1;
          }

          if (sampleFailures.length < 40) {
            sampleFailures.push({
              batchSize,
              repeat,
              recordId: record.id,
              sourceType: record.sourceType,
              inputStyle: record.inputStyle,
              perturbation: record.perturbation,
              expectedTitle: record.expected.title,
              actualTitle: '',
              expectedVenue: bestVenue(record.expected),
              actualVenue: '',
              expectedApa: record.expectedApa,
              actualApa: '',
              mismatches: evaluation.mismatches,
              renderSimilarityPct: evaluation.renderSimilarityPct,
              selectionMode: 'missing',
              winnerAdapterId: 'missing',
              selectionReason: 'missing_output',
            });
          }
        }
      }
    }

    batchSummaries.push({
      batchSize,
      repeats,
      totalBatches: batches.length * repeats,
      expectedCitations,
      actualCitations,
      strictEssentialAccuracyPct: toPercent(strictEssentialPass, corpus.records.length),
      legacyFieldAveragePct: toPercent(legacyFieldPass, legacyFieldTotal),
      fieldAccuracyPct: toPercent(allFieldPass, allFieldTotal),
      countIntegrityPct: toPercent(actualCitations, expectedCitations),
      nonEmptyOutputPct: toPercent(nonEmptyOutputCount, corpus.records.length),
      identityIntegrityPct: toPercent(identityIntegrityCount, corpus.records.length),
      identityContaminationCount,
      identityContaminationByCategory: identityBuckets,
      partialBatchRatePct: toPercent(partialBatches, batches.length * repeats),
      consistencyPct: toPercent(identicalOutputComparisons, totalOutputComparisons),
      exactBatchConsistencyPct: toPercent(exactBatchMatches, totalBatchComparisons),
      averageRenderSimilarityPct: mean(renderScores),
      speed: {
        meanBatchMs: mean(durationMs),
        medianBatchMs: median(durationMs),
        p95BatchMs: percentile(durationMs, 95),
        meanMsPerCitation: mean(perCitationMs),
        medianMsPerCitation: median(perCitationMs),
        throughputCitationsPerSecond: Number((corpus.records.length / Math.max(durationMs.reduce((sum, value) => sum + value, 0) / 1000, 0.001)).toFixed(2)),
      },
    });
  }

  const byField = Array.from(fieldMetrics.entries())
    .map(([field, metric]) => ({
      field,
      accuracyPct: toPercent(metric.pass, metric.total),
      pass: metric.pass,
      total: metric.total,
    }))
    .sort((left, right) => right.accuracyPct - left.accuracyPct || left.field.localeCompare(right.field));

  const bySourceTypeSummary = sortSliceMap(bySourceType).map((entry) => ({
    sourceType: entry.key,
    count: sourceTypeCorpusCounts.get(entry.key) ?? entry.count,
    strictEssentialAccuracyPct: entry.strictEssentialAccuracyPct,
    legacyFieldAveragePct: entry.legacyFieldAveragePct,
    fieldAccuracyPct: entry.fieldAccuracyPct,
    averageRenderSimilarityPct: entry.averageRenderSimilarityPct,
  }));

  const byInputStyleSummary = sortSliceMap(byInputStyle).map((entry) => ({
    inputStyle: entry.key,
    count: inputStyleCorpusCounts.get(entry.key) ?? entry.count,
    strictEssentialAccuracyPct: entry.strictEssentialAccuracyPct,
    legacyFieldAveragePct: entry.legacyFieldAveragePct,
    fieldAccuracyPct: entry.fieldAccuracyPct,
    averageRenderSimilarityPct: entry.averageRenderSimilarityPct,
  }));

  const strictEssentialAccuracyPct = mean(batchSummaries.map((summary) => summary.strictEssentialAccuracyPct));
  const legacyFieldAveragePct = mean(batchSummaries.map((summary) => summary.legacyFieldAveragePct));
  const countIntegrityPct = mean(batchSummaries.map((summary) => summary.countIntegrityPct));
  const nonEmptyOutputPct = mean(batchSummaries.map((summary) => summary.nonEmptyOutputPct));
  const identityIntegrityPct = mean(batchSummaries.map((summary) => summary.identityIntegrityPct));
  const consistencyPct = mean(batchSummaries.map((summary) => summary.consistencyPct));
  const averageRenderSimilarityPct = mean(batchSummaries.map((summary) => summary.averageRenderSimilarityPct));

  const overall: OverallSummary = {
    corpusSize: corpus.records.length,
    repeatCount: repeats,
    retrievalDate: corpus.generatedAt,
    fieldAccuracyPct: mean(batchSummaries.map((summary) => summary.fieldAccuracyPct)),
    consistencyPct,
    averageRenderSimilarityPct,
  };
  const totalStrictFails = materializeLedgerVotes(dominantFailureVotes, corpusRecordById, dominantFailureLedgerAccumulator);
  materializeLedgerVotes(nearPassVotes, corpusRecordById, nearPassLedgerAccumulator);
  const dominantFailureLedger = finalizeLedger(dominantFailureLedgerAccumulator, totalStrictFails);
  const nearPassLedger = finalizeLedger(nearPassLedgerAccumulator, totalStrictFails);
  const typeConfusionMatrix = Array.from(typeConfusionCounts.entries())
    .map(([key, count]) => {
      const [expectedReferenceType, actualReferenceType] = key.split('=>');
      return {
        expectedReferenceType: expectedReferenceType ?? 'unknown',
        actualReferenceType: actualReferenceType ?? 'unknown',
        count,
      };
    })
    .sort((left, right) => right.count - left.count || left.expectedReferenceType.localeCompare(right.expectedReferenceType) || left.actualReferenceType.localeCompare(right.actualReferenceType));

  const strongestType = bySourceTypeSummary[0];
  const weakestType = [...bySourceTypeSummary].sort((left, right) => left.strictEssentialAccuracyPct - right.strictEssentialAccuracyPct)[0];
  const weakestStyle = [...byInputStyleSummary].sort((left, right) => left.strictEssentialAccuracyPct - right.strictEssentialAccuracyPct)[0];
  const weakestField = [...byField].sort((left, right) => left.accuracyPct - right.accuracyPct)[0];
  const highestThroughputBatch = [...batchSummaries].sort((left, right) => right.speed.throughputCitationsPerSecond - left.speed.throughputCitationsPerSecond)[0];

  const strengths = [
    'The benchmark uses a frozen 1,000-reference real-world corpus, making reruns auditable and institution-friendly.',
    'Strict external readiness, internal legacy compatibility, and batch performance are separated instead of being collapsed into one misleading score.',
    strongestType ? `${strongestType.sourceType} records performed best on the strict score at ${formatPercent(strongestType.strictEssentialAccuracyPct)}.` : 'At least one source type showed stable strict performance.',
    highestThroughputBatch ? `The fastest operating point was the ${highestThroughputBatch.batchSize}-citation batch at ${highestThroughputBatch.speed.throughputCitationsPerSecond.toFixed(2)} citations/sec.` : 'Throughput remained measurable at all tested batch sizes.',
  ];

  const weaknesses = [
    weakestType ? `${weakestType.sourceType} is the weakest strict source type and should stay in the next remediation wave.` : 'The weakest source type still needs targeted remediation.',
    weakestStyle ? `${weakestStyle.inputStyle.toUpperCase()} is the lowest-performing input style on the strict score.` : 'One input style clearly underperformed and needs dedicated diagnosis.',
    weakestField ? `${weakestField.field} is the lowest-accuracy field and remains the clearest parser-recovery target.` : 'At least one bibliographic field remains materially weaker than the rest.',
    `Identity contamination currently accounts for ${Object.values(overallIdentityBuckets).reduce((sum, value) => sum + value, 0)} strict failures across the benchmarked runs.`,
  ];

  const pros = [
    'Uses real citations rather than synthetic placeholders.',
    'Separates strict external readiness from legacy internal comparability.',
    'Measures count integrity, non-empty output, identity integrity, consistency, and speed as distinct operational properties.',
    'Evaluates 50, 100, and 200 citation batch sizes to mirror institution-friendly throughput constraints.',
  ];

  const cons = [
    'LLM extraction and GROBID can be toggled for the primary benchmark, so benchmark claims must always be read alongside the reported run flags.',
    'The legacy-comparable score is higher by design and must not be used as a readiness claim.',
    'The benchmark is still internal; an external validation round would increase procurement credibility.',
    'This release is scoped to academic references and does not cover websites, patents, statutes, or datasets.',
  ];

  const recommendedExternalPilot = [
    'Use the strict external readiness score as the procurement-facing metric and treat the legacy score as internal historical context only.',
    'Default acceptance testing to the 100-citation batch, then verify operational headroom with 50-citation and 200-citation runs.',
    'Record count integrity, non-empty output rate, identity integrity, and strict essential accuracy together so the evaluation cannot be gamed by a softer metric.',
    'Have a librarian, writing center lead, or research support team manually inspect a stratified sample from the weakest source types and IEEE-style inputs.',
  ];
  const weightedLiftModel: WeightedLiftModel = {
    targetStrictExternalAccuracyPct: 90,
    currentStrictExternalAccuracyPct: strictEssentialAccuracyPct,
    remainingGapPct: Number(Math.max(90 - strictEssentialAccuracyPct, 0).toFixed(2)),
    bySourceType: buildWeightedLiftProjection(
      bySourceTypeSummary.map((entry) => ({
        key: entry.sourceType,
        count: entry.count,
        strictEssentialAccuracyPct: entry.strictEssentialAccuracyPct,
      })),
      corpus.records.length,
    ),
    byInputStyle: buildWeightedLiftProjection(
      byInputStyleSummary.map((entry) => ({
        key: entry.inputStyle,
        count: entry.count,
        strictEssentialAccuracyPct: entry.strictEssentialAccuracyPct,
      })),
      corpus.records.length,
    ),
  };

  const result: BenchmarkModeSummary = {
    mode,
    llmExtractEnabled: llmEnabled,
    corpusSize: corpus.records.length,
    ieeeCorpusCount,
    repeats,
    strict_external: {
      essentialAccuracyPct: strictEssentialAccuracyPct,
      countIntegrityPct,
      nonEmptyOutputPct,
      identityIntegrityPct,
      identityContaminationCount: Object.values(overallIdentityBuckets).reduce((sum, value) => sum + value, 0),
      identityContaminationByCategory: overallIdentityBuckets,
      averageRenderSimilarityPct,
      consistencyPct,
    },
    legacy_comparable: {
      methodologyVersion: LEGACY_METHODOLOGY_VERSION,
      frozenAt: METHODOLOGY_FROZEN_AT,
      fieldAveragePct: legacyFieldAveragePct,
      includedFields: ['title', 'firstAuthor', 'year', 'venue', 'volume', 'issue', 'pages', 'doi'],
      matchRules: {
        title: 'normalized fuzzy >= 90',
        firstAuthor: 'normalized fuzzy >= 90',
        venue: 'normalized fuzzy >= 90',
        year: 'normalized exact',
        volume: 'normalized exact',
        issue: 'normalized exact',
        pages: 'normalized exact',
        doi: 'normalized exact',
      },
      renderSimilarityIncluded: false,
    },
    overall,
    countIntegrityPct,
    nonEmptyOutputPct,
    identityIntegrityPct,
    identityContaminationCount: Object.values(overallIdentityBuckets).reduce((sum, value) => sum + value, 0),
    identityContaminationByCategory: overallIdentityBuckets,
    ieeeFailureBreakdown,
    actionNeededReasonCounts,
    validationIssueCounts: Object.fromEntries(Array.from(validationIssueCounts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))),
    missingRequiredFieldCounts: Object.fromEntries(Array.from(missingRequiredFieldCounts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))),
    dominantFailureLedger,
    nearPassLedger,
    weightedLiftModel,
    fallbackRouting: {
      llmEnabled,
      llmUsedInRun: llmFallbackAttemptedCount > 0 || llmFallbackAcceptedCount > 0,
      directModelCallCount: llmFallbackAttemptedCount,
      directAcceptedCount: llmFallbackDirectAcceptedCount,
      clusterReuseAcceptedCount: llmFallbackClusterReuseAcceptedCount,
      acceptedCitationCount: llmFallbackAcceptedCount,
      rejectedCount: llmFallbackRejectedCount,
      budgetSkippedCount: llmFallbackBudgetSkippedCount,
      acceptedWithFieldImprovementsCount: llmFallbackAcceptedWithFieldImprovementsCount,
      acceptedWithOutputCount: llmFallbackAcceptedWithOutputCount,
      acceptedWithStrictPassLiftCount: llmFallbackAcceptedWithStrictPassLiftCount,
      totalStrictPassDelta: llmFallbackTotalStrictPassDelta,
      directModelCallRatePct: toPercent(llmFallbackAttemptedCount, corpus.records.length),
      directAcceptRatePct: toPercent(llmFallbackDirectAcceptedCount, llmFallbackAttemptedCount),
      acceptedCitationRatePct: toPercent(llmFallbackAcceptedCount, corpus.records.length),
      rejectedRatePct: toPercent(llmFallbackRejectedCount, llmFallbackAttemptedCount),
      improvedFieldCounts: Object.fromEntries(Array.from(llmFallbackImprovedFieldCounts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))),
    },
    fallbackReasonCounts: {
      attempted: Object.fromEntries(Array.from(llmFallbackAttemptReasons.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))),
      accepted: Object.fromEntries(Array.from(llmFallbackAcceptedReasons.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))),
      rejected: Object.fromEntries(Array.from(llmFallbackRejectedReasons.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))),
    },
    typeConfusionMatrix,
    selectorDiagnostics: {
      selectorModes: Object.fromEntries(Array.from(selectorModeCounts.entries()).sort((left, right) => left[0].localeCompare(right[0]))),
      selectionModes: Object.fromEntries(Array.from(selectionModeCounts.entries()).sort((left, right) => left[0].localeCompare(right[0]))),
      topWinnerAdapters: rankedCounts(winnerAdapterCounts)
        .slice(0, 12)
        .map(({ value, count }) => ({ adapterId: value, count })),
      topSelectionReasons: rankedCounts(selectionReasonCounts)
        .slice(0, 12)
        .map(({ value, count }) => ({ reason: value, count })),
    },
    byBatchSize: batchSummaries,
    bySourceType: bySourceTypeSummary,
    byInputStyle: byInputStyleSummary,
    byField,
    sampleFailures: sampleFailures.sort((left, right) => left.renderSimilarityPct - right.renderSimilarityPct).slice(0, 15),
    strengths,
    weaknesses,
    pros,
    cons,
    recommendedExternalPilot,
    batchRuns,
  };
  return result;
  } finally {
    if (previousLlmExtractor == null) delete process.env.ENABLE_LLM_EXTRACTOR;
    else process.env.ENABLE_LLM_EXTRACTOR = previousLlmExtractor;
    if (previousGrobidExtractor == null) delete process.env.ENABLE_GROBID_EXTRACTOR;
    else process.env.ENABLE_GROBID_EXTRACTOR = previousGrobidExtractor;
    if (previousEnrichConcurrency == null) delete process.env.V2_ENRICH_CONCURRENCY;
    else process.env.V2_ENRICH_CONCURRENCY = previousEnrichConcurrency;
    if (previousEnrichCitationTimeoutMs == null) delete process.env.V2_ENRICH_CITATION_TIMEOUT_MS;
    else process.env.V2_ENRICH_CITATION_TIMEOUT_MS = previousEnrichCitationTimeoutMs;
    if (previousEnrichTimeoutMs == null) delete process.env.V2_ENRICH_TIMEOUT_MS;
    else process.env.V2_ENRICH_TIMEOUT_MS = previousEnrichTimeoutMs;
    if (previousTruthConcurrency == null) delete process.env.V2_TRUTH_CONCURRENCY;
    else process.env.V2_TRUTH_CONCURRENCY = previousTruthConcurrency;
    if (previousProviderMaxRetries == null) delete process.env.V2_PROVIDER_MAX_RETRIES;
    else process.env.V2_PROVIDER_MAX_RETRIES = previousProviderMaxRetries;
    if (previousProviderMaxRetryAfterMs == null) delete process.env.V2_PROVIDER_MAX_RETRY_AFTER_MS;
    else process.env.V2_PROVIDER_MAX_RETRY_AFTER_MS = previousProviderMaxRetryAfterMs;
  }
}

export async function runAcademicBenchmark(options?: {
  adapters?: V2AdapterBundle;
}): Promise<AcademicBenchmarkReport> {
  const primary = await runAcademicBenchmarkMode('primary_benchmark', {
    adapters: options?.adapters ?? createDefaultAdapters(),
  });

  return {
    generatedAt: new Date().toISOString(),
    corpusPath: CORPUS_PATH,
    corpusSize: primary.corpusSize,
    ieeeCorpusCount: primary.ieeeCorpusCount,
    repeats: primary.repeats,
    methodology: {
      source: 'Crossref public works metadata frozen into a local JSON corpus.',
      frozenAt: primary.overall.retrievalDate,
      groundTruth: 'Canonical metadata fields plus APA bibliography output rendered from frozen CSL JSON.',
      scope: Array.from(new Set(primary.bySourceType.map((entry) => entry.sourceType))),
      notes: [
        'The corpus contains 1,000 real citations drawn from Crossref and frozen locally on the generation date shown above.',
        isAcademicBenchmarkEnrichEnabled()
          ? (isAcademicBenchmarkLlmEnabled()
            ? 'The primary score uses the v2 pipeline with enrichment enabled, GPT-5.4 nano extract fallback enabled, and GROBID disabled.'
            : 'The primary score uses the deterministic v2 pipeline with enrichment enabled, LLM extraction disabled, and GROBID disabled.')
          : (isAcademicBenchmarkLlmEnabled()
            ? 'The primary score uses the v2 pipeline with enrichment disabled, GPT-5.4 nano extract fallback enabled, and GROBID disabled.'
            : 'The primary score uses the deterministic v2 pipeline with enrichment, LLM extraction, and GROBID disabled for repeatability.'),
        'Strict external readiness requires referenceType, year, title, firstAuthor, venue, non-empty output, and identity integrity to all pass.',
        'The legacy-comparable score is a frozen field-average reference for internal comparison only.',
      ],
    },
    strict_external: primary.strict_external,
    legacy_comparable: primary.legacy_comparable,
    overall: primary.overall,
    countIntegrityPct: primary.countIntegrityPct,
    nonEmptyOutputPct: primary.nonEmptyOutputPct,
    identityIntegrityPct: primary.identityIntegrityPct,
    identityContaminationCount: primary.identityContaminationCount,
    identityContaminationByCategory: primary.identityContaminationByCategory,
    actionNeededReasonCounts: primary.actionNeededReasonCounts,
    validationIssueCounts: primary.validationIssueCounts,
    missingRequiredFieldCounts: primary.missingRequiredFieldCounts,
    dominantFailureLedger: primary.dominantFailureLedger,
    nearPassLedger: primary.nearPassLedger,
    weightedLiftModel: primary.weightedLiftModel,
    fallbackRouting: primary.fallbackRouting,
    fallbackReasonCounts: primary.fallbackReasonCounts,
    ieeeFailureBreakdown: primary.ieeeFailureBreakdown,
    typeConfusionMatrix: primary.typeConfusionMatrix,
    selectorDiagnostics: primary.selectorDiagnostics,
    byBatchSize: primary.byBatchSize,
    bySourceType: primary.bySourceType,
    byInputStyle: primary.byInputStyle,
    byField: primary.byField,
    sampleFailures: primary.sampleFailures,
    strengths: primary.strengths,
    weaknesses: primary.weaknesses,
    pros: primary.pros,
    cons: primary.cons,
    recommendedExternalPilot: primary.recommendedExternalPilot,
    batchRuns: primary.batchRuns,
  };
}

async function main(): Promise<void> {
  const report = await runAcademicBenchmark();
  await mkdir(path.dirname(OUTPUT_JSON), { recursive: true });
  await writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(OUTPUT_MD, renderMarkdown(report), 'utf8');

  console.log(JSON.stringify({
    outputJson: OUTPUT_JSON,
    outputMarkdown: OUTPUT_MD,
    strict_external: report.strict_external,
    legacy_comparable: report.legacy_comparable,
    llmExtractEnabled: isAcademicBenchmarkLlmEnabled(),
    fallbackRouting: report.fallbackRouting,
    fallbackReasonCounts: report.fallbackReasonCounts,
    byBatchSize: report.byBatchSize,
  }, null, 2));
}

const isDirectExecution = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
