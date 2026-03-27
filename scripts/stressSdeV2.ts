import fs from 'node:fs';
import path from 'node:path';
import { processV2Conversion } from '../server/engine/v2/pipeline.js';
import { canonicalToParsedReference } from '../server/engine/v2/utils.js';
import type {
  CanonicalAuthor,
  CanonicalCitation,
  CanonicalReferenceType,
  CitationStyle,
  ParsedReference,
  V2StageTiming,
} from '../shared/schema.js';

process.env.ENABLE_GROBID_EXTRACTOR ??= '0';
process.env.ENABLE_LLM_EXTRACTOR ??= '0';

type AuthorSpec =
  | { kind: 'person'; first: string; last: string }
  | { kind: 'literal'; literal: string };

type ManifestEntry = {
  caseId: string;
  familyId: string;
  familyName: string;
  expectedStyle: CitationStyle;
  expectedReferenceType: CanonicalReferenceType;
  edgeTags: string[];
  expectedFields: {
    authors: AuthorSpec[];
    editors: AuthorSpec[];
    title: string;
    year: string;
    journal?: string;
    conferenceTitle?: string;
    bookTitle?: string;
    publisher?: string;
    institution?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    articleNumber?: string;
    doi?: string;
    url?: string;
    edition?: string;
    reportNumber?: string;
  };
  raw: string;
};

type Manifest = Record<string, ManifestEntry>;

type ComparableField =
  | 'authors'
  | 'title'
  | 'year'
  | 'journal'
  | 'conferenceTitle'
  | 'bookTitle'
  | 'publisher'
  | 'institution'
  | 'volume'
  | 'issue'
  | 'locator'
  | 'doi'
  | 'url'
  | 'edition';

type Args = {
  inputPath: string;
  manifestPath: string;
  outputDir: string;
  filter?: 'all' | 'split' | 'detect' | 'extract' | 'mismatch';
  debug: boolean;
};

const DEFAULT_INPUT = path.resolve(process.cwd(), 'scripts/data/stress-batch-20260322-sde-250.txt');
const DEFAULT_MANIFEST = path.resolve(process.cwd(), 'scripts/data/stress-batch-20260322-sde-250.manifest.json');
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), 'output/stress');
const CASE_ID_PATTERN = /\bSDE-[A-Z]{3,4}-\d{3}\b/g;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    inputPath: DEFAULT_INPUT,
    manifestPath: DEFAULT_MANIFEST,
    outputDir: DEFAULT_OUTPUT_DIR,
    filter: 'all',
    debug: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--input':
        args.inputPath = path.resolve(process.cwd(), argv[index + 1]);
        index += 1;
        break;
      case '--manifest':
        args.manifestPath = path.resolve(process.cwd(), argv[index + 1]);
        index += 1;
        break;
      case '--output-dir':
        args.outputDir = path.resolve(process.cwd(), argv[index + 1]);
        index += 1;
        break;
      case '--filter':
        args.filter = (argv[index + 1] as Args['filter']) ?? 'all';
        index += 1;
        break;
      case '--debug': {
        const value = (argv[index + 1] ?? '').toLowerCase();
        args.debug = !['0', 'false', 'no', 'off'].includes(value);
        index += 1;
        break;
      }
      default:
        break;
    }
  }

  return args;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace(/-/g, '').replace('T', '-');
}

function normalizeText(value: string | undefined | null): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, (match) => match.toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDoi(value: string | undefined | null): string {
  return (value ?? '')
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/[.)\],;]+$/g, '')
    .toLowerCase();
}

function normalizeUrl(value: string | undefined | null): string {
  return (value ?? '')
    .trim()
    .replace(/[.)\],;]+$/g, '')
    .toLowerCase();
}

function normalizeStyleFamily(value: string | undefined | null): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (normalized.startsWith('harvard')) return 'harvard';
  if (normalized.startsWith('chicago')) return 'chicago';
  return normalized;
}

