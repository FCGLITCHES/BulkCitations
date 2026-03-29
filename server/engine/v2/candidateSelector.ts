import type {
  AdapterFiringRegistryEntry,
  CandidateScoreBreakdown,
  CandidateSelectionMode,
  CanonicalReferenceType,
  ExtractionCandidate,
  ParsedReference,
  V2SelectorMode,
} from '@shared/schema';
import { bestVenueFromParsed, getRequirementProfile, isLocatorLike } from './qualityRules.js';
import { normalizeDoiValue, normalizeWhitespace } from './utils.js';

export interface SelectableExtractionCandidate extends Omit<ExtractionCandidate, 'parsed'> {
  parsed: ParsedReference;
  branch: string;
  styleUsed?: string | null;
  styleConfidence?: number;
  warnings: string[];
}

export interface CandidateAttempt {
  adapterId: string;
  adapterPriority: number;
  branch: string;
  candidate: SelectableExtractionCandidate | null;
}

type CandidateRecord = {
  attempt: CandidateAttempt;
  breakdown: CandidateScoreBreakdown;
};

type CoverageTuple = [number, number, number];
const INSTITUTIONAL_CONTAINER_SIGNAL = /\b(?:organization|agency|administration|department|ministry|office|commission|council|bank|foundation|university|institute|society|association|bureau|hub|portal|observatory|network|unit|office)\b/i;
const REPORT_METADATA_SIGNAL = /\b(?:report\s+no\.?|working paper|technical note|policy brief|white paper)\b/i;
const VERSION_VENUE_SIGNAL = /\b(?:ver\.?|version)\b/i;
const PLACE_PUBLISHER_VENUE_SIGNAL = /:\s*[^.;]+\b(?:press|publisher|organization|agency|department|ministry|office|commission|council|bank|foundation|university|institute|society|association|hub|portal|observatory|network|unit)\b/i;
const YEAR_TAIL_VENUE_SIGNAL = /;\s*(?:1[5-9]\d{2}|20\d{2})$/i;

function normalizeKey(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace((value ?? '').toLowerCase())
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1).fill(0);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    for (let index = 0; index <= right.length; index += 1) previous[index] = current[index] ?? 0;
  }
  return previous[right.length] ?? 0;
}

function normalizedLevenshteinDistance(left: string | null, right: string | null): number {
  const a = normalizeKey(left);
  const b = normalizeKey(right);
  if (!a && !b) return 0;
  if (!a || !b) return 1;
  const denominator = Math.max(a.length, b.length, 1);
  return Number((levenshteinDistance(a, b) / denominator).toFixed(4));
}

function getCandidateProfile(referenceType: CanonicalReferenceType) {
  if (referenceType === 'unknown') {
    return {
      required: ['title', 'year'] as const,
      expected: ['authors'] as const,
      optional: ['doi'] as const,
    };
  }
  return getRequirementProfile(referenceType);
}

function hasField(candidate: SelectableExtractionCandidate, field: string): boolean {
  const parsed = candidate.parsed;
  switch (field) {
    case 'authors':
      if (candidate.claimedType === 'website' && Boolean(bestVenueFromParsed(parsed))) return false;
      return (parsed.authors?.length ?? 0) > 0 && candidate.plausibility.authors.plausible;
    case 'title':
      return Boolean(normalizeWhitespace(parsed.title ?? '')) && candidate.plausibility.title.plausible;
    case 'year':
      return Boolean(normalizeWhitespace(parsed.year ?? '')) && candidate.plausibility.year.plausible;
    case 'venue':
      return Boolean(normalizeWhitespace(bestVenueFromParsed(parsed) ?? '')) && candidate.plausibility.venue.plausible;
    case 'locator':
      return Boolean(normalizeWhitespace(parsed.pages ?? parsed['article-number'] ?? ''))
        && isLocatorLike(parsed.pages ?? parsed['article-number'])
        && candidate.plausibility.locator.plausible;
    case 'publisher':
      return Boolean(normalizeWhitespace(parsed.publisher ?? parsed.institution ?? '')) && candidate.plausibility.publisher.plausible;
    case 'institution':
      return Boolean(normalizeWhitespace(parsed.institution ?? '')) && candidate.plausibility.publisher.plausible;
    case 'edition':
      return Boolean(normalizeWhitespace(parsed.edition ?? ''));
    case 'url':
      return Boolean(normalizeWhitespace(parsed.url ?? ''));
    case 'doi':
      return Boolean(normalizeWhitespace(parsed.doi ?? ''));
    case 'volume':
      return Boolean(normalizeWhitespace(parsed.volume ?? ''));
    case 'issue':
      return Boolean(normalizeWhitespace(parsed.issue ?? ''));
    case 'bookTitle':
      return Boolean(normalizeWhitespace(parsed.bookTitle ?? ''));
    case 'conferenceTitle':
      return Boolean(normalizeWhitespace(parsed.conferenceTitle ?? ''));
    default:
      return false;
  }
}

