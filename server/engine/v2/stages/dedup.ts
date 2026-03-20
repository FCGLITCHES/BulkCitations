import { randomUUID } from 'node:crypto';
import type { CanonicalAuthor, CanonicalCitation, FieldValue, V2DuplicateEntry, V2FieldSource } from '@shared/schema';
import type { V2Stage } from '../contracts.js';
import { addCitationStageLog, average, createStageDiagnostic, firstAuthorLastName, normalizedField, normalizeWhitespace } from '../utils.js';

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

function citationStrength(citation: CanonicalCitation): number {
  return average([
    citation.authors.confidence,
    citation.title.confidence,
    citation.year.confidence,
    citation.journal.confidence,
    citation.doi.confidence,
  ]);
}

function chooseBaseCitation(group: CanonicalCitation[]): CanonicalCitation {
  return [...group].sort((left, right) => citationStrength(right) - citationStrength(left))[0];
}

function mergeField<T>(
  base: FieldValue<T>,
  duplicate: FieldValue<T>,
  baseCitationId: string,
  duplicateCitationId: string,
  fieldName: string,
  predicate?: (value: T) => boolean,
): FieldValue<T> {
  const baseIsUseful = predicate ? predicate(base.value) : Boolean(base.value);
  const duplicateIsUseful = predicate ? predicate(duplicate.value) : Boolean(duplicate.value);

  if (baseIsUseful) {
    return {
      ...base,
      source: 'merged',
      stageId: 'dedup',
      mergedFrom: [baseCitationId, duplicateCitationId],
      conflictResolution: `kept_base_${fieldName}`,
    };
  }

  if (duplicateIsUseful) {
    return {
      ...duplicate,
      source: 'merged',
      stageId: 'dedup',
      mergedFrom: [baseCitationId, duplicateCitationId],
      conflictResolution: `filled_missing_${fieldName}`,
    };
  }

  return {
    ...base,
    source: 'merged' as V2FieldSource,
    stageId: 'dedup',
    mergedFrom: [baseCitationId, duplicateCitationId],
    conflictResolution: `no_better_${fieldName}`,
  };
}

function mergeAuthors(
  base: FieldValue<CanonicalAuthor[]>,
  duplicate: FieldValue<CanonicalAuthor[]>,
  baseCitationId: string,
  duplicateCitationId: string,
): FieldValue<CanonicalAuthor[]> {
  const baseScore = hasMoreStructuredAuthors(base.value);
  const duplicateScore = hasMoreStructuredAuthors(duplicate.value);
  const winner = duplicateScore > baseScore ? duplicate : base;
  return {
    ...winner,
    source: 'merged',
    stageId: 'dedup',
    mergedFrom: [baseCitationId, duplicateCitationId],
    conflictResolution: duplicateScore > baseScore ? 'preferred_more_structured_authors' : 'kept_base_authors',
  };
}

function createMergedCitation(group: CanonicalCitation[], method: 'doi' | 'structural'): CanonicalCitation {
  const base = chooseBaseCitation(group);
  const others = group.filter((citation) => citation.id !== base.id);

  let merged = {
    ...base,
    id: randomUUID(),
    status: 'merged' as const,
    raw: group.map((citation) => citation.raw).join('\n'),
  };

  for (const duplicate of others) {
      merged = {
        ...merged,
        authors: mergeAuthors(merged.authors, duplicate.authors, merged.id, duplicate.id),
        title: mergeField(merged.title, duplicate.title, merged.id, duplicate.id, 'title', (value) => Boolean(value)),
        year: mergeField(merged.year, duplicate.year, merged.id, duplicate.id, 'year', (value) => value != null),
        journal: mergeField(merged.journal, duplicate.journal, merged.id, duplicate.id, 'journal', (value) => Boolean(value)),
        volume: mergeField(merged.volume, duplicate.volume, merged.id, duplicate.id, 'volume', (value) => Boolean(value)),
        issue: mergeField(merged.issue, duplicate.issue, merged.id, duplicate.id, 'issue', (value) => Boolean(value)),
        pages: mergeField(merged.pages, duplicate.pages, merged.id, duplicate.id, 'pages', (value) => Boolean(value)),
        doi: mergeField(merged.doi, duplicate.doi, merged.id, duplicate.id, 'doi', (value) => Boolean(value)),
        publisher: mergeField(merged.publisher, duplicate.publisher, merged.id, duplicate.id, 'publisher', (value) => Boolean(value)),
        url: mergeField(merged.url, duplicate.url, merged.id, duplicate.id, 'url', (value) => Boolean(value)),
        conferenceTitle: mergeField(merged.conferenceTitle, duplicate.conferenceTitle, merged.id, duplicate.id, 'conferenceTitle', (value) => Boolean(value)),
        bookTitle: mergeField(merged.bookTitle, duplicate.bookTitle, merged.id, duplicate.id, 'bookTitle', (value) => Boolean(value)),
        institution: mergeField(merged.institution, duplicate.institution, merged.id, duplicate.id, 'institution', (value) => Boolean(value)),
        edition: mergeField(merged.edition, duplicate.edition, merged.id, duplicate.id, 'edition', (value) => Boolean(value)),
        editor: mergeField(merged.editor, duplicate.editor, merged.id, duplicate.id, 'editor', (value) => Boolean(value)),
      };
    }

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

        const mergedCitation = createMergedCitation(group.members, group.method);
        const base = chooseBaseCitation(group.members);
        citations.push(...group.members.map((citation) => addCitationStageLog(
          {
            ...citation,
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
        )));
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