function rawHasComparableWebsiteYear(raw: string): boolean {
  const normalized = normalizeText(raw);
  if (!normalized) return false;
  const withoutAccessTail = normalized
    .replace(/\b(?:viewed|accessed)\b[\s\S]*$/i, ' ')
    .replace(/\bavailable(?:\s+at|\s+from)?\b[\s\S]*$/i, ' ');
  return /\b(?:1[5-9]\d{2}|20\d{2})\b/.test(withoutAccessTail);
}

function rawHasComparableConferencePublisher(raw: string): boolean {
  const normalized = normalizeText(raw);
  if (!normalized) return false;
  return /\bpp?\.?\s*[a-z]?\d+(?:\s*-\s*[a-z]?\d+)?\s*,\s*[^,.;]+\.?$/i.test(normalized)
    || /:\s*[^.;]+;\s*(?:1[5-9]\d{2}|20\d{2})/i.test(normalized);
}

function comparableFieldsFor(entry: ManifestEntry): Set<ComparableField> {
  switch (entry.expectedReferenceType) {
    case 'conference': {
      const fields = new Set<ComparableField>(['authors', 'title', 'year', 'conferenceTitle', 'locator', 'doi']);
      if (rawHasComparableConferencePublisher(entry.raw)) fields.add('publisher');
      return fields;
    }
    case 'chapter':
      return new Set(['authors', 'title', 'year', 'bookTitle', 'publisher', 'locator', 'edition']);
    case 'book':
      return new Set(['authors', 'title', 'year', 'publisher', 'edition']);
    case 'report':
      return new Set(['authors', 'title', 'year', 'publisher', 'url']);
    case 'thesis':
      return new Set(['authors', 'title', 'year', 'institution', 'url']);
    case 'website': {
      const fields = new Set<ComparableField>(['authors', 'title', 'url']);
      if (rawHasComparableWebsiteYear(entry.raw)) fields.add('year');
      if (/\b(?:doi\b|doi\.org)\b/i.test(entry.raw)) fields.add('doi');
      return fields;
    }
    case 'preprint':
      return new Set(['authors', 'title', 'year', 'publisher', 'url']);
    case 'journal':
    default:
      return new Set(['authors', 'title', 'year', 'journal', 'volume', 'issue', 'locator', 'doi']);
  }
}

function authorKey(author: AuthorSpec | CanonicalAuthor): string {
  if ('kind' in author) {
    if (author.kind === 'literal') return normalizeText(author.literal);
    return `${normalizeText(author.last)}|${normalizeText(author.first).charAt(0)}`;
  }
  if (author.literal) return normalizeText(author.literal);
  const firstInitial = normalizeText(author.first ?? author.initials ?? '').charAt(0);
  return `${normalizeText(author.last)}|${firstInitial}`;
}

function extractCaseIds(value: string): string[] {
  return [...new Set(value.match(CASE_ID_PATTERN) ?? [])];
}

function selectedParsed(citation: CanonicalCitation): ParsedReference | null {
  const extractDebug = citation.stageDebug?.extract;
  if (extractDebug && 'selectedParsed' in extractDebug) {
    return extractDebug.selectedParsed as ParsedReference;
  }
  return null;
}

function compareValue(expected: string | undefined, actual: string | undefined): boolean | null {
  if (!expected) return null;
  return normalizeText(expected) === normalizeText(actual);
}

function compareLocator(expected: ManifestEntry['expectedFields'], actual: ParsedReference): boolean | null {
  if (expected.pages) return normalizeText(expected.pages) === normalizeText(actual.pages);
  if (expected.articleNumber) {
    const actualLocator = actual['article-number'] ?? actual.pages;
    return normalizeText(expected.articleNumber) === normalizeText(actualLocator);
  }
  return null;
}

function compareAuthors(expected: AuthorSpec[], actual: CanonicalAuthor[]): { match: boolean | null; expectedKeys: string[]; actualKeys: string[] } {
  if (expected.length === 0) {
    return {
      match: actual.length === 0,
      expectedKeys: [],
      actualKeys: actual.map(authorKey),
    };
  }

  const expectedKeys = expected.map(authorKey);
  const actualKeys = actual.map(authorKey);
  const trailingEtAl = normalizeText(actual[actual.length - 1]?.literal ?? actual[actual.length - 1]?.last);
  return {
    match: (
      expectedKeys.length === actualKeys.length && expectedKeys.every((key, index) => key === actualKeys[index])
    ) || (
      trailingEtAl === 'et al'
      && actualKeys.length === expectedKeys.length + 1
      && expectedKeys.every((key, index) => key === actualKeys[index])
    ),
    expectedKeys,
    actualKeys,
  };
}