function coverageTuple(candidate: SelectableExtractionCandidate): CoverageTuple {
  const { parsed, claimedType } = candidate;
  const profile = getCandidateProfile(claimedType);
  const requiredCoveredCount = profile.required.filter((field) => hasField(candidate, field)).length;
  const expectedCoveredCount = profile.expected.filter((field) => hasField(candidate, field)).length;
  const optionalCoveredCount = profile.optional.filter((field) => hasField(candidate, field)).length;
  return [requiredCoveredCount, expectedCoveredCount, optionalCoveredCount];
}

function consensusMap(candidates: SelectableExtractionCandidate[], key: keyof ExtractionCandidate['normalizedKeyFields']) {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const value = candidate.normalizedKeyFields[key];
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function consensusScore(candidate: SelectableExtractionCandidate, counts: {
  title: Map<string, number>;
  year: Map<string, number>;
  doi: Map<string, number>;
}): number {
  let score = 0;
  for (const key of ['title', 'year', 'doi'] as const) {
    const value = candidate.normalizedKeyFields[key];
    if (!value) continue;
    const agreementCount = counts[key].get(value) ?? 0;
    if (agreementCount >= 2) {
      score += 0.2 * Math.min(agreementCount - 1, 2);
    }
  }
  return Number(score.toFixed(3));
}

function sourceTypeCoherence(candidate: SelectableExtractionCandidate): number {
  const { claimedType, containerHints } = candidate;
  if (containerHints.containerKindConfidence < 0.85) return 0;
  if (containerHints.containerKindHint === 'conference' && claimedType === 'conference') return 1.4;
  if (containerHints.containerKindHint === 'journal' && claimedType === 'journal') return 1.1;
  if (containerHints.containerKindHint === 'book' && (claimedType === 'book' || claimedType === 'chapter')) return 1.2;
  if (containerHints.containerKindHint === 'report' && claimedType === 'report') return 1.1;
  if (containerHints.containerKindHint === 'thesis' && claimedType === 'thesis') return 1.1;
  if (containerHints.containerKindHint === 'website' && claimedType === 'website') return 1;
  return -0.2;
}

function doiYearConsistency(candidate: SelectableExtractionCandidate): number {
  let score = 0;
  const year = candidate.normalizedKeyFields.year;
  if (year) score += 0.45;

  const doi = candidate.normalizedKeyFields.doi;
  if (doi) score += 0.55;
  if (doi && candidate.parsed.url && candidate.parsed.url.toLowerCase().includes(normalizeDoiValue(doi).toLowerCase())) {
    score += 0.2;
  }
  return Number(score.toFixed(3));
}

function contaminationPenalty(candidate: SelectableExtractionCandidate): number {
  let penalty = 0;
  if (candidate.containerHints.venueContaminated) penalty += 0.95;
  if (candidate.containerHints.titleContainerBleed) penalty += 0.9;
  if (candidate.containerHints.locatorInVenue) penalty += 0.45;
  if (candidate.containerHints.copyrightTailPresent) penalty += 0.2;

  penalty += candidate.plausibility.authors.penalty;
  penalty += candidate.plausibility.title.penalty;
  penalty += candidate.plausibility.venue.penalty;
  penalty += candidate.plausibility.locator.penalty;
  penalty += candidate.plausibility.publisher.penalty;
  penalty += candidate.plausibility.year.penalty;
  return Number(penalty.toFixed(3));
}

function buildBreakdown(
  attempt: CandidateAttempt,
  consensus: { title: Map<string, number>; year: Map<string, number>; doi: Map<string, number> },
): CandidateScoreBreakdown {
  if (!attempt.candidate) {
    return {
      vetoed: false,
      vetoReasons: [],
      requiredCoveredCount: 0,
      requiredTotalCount: 0,
      expectedCoveredCount: 0,
      expectedTotalCount: 0,
      optionalCoveredCount: 0,
      optionalTotalCount: 0,
      contaminationPenalty: 0,
      consensusScore: 0,
      sourceTypeCoherence: 0,
      doiYearConsistency: 0,
      adapterPriority: attempt.adapterPriority,
    };
  }

  const [requiredCoveredCount, expectedCoveredCount, optionalCoveredCount] = coverageTuple(
    attempt.candidate,
  );
  const profile = getCandidateProfile(attempt.candidate.claimedType);
  const vetoReasons = profile.required.filter((field) => !hasField(attempt.candidate!, field));
  const hasCredibleVenue = hasField(attempt.candidate, 'venue');
  const hasCredibleLocator = hasField(attempt.candidate, 'locator');
  const hasExplicitSerialStructure = hasField(attempt.candidate, 'volume')
    || hasField(attempt.candidate, 'issue')
    || hasCredibleLocator;
  const venueValue = normalizeWhitespace(bestVenueFromParsed(attempt.candidate.parsed) ?? '');
  const primaryAuthor = normalizeWhitespace(attempt.candidate.parsed.authors?.[0] ?? '');
  const hasInstitutionalVenueOnly = Boolean(venueValue) && INSTITUTIONAL_CONTAINER_SIGNAL.test(venueValue);
  const hasInstitutionalAuthorLead = Boolean(primaryAuthor) && INSTITUTIONAL_CONTAINER_SIGNAL.test(primaryAuthor);
  const venueLooksPublisherTail = PLACE_PUBLISHER_VENUE_SIGNAL.test(venueValue) || YEAR_TAIL_VENUE_SIGNAL.test(venueValue);
  const urlBackedNonSerialVenue = Boolean(normalizeWhitespace(attempt.candidate.parsed.url ?? ''))
    && !hasExplicitSerialStructure
    && (
      hasInstitutionalVenueOnly
      || VERSION_VENUE_SIGNAL.test(venueValue)
      || venueLooksPublisherTail
      || attempt.candidate.containerHints.containerKindHint === 'website'
      || attempt.candidate.containerHints.containerKindHint === 'report'
    );
  const hasSerialStructure = hasExplicitSerialStructure
    || (hasCredibleVenue && !urlBackedNonSerialVenue && !venueLooksPublisherTail);
  const titleLooksLikeReportMetadata = REPORT_METADATA_SIGNAL.test(
    normalizeWhitespace(attempt.candidate.parsed.title ?? ''),
  );
  const titleContainsBrokenReportNote = /\(\s*Report No\b/i.test(
    normalizeWhitespace(attempt.candidate.parsed.title ?? ''),
  );
  const venueLooksMetadataLike = !attempt.candidate.plausibility.venue.plausible
    || VERSION_VENUE_SIGNAL.test(venueValue)
    || venueLooksPublisherTail;
  const placeValue = normalizeWhitespace(attempt.candidate.parsed.placeOfPublication ?? '');
  const journalLooksLikeReportIdentifier = /^[A-Z]{2,}(?:-[A-Z0-9]{2,})+$/i.test(venueValue);
  const placeContainsReportIdentifier = /\b[A-Z]{2,}(?:-[A-Z0-9]{2,})+\)?/i.test(placeValue);
  const reportLikeJournalMetadata = (venueLooksPublisherTail || titleLooksLikeReportMetadata || hasInstitutionalVenueOnly)
    && Boolean(normalizeWhitespace(
      attempt.candidate.parsed.publisher
      ?? attempt.candidate.parsed.institution
      ?? attempt.candidate.parsed.url
      ?? '',
    ))
    && hasInstitutionalAuthorLead;
  const brokenReportLikeJournalFallback = hasInstitutionalAuthorLead
    && (titleContainsBrokenReportNote || journalLooksLikeReportIdentifier || placeContainsReportIdentifier);

  if (
    attempt.candidate.claimedType === 'journal'
    && (
      (
        !hasSerialStructure
        && (
          Boolean(normalizeWhitespace(attempt.candidate.parsed.publisher ?? attempt.candidate.parsed.institution ?? ''))
          || Boolean(normalizeWhitespace(attempt.candidate.parsed.url ?? ''))
          || hasInstitutionalVenueOnly
          || venueLooksMetadataLike
          || titleLooksLikeReportMetadata
        )
      )
      || reportLikeJournalMetadata
      || brokenReportLikeJournalFallback
    )
  ) {
    vetoReasons.push('venue');
  }

  if (
    attempt.candidate.claimedType === 'conference'
    && !hasCredibleVenue
    && !hasCredibleLocator
  ) {
    vetoReasons.push('venue');
  }

  if (
    attempt.candidate.claimedType === 'book'
    && (
      !hasField(attempt.candidate, 'publisher')
      || (
        !hasField(attempt.candidate, 'edition')
        && !attempt.candidate.containerHints.publisherTailPresent
        && attempt.candidate.containerHints.containerKindHint !== 'book'
      )
    )
  ) {
    vetoReasons.push('publisher');
  }

  return {
    vetoed: vetoReasons.length > 0,
    vetoReasons,
    requiredCoveredCount,
    requiredTotalCount: profile.required.length,
    expectedCoveredCount,
    expectedTotalCount: profile.expected.length,
    optionalCoveredCount,
    optionalTotalCount: profile.optional.length,
    contaminationPenalty: contaminationPenalty(attempt.candidate),
    consensusScore: consensusScore(attempt.candidate, consensus),
    sourceTypeCoherence: sourceTypeCoherence(attempt.candidate),
    doiYearConsistency: doiYearConsistency(attempt.candidate),
    adapterPriority: attempt.adapterPriority,
  };
}

function compareCoverage(left: CandidateScoreBreakdown, right: CandidateScoreBreakdown): number {
  if (left.requiredCoveredCount !== right.requiredCoveredCount) {
    return right.requiredCoveredCount - left.requiredCoveredCount;
  }
  if (left.expectedCoveredCount !== right.expectedCoveredCount) {
    return right.expectedCoveredCount - left.expectedCoveredCount;
  }
  if (left.optionalCoveredCount !== right.optionalCoveredCount) {
    return right.optionalCoveredCount - left.optionalCoveredCount;
  }
  return 0;
}

function compareLexicographic(left: CandidateRecord, right: CandidateRecord): number {
  if (left.breakdown.vetoed !== right.breakdown.vetoed) {
    return left.breakdown.vetoed ? 1 : -1;
  }

  return compareCoverage(left.breakdown, right.breakdown)
    || (left.breakdown.contaminationPenalty - right.breakdown.contaminationPenalty)
    || (right.breakdown.consensusScore - left.breakdown.consensusScore)
    || (right.breakdown.sourceTypeCoherence - left.breakdown.sourceTypeCoherence)
    || (right.breakdown.doiYearConsistency - left.breakdown.doiYearConsistency)
    || (left.breakdown.adapterPriority - right.breakdown.adapterPriority);
}

function buildFingerprint(candidate: SelectableExtractionCandidate): string {
  return [
    candidate.claimedType,
    candidate.normalizedKeyFields.title ?? '',
    candidate.normalizedKeyFields.venue ?? '',
    candidate.normalizedKeyFields.year ?? '',
    candidate.normalizedKeyFields.doi ?? '',
  ].join('|');
}

function isEffectivelyUnanimous(records: CandidateRecord[]): boolean {
  if (records.length < 2) return false;

  let maxDistance = 0;
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const distance = normalizedLevenshteinDistance(
        buildFingerprint(records[leftIndex]!.attempt.candidate!),
        buildFingerprint(records[rightIndex]!.attempt.candidate!),
      );
      maxDistance = Math.max(maxDistance, distance);
      if (maxDistance >= 0.08) return false;
    }
  }
  return true;
}

