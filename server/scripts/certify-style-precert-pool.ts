import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  certifyPreparedStylePrecertPool,
  prepareStylePrecertPool,
  type CrossrefEnrichment,
  type CrossrefEnrichmentAuthor,
  type StylePrecertLookupRequest,
  type StylePrecertPoolRow,
} from '../src/training/stylePrecertCertification.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

interface ScriptOptions {
  inputPath: string;
  reviewOutputPath: string;
  sanitizedOutputPath: string;
  summaryOutputPath: string;
  crossrefEmail: string | null;
  crossrefDelayMs: number;
  crossrefTimeoutMs: number;
  enrichScope: 'review-queue' | 'full';
}

interface CrossrefWork {
  DOI?: string;
  URL?: string;
  type?: string;
  title?: string[];
  'container-title'?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  author?: Array<{ family?: string; given?: string }>;
  'published-print'?: { 'date-parts'?: number[][] };
  'published-online'?: { 'date-parts'?: number[][] };
  created?: { 'date-parts'?: number[][] };
}

const DEFAULT_TIMEOUT_MS = Number(process.env.CROSSREF_TIMEOUT_MS ?? '5000') || 5000;
const DEFAULT_DELAY_MS = Math.max(50, Number(process.env.CROSSREF_MIN_INTERVAL_MS ?? '120') || 120);

function parseArgs(argv: string[]): ScriptOptions {
  let inputPath: string | null = null;
  let reviewOutputPath: string | null = null;
  let sanitizedOutputPath: string | null = null;
  let summaryOutputPath: string | null = null;
  let crossrefEmail = process.env.CROSSREF_EMAIL?.trim() || null;
  let crossrefDelayMs = DEFAULT_DELAY_MS;
  let crossrefTimeoutMs = DEFAULT_TIMEOUT_MS;
  let enrichScope: 'review-queue' | 'full' = 'review-queue';

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }
    if (!token.startsWith('--') && inputPath == null) {
      inputPath = token;
      continue;
    }
    if (token === '--input') {
      inputPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === '--review-output') {
      reviewOutputPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === '--sanitized-output') {
      sanitizedOutputPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === '--summary-output') {
      summaryOutputPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === '--crossref-email') {
      crossrefEmail = (argv[index + 1] ?? '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--crossref-delay-ms') {
      crossrefDelayMs = Math.max(0, Number(argv[index + 1] ?? DEFAULT_DELAY_MS) || DEFAULT_DELAY_MS);
      index += 1;
      continue;
    }
    if (token === '--crossref-timeout-ms') {
      crossrefTimeoutMs = Math.max(1000, Number(argv[index + 1] ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
      index += 1;
      continue;
    }
    if (token === '--enrich-scope') {
      const nextValue = argv[index + 1];
      if (nextValue === 'review-queue' || nextValue === 'full') {
        enrichScope = nextValue;
      }
      index += 1;
      continue;
    }
  }

  if (!inputPath) {
    throw new Error('Provide an input precert NDJSON path.');
  }

  const resolvedInputPath = path.resolve(process.cwd(), inputPath);
  const basePath = resolvedInputPath.replace(/\.ndjson$/iu, '');

  return {
    inputPath: resolvedInputPath,
    reviewOutputPath: reviewOutputPath
      ? path.resolve(process.cwd(), reviewOutputPath)
      : `${basePath}.admin-review.ndjson`,
    sanitizedOutputPath: sanitizedOutputPath
      ? path.resolve(process.cwd(), sanitizedOutputPath)
      : `${basePath}.sanitized.ndjson`,
    summaryOutputPath: summaryOutputPath
      ? path.resolve(process.cwd(), summaryOutputPath)
      : `${basePath}.certification-summary.json`,
    crossrefEmail,
    crossrefDelayMs,
    crossrefTimeoutMs,
    enrichScope,
  };
}

function datasetVersionFromPath(inputPath: string): string {
  const fileName = path.basename(inputPath);
  return fileName.replace(/\.precert-pool\.ndjson$/iu, '').replace(/\.ndjson$/iu, '');
}

function buildHeaders(email: string | null): Record<string, string> {
  return {
    Accept: 'application/json',
    'User-Agent': email
      ? `BulkReferences Style Precert Certifier/1.0 (mailto:${email})`
      : 'BulkReferences Style Precert Certifier/1.0',
  };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '')
    .replace(/^doi:\s*/iu, '')
    .trim()
    .toLowerCase();
}

function extractYear(work: CrossrefWork): number | null {
  for (const key of ['published-print', 'published-online', 'created'] as const) {
    const year = work[key]?.['date-parts']?.[0]?.[0];
    if (typeof year === 'number') {
      return year;
    }
  }
  return null;
}

