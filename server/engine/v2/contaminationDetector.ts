import type { ValidationIssue } from '@shared/schema';
import { normalizeDoiValue, normalizeWhitespace } from './utils.js';

const DOI_CLUSTER_PATTERN = /(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,}\/\S+/gi;
const YEAR_CLUSTER_PATTERN = /(?:\(|\[)(?:19|20)\d{2}[a-z]?(?:\)|\])/gi;
const EMBEDDED_REFERENCE_START_PATTERN = /[A-Z][\p{L}'’.-]+,\s+[A-Z][^()]{0,40}\(\d{4}[a-z]?\)/gu;

function hasEmbeddedReferenceStart(value: string | null | undefined): boolean {
  const raw = value ?? '';
  if (!raw) return false;

  for (const match of raw.matchAll(EMBEDDED_REFERENCE_START_PATTERN)) {
    if ((match.index ?? 0) > 0) return true;
  }

  return false;
}

function countDistinctDoiClusters(value: string): number {
  return new Set(
    [...value.matchAll(DOI_CLUSTER_PATTERN)]
      .map((match) => normalizeDoiValue(match[0] ?? ''))
      .filter(Boolean),
  ).size;
}

function countYearClusters(value: string): number {
  return [...value.matchAll(YEAR_CLUSTER_PATTERN)].length;
}

export function buildReferenceSignatureIssues(options: {
  raw: string;
  title?: string | null;
  venue?: string | null;
  venueField: string;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const title = normalizeWhitespace(options.title ?? '');
  const venue = normalizeWhitespace(options.venue ?? '');
  const doiClusters = countDistinctDoiClusters(options.raw);
  const yearClusters = countYearClusters(options.raw);

  if (hasEmbeddedReferenceStart(title)) {
    issues.push({
      field: 'title',
      severity: 'error',
      code: 'embedded_reference_start_in_title',
      message: 'Title appears to contain the start of a second reference.',
      extracted: title,
    });
  }

  if (hasEmbeddedReferenceStart(venue)) {
    issues.push({
      field: options.venueField,
      severity: 'error',
      code: 'embedded_reference_start_in_venue',
      message: 'Venue field appears to contain the start of a second reference.',
      extracted: venue,
    });
  }

  if (doiClusters >= 2) {
    issues.push({
      field: 'raw',
      severity: 'error',
      code: 'multiple_doi_clusters',
      message: 'Raw citation contains multiple DOI clusters and likely includes more than one reference.',
      extracted: doiClusters,
    });
  }

  if (yearClusters >= 2) {
    issues.push({
      field: 'raw',
      severity: 'error',
      code: 'multiple_year_anchor_clusters',
      message: 'Raw citation contains multiple year-anchor clusters and likely includes more than one reference.',
      extracted: yearClusters,
    });
  }

  return issues;
}