function registryEntry(record: CandidateRecord | null, attempt: CandidateAttempt, selected: boolean): AdapterFiringRegistryEntry {
  return {
    adapterId: attempt.adapterId,
    candidateId: attempt.candidate?.id,
    attempted: true,
    producedCandidate: Boolean(attempt.candidate),
    vetoed: record?.breakdown.vetoed ?? false,
    vetoReasons: record?.breakdown.vetoReasons ?? [],
    coverageTuple: [
      record?.breakdown.requiredCoveredCount ?? 0,
      record?.breakdown.expectedCoveredCount ?? 0,
      record?.breakdown.optionalCoveredCount ?? 0,
    ],
    contaminationPenalty: record?.breakdown.contaminationPenalty ?? 0,
    consensusScore: record?.breakdown.consensusScore ?? 0,
    sourceTypeCoherence: record?.breakdown.sourceTypeCoherence ?? 0,
    doiYearConsistency: record?.breakdown.doiYearConsistency ?? 0,
    adapterPriority: attempt.adapterPriority,
    selected,
  };
}

export function buildNormalizedKeyFields(parsed: ParsedReference): ExtractionCandidate['normalizedKeyFields'] {
  return {
    title: normalizeKey(parsed.title),
    year: normalizeKey(parsed.year),
    venue: normalizeKey(bestVenueFromParsed(parsed)),
    doi: normalizeKey(parsed.doi ? normalizeDoiValue(parsed.doi) : null),
  };
}

