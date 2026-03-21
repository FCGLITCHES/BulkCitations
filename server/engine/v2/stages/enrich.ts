import pLimit from 'p-limit';
import type {
  CanonicalCitation,
  EnrichmentMetadata,
  FieldValue,
  ResolutionAcceptedCandidate,
  ResolutionMetadata,
} from '@shared/schema';
import { isPlaceholderFieldValue } from '@shared/referencePlaceholders';
import { isGroupAuthor, normalizeGroupAuthor } from '../../shared/citationSemantics.js';
import type {
  CacheAdapter,
  ResolutionCandidateRecord,
  ResolutionProviderAdapter,
  ResolutionSearchQuery,
  V2Stage,
} from '../contracts.js';
import {
  buildAcceptedCandidateSummary,
  buildResolutionMetadata,
  buildResolutionQueryEvidence,
  chooseBestResolutionCandidate,
} from '../resolution.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  createStageDiagnostic,
  logStructuredDebug,
  normalizeDoiValue,
  normalizeWhitespace,
  nowIso,
} from '../utils.js';

const PROVIDER_LIMIT = 5;
const DEFAULT_ENRICH_CONCURRENCY = 3;

type ProviderKey = 'doi' | 'crossref' | 'pubmed' | 'openalex';

type CachedResolutionPayload = {
  status: ResolutionMetadata['status'];
  provider?: string;
  matchStrategy?: ResolutionMetadata['matchStrategy'];
  candidateCount: number;
  acceptedCandidate?: ResolutionAcceptedCandidate;
  rejectedReasons: string[];
  yearToleranceApplied: boolean;
};

function updateStringField(
  field: FieldValue<string | null>,
  incoming: string | undefined,
  stageId: string,
  conflictFields: string[],
  conflictName: string,
  normalizer: (value: string) => string = (value) => normalizeWhitespace(value.toLowerCase()),
): FieldValue<string | null> {
  const nextValue = normalizeWhitespace(incoming ?? '') || undefined;
  if (!nextValue) return field;

  if (!field.value || isPlaceholderFieldValue(field.value)) {
    return {
      value: nextValue,
      source: 'authority',
      confidence: Math.max(field.confidence, 0.94),
      stageId,
    };
  }

  if (normalizer(field.value) !== normalizer(nextValue) && !conflictFields.includes(conflictName)) {
    conflictFields.push(conflictName);
  }
  return field;
}

function updateNumericField(
  field: FieldValue<number | null>,
  incoming: number | undefined,
  stageId: string,
  conflictFields: string[],
  conflictName: string,
): FieldValue<number | null> {
  if (incoming == null || !Number.isFinite(incoming)) return field;
  if (field.value == null) {
    return {
      value: incoming,
      source: 'authority',
      confidence: Math.max(field.confidence, 0.94),
      stageId,
    };
  }

  if (field.value !== incoming && !conflictFields.includes(conflictName)) {
    conflictFields.push(conflictName);
  }
  return field;
}

function buildVenueNormalizer(value: string): string {
  return normalizeWhitespace(value.toLowerCase()).replace(/[^\p{L}\p{N}\s]+/gu, ' ');
}

function cacheKeyForCitation(citation: CanonicalCitation): string {
  const evidence = buildResolutionQueryEvidence(citation);
  return [
    normalizeWhitespace((citation.title.value ?? '').toLowerCase()),
    normalizeWhitespace((evidence.firstAuthorSurname ?? evidence.groupAuthorLiteral ?? '').toLowerCase()),
    citation.year.value ?? '',
    citation.referenceType,
  ].join('|');
}

function isBiomedical(citation: CanonicalCitation): boolean {
  const combined = normalizeWhitespace([
    citation.journal.value ?? '',
    citation.title.value ?? '',
  ].join(' ').toLowerCase());
  return /(med|clinical|oncology|cardio|biomed|health|lancet|nejm|jama|bmj|tuberculosis|radiology|medical)/.test(combined);
}

