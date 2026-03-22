import { randomUUID } from 'node:crypto';
import type { CanonicalAuthor, CanonicalCitation, EnrichmentMetadata, FieldValue, ResolutionMetadata, V2DuplicateEntry, V2FieldSource } from '@shared/schema';
import type { V2Stage } from '../contracts.js';
import { buildResolutionMetadata } from '../resolution.js';
import { addCitationStageLog, average, createStageDiagnostic, firstAuthorLastName, normalizedField, normalizeWhitespace } from '../utils.js';
import { hasCanonicalMalformedAuthors } from '../qualityRules.js';
import { validateCitationOffline } from './validate.js';

function similarityTokens(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[–—]/g, '-')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aTokens = new Set(similarityTokens(a));
  const bTokens = new Set(similarityTokens(b));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function normalizedVenue(citation: CanonicalCitation): string {
  return normalizeWhitespace(
    citation.journal.value
    ?? citation.conferenceTitle.value
    ?? citation.bookTitle.value
    ?? '',
  ).toLowerCase();
}

function normalizedTitle(citation: CanonicalCitation): string {
  return normalizeWhitespace(citation.title.value ?? '')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedPages(citation: CanonicalCitation): string {
  return normalizeWhitespace(citation.pages.value ?? '')
    .replace(/[–—]/g, '-')
    .toLowerCase();
}

function sharedAuthorSignature(left: CanonicalCitation, right: CanonicalCitation): boolean {
  const leftAuthors = left.authors.value.map((author) => normalizeWhitespace(author.last).toLowerCase()).filter(Boolean);
  const rightAuthors = right.authors.value.map((author) => normalizeWhitespace(author.last).toLowerCase()).filter(Boolean);
  if (leftAuthors.length === 0 || rightAuthors.length === 0) return false;
  const shared = leftAuthors.filter((author) => rightAuthors.includes(author));
  return shared.length >= Math.min(2, leftAuthors.length, rightAuthors.length);
}

function authorOverlapScore(left: CanonicalCitation, right: CanonicalCitation): number {
  const leftAuthors = new Set(left.authors.value.map((author) => normalizeWhitespace(author.last).toLowerCase()).filter(Boolean));
  const rightAuthors = new Set(right.authors.value.map((author) => normalizeWhitespace(author.last).toLowerCase()).filter(Boolean));
  if (leftAuthors.size === 0 || rightAuthors.size === 0) return 0;
  const intersection = [...leftAuthors].filter((author) => rightAuthors.has(author)).length;
  const denominator = Math.max(leftAuthors.size, rightAuthors.size);
  return denominator === 0 ? 0 : intersection / denominator;
}

function isStructuralDuplicate(left: CanonicalCitation, right: CanonicalCitation): boolean {
  if (left.year.value == null || right.year.value == null || left.year.value !== right.year.value) {
    return false;
  }

  const authorScore = similarity(firstAuthorLastName(left), firstAuthorLastName(right));
  const titleScore = similarity(normalizedTitle(left), normalizedTitle(right));
  if (titleScore < 0.9) {
    return false;
  }

  const venueScore = similarity(normalizedVenue(left), normalizedVenue(right));
  const pageScore = similarity(normalizedPages(left), normalizedPages(right));
  const authorOverlap = authorOverlapScore(left, right);
  const volumeMatch = normalizeWhitespace(left.volume.value ?? '') !== ''
    && normalizeWhitespace(left.volume.value ?? '') === normalizeWhitespace(right.volume.value ?? '');
  const issueMatch = normalizeWhitespace(left.issue.value ?? '') !== ''
    && normalizeWhitespace(left.issue.value ?? '') === normalizeWhitespace(right.issue.value ?? '');
  const locatorMatch = pageScore >= 0.85 || volumeMatch || issueMatch;
  const strongBibliographicMatch = venueScore >= 0.9 && locatorMatch;
  const exactWorkSignature = titleScore >= 0.97 && venueScore >= 0.9 && locatorMatch;
  const authorCorroborated = authorScore >= 0.99 || authorOverlap >= 0.5 || sharedAuthorSignature(left, right);
  const sameVenueYearTitle = titleScore >= 0.96 && venueScore >= 0.92 && authorOverlap >= 0.5;

  if (exactWorkSignature) {
    return true;
  }

  if (sameVenueYearTitle) {
    return true;
  }

  return authorCorroborated && strongBibliographicMatch;
}

function hasMoreStructuredAuthors(authors: CanonicalAuthor[]): number {
  return authors.reduce((score, author) => score + (author.literal ? 0 : 1), 0) + authors.length;
}

function authorStructurePenalty(authors: CanonicalAuthor[]): number {
  let penalty = hasCanonicalMalformedAuthors(authors) ? 8 : 0;
  for (const author of authors) {
    const combined = normalizeWhitespace([author.literal ?? '', author.last, author.first ?? '', author.initials ?? ''].join(' '));
    if (!combined) {
      penalty += 2;
      continue;
    }
    if ((combined.match(/,/g) ?? []).length >= 2) penalty += 2;
    if (combined.split(/\s+/).filter(Boolean).length >= 8) penalty += 1.5;
  }
  return penalty;
}

function isVerifiedResolution(citation: CanonicalCitation): boolean {
  return citation.resolution?.status === 'verified' || citation.resolution?.status === 'verified_with_year_tolerance';
}

function resolutionPriority(citation: CanonicalCitation): number {
  switch (citation.resolution?.status) {
    case 'verified':
      return 8;
    case 'verified_with_year_tolerance':
      return 7;
    case 'no_exact_match':
      return 5;
    case 'provider_no_coverage':
      return 4;
    case 'provider_error':
      return 3;
    case 'insufficient_evidence':
      return 2;
    default:
      return 0;
  }
}

function sourcePriority(source: V2FieldSource): number {
  switch (source) {
    case 'authority':
      return 0.25;
    case 'merged':
      return 0.15;
    case 'normalized':
      return 0.1;
    case 'user':
      return 0.08;
    default:
      return 0;
  }
}

function citationStrength(citation: CanonicalCitation): number {
  let score = average([
    citation.authors.confidence,
    citation.title.confidence,
    citation.year.confidence,
    citation.journal.confidence,
    citation.doi.confidence,
  ]);
  if (isVerifiedResolution(citation)) score += 0.18;
  if (citation.resolution?.matchStrategy === 'crossref_doi') score += 0.04;
  if ((citation.resolution?.appliedFields?.length ?? 0) > 0) {
    score += Math.min(0.05, (citation.resolution?.appliedFields?.length ?? 0) * 0.01);
  }
  if ((citation.resolution?.conflictFields.length ?? 0) > 0) score -= 0.12;
  if (citation.quality?.bucket === 'ready') score += 0.04;
  return score;
}

function fieldStrength<T>(
  field: FieldValue<T>,
  citation: CanonicalCitation,
  fieldName: string,
  predicate?: (value: T) => boolean,
): number {
  const useful = predicate ? predicate(field.value) : Boolean(field.value);
  if (!useful) return Number.NEGATIVE_INFINITY;
  let score = field.confidence + sourcePriority(field.source) + (resolutionPriority(citation) * 0.02);
  if (citation.resolution?.appliedFields?.includes(fieldName)) score += 0.08;
  if (citation.resolution?.conflictFields?.includes(fieldName)) score -= 0.2;
  if (citation.quality?.bucket === 'ready') score += 0.03;
  return score;
}

function chooseBaseCitation(group: CanonicalCitation[]): CanonicalCitation {
  return [...group].sort((left, right) => citationStrength(right) - citationStrength(left))[0];
}

function mergeField<T>(
  base: FieldValue<T>,
  duplicate: FieldValue<T>,
  baseCitation: CanonicalCitation,
  duplicateCitation: CanonicalCitation,
  fieldName: string,
  predicate?: (value: T) => boolean,
): FieldValue<T> {
  const baseScore = fieldStrength(base, baseCitation, fieldName, predicate);
  const duplicateScore = fieldStrength(duplicate, duplicateCitation, fieldName, predicate);
  const winner = duplicateScore > baseScore ? duplicate : base;
  const conflictResolution = duplicateScore > baseScore
    ? `preferred_duplicate_${fieldName}`
    : Number.isFinite(baseScore)
      ? `kept_base_${fieldName}`
      : `no_better_${fieldName}`;

  return {
    ...winner,
    source: 'merged',
    stageId: 'dedup',
    mergedFrom: [baseCitation.id, duplicateCitation.id],
    conflictResolution,
  };
}

function mergeAuthors(
  base: FieldValue<CanonicalAuthor[]>,
  duplicate: FieldValue<CanonicalAuthor[]>,
  baseCitation: CanonicalCitation,
  duplicateCitation: CanonicalCitation,
): FieldValue<CanonicalAuthor[]> {
  const baseScore =
    hasMoreStructuredAuthors(base.value)
    + fieldStrength(base, baseCitation, 'authors', (value) => value.length > 0)
    - authorStructurePenalty(base.value);
  const duplicateScore =
    hasMoreStructuredAuthors(duplicate.value)
    + fieldStrength(duplicate, duplicateCitation, 'authors', (value) => value.length > 0)
    - authorStructurePenalty(duplicate.value);
  const winner = duplicateScore > baseScore ? duplicate : base;
  return {
    ...winner,
    source: 'merged',
    stageId: 'dedup',
    mergedFrom: [baseCitation.id, duplicateCitation.id],
    conflictResolution: duplicateScore > baseScore ? 'preferred_more_structured_authors' : 'kept_base_authors',
  };
}

function inheritMergedField<T>(
  field: FieldValue<T>,
  duplicateId: string,
  mergedId: string,
): FieldValue<T> {
  return {
    ...field,
    source: 'merged',
    stageId: 'dedup',
    mergedFrom: [duplicateId, mergedId],
    conflictResolution: 'inherited_from_merged_duplicate_family',
  };
}

function buildMergedResolution(group: CanonicalCitation[], merged: CanonicalCitation): ResolutionMetadata | undefined {
  const resolutionWinner = [...group].sort((left, right) => resolutionPriority(right) - resolutionPriority(left) || citationStrength(right) - citationStrength(left))[0];
  if (!resolutionWinner?.resolution) return undefined;

  const appliedFields = [...new Set(group.flatMap((citation) => citation.resolution?.appliedFields ?? []))];
  return {
    ...buildResolutionMetadata(merged, resolutionWinner.resolution.status, {
      resolvedAt: resolutionWinner.resolution.resolvedAt,
      provider: resolutionWinner.resolution.provider,
      matchStrategy: resolutionWinner.resolution.matchStrategy,
      acceptedCandidate: resolutionWinner.resolution.acceptedCandidate,
    }),
    candidateCount: resolutionWinner.resolution.candidateCount,
    rejectedReasons: resolutionWinner.resolution.rejectedReasons,
    appliedFields,
    conflictFields: [],
    yearToleranceApplied: resolutionWinner.resolution.yearToleranceApplied,
  };
}

function buildMergedEnrichment(group: CanonicalCitation[]): EnrichmentMetadata | null {
  const enrichmentWinner = [...group].sort((left, right) => citationStrength(right) - citationStrength(left))[0];
  if (!enrichmentWinner?.enrichment) return null;
  return {
    ...enrichmentWinner.enrichment,
    raw: enrichmentWinner.enrichment.raw
      ? {
          ...enrichmentWinner.enrichment.raw,
          duplicateFamilySize: group.length,
        }
      : {
          duplicateFamilySize: group.length,
        },
  };
}

async function createMergedCitation(group: CanonicalCitation[], method: 'doi' | 'structural'): Promise<CanonicalCitation> {
  const base = chooseBaseCitation(group);
  const others = group.filter((citation) => citation.id !== base.id);

  let merged = {
    ...base,
    id: randomUUID(),
    status: 'merged' as const,
    raw: base.raw,
  };

  for (const duplicate of others) {
      merged = {
        ...merged,
        authors: mergeAuthors(merged.authors, duplicate.authors, merged, duplicate),
        title: mergeField(merged.title, duplicate.title, merged, duplicate, 'title', (value) => Boolean(value)),
        year: mergeField(merged.year, duplicate.year, merged, duplicate, 'year', (value) => value != null),
        journal: mergeField(merged.journal, duplicate.journal, merged, duplicate, 'journal', (value) => Boolean(value)),
        volume: mergeField(merged.volume, duplicate.volume, merged, duplicate, 'volume', (value) => Boolean(value)),
        issue: mergeField(merged.issue, duplicate.issue, merged, duplicate, 'issue', (value) => Boolean(value)),
        pages: mergeField(merged.pages, duplicate.pages, merged, duplicate, 'pages', (value) => Boolean(value)),
        doi: mergeField(merged.doi, duplicate.doi, merged, duplicate, 'doi', (value) => Boolean(value)),
        publisher: mergeField(merged.publisher, duplicate.publisher, merged, duplicate, 'publisher', (value) => Boolean(value)),
        url: mergeField(merged.url, duplicate.url, merged, duplicate, 'url', (value) => Boolean(value)),
        conferenceTitle: mergeField(merged.conferenceTitle, duplicate.conferenceTitle, merged, duplicate, 'conferenceTitle', (value) => Boolean(value)),
        bookTitle: mergeField(merged.bookTitle, duplicate.bookTitle, merged, duplicate, 'bookTitle', (value) => Boolean(value)),
        institution: mergeField(merged.institution, duplicate.institution, merged, duplicate, 'institution', (value) => Boolean(value)),
        edition: mergeField(merged.edition, duplicate.edition, merged, duplicate, 'edition', (value) => Boolean(value)),
        editor: mergeField(merged.editor, duplicate.editor, merged, duplicate, 'editor', (value) => Boolean(value)),
      };
    }

  merged = {
    ...merged,
    resolution: buildMergedResolution(group, merged),
    enrichment: buildMergedEnrichment(group),
  };

  const { issues, metadata } = await validateCitationOffline(merged);
  merged = {
    ...merged,
    validationIssues: issues,
    validation: metadata,
  };

  return addCitationStageLog(
    {
      ...merged,
      duplicate: {
        status: 'merged',
        method,
        mergedFrom: group.map((citation) => citation.id),
        mergeReason: `merged_${method}_duplicate_group`,
      },
    },
    createStageDiagnostic('dedup', 'success', 'Created merged canonical citation from duplicate group.', {
      mergedFrom: group.map((citation) => citation.id),
      method,
    }),
  );
}

async function hydrateDuplicateCitation(
  citation: CanonicalCitation,
  mergedCitation: CanonicalCitation,
  method: 'doi' | 'structural',
): Promise<CanonicalCitation> {
  let hydrated: CanonicalCitation = {
    ...citation,
    referenceType: mergedCitation.referenceType,
    authors: inheritMergedField(mergedCitation.authors, citation.id, mergedCitation.id),
    title: inheritMergedField(mergedCitation.title, citation.id, mergedCitation.id),
    year: inheritMergedField(mergedCitation.year, citation.id, mergedCitation.id),
    journal: inheritMergedField(mergedCitation.journal, citation.id, mergedCitation.id),
    volume: inheritMergedField(mergedCitation.volume, citation.id, mergedCitation.id),
    issue: inheritMergedField(mergedCitation.issue, citation.id, mergedCitation.id),
    pages: inheritMergedField(mergedCitation.pages, citation.id, mergedCitation.id),
    doi: inheritMergedField(mergedCitation.doi, citation.id, mergedCitation.id),
    publisher: inheritMergedField(mergedCitation.publisher, citation.id, mergedCitation.id),
    url: inheritMergedField(mergedCitation.url, citation.id, mergedCitation.id),
    conferenceTitle: inheritMergedField(mergedCitation.conferenceTitle, citation.id, mergedCitation.id),
    bookTitle: inheritMergedField(mergedCitation.bookTitle, citation.id, mergedCitation.id),
    institution: inheritMergedField(mergedCitation.institution, citation.id, mergedCitation.id),
    edition: inheritMergedField(mergedCitation.edition, citation.id, mergedCitation.id),
    editor: inheritMergedField(mergedCitation.editor, citation.id, mergedCitation.id),
    resolution: mergedCitation.resolution
      ? {
          ...mergedCitation.resolution,
          appliedFields: [...new Set(mergedCitation.resolution.appliedFields ?? [])],
          conflictFields: [],
        }
      : citation.resolution,
    enrichment: mergedCitation.enrichment
      ? {
          ...mergedCitation.enrichment,
          raw: mergedCitation.enrichment.raw
            ? {
                ...mergedCitation.enrichment.raw,
                inheritedFromDuplicateFamily: true,
              }
            : {
                inheritedFromDuplicateFamily: true,
              },
        }
      : citation.enrichment,
  };

  const { issues, metadata } = await validateCitationOffline(hydrated);
  hydrated = {
    ...hydrated,
    validationIssues: issues,
    validation: metadata,
  };

  return addCitationStageLog(
    hydrated,
    createStageDiagnostic('dedup', 'success', 'Inherited canonical fields from merged duplicate family.', {
      mergedId: mergedCitation.id,
      method,
    }),
  );
}

function groupDuplicates(citations: CanonicalCitation[]): Array<{ method: 'doi' | 'structural'; members: CanonicalCitation[] }> {
  const parent = new Map<string, string>();
  const methodByRoot = new Map<string, 'doi' | 'structural'>();

  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) {
      parent.set(id, id);
      return id;
    }
    const root = find(current);
    parent.set(id, root);
    return root;
  };

  const union = (left: string, right: string, method: 'doi' | 'structural') => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) {
      if (method === 'doi') methodByRoot.set(leftRoot, 'doi');
      return;
    }
    parent.set(rightRoot, leftRoot);
    methodByRoot.set(leftRoot, method === 'doi' || methodByRoot.get(leftRoot) === 'doi' || methodByRoot.get(rightRoot) === 'doi' ? 'doi' : 'structural');
  };

  for (const citation of citations) {
    parent.set(citation.id, citation.id);
  }

  for (let leftIndex = 0; leftIndex < citations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < citations.length; rightIndex += 1) {
      const left = citations[leftIndex];
      const right = citations[rightIndex];
      const leftDoi = left.doi.value ? normalizeWhitespace(left.doi.value.toLowerCase()) : '';
      const rightDoi = right.doi.value ? normalizeWhitespace(right.doi.value.toLowerCase()) : '';
      const doiMatch = Boolean(leftDoi && rightDoi && leftDoi === rightDoi);
      const doiConflict = Boolean(leftDoi && rightDoi && leftDoi !== rightDoi);
      if (doiConflict) {
        continue;
      }
      const structuralMatch = !doiMatch && isStructuralDuplicate(left, right);
      if (doiMatch || structuralMatch) {
        union(left.id, right.id, doiMatch ? 'doi' : 'structural');
      }
    }
  }

  const grouped = new Map<string, CanonicalCitation[]>();
  for (const citation of citations) {
    const root = find(citation.id);
    const existing = grouped.get(root) ?? [];
    existing.push(citation);
    grouped.set(root, existing);
  }

  return [...grouped.entries()].map(([root, members]) => ({
    method: methodByRoot.get(root) ?? 'structural',
    members,
  }));
}