function expectedFieldChecks(entry: ManifestEntry, canonical: ParsedReference, citation: CanonicalCitation) {
  const authorComparison = compareAuthors(entry.expectedFields.authors, citation.authors.value);
  const comparableFields = comparableFieldsFor(entry);
  const comparable = (field: ComparableField, value: boolean | null): boolean | null => (
    comparableFields.has(field) ? value : null
  );
  const checks = {
    authors: comparable('authors', authorComparison.match),
    title: comparable('title', compareValue(entry.expectedFields.title, canonical.title)),
    year: comparable('year', entry.expectedFields.year ? String(entry.expectedFields.year) === String(canonical.year ?? '') : null),
    journal: comparable('journal', compareValue(entry.expectedFields.journal, canonical.journal)),
    conferenceTitle: comparable('conferenceTitle', compareValue(entry.expectedFields.conferenceTitle, canonical.conferenceTitle)),
    bookTitle: comparable('bookTitle', compareValue(entry.expectedFields.bookTitle, canonical.bookTitle)),
    publisher: comparable('publisher', compareValue(entry.expectedFields.publisher, canonical.publisher)),
    institution: comparable('institution', compareValue(entry.expectedFields.institution, canonical.institution)),
    volume: comparable('volume', compareValue(entry.expectedFields.volume, canonical.volume)),
    issue: comparable('issue', compareValue(entry.expectedFields.issue, canonical.issue)),
    locator: comparable('locator', compareLocator(entry.expectedFields, canonical)),
    doi: comparable('doi', entry.expectedFields.doi ? normalizeDoi(entry.expectedFields.doi) === normalizeDoi(canonical.doi) : null),
    url: comparable('url', entry.expectedFields.url ? normalizeUrl(entry.expectedFields.url) === normalizeUrl(canonical.url) : null),
    edition: comparable('edition', compareValue(entry.expectedFields.edition, canonical.edition)),
  };

  const mismatches = Object.entries(checks)
    .filter(([, value]) => value === false)
    .map(([field]) => field);

  const totalComparable = Object.values(checks).filter((value) => value !== null).length;
  const matchedComparable = Object.values(checks).filter((value) => value === true).length;

  return {
    checks,
    mismatches,
    totalComparable,
    matchedComparable,
    authorComparison,
  };
}

function loadManifest(filePath: string): Manifest {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Manifest;
}

function reportItem(citation: CanonicalCitation, manifest: Manifest) {
  const caseIds = extractCaseIds(citation.raw);
  const canonical = canonicalToParsedReference(citation);
  const rawParsed = selectedParsed(citation);

  if (caseIds.length !== 1) {
    return {
      citationId: citation.id,
      raw: citation.raw,
      caseIds,
      familyName: null,
      edgeTags: [],
      expectedStyle: null,
      detectedStyle: citation.detectedStyle.value,
      expectedReferenceType: null,
      actualReferenceType: citation.referenceType,
      splitStatus: caseIds.length === 0 ? 'unidentified_chunk' : 'merged_cases',
      styleMatch: null,
      referenceTypeMatch: null,
      fieldChecks: null,
      rawParsed,
      canonical,
      split: citation.split ?? null,
      extraction: citation.extraction ?? null,
    };
  }

  const entry = manifest[caseIds[0]];
  if (!entry) {
    return {
      citationId: citation.id,
      raw: citation.raw,
      caseIds,
      familyId: null,
      familyName: null,
      edgeTags: [],
      expectedStyle: null,
      detectedStyle: citation.detectedStyle.value,
      expectedReferenceType: null,
      actualReferenceType: citation.referenceType,
      splitStatus: 'unknown_case_id',
      styleMatch: null,
      referenceTypeMatch: null,
      fieldChecks: null,
      rawParsed,
      canonical,
      split: citation.split ?? null,
      extraction: citation.extraction ?? null,
    };
  }

  const checks = expectedFieldChecks(entry, canonical, citation);

  return {
    citationId: citation.id,
    raw: citation.raw,
    caseIds,
    caseId: entry.caseId,
    familyId: entry.familyId,
    familyName: entry.familyName,
    edgeTags: entry.edgeTags,
    expectedStyle: entry.expectedStyle,
    detectedStyle: citation.detectedStyle.value,
    expectedReferenceType: entry.expectedReferenceType,
    actualReferenceType: citation.referenceType,
    splitStatus: 'identified',
    styleMatch: normalizeStyleFamily(entry.expectedStyle) === normalizeStyleFamily(citation.detectedStyle.value),
    referenceTypeMatch: entry.expectedReferenceType === citation.referenceType,
    fieldChecks: checks,
    rawParsed,
    canonical,
    split: citation.split ?? null,
    extraction: citation.extraction ?? null,
  };
}

