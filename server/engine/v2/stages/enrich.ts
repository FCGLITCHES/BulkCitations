import type { CanonicalCitation, EnrichmentMetadata, FieldValue } from '@shared/schema';
import { fetchCrossrefMetadata } from '../../doiEnrichment.js';
import type { AuthorityLookupAdapter, CacheAdapter, V2Stage } from '../contracts.js';
import { addCitationStageLog, attachCitationDebug, createStageDiagnostic, logStructuredDebug, normalizeWhitespace, runWithTimeout } from '../utils.js';

const ENRICH_TIMEOUT_MS = 500;

function updateIfMissing(
  field: FieldValue<string | null>,
  incoming: string | undefined,
  stageId: string,
): FieldValue<string | null> {
  if (field.value || !incoming) return field;
  return {
    value: incoming,
    source: 'authority',
    confidence: Math.max(field.confidence, 0.82),
    stageId,
  };
}

function cacheKeyForCitation(citation: CanonicalCitation): string {
  return [
    normalizeWhitespace(citation.title.value?.toLowerCase() ?? ''),
    normalizeWhitespace(citation.authors.value[0]?.last?.toLowerCase() ?? ''),
    citation.year.value ?? '',
  ].join('|');
}

function isBiomedical(citation: CanonicalCitation): boolean {
  const journal = normalizeWhitespace(citation.journal.value?.toLowerCase() ?? '');
  return /(med|clinical|oncology|cardio|biomed|health|lancet|nejm|jama|bmj)/.test(journal);
}

async function crossrefSearchByTitleAuthor(citation: CanonicalCitation) {
  if (!citation.title.value) return null;
  const query = encodeURIComponent([citation.title.value, citation.authors.value[0]?.last].filter(Boolean).join(' '));
  const response = await fetch(`https://api.crossref.org/works?rows=1&query.bibliographic=${query}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'CitingApp/1.0 (mailto:noreply@citing.app)',
    },
    signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Crossref search failed with status ${response.status}`);
  const payload = await response.json() as { message?: { items?: Array<Record<string, any>> } };
  return payload.message?.items?.[0] ?? null;
}

async function pubmedLookup(citation: CanonicalCitation) {
  if (!citation.title.value) return null;
  const query = encodeURIComponent(`"${citation.title.value}"[Title]`);
  const searchResponse = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term=${query}`, {
    signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS),
  });
  if (!searchResponse.ok) throw new Error(`PubMed search failed with status ${searchResponse.status}`);
  const search = await searchResponse.json() as { esearchresult?: { idlist?: string[] } };
  const pmid = search.esearchresult?.idlist?.[0];
  if (!pmid) return null;

  const summaryResponse = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${pmid}`, {
    signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS),
  });
  if (!summaryResponse.ok) throw new Error(`PubMed summary failed with status ${summaryResponse.status}`);
  const summary = await summaryResponse.json() as { result?: Record<string, any> };
  return summary.result?.[pmid] ?? null;
}

function applyEnrichment(citation: CanonicalCitation, metadata: EnrichmentMetadata, data?: {
  title?: string;
  journal?: string;
  year?: number;
  doi?: string;
  url?: string;
  abstract?: string;
}) {
  return {
    ...citation,
    title: updateIfMissing(citation.title, data?.title, 'enrich'),
    journal: updateIfMissing(citation.journal, data?.journal, 'enrich'),
    doi: updateIfMissing(citation.doi, data?.doi, 'enrich'),
    url: updateIfMissing(citation.url, data?.url, 'enrich'),
    year: citation.year.value == null && data?.year != null
      ? { value: data.year, source: 'authority' as const, confidence: 0.8, stageId: 'enrich' }
      : citation.year,
    enrichment: {
      ...metadata,
      abstract: data?.abstract ?? metadata.abstract,
    },
  };
}