export function createDedupStage(): V2Stage {
  return {
    id: 'dedup',
    async run(context) {
      const startedAt = Date.now();
      if (!context.request.dedup) {
        return {
          ...context,
          pipelineLog: [
            ...context.pipelineLog,
            createStageDiagnostic('dedup', 'skipped', 'Deduplication disabled for this request.'),
          ],
        };
      }

      const groups = groupDuplicates(context.citations);
      const duplicates: V2DuplicateEntry[] = [];
      const citations: CanonicalCitation[] = [];

      for (const group of groups) {
        if (group.members.length === 1) {
          citations.push(addCitationStageLog(
            group.members[0],
            createStageDiagnostic('dedup', 'success', 'Citation did not match any duplicate group.'),
          ));
          continue;
        }

        const mergedCitation = await createMergedCitation(group.members, group.method);
        const base = chooseBaseCitation(group.members);
        const hydratedDuplicates = await Promise.all(group.members.map(async (citation) => {
          const hydrated = await hydrateDuplicateCitation(citation, mergedCitation, group.method);
          return addCitationStageLog(
            {
              ...hydrated,
              status: 'duplicate',
              duplicate: {
                status: 'duplicate',
                duplicateOf: mergedCitation.id,
                method: group.method,
                mergedFrom: [citation.id, mergedCitation.id],
                mergeReason: citation.id === base.id ? 'base_promoted_to_merged_record' : 'duplicate_group_member',
              },
            },
            createStageDiagnostic('dedup', 'warning', 'Citation marked as duplicate; merged record created.', {
              mergedId: mergedCitation.id,
              method: group.method,
            }),
          );
        }));
        citations.push(...hydratedDuplicates);
        citations.push(mergedCitation);

        for (const duplicate of group.members) {
          if (duplicate.id === base.id) continue;
          duplicates.push({
            originalId: base.id,
            duplicateId: duplicate.id,
            method: group.method,
            mergedId: mergedCitation.id,
          });
        }
      }

      return {
        ...context,
        citations,
        duplicates,
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            dedup: {
              duplicateCount: duplicates.length,
            },
          }
          : context.jobDebug,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(
            'dedup',
            'success',
            `Deduplication created ${duplicates.length} duplicate link(s).`,
            { duplicateCount: duplicates.length },
            Date.now() - startedAt,
          ),
        ],
      };
    },
  };
}