function familySummary(items: ReturnType<typeof reportItem>[], manifest: Manifest) {
  const families = new Map<string, {
    familyId: string;
    familyName: string;
    expectedCount: number;
    seenCaseIds: Set<string>;
    splitFailures: number;
    styleMatches: number;
    styleComparable: number;
    typeMatches: number;
    typeComparable: number;
    fieldMatches: number;
    fieldComparable: number;
  }>();

  for (const entry of Object.values(manifest)) {
    const existing = families.get(entry.familyId);
    if (existing) {
      existing.expectedCount += 1;
    } else {
      families.set(entry.familyId, {
        familyId: entry.familyId,
        familyName: entry.familyName,
        expectedCount: 1,
        seenCaseIds: new Set<string>(),
        splitFailures: 0,
        styleMatches: 0,
        styleComparable: 0,
        typeMatches: 0,
        typeComparable: 0,
        fieldMatches: 0,
        fieldComparable: 0,
      });
    }
  }

  for (const item of items as any[]) {
    const familyId = item.familyId ?? 'unmapped';
    if (!families.has(familyId)) {
      families.set(familyId, {
        familyId,
        familyName: item.familyId ? item.familyName ?? item.familyId : 'unmapped',
        expectedCount: 0,
        seenCaseIds: new Set<string>(),
        splitFailures: 0,
        styleMatches: 0,
        styleComparable: 0,
        typeMatches: 0,
        typeComparable: 0,
        fieldMatches: 0,
        fieldComparable: 0,
      });
    }

    const summary = families.get(familyId)!;
    if ('caseId' in item && item.caseId) summary.seenCaseIds.add(item.caseId);
    if (item.splitStatus !== 'identified') {
      summary.splitFailures += 1;
      continue;
    }
    if (item.styleMatch !== null) {
      summary.styleComparable += 1;
      if (item.styleMatch) summary.styleMatches += 1;
    }
    if (item.referenceTypeMatch !== null) {
      summary.typeComparable += 1;
      if (item.referenceTypeMatch) summary.typeMatches += 1;
    }
    if (item.fieldChecks) {
      summary.fieldMatches += item.fieldChecks.matchedComparable;
      summary.fieldComparable += item.fieldChecks.totalComparable;
    }
  }

  return [...families.values()].map((entry) => ({
    familyId: entry.familyId,
    familyName: entry.familyName,
    expectedCount: entry.expectedCount,
    observedCount: entry.seenCaseIds.size,
    splitFailures: entry.splitFailures,
    styleAccuracy: entry.styleComparable > 0 ? Number((entry.styleMatches / entry.styleComparable).toFixed(4)) : null,
    referenceTypeAccuracy: entry.typeComparable > 0 ? Number((entry.typeMatches / entry.typeComparable).toFixed(4)) : null,
    fieldAccuracy: entry.fieldComparable > 0 ? Number((entry.fieldMatches / entry.fieldComparable).toFixed(4)) : null,
  })).sort((left, right) => left.familyId.localeCompare(right.familyId));
}