function mapWorkTypeToReferenceType(workType: string | undefined): string | null {
  switch ((workType ?? '').trim().toLowerCase()) {
    case 'journal-article':
      return 'article-journal';
    case 'proceedings-article':
      return 'conference-paper';
    case 'book':
    case 'monograph':
    case 'edited-book':
      return 'book';
    case 'book-chapter':
    case 'reference-entry':
      return 'book-chapter';
    case 'posted-content':
      return 'preprint';
    case 'dissertation':
      return 'thesis';
    case 'report':
    case 'report-series':
    case 'standard':
      return 'report';
    default:
      return null;
  }
}

function normalizeForScoring(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/_/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeForScoring(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

function mapAuthors(authors: CrossrefWork['author']): CrossrefEnrichmentAuthor[] | undefined {
  const mapped = (authors ?? [])
    .filter((entry) => typeof entry.family === 'string' && entry.family.trim().length > 0)
    .map((entry) => ({
      family: entry.family!.trim(),
      given: entry.given?.trim() || null,
    }));
  return mapped.length > 0 ? mapped : undefined;
}

function toEnrichmentFields(work: CrossrefWork) {
  const doi = normalizeDoi(work.DOI);
  return {
    title: work.title?.[0] ?? null,
    year: extractYear(work),
    journal: work['container-title']?.[0] ?? null,
    volume: work.volume ?? null,
    issue: work.issue ?? null,
    pages: work.page ?? null,
    doi,
    publisher: work.publisher ?? null,
    url: doi ? `https://doi.org/${doi}` : work.URL ?? null,
    reference_type: mapWorkTypeToReferenceType(work.type),
    authors: mapAuthors(work.author),
  };
}

function extractRawYear(rawText: string): number | null {
  const matched = rawText.match(/\b(19|20)\d{2}[a-z]?\b/iu)?.[0] ?? null;
  if (!matched) {
    return null;
  }
  const year = Number.parseInt(matched.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function scoreBibliographicCandidate(rawText: string, work: CrossrefWork): {
  score: number;
  confidence: 'medium' | 'low' | 'none';
  notes: string[];
} {
  const notes: string[] = [];
  const title = work.title?.[0]?.trim() ?? '';
  const rawNormalized = normalizeForScoring(rawText);
  const titleNormalized = normalizeForScoring(title);
  const rawTokens = new Set(tokenize(rawText));
  const titleTokens = tokenize(title);
  const sharedTitleTokens = titleTokens.filter((token) => rawTokens.has(token)).length;
  const titleCoverage = titleTokens.length > 0 ? sharedTitleTokens / titleTokens.length : 0;
  if (titleCoverage > 0) {
    notes.push(`title_coverage=${titleCoverage.toFixed(3)}`);
  }

  const rawYear = extractRawYear(rawText);
  const workYear = extractYear(work);
  const yearMatch = rawYear != null && workYear != null && rawYear === workYear ? 1 : 0;
  if (yearMatch === 1) {
    notes.push('year_match');
  }

  const firstAuthor = work.author?.[0]?.family?.toLowerCase() ?? null;
  const authorMatch = firstAuthor && rawNormalized.includes(firstAuthor.toLowerCase()) ? 1 : 0;
  if (authorMatch === 1) {
    notes.push('author_match');
  }

  const titleSubstring = titleNormalized.length > 0 && rawNormalized.includes(titleNormalized) ? 1 : 0;
  if (titleSubstring === 1) {
    notes.push('title_substring');
  }

  const score = Number(
    (
      titleCoverage * 0.55
      + titleSubstring * 0.25
      + yearMatch * 0.15
      + authorMatch * 0.05
    ).toFixed(4),
  );

  if (score >= 0.8) {
    return { score, confidence: 'medium', notes };
  }
  if (score >= 0.55) {
    return { score, confidence: 'low', notes };
  }
  return { score, confidence: 'none', notes };
}

async function fetchJson(url: string, options: ScriptOptions, attempt = 1): Promise<unknown> {
  const response = await fetch(url, {
    headers: buildHeaders(options.crossrefEmail),
    signal: AbortSignal.timeout(options.crossrefTimeoutMs),
  });
  if (response.ok) {
    return response.json();
  }
  if (attempt < 4 && [429, 500, 502, 503, 504].includes(response.status)) {
    await sleep(options.crossrefDelayMs * attempt);
    return fetchJson(url, options, attempt + 1);
  }
  throw new Error(`Crossref request failed with status ${response.status} for ${url}`);
}

async function resolveByDoi(doi: string, options: ScriptOptions): Promise<CrossrefEnrichment> {
  const normalizedDoi = normalizeDoi(doi);
  if (!normalizedDoi) {
    return {
      status: 'unresolved',
      match_confidence: 'none',
      fields: null,
      matched_by: 'reference_doi',
      match_notes: ['empty_doi'],
    };
  }
  const pathDoi = normalizedDoi
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const query = options.crossrefEmail
    ? `?mailto=${encodeURIComponent(options.crossrefEmail)}`
    : '';
  const url = `https://api.crossref.org/works/${pathDoi}${query}`;
  const payload = (await fetchJson(url, options)) as {
    message?: CrossrefWork;
  };
  if (!payload.message) {
    return {
      status: 'unresolved',
      match_confidence: 'none',
      fields: null,
      matched_by: 'reference_doi',
      match_notes: ['missing_message'],
    };
  }
  return {
    status: 'resolved_doi',
    match_confidence: 'high',
    fields: toEnrichmentFields(payload.message),
    matched_by: 'reference_doi',
    candidate_count: 1,
  };
}

async function resolveByBibliographic(queryText: string, options: ScriptOptions): Promise<CrossrefEnrichment> {
  const params = new URLSearchParams({
    'query.bibliographic': queryText,
    rows: '3',
  });
  if (options.crossrefEmail) {
    params.set('mailto', options.crossrefEmail);
  }
  const url = `https://api.crossref.org/works?${params.toString()}`;
  const payload = (await fetchJson(url, options)) as {
    message?: { items?: CrossrefWork[] };
  };
  const items = payload.message?.items ?? [];
  if (items.length === 0) {
    return {
      status: 'unresolved',
      match_confidence: 'none',
      fields: null,
      matched_by: 'bibliographic',
      candidate_count: 0,
      match_notes: ['no_candidates'],
    };
  }

  const scored = items
    .map((work) => ({
      work,
      ...scoreBibliographicCandidate(queryText, work),
    }))
    .sort((left, right) => right.score - left.score);

  const best = scored[0]!;
  if (best.confidence === 'none') {
    return {
      status: 'unresolved',
      match_confidence: 'none',
      fields: null,
      matched_by: 'bibliographic',
      candidate_count: items.length,
      match_notes: best.notes,
    };
  }

  return {
    status: 'resolved_bibliographic',
    match_confidence: best.confidence,
    fields: toEnrichmentFields(best.work),
    matched_by: 'bibliographic',
    candidate_count: items.length,
    match_notes: [...best.notes, `score=${best.score.toFixed(4)}`],
  };
}

async function resolveLookupRequest(
  request: StylePrecertLookupRequest,
  options: ScriptOptions,
): Promise<CrossrefEnrichment> {
  try {
    if (request.lookupKind === 'doi' && request.doi) {
      return await resolveByDoi(request.doi, options);
    }
    if (request.lookupKind === 'bibliographic' && request.queryText) {
      return await resolveByBibliographic(request.queryText, options);
    }
    return {
      status: 'unresolved',
      match_confidence: 'none',
      fields: null,
      error: 'lookup_request_missing_payload',
    };
  } catch (error) {
    return {
      status: 'error',
      match_confidence: 'none',
      fields: null,
      error: error instanceof Error ? error.message : String(error),
      matched_by: request.lookupKind === 'doi' ? 'reference_doi' : 'bibliographic',
    };
  }
}

async function readNdjson(inputPath: string): Promise<StylePrecertPoolRow[]> {
  const body = await readFile(inputPath, 'utf8');
  return body
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as StylePrecertPoolRow);
}

async function writeNdjson(outputPath: string, rows: unknown[]): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = rows.map((row) => JSON.stringify(row)).join('\n');
  await writeFile(outputPath, payload.length > 0 ? `${payload}\n` : '', 'utf8');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const datasetVersion = datasetVersionFromPath(options.inputPath);
  const rows = await readNdjson(options.inputPath);
  const prepared = prepareStylePrecertPool(rows, { datasetVersion });
  const baseline = certifyPreparedStylePrecertPool(prepared, new Map());
  const reviewLookupKeys = new Set(baseline.reviewQueue.map((row) => row.lookup_key));

  const lookupRequests =
    options.enrichScope === 'full'
      ? prepared.lookupRequests
      : prepared.lookupRequests.filter((request) => reviewLookupKeys.has(request.lookupKey));

  const enrichments = new Map<string, CrossrefEnrichment>();
  let processed = 0;
  for (const request of lookupRequests) {
    const enrichment = await resolveLookupRequest(request, options);
    enrichments.set(request.lookupKey, enrichment);
    processed += 1;
    if (processed < lookupRequests.length) {
      await sleep(options.crossrefDelayMs);
    }
  }

  const result = certifyPreparedStylePrecertPool(
    {
      ...prepared,
      lookupRequests,
    },
    enrichments,
  );

  await writeNdjson(options.reviewOutputPath, result.reviewQueue);
  await writeNdjson(options.sanitizedOutputPath, result.sanitizedRows);
  await mkdir(path.dirname(options.summaryOutputPath), { recursive: true });
  await writeFile(
    options.summaryOutputPath,
    `${JSON.stringify(
      {
        ok: true,
        inputPath: options.inputPath,
        reviewOutputPath: options.reviewOutputPath,
        sanitizedOutputPath: options.sanitizedOutputPath,
        enrichScope: options.enrichScope,
        requestedLookupCount: lookupRequests.length,
        summary: result.summary,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        inputPath: options.inputPath,
        reviewOutputPath: options.reviewOutputPath,
        sanitizedOutputPath: options.sanitizedOutputPath,
        summaryOutputPath: options.summaryOutputPath,
        enrichScope: options.enrichScope,
        requestedLookupCount: lookupRequests.length,
        summary: result.summary,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