export function selectExtractionCandidate(
  attempts: CandidateAttempt[],
  selectorMode: V2SelectorMode,
): {
  winner: SelectableExtractionCandidate | null;
  winnerBreakdown: CandidateScoreBreakdown | null;
  adapterRegistry: AdapterFiringRegistryEntry[];
  selectionMode: CandidateSelectionMode;
  selectionReason: string;
} {
  const candidates = attempts.flatMap((attempt) => attempt.candidate ? [attempt.candidate] : []);
  const consensus = {
    title: consensusMap(candidates, 'title'),
    year: consensusMap(candidates, 'year'),
    doi: consensusMap(candidates, 'doi'),
  };
  const records = attempts.map((attempt) => ({
    attempt,
    breakdown: buildBreakdown(attempt, consensus),
  }));

  const surviving = records.filter((record) => record.attempt.candidate && !record.breakdown.vetoed);
  const produced = records.filter((record) => record.attempt.candidate);
  const fallbackRecord = produced.sort((left, right) => left.attempt.adapterPriority - right.attempt.adapterPriority)[0] ?? null;

  let winnerRecord: CandidateRecord | null = null;
  let selectionMode: CandidateSelectionMode = 'full_scoring';
  let selectionReason = 'lexicographic_veto_coverage_contamination_consensus';

  if (selectorMode === 'legacy_first_match') {
    winnerRecord = fallbackRecord;
    selectionMode = produced.length <= 1 ? 'single_survivor' : 'full_scoring';
    selectionReason = 'legacy_first_match_order';
  } else if (surviving.length === 1) {
    winnerRecord = surviving[0] ?? fallbackRecord;
    selectionMode = 'single_survivor';
    selectionReason = 'single_survivor_after_required_field_veto';
  } else if (surviving.length > 1 && isEffectivelyUnanimous(surviving)) {
    winnerRecord = [...surviving].sort((left, right) =>
      compareCoverage(left.breakdown, right.breakdown)
      || (left.breakdown.adapterPriority - right.breakdown.adapterPriority))[0] ?? fallbackRecord;
    selectionMode = 'unanimous_diversity_guard';
    selectionReason = 'unanimous_diversity_guard';
  } else {
    winnerRecord = [...(surviving.length > 0 ? surviving : produced)].sort(compareLexicographic)[0] ?? null;
    selectionMode = surviving.length <= 1 ? 'single_survivor' : 'full_scoring';
    selectionReason = surviving.length > 0
      ? 'lexicographic_veto_coverage_contamination_consensus'
      : 'all_candidates_vetoed_fallback_to_best_available';
  }

  const adapterRegistry = attempts.map((attempt) => {
    const record = records.find((entry) => entry.attempt.adapterId === attempt.adapterId && entry.attempt.adapterPriority === attempt.adapterPriority) ?? null;
    return registryEntry(record, attempt, Boolean(
      winnerRecord
      && attempt.candidate
      && winnerRecord.attempt.candidate
      && attempt.candidate.id === winnerRecord.attempt.candidate.id,
    ));
  });

  return {
    winner: winnerRecord?.attempt.candidate ?? null,
    winnerBreakdown: winnerRecord?.breakdown ?? null,
    adapterRegistry,
    selectionMode,
    selectionReason,
  };
}