function filterItems(items: ReturnType<typeof reportItem>[], filter: Args['filter']) {
  switch (filter) {
    case 'split':
      return items.filter((item) => item.splitStatus !== 'identified');
    case 'detect':
      return items.filter((item) => item.splitStatus === 'identified' && item.styleMatch === false);
    case 'extract':
      return items.filter((item) => item.splitStatus === 'identified' && (item.referenceTypeMatch === false || (item.fieldChecks?.mismatches.length ?? 0) > 0));
    case 'mismatch':
      return items.filter((item) => item.splitStatus !== 'identified' || item.styleMatch === false || item.referenceTypeMatch === false || (item.fieldChecks?.mismatches.length ?? 0) > 0);
    default:
      return items;
  }
}

function summarizeStageTimings(stageTimings: V2StageTiming[] | undefined) {
  const ordered = [...(stageTimings ?? [])].sort((left, right) => right.durationMs - left.durationMs);
  return ordered.map((entry) => ({
    stageId: entry.stageId,
    status: entry.status,
    durationMs: entry.durationMs,
    workUnits: entry.workUnits ?? null,
    timeoutMs: entry.timeoutMs ?? null,
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.outputDir, { recursive: true });

  const content = fs.readFileSync(args.inputPath, 'utf8');
  const manifest = loadManifest(args.manifestPath);

  const originalLog = console.log;
  let response;
  try {
    console.log = () => {};
    ({ response } = await processV2Conversion({
      sourceType: 'text',
      content,
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: args.debug,
    }));
  } finally {
    console.log = originalLog;
  }

  const items = response.citations.map((citation) => reportItem(citation, manifest));
  const observedCaseIds = new Set(items.flatMap((item) => ('caseId' in item && item.caseId ? [item.caseId] : [])));
  const missingCaseIds = Object.keys(manifest).filter((caseId) => !observedCaseIds.has(caseId));

  const splitFailures = items.filter((item) => item.splitStatus !== 'identified').length;
  const styleComparable = items.filter((item) => item.styleMatch !== null).length;
  const styleMatches = items.filter((item) => item.styleMatch === true).length;
  const typeComparable = items.filter((item) => item.referenceTypeMatch !== null).length;
  const typeMatches = items.filter((item) => item.referenceTypeMatch === true).length;
  const fieldComparable = items.reduce((sum, item) => sum + (item.fieldChecks?.totalComparable ?? 0), 0);
  const fieldMatches = items.reduce((sum, item) => sum + (item.fieldChecks?.matchedComparable ?? 0), 0);

  const report = {
    generatedAt: new Date().toISOString(),
    inputPath: args.inputPath,
    manifestPath: args.manifestPath,
    summary: {
      expectedCount: Object.keys(manifest).length,
      actualCount: response.citations.length,
      splitFailures,
      missingCaseCount: missingCaseIds.length,
      styleAccuracy: styleComparable > 0 ? Number((styleMatches / styleComparable).toFixed(4)) : null,
      referenceTypeAccuracy: typeComparable > 0 ? Number((typeMatches / typeComparable).toFixed(4)) : null,
      fieldAccuracy: fieldComparable > 0 ? Number((fieldMatches / fieldComparable).toFixed(4)) : null,
      extractorPathsUsed: response.processingPath.extractorPathsUsed ?? [],
      fallbacksUsed: response.processingPath.fallbacksUsed,
      durationMs: response.processingPath.durationMs,
      partialResult: response.processingPath.partialResult,
      slowestStages: summarizeStageTimings(response.processingPath.stageTimings).slice(0, 5),
    },
    missingCaseIds,
    familyBreakdown: familySummary(items, manifest),
    items: filterItems(items, args.filter),
  };

  const outputPath = path.join(args.outputDir, `${timestamp()}-stress-sde-250.json`);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify({
    outputPath,
    expectedCount: report.summary.expectedCount,
    actualCount: report.summary.actualCount,
    splitFailures: report.summary.splitFailures,
    missingCaseCount: report.summary.missingCaseCount,
    styleAccuracy: report.summary.styleAccuracy,
    referenceTypeAccuracy: report.summary.referenceTypeAccuracy,
    fieldAccuracy: report.summary.fieldAccuracy,
  }, null, 2));

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