function isCorporateHeavy(citation: CanonicalCitation): boolean {
  if (citation.authors.value.some((author) => Boolean(author.literal) || isGroupAuthor(author.last))) return true;
  if (citation.publisher.value && isGroupAuthor(citation.publisher.value)) return true;
  if (citation.institution.value && isGroupAuthor(citation.institution.value)) return true;
  return false;
}

function providerOrderForCitation(citation: CanonicalCitation): ProviderKey[] {
  if (citation.doi.value) return ['doi'];
  if (isBiomedical(citation) && ['journal', 'preprint', 'unknown'].includes(citation.referenceType)) {
    return ['crossref', 'pubmed', 'openalex'];
  }
  if (['report', 'book', 'website', 'chapter'].includes(citation.referenceType) || isCorporateHeavy(citation)) {
    return ['openalex', 'crossref'];
  }
  return ['crossref', 'openalex'];
}

async function fetchProviderCandidates(
  provider: ResolutionProviderAdapter,
  query: ResolutionSearchQuery,
  doi: string | null,
  providerKey: ProviderKey,
): Promise<ResolutionCandidateRecord[]> {
  switch (providerKey) {
    case 'doi':
      return doi ? provider.lookupByDoi(doi) : [];
    case 'crossref':
      return query.title ? provider.searchCrossrefByTitle(query, PROVIDER_LIMIT) : [];
    case 'pubmed':
      return query.title ? provider.searchPubmedByTitle(query, PROVIDER_LIMIT) : [];
    case 'openalex':
      return query.title ? provider.searchOpenAlexByTitle(query, PROVIDER_LIMIT) : [];
    default:
      return [];
  }
}

function toMatchStrategy(providerKey: ProviderKey): ResolutionMetadata['matchStrategy'] {
  switch (providerKey) {
    case 'doi':
      return 'crossref_doi';
    case 'crossref':
      return 'crossref_exact_title';
    case 'pubmed':
      return 'pubmed_exact_title';
    case 'openalex':
      return 'openalex_exact_title';
    default:
      return 'none';
  }
}

function applyVerifiedCandidate(
  citation: CanonicalCitation,
  candidate: ResolutionAcceptedCandidate,
): { citation: CanonicalCitation; conflictFields: string[] } {
  const conflictFields: string[] = [];

  let nextCitation: CanonicalCitation = {
    ...citation,
    title: updateStringField(citation.title, candidate.title, 'enrich', conflictFields, 'title'),
    year: updateNumericField(citation.year, candidate.year, 'enrich', conflictFields, 'year'),
    doi: updateStringField(citation.doi, candidate.doi ? normalizeDoiValue(candidate.doi) : undefined, 'enrich', conflictFields, 'doi', normalizeDoiValue),
    url: updateStringField(citation.url, candidate.url, 'enrich', conflictFields, 'url'),
    volume: updateStringField(citation.volume, candidate.volume, 'enrich', conflictFields, 'volume'),
    issue: updateStringField(citation.issue, candidate.issue, 'enrich', conflictFields, 'issue'),
    pages: updateStringField(citation.pages, candidate.pages, 'enrich', conflictFields, 'pages'),
    publisher: updateStringField(citation.publisher, candidate.publisher, 'enrich', conflictFields, 'publisher'),
  };

  const venue = candidate.venue;
  if (citation.referenceType === 'conference') {
    nextCitation = {
      ...nextCitation,
      conferenceTitle: updateStringField(citation.conferenceTitle, venue, 'enrich', conflictFields, 'conferenceTitle', buildVenueNormalizer),
    };
  } else if (['book', 'chapter'].includes(citation.referenceType)) {
    nextCitation = {
      ...nextCitation,
      bookTitle: updateStringField(citation.bookTitle, venue, 'enrich', conflictFields, 'bookTitle', buildVenueNormalizer),
    };
  } else {
    nextCitation = {
      ...nextCitation,
      journal: updateStringField(citation.journal, venue, 'enrich', conflictFields, 'journal', buildVenueNormalizer),
    };
  }

  if (citation.referenceType === 'report' && !nextCitation.institution.value && candidate.publisher && isGroupAuthor(candidate.publisher)) {
    nextCitation = {
      ...nextCitation,
      institution: {
        value: normalizeGroupAuthor(candidate.publisher),
        source: 'authority',
        confidence: Math.max(nextCitation.institution.confidence, 0.9),
        stageId: 'enrich',
      },
    };
  }

  return { citation: nextCitation, conflictFields };
}