export function createEnrichStage(authorityLookup: AuthorityLookupAdapter, cache: CacheAdapter): V2Stage {
  return {
    id: 'enrich',
    async run(context) {
      const startedAt = Date.now();
      const results = await Promise.all(context.citations.map(async (citation, citationIndex) => {
        const localFallbacks: string[] = [];
        let localPartialResult = false;

        if (!context.request.enrich || citation.status === 'duplicate') {
          const skippedCitation = attachCitationDebug({
            ...citation,
            enrichment: { status: 'skipped', provider: authorityLookup.id, sourceUsed: 'skipped' },
          }, 'enrich', {
            sourceUsed: 'skipped',
            warningFlags: [],
          }, context.debugEnabled);
          return {
            citation: addCitationStageLog(
              skippedCitation,
              createStageDiagnostic('enrich', 'skipped', 'Enrichment skipped for this citation.'),
            ),
            fallbacksUsed: localFallbacks,
            partialResult: localPartialResult,
          };
        }

        const cacheKey = cacheKeyForCitation(citation);
        const cached = await cache.get<EnrichmentMetadata & { data?: Record<string, string | number | undefined> }>(cacheKey);
        if (cached) {
          const cachedCitation = attachCitationDebug(applyEnrichment(citation, {
            ...cached,
            cacheHit: true,
            sourceUsed: 'cache',
          }, cached.data as any), 'enrich', {
            sourceUsed: 'cache',
            cacheHit: true,
          }, context.debugEnabled);
          logStructuredDebug(context, 'enrich', citationIndex, cachedCitation, {
            warningFlags: [],
            sourceUsed: 'cache',
          });
          return {
            citation: addCitationStageLog(
              cachedCitation,
              createStageDiagnostic('enrich', 'success', 'Reused cached enrichment result.', { cacheKey }),
            ),
            fallbacksUsed: localFallbacks,
            partialResult: localPartialResult,
          };
        }

        let enrichedCitation = citation;
        let stageStatus: 'success' | 'warning' = 'warning';
        let stageMessage = 'Citation could not be enriched and was marked unverifiable.';

        const finalize = async (nextCitation: CanonicalCitation, logMessage: string, status: 'success' | 'warning') => {
          if (nextCitation.enrichment?.status === 'fetched') {
            await cache.set(cacheKey, {
              ...nextCitation.enrichment,
              data: {
                title: nextCitation.title.value ?? undefined,
                journal: nextCitation.journal.value ?? undefined,
                year: nextCitation.year.value ?? undefined,
                doi: nextCitation.doi.value ?? undefined,
                url: nextCitation.url.value ?? undefined,
                abstract: nextCitation.enrichment.abstract,
              },
            });
          }
          const debuggedCitation = attachCitationDebug(nextCitation, 'enrich', {
            sourceUsed: nextCitation.enrichment?.sourceUsed,
            status: nextCitation.enrichment?.status,
            timedOut: nextCitation.enrichment?.timedOut ?? false,
            warningFlags: nextCitation.enrichment?.timedOut ? ['timeout_fallback'] : [],
          }, context.debugEnabled);
          logStructuredDebug(context, 'enrich', citationIndex, debuggedCitation, {
            warningFlags: debuggedCitation.enrichment?.timedOut ? ['timeout_fallback'] : [],
            sourceUsed: debuggedCitation.enrichment?.sourceUsed,
          });
          return addCitationStageLog(
            debuggedCitation,
            createStageDiagnostic('enrich', status, logMessage, {
              sourceUsed: debuggedCitation.enrichment?.sourceUsed,
              status: debuggedCitation.enrichment?.status,
            }),
          );
        };

        try {
          if (citation.doi.value) {
            const crossref = await runWithTimeout('crossref-doi', fetchCrossrefMetadata(citation.doi.value), ENRICH_TIMEOUT_MS);
            if (crossref) {
              enrichedCitation = applyEnrichment(citation, {
                status: 'fetched',
                provider: 'crossref',
                sourceUsed: 'crossref_doi',
                cacheHit: false,
                doiFound: Boolean(crossref.DOI),
                abstractFound: false,
                retractedFlag: /retract/i.test(String(crossref.title ?? '')),
                matchedTitle: crossref.title,
                matchedYear: crossref.issued?.['date-parts']?.[0]?.[0],
                url: crossref.URL,
                raw: crossref,
              }, {
                title: crossref.title,
                journal: crossref['container-title'],
                year: crossref.issued?.['date-parts']?.[0]?.[0],
                doi: crossref.DOI,
                url: crossref.URL,
              });
              stageStatus = 'success';
              stageMessage = 'Enriched citation from Crossref DOI lookup.';
              return {
                citation: await finalize(enrichedCitation, stageMessage, stageStatus),
                fallbacksUsed: localFallbacks,
                partialResult: localPartialResult,
              };
            }
          }

          const crossrefSearch = await runWithTimeout('crossref-title-author', crossrefSearchByTitleAuthor(citation), ENRICH_TIMEOUT_MS);
          if (crossrefSearch) {
            enrichedCitation = applyEnrichment(citation, {
              status: 'fetched',
              provider: 'crossref',
              sourceUsed: 'crossref_title_author',
              cacheHit: false,
              doiFound: Boolean(crossrefSearch.DOI),
              abstractFound: false,
              retractedFlag: /retract/i.test(String(crossrefSearch.title?.[0] ?? '')),
              matchedTitle: crossrefSearch.title?.[0],
              matchedYear: crossrefSearch.issued?.['date-parts']?.[0]?.[0],
              url: crossrefSearch.URL,
              raw: crossrefSearch,
            }, {
              title: crossrefSearch.title?.[0],
              journal: crossrefSearch['container-title']?.[0],
              year: crossrefSearch.issued?.['date-parts']?.[0]?.[0],
              doi: crossrefSearch.DOI,
              url: crossrefSearch.URL,
            });
            stageStatus = 'success';
            stageMessage = 'Enriched citation from Crossref title/author search.';
            return {
              citation: await finalize(enrichedCitation, stageMessage, stageStatus),
              fallbacksUsed: localFallbacks,
              partialResult: localPartialResult,
            };
          }

          // Semantic Scholar is intentionally disabled in the active enrichment path.
          // Reason: current rate limits serialize batch processing and make v2 conversion
          // unacceptably slow. Re-enable later behind a flag when deep enrichment returns.

          if (isBiomedical(citation)) {
            const pubmedResult = await runWithTimeout('pubmed', pubmedLookup(citation), ENRICH_TIMEOUT_MS);
            if (pubmedResult) {
              enrichedCitation = applyEnrichment(citation, {
                status: 'fetched',
                provider: 'pubmed',
                sourceUsed: 'pubmed',
                cacheHit: false,
                doiFound: false,
                abstractFound: false,
                retractedFlag: /retract/i.test(String(pubmedResult.title ?? '')),
                matchedTitle: pubmedResult.title,
                matchedYear: Number.parseInt(String(pubmedResult.pubdate ?? '').slice(0, 4), 10) || undefined,
                raw: pubmedResult,
              }, {
                title: pubmedResult.title,
                journal: pubmedResult.fulljournalname,
                year: Number.parseInt(String(pubmedResult.pubdate ?? '').slice(0, 4), 10) || undefined,
              });
              stageStatus = 'success';
              stageMessage = 'Enriched citation from PubMed.';
              return {
                citation: await finalize(enrichedCitation, stageMessage, stageStatus),
                fallbacksUsed: localFallbacks,
                partialResult: localPartialResult,
              };
            }
          }

          enrichedCitation = {
            ...citation,
            enrichment: {
              status: 'no_match',
              provider: authorityLookup.id,
              sourceUsed: 'unverifiable',
              cacheHit: false,
              doiFound: Boolean(citation.doi.value),
              abstractFound: false,
              retractedFlag: false,
              confidencePenalty: -0.15,
            },
          };
        } catch (error) {
          localPartialResult = true;
          localFallbacks.push('enrich:timeout_fallback');
          enrichedCitation = {
            ...citation,
            enrichment: {
              status: 'error',
              provider: authorityLookup.id,
              sourceUsed: 'timeout_fallback',
              cacheHit: false,
              doiFound: Boolean(citation.doi.value),
              abstractFound: false,
              retractedFlag: false,
              timedOut: true,
              confidencePenalty: -0.15,
              raw: {
                message: error instanceof Error ? error.message : String(error),
              },
            },
          };
          stageMessage = 'Enrichment timed out; returning graceful partial result.';
        }

        return {
          citation: await finalize(enrichedCitation, stageMessage, stageStatus),
          fallbacksUsed: localFallbacks,
          partialResult: localPartialResult,
        };
      }));

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
            },
          }
          : context.jobDebug,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(
            'enrich',
            'success',
            `Completed enrichment waterfall for ${citations.length} citation(s).`,
            { provider: authorityLookup.id, citationCount: citations.length },
            Date.now() - startedAt,
          ),
        ],
      };
    },
  };
}