function buildEnrichmentFromResolution(
  status: EnrichmentMetadata['status'],
  providerId: string,
  providerKey: ProviderKey | 'cache' | 'unverifiable' | 'skipped',
  candidate?: ResolutionAcceptedCandidate,
  raw?: Record<string, unknown>,
  cacheHit = false,
): EnrichmentMetadata {
  return {
    status,
    provider: candidate?.provider ?? providerId,
    sourceUsed: providerKey === 'doi'
      ? 'crossref_doi'
      : providerKey === 'crossref'
        ? 'crossref_title_author'
        : providerKey === 'pubmed'
          ? 'pubmed'
          : providerKey === 'openalex'
            ? 'openalex'
            : providerKey === 'cache'
              ? 'cache'
              : providerKey === 'skipped'
                ? 'skipped'
                : 'unverifiable',
    cacheHit,
    doiFound: Boolean(candidate?.doi),
    abstractFound: false,
    retractedFlag: /retract/i.test(String(candidate?.title ?? '')),
    matchedTitle: candidate?.title,
    matchedAuthors: candidate?.authors,
    matchedYear: candidate?.year,
    url: candidate?.url,
    raw,
  };
}

export function createEnrichStage(resolutionProvider: ResolutionProviderAdapter, cache: CacheAdapter): V2Stage {
  return {
    id: 'enrich',
    async run(context) {
      const startedAt = Date.now();
      if (!context.request.enrich) {
        const citations = context.citations.map((citation) => addCitationStageLog(
          attachCitationDebug({
            ...citation,
            enrichment: citation.enrichment ?? buildEnrichmentFromResolution('skipped', resolutionProvider.id, 'skipped'),
          }, 'enrich', {
            status: 'skipped',
            providerOrder: [],
            candidateCount: 0,
            warningFlags: [],
          }, context.debugEnabled),
          createStageDiagnostic('enrich', 'skipped', 'Strict external resolution disabled for this request.', {
            provider: resolutionProvider.id,
          }),
        ));

        return {
          ...context,
          citations,
          jobDebug: context.debugEnabled
            ? {
              ...context.jobDebug,
              enrich: {
                citationCount: citations.length,
                provider: resolutionProvider.id,
                skipped: true,
              },
            }
            : context.jobDebug,
          pipelineLog: [
            ...context.pipelineLog,
            createStageDiagnostic(
              'enrich',
              'skipped',
              `Skipped strict external resolution for ${citations.length} citation(s).`,
              { provider: resolutionProvider.id, citationCount: citations.length },
              Date.now() - startedAt,
            ),
          ],
        };
      }

      const concurrency = Number.parseInt(process.env.V2_ENRICH_CONCURRENCY ?? String(DEFAULT_ENRICH_CONCURRENCY), 10);
      const limit = pLimit(Number.isFinite(concurrency) && concurrency > 0 ? concurrency : DEFAULT_ENRICH_CONCURRENCY);

      const results = await Promise.all(context.citations.map((citation, citationIndex) => limit(async () => {
        const localFallbacks: string[] = [];
        let localPartialResult = false;

        if (citation.status === 'duplicate') {
          const nextCitation = attachCitationDebug({
            ...citation,
            resolution: buildResolutionMetadata(citation, 'skipped_duplicate', {
              resolvedAt: nowIso(),
              provider: resolutionProvider.id,
              matchStrategy: 'none',
            }),
            enrichment: buildEnrichmentFromResolution('skipped', resolutionProvider.id, 'skipped'),
          }, 'enrich', {
            status: 'skipped_duplicate',
            providerOrder: [],
            candidateCount: 0,
            warningFlags: [],
          }, context.debugEnabled);

          return {
            citation: addCitationStageLog(nextCitation, createStageDiagnostic('enrich', 'skipped', 'Resolution skipped for duplicate citation.')),
            fallbacksUsed: localFallbacks,
            partialResult: localPartialResult,
          };
        }

        const queryEvidence = buildResolutionQueryEvidence(citation);
        if (!queryEvidence.titlePresent || (!queryEvidence.firstAuthorSurname && !queryEvidence.groupAuthorLiteral)) {
          const nextCitation = attachCitationDebug({
            ...citation,
            resolution: {
              ...buildResolutionMetadata(citation, 'insufficient_evidence', {
                resolvedAt: nowIso(),
                provider: resolutionProvider.id,
                matchStrategy: 'none',
              }),
              rejectedReasons: ['parse_too_sparse'],
            },
            enrichment: buildEnrichmentFromResolution('no_match', resolutionProvider.id, 'unverifiable'),
          }, 'enrich', {
            status: 'insufficient_evidence',
            providerOrder: [],
            candidateCount: 0,
            warningFlags: ['parse_too_sparse'],
          }, context.debugEnabled);
          logStructuredDebug(context, 'enrich', citationIndex, nextCitation, {
            providerOrder: [],
            warningFlags: ['parse_too_sparse'],
            candidateCount: 0,
          });
          return {
            citation: addCitationStageLog(nextCitation, createStageDiagnostic('enrich', 'warning', 'Skipped network resolution because parse evidence was insufficient.', {
              provider: resolutionProvider.id,
              reason: 'parse_too_sparse',
            })),
            fallbacksUsed: localFallbacks,
            partialResult: localPartialResult,
          };
        }

        const cacheKey = cacheKeyForCitation(citation);
        const resolutionQuery: ResolutionSearchQuery = {
          title: citation.title.value ?? '',
          firstAuthorSurname: queryEvidence.firstAuthorSurname,
          groupAuthorLiteral: queryEvidence.groupAuthorLiteral,
          year: queryEvidence.year ?? null,
          venue: queryEvidence.venue ?? null,
          sourceType: queryEvidence.sourceType,
        };
        const cached = await cache.get<CachedResolutionPayload>(cacheKey);
        if (cached) {
          let cachedCitation = citation;
          let conflictFields: string[] = [];
          if (cached.acceptedCandidate) {
            const merged = applyVerifiedCandidate(cachedCitation, cached.acceptedCandidate);
            cachedCitation = merged.citation;
            conflictFields = merged.conflictFields;
          }

          cachedCitation = attachCitationDebug({
            ...cachedCitation,
            resolution: {
              ...buildResolutionMetadata(cachedCitation, cached.status, {
                resolvedAt: nowIso(),
                provider: cached.provider,
                matchStrategy: cached.matchStrategy,
                acceptedCandidate: cached.acceptedCandidate,
              }),
              candidateCount: cached.candidateCount,
              rejectedReasons: cached.rejectedReasons,
              conflictFields,
              yearToleranceApplied: cached.yearToleranceApplied,
            },
            enrichment: buildEnrichmentFromResolution(
              cached.acceptedCandidate ? 'fetched' : 'no_match',
              resolutionProvider.id,
              'cache',
              cached.acceptedCandidate,
              cached.acceptedCandidate ? { cached: true } : undefined,
              true,
            ),
          }, 'enrich', {
            status: cached.status,
            providerOrder: ['cache'],
            cacheHit: true,
            candidateCount: cached.candidateCount,
            conflictFields,
            warningFlags: conflictFields,
          }, context.debugEnabled);
          logStructuredDebug(context, 'enrich', citationIndex, cachedCitation, {
            providerOrder: ['cache'],
            cacheHit: true,
            candidateCount: cached.candidateCount,
            conflictFields,
            warningFlags: conflictFields,
          });
          return {
            citation: addCitationStageLog(cachedCitation, createStageDiagnostic('enrich', 'success', 'Reused cached strict resolution result.', {
              provider: cached.provider,
              status: cached.status,
              cacheKey,
              conflictFields,
            })),
            fallbacksUsed: localFallbacks,
            partialResult: localPartialResult,
          };
        }

        const providerOrder = providerOrderForCitation(citation);
        const allCandidates: ResolutionCandidateRecord[] = [];
        const rejectedReasons: string[] = [];
        let providerError = false;
        let successfulProviderCount = 0;
        let providerErrorCount = 0;
        let selected: ReturnType<typeof chooseBestResolutionCandidate> = {
          ambiguous: false,
          evaluated: [],
        };

        for (const providerKey of providerOrder) {
          try {
            const candidates = await fetchProviderCandidates(
              resolutionProvider,
              resolutionQuery,
              citation.doi.value,
              providerKey,
            );
            successfulProviderCount += 1;
            allCandidates.push(...candidates);
            selected = chooseBestResolutionCandidate(citation, allCandidates);
            if (selected.accepted && !selected.ambiguous && selected.accepted.band === 2) {
              break;
            }
          } catch (error) {
            providerError = true;
            providerErrorCount += 1;
            localPartialResult = true;
            localFallbacks.push(`enrich:${providerKey}_provider_error`);
            rejectedReasons.push(`${providerKey}_provider_error:${error instanceof Error ? error.message : String(error)}`);
          }
        }
        const evaluatedRejectedReasons = selected.evaluated
          .filter((entry) => !entry.accepted)
          .flatMap((entry) => entry.reasons.map((reason) => `${entry.candidate.provider}:${reason}`));
        rejectedReasons.push(...evaluatedRejectedReasons);

        let nextCitation = citation;
        let stageStatus: 'success' | 'warning' = 'warning';
        let stageMessage = 'No exact external match was accepted for this citation.';

        if (selected.ambiguous) {
          nextCitation = {
            ...citation,
            resolution: {
              ...buildResolutionMetadata(citation, 'ambiguous_match', {
                resolvedAt: nowIso(),
                provider: resolutionProvider.id,
                matchStrategy: 'none',
              }),
              candidateCount: allCandidates.length,
              rejectedReasons: [
                'ambiguous_match',
                ...selected.evaluated
                  .filter((entry) => entry.accepted)
                  .slice(0, 2)
                  .map((entry) => `${entry.candidate.provider}:${entry.candidate.title ?? 'unknown_title'}`),
                ...rejectedReasons,
              ],
            },
            enrichment: buildEnrichmentFromResolution('no_match', resolutionProvider.id, 'unverifiable'),
          };
          stageMessage = 'Multiple strict external matches tied; citation remains unresolved.';
        } else if (selected.accepted) {
          const acceptedCandidate = buildAcceptedCandidateSummary(selected.accepted.candidate);
          const merged = applyVerifiedCandidate(citation, acceptedCandidate);
          nextCitation = {
            ...merged.citation,
            resolution: {
              ...buildResolutionMetadata(
                merged.citation,
                selected.accepted.yearToleranceApplied ? 'verified_with_year_tolerance' : 'verified',
                {
                  resolvedAt: nowIso(),
                  provider: selected.accepted.candidate.provider,
                  matchStrategy: toMatchStrategy(
                    selected.accepted.candidate.provider === 'crossref' && citation.doi.value
                      ? 'doi'
                      : selected.accepted.candidate.provider,
                  ),
                  acceptedCandidate,
                },
              ),
              candidateCount: allCandidates.length,
              rejectedReasons,
              conflictFields: merged.conflictFields,
              yearToleranceApplied: selected.accepted.yearToleranceApplied,
            },
            enrichment: buildEnrichmentFromResolution(
              'fetched',
              resolutionProvider.id,
              selected.accepted.candidate.provider === 'crossref' && citation.doi.value ? 'doi' : selected.accepted.candidate.provider,
              acceptedCandidate,
              selected.accepted.candidate.raw,
            ),
          };
          stageStatus = merged.conflictFields.length === 0 ? 'success' : 'warning';
          stageMessage = merged.conflictFields.length === 0
            ? 'Verified citation via strict external resolution.'
            : 'Verified citation externally, but conflicting extracted fields were preserved for review.';

          await cache.set(cacheKey, {
            status: nextCitation.resolution?.status ?? 'verified',
            provider: nextCitation.resolution?.provider,
            matchStrategy: nextCitation.resolution?.matchStrategy,
            candidateCount: nextCitation.resolution?.candidateCount ?? allCandidates.length,
            acceptedCandidate,
            rejectedReasons,
            yearToleranceApplied: nextCitation.resolution?.yearToleranceApplied ?? false,
          } satisfies CachedResolutionPayload);
        } else {
          const status: ResolutionMetadata['status'] = providerError && successfulProviderCount === 0
            ? 'provider_error'
            : allCandidates.length === 0 && ['report', 'book', 'website', 'chapter'].includes(citation.referenceType)
              ? 'provider_no_coverage'
              : 'no_exact_match';

          nextCitation = {
            ...citation,
            resolution: {
              ...buildResolutionMetadata(citation, status, {
                resolvedAt: nowIso(),
                provider: resolutionProvider.id,
                matchStrategy: 'none',
              }),
              candidateCount: allCandidates.length,
              rejectedReasons,
            },
            enrichment: buildEnrichmentFromResolution(
              providerError ? 'error' : 'no_match',
              resolutionProvider.id,
              'unverifiable',
              undefined,
              providerError ? { rejectedReasons } : undefined,
            ),
          };
          stageMessage = providerError && successfulProviderCount === 0
            ? 'External resolution completed with provider errors and no accepted exact match.'
            : 'Strict external resolution did not accept any exact-title candidate.';
          await cache.set(cacheKey, {
            status,
            provider: resolutionProvider.id,
            matchStrategy: 'none',
            candidateCount: allCandidates.length,
            rejectedReasons,
            yearToleranceApplied: false,
          } satisfies CachedResolutionPayload);
        }

        nextCitation = attachCitationDebug(nextCitation, 'enrich', {
          status: nextCitation.resolution?.status,
          providerOrder,
          candidateCount: allCandidates.length,
          successfulProviderCount,
          providerErrorCount,
          acceptedCandidate: nextCitation.resolution?.acceptedCandidate,
          rejectedReasons: nextCitation.resolution?.rejectedReasons ?? [],
          conflictFields: nextCitation.resolution?.conflictFields ?? [],
          yearToleranceApplied: nextCitation.resolution?.yearToleranceApplied ?? false,
          warningFlags: nextCitation.resolution?.conflictFields ?? [],
        }, context.debugEnabled);
        logStructuredDebug(context, 'enrich', citationIndex, nextCitation, {
          providerOrder,
          candidateCount: allCandidates.length,
          successfulProviderCount,
          providerErrorCount,
          warningFlags: nextCitation.resolution?.conflictFields ?? [],
          conflictFields: nextCitation.resolution?.conflictFields ?? [],
          selectedBranch: undefined,
          selectionReason: nextCitation.resolution?.status,
        });

        return {
          citation: addCitationStageLog(nextCitation, createStageDiagnostic('enrich', stageStatus, stageMessage, {
            provider: nextCitation.resolution?.provider,
            status: nextCitation.resolution?.status,
            candidateCount: nextCitation.resolution?.candidateCount,
            conflictFields: nextCitation.resolution?.conflictFields ?? [],
          })),
          fallbacksUsed: localFallbacks,
          partialResult: localPartialResult,
        };
      })));

      const citations = results.map((result) => result.citation);
      const fallbacksUsed = [
        ...context.fallbacksUsed,
        ...results.flatMap((result) => result.fallbacksUsed),
      ];
      const partialResult = context.partialResult || results.some((result) => result.partialResult);

      return {
        ...context,
        citations,
        fallbacksUsed,
        partialResult,
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            enrich: {
              citationCount: citations.length,
              provider: resolutionProvider.id,
              concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : DEFAULT_ENRICH_CONCURRENCY,
            },
          }
          : context.jobDebug,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(
            'enrich',
            'success',
            `Completed strict external resolution for ${citations.length} citation(s).`,
            { provider: resolutionProvider.id, citationCount: citations.length },
            Date.now() - startedAt,
          ),
        ],
      };
    },
  };
}
