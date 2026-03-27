import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { performance } from 'node:perf_hooks';
import { processV2Conversion } from '../server/engine/v2/pipeline.js';
import { buildStressCorpus } from '../server/engine/v2/fixtures/stress500Corpus.js';
import { canonicalToParsedReference } from '../server/engine/v2/utils.js';
import { registerRoutes } from '../server/routes.js';
import type {
  CanonicalAuthor,
  CanonicalCitation,
  CanonicalReferenceType,
  CitationStyle,
  ParsedReference,
  V2StageTiming,
} from '../shared/schema.js';

type Mode = 'freeze' | 'check';

type AuthorSpec =
  | { kind: 'person'; first: string; last: string }
  | { kind: 'literal'; literal: string };

type SdeManifestEntry = {
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

type SdeManifest = Record<string, SdeManifestEntry>;

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

type CaseCheck = {
  caseId: string;
  observedReferenceType: CanonicalReferenceType;
  expectedReferenceType: CanonicalReferenceType;
  matchedReferenceType: boolean;
  fields: Record<string, string | number | boolean | null>;
};

type AccuracySummary = {
  count: number;
  styleAccuracy: number | null;
  referenceTypeAccuracy: number | null;
  fieldAccuracy: number | null;
};

type StageCeilings = Record<string, number>;

type BaselineManifest = {
  generatedAt: string;
  version: number;
  seedTargets: {
    readyRateTarget: number;
    route10WarmP50MsTarget: number;
    route500WarmP50MsTarget: number;
  };
  corpusFloors: {
    readyRateMin: number;
    actionNeededMax: number;
    populatedTitlesMin: number;
    populatedRenderedMin: number;
    populatedYearsMin: number;
    contaminationCountMin: number;
  };
  sdeFloors: {
    styleAccuracyMin: number;
    referenceTypeAccuracyMin: number;
    fieldAccuracyMin: number;
    splitFailuresMax: number;
    missingCaseCountMax: number;
  };
  routeCeilings: {
    citations10WarmP50MsMax: number;
    citations500WarmP50MsMax: number;
  };
  stageTimingCeilingsMs: {
    stress500: StageCeilings;
    sde250: StageCeilings;
  };
  perTypeFloors: Record<string, AccuracySummary>;
  perFamilyFloors: Record<string, AccuracySummary & { expectedCount: number; observedCount: number; splitFailures: number }>;
  protectedCases: Record<string, CaseCheck>;
  observed: {
    stress500: {
      citationCount: number;
      bucketCounts: Record<string, number>;
      readyRate: number;
      actionNeededCount: number;
      populatedTitles: number;
      populatedRendered: number;
      populatedYears: number;
      contaminationCount: number;
      stageTimingsMs: Record<string, number>;
      slowestStages: Array<{ stageId: string; durationMs: number }>;
    };
    sde250: {
      expectedCount: number;
      actualCount: number;
      splitFailures: number;
      missingCaseCount: number;
      styleAccuracy: number | null;
      referenceTypeAccuracy: number | null;
      fieldAccuracy: number | null;
      stageTimingsMs: Record<string, number>;
    };
    routeBench: {
      citations10: {
        samplesMs: number[];
        warmP50Ms: number;
      };
      citations500: {
        samplesMs: number[];
        warmP50Ms: number;
      };
    };
  };
  observabilityReports: {
    detectFamilyConfusion: Array<{
      expectedStyle: string;
      detectedStyle: string;
      count: number;
      caseIds: string[];
    }>;
    sourceTypeMisclassification: Array<{
      expectedType: string;
      actualType: string;
      count: number;
      caseIds: string[];
    }>;
    extractorFieldLoss: Array<{
      field: string;
      count: number;
      caseIds: string[];
      families: string[];
    }>;
  };
};

type SdeItem = {
  caseId: string;
  familyId: string;
  familyName: string;
  expectedStyle: CitationStyle;
  detectedStyle: string | null;
  expectedReferenceType: CanonicalReferenceType;
  actualReferenceType: CanonicalReferenceType;
  styleMatch: boolean;
  referenceTypeMatch: boolean;
  mismatches: string[];
  totalComparable: number;
  matchedComparable: number;
};

const MANIFEST_PATH = path.resolve(process.cwd(), 'scripts/data/v2-phase-baseline.json');
const SDE_INPUT_PATH = path.resolve(process.cwd(), 'scripts/data/stress-batch-20260322-sde-250.txt');
const SDE_MANIFEST_PATH = path.resolve(process.cwd(), 'scripts/data/stress-batch-20260322-sde-250.manifest.json');
const CASE_ID_PATTERN = /\bSDE-[A-Z]{3,4}-\d{3}\b/g;
const STRESS_READY_RATE_SEED = 0.974;
const ROUTE_10_P50_SEED_MS = 75;
const ROUTE_500_P50_SEED_MS = 2500;

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

function comparableFieldsFor(entry: SdeManifestEntry): Set<ComparableField> {
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

function compareValue(expected: string | undefined, actual: string | undefined): boolean | null {
  if (!expected) return null;
  return normalizeText(expected) === normalizeText(actual);
}

function compareLocator(expected: SdeManifestEntry['expectedFields'], actual: ParsedReference): boolean | null {
  if (expected.pages) return normalizeText(expected.pages) === normalizeText(actual.pages);
  if (expected.articleNumber) {
    const actualLocator = actual['article-number'] ?? actual.pages;
    return normalizeText(expected.articleNumber) === normalizeText(actualLocator);
  }
  return null;
}

function compareAuthors(expected: AuthorSpec[], actual: CanonicalAuthor[]): boolean | null {
  if (expected.length === 0) return actual.length === 0;
  const expectedKeys = expected.map(authorKey);
  const actualKeys = actual.map(authorKey);
  const exactMatch = expectedKeys.length === actualKeys.length
    && expectedKeys.every((key, index) => key === actualKeys[index]);
  if (exactMatch) return true;

  const trailingEtAl = normalizeText(actual[actual.length - 1]?.literal ?? actual[actual.length - 1]?.last);
  return trailingEtAl === 'et al'
    && actualKeys.length === expectedKeys.length + 1
    && expectedKeys.every((key, index) => key === actualKeys[index]);
}

function computePercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * ordered.length) - 1));
  return Number(ordered[index].toFixed(2));
}

function deriveStageCeiling(durationMs: number): number {
  if (durationMs <= 0) return 5;
  return Math.round(Math.max(durationMs * 2, durationMs + 150, 50));
}

function extractCaseIds(value: string): string[] {
  return [...new Set(value.match(CASE_ID_PATTERN) ?? [])];
}

function loadSdeManifest(): SdeManifest {
  return JSON.parse(fs.readFileSync(SDE_MANIFEST_PATH, 'utf8')) as SdeManifest;
}

function summarizeStageTimings(stageTimings: V2StageTiming[] | undefined): Record<string, number> {
  return Object.fromEntries((stageTimings ?? []).map((entry) => [entry.stageId, Number(entry.durationMs.toFixed(2))]));
}

function suppressStructuredLogs<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  console.log = (...parts: unknown[]) => {
    const rendered = parts.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join(' ').trim();
    if (rendered.startsWith('{') && /\"stage\"\s*:/.test(rendered)) return;
    originalLog(...parts);
  };
  return fn().finally(() => {
    console.log = originalLog;
  });
}

async function runStress500Metrics() {
  const corpus = buildStressCorpus();
  const { response } = await suppressStructuredLogs(() => processV2Conversion({
    sourceType: 'text',
    content: corpus.map((entry) => entry.reference).join('\n\n'),
    inputStyle: 'auto',
    outputStyle: 'apa',
    enrich: false,
    dedup: false,
    group: false,
    debug: true,
  }, {
    executionMode: 'sync',
  }));

  const citations = response.citations;
  const debugCitations = response.debug?.citations ?? [];
  const contaminationCount = debugCitations.filter((debugCitation) => {
    const splitDebug = debugCitation.stages.split as Record<string, unknown> | undefined;
    const flags = Array.isArray(splitDebug?.contaminationFlags) ? splitDebug.contaminationFlags : [];
    return flags.length > 0;
  }).length;
  const bucketCounts = {
    ready: citations.filter((citation) => citation.quality?.bucket === 'ready').length,
    worth_reviewing: citations.filter((citation) => citation.quality?.bucket === 'worth_reviewing').length,
    action_needed: citations.filter((citation) => citation.quality?.bucket === 'action_needed').length,
  };
  const protectedCases: Record<string, CaseCheck> = {};
  const protectedIndexes = [0, 1, 2];

  for (const index of protectedIndexes) {
    const citation = citations[index];
    const expected = corpus[index];
    const parsed = canonicalToParsedReference(citation);
    const expectedReferenceType = expected.id === 'manual-conference-in-source'
      ? 'conference'
      : expected.id === 'manual-chapter-in-source'
        ? 'chapter'
        : 'journal';

    protectedCases[expected.id] = {
      caseId: expected.id,
      observedReferenceType: citation.referenceType,
      expectedReferenceType,
      matchedReferenceType: citation.referenceType === expectedReferenceType,
      fields: {
        title: parsed.title ?? null,
        conferenceTitle: parsed.conferenceTitle ?? null,
        bookTitle: parsed.bookTitle ?? null,
        publisher: parsed.publisher ?? null,
        doi: parsed.doi ?? null,
        year: parsed.year ?? null,
      },
    };
  }

  return {
    citationCount: citations.length,
    bucketCounts,
    readyRate: computePercent(bucketCounts.ready, citations.length) ?? 0,
    actionNeededCount: bucketCounts.action_needed,
    populatedTitles: citations.filter((citation) => Boolean((citation.title.value ?? '').trim())).length,
    populatedRendered: citations.filter((citation) => Boolean((citation.rendered?.formatted ?? '').trim())).length,
    populatedYears: citations.filter((citation) => String(citation.year.value ?? '').trim().length > 0).length,
    contaminationCount,
    stageTimingsMs: summarizeStageTimings(response.processingPath.stageTimings),
    slowestStages: (response.processingPath.slowestStages ?? []).slice(0, 5).map((entry) => ({
      stageId: entry.stageId,
      durationMs: Number(entry.durationMs.toFixed(2)),
    })),
    protectedCases,
  };
}

function buildSdeItem(entry: SdeManifestEntry, citation: CanonicalCitation): SdeItem {
  const parsed = canonicalToParsedReference(citation);
  const comparableFields = comparableFieldsFor(entry);
  const comparable = (field: ComparableField, value: boolean | null): boolean | null => (
    comparableFields.has(field) ? value : null
  );
  const checks = {
    authors: comparable('authors', compareAuthors(entry.expectedFields.authors, citation.authors.value)),
    title: comparable('title', compareValue(entry.expectedFields.title, parsed.title)),
    year: comparable('year', entry.expectedFields.year ? String(entry.expectedFields.year) === String(parsed.year ?? '') : null),
    journal: comparable('journal', compareValue(entry.expectedFields.journal, parsed.journal)),
    conferenceTitle: comparable('conferenceTitle', compareValue(entry.expectedFields.conferenceTitle, parsed.conferenceTitle)),
    bookTitle: comparable('bookTitle', compareValue(entry.expectedFields.bookTitle, parsed.bookTitle)),
    publisher: comparable('publisher', compareValue(entry.expectedFields.publisher, parsed.publisher)),
    institution: comparable('institution', compareValue(entry.expectedFields.institution, parsed.institution)),
    volume: comparable('volume', compareValue(entry.expectedFields.volume, parsed.volume)),
    issue: comparable('issue', compareValue(entry.expectedFields.issue, parsed.issue)),
    locator: comparable('locator', compareLocator(entry.expectedFields, parsed)),
    doi: comparable('doi', entry.expectedFields.doi ? normalizeDoi(entry.expectedFields.doi) === normalizeDoi(parsed.doi) : null),
    url: comparable('url', entry.expectedFields.url ? normalizeUrl(entry.expectedFields.url) === normalizeUrl(parsed.url) : null),
    edition: comparable('edition', compareValue(entry.expectedFields.edition, parsed.edition)),
  };

  return {
    caseId: entry.caseId,
    familyId: entry.familyId,
    familyName: entry.familyName,
    expectedStyle: entry.expectedStyle,
    detectedStyle: citation.detectedStyle.value,
    expectedReferenceType: entry.expectedReferenceType,
    actualReferenceType: citation.referenceType,
    styleMatch: normalizeStyleFamily(entry.expectedStyle) === normalizeStyleFamily(citation.detectedStyle.value),
    referenceTypeMatch: entry.expectedReferenceType === citation.referenceType,
    mismatches: Object.entries(checks)
      .filter(([, matched]) => matched === false)
      .map(([field]) => field),
    totalComparable: Object.values(checks).filter((value) => value !== null).length,
    matchedComparable: Object.values(checks).filter((value) => value === true).length,
  };
}

async function runSdeMetrics() {
  const content = fs.readFileSync(SDE_INPUT_PATH, 'utf8');
  const manifest = loadSdeManifest();
  const { response } = await suppressStructuredLogs(() => processV2Conversion({
    sourceType: 'text',
    content,
    inputStyle: 'auto',
    outputStyle: 'apa',
    enrich: false,
    dedup: false,
    group: false,
    debug: false,
  }, {
    executionMode: 'sync',
  }));

  const byCaseId = new Map<string, CanonicalCitation>();
  for (const citation of response.citations) {
    const caseIds = extractCaseIds(citation.raw);
    if (caseIds.length === 1) byCaseId.set(caseIds[0], citation);
  }

  const items = Object.values(manifest)
    .filter((entry) => byCaseId.has(entry.caseId))
    .map((entry) => buildSdeItem(entry, byCaseId.get(entry.caseId)!));
  const missingCaseIds = Object.keys(manifest).filter((caseId) => !byCaseId.has(caseId));
  const styleComparable = items.length;
  const styleMatches = items.filter((item) => item.styleMatch).length;
  const typeComparable = items.length;
  const typeMatches = items.filter((item) => item.referenceTypeMatch).length;
  const fieldComparable = items.reduce((sum, item) => sum + item.totalComparable, 0);
  const fieldMatches = items.reduce((sum, item) => sum + item.matchedComparable, 0);

  const perTypeFloors: Record<string, AccuracySummary> = {};
  const perFamilyFloors: Record<string, AccuracySummary & { expectedCount: number; observedCount: number; splitFailures: number }> = {};

  for (const entry of Object.values(manifest)) {
    if (!perTypeFloors[entry.expectedReferenceType]) {
      perTypeFloors[entry.expectedReferenceType] = {
        count: 0,
        styleAccuracy: null,
        referenceTypeAccuracy: null,
        fieldAccuracy: null,
      };
    }
    perTypeFloors[entry.expectedReferenceType].count += 1;

    if (!perFamilyFloors[entry.familyId]) {
      perFamilyFloors[entry.familyId] = {
        count: 0,
        expectedCount: 0,
        observedCount: 0,
        splitFailures: 0,
        styleAccuracy: null,
        referenceTypeAccuracy: null,
        fieldAccuracy: null,
      };
    }
    perFamilyFloors[entry.familyId].count += 1;
    perFamilyFloors[entry.familyId].expectedCount += 1;
  }

  for (const type of Object.keys(perTypeFloors)) {
    const typeItems = items.filter((item) => item.expectedReferenceType === type);
    perTypeFloors[type] = {
      count: perTypeFloors[type].count,
      styleAccuracy: computePercent(typeItems.filter((item) => item.styleMatch).length, typeItems.length),
      referenceTypeAccuracy: computePercent(typeItems.filter((item) => item.referenceTypeMatch).length, typeItems.length),
      fieldAccuracy: computePercent(
        typeItems.reduce((sum, item) => sum + item.matchedComparable, 0),
        typeItems.reduce((sum, item) => sum + item.totalComparable, 0),
      ),
    };
  }

  for (const familyId of Object.keys(perFamilyFloors)) {
    const familyItems = items.filter((item) => item.familyId === familyId);
    perFamilyFloors[familyId] = {
      count: perFamilyFloors[familyId].count,
      expectedCount: perFamilyFloors[familyId].expectedCount,
      observedCount: familyItems.length,
      splitFailures: perFamilyFloors[familyId].expectedCount - familyItems.length,
      styleAccuracy: computePercent(familyItems.filter((item) => item.styleMatch).length, familyItems.length),
      referenceTypeAccuracy: computePercent(familyItems.filter((item) => item.referenceTypeMatch).length, familyItems.length),
      fieldAccuracy: computePercent(
        familyItems.reduce((sum, item) => sum + item.matchedComparable, 0),
        familyItems.reduce((sum, item) => sum + item.totalComparable, 0),
      ),
    };
  }

  const detectFamilyConfusion = new Map<string, { expectedStyle: string; detectedStyle: string; count: number; caseIds: string[] }>();
  const sourceTypeMisclassification = new Map<string, { expectedType: string; actualType: string; count: number; caseIds: string[] }>();
  const extractorFieldLoss = new Map<string, { field: string; count: number; caseIds: string[]; families: Set<string> }>();

  for (const item of items) {
    if (!item.styleMatch) {
      const key = `${item.expectedStyle}=>${item.detectedStyle ?? 'null'}`;
      const existing = detectFamilyConfusion.get(key) ?? {
        expectedStyle: item.expectedStyle,
        detectedStyle: item.detectedStyle ?? 'null',
        count: 0,
        caseIds: [],
      };
      existing.count += 1;
      existing.caseIds.push(item.caseId);
      detectFamilyConfusion.set(key, existing);
    }

    if (!item.referenceTypeMatch) {
      const key = `${item.expectedReferenceType}=>${item.actualReferenceType}`;
      const existing = sourceTypeMisclassification.get(key) ?? {
        expectedType: item.expectedReferenceType,
        actualType: item.actualReferenceType,
        count: 0,
        caseIds: [],
      };
      existing.count += 1;
      existing.caseIds.push(item.caseId);
      sourceTypeMisclassification.set(key, existing);
    }

    for (const field of item.mismatches) {
      const existing = extractorFieldLoss.get(field) ?? {
        field,
        count: 0,
        caseIds: [],
        families: new Set<string>(),
      };
      existing.count += 1;
      existing.caseIds.push(item.caseId);
      existing.families.add(item.familyId);
      extractorFieldLoss.set(field, existing);
    }
  }

  return {
    expectedCount: Object.keys(manifest).length,
    actualCount: response.citations.length,
    splitFailures: missingCaseIds.length,
    missingCaseCount: missingCaseIds.length,
    styleAccuracy: computePercent(styleMatches, styleComparable),
    referenceTypeAccuracy: computePercent(typeMatches, typeComparable),
    fieldAccuracy: computePercent(fieldMatches, fieldComparable),
    stageTimingsMs: summarizeStageTimings(response.processingPath.stageTimings),
    perTypeFloors,
    perFamilyFloors,
    observabilityReports: {
      detectFamilyConfusion: [...detectFamilyConfusion.values()].sort((left, right) => right.count - left.count),
      sourceTypeMisclassification: [...sourceTypeMisclassification.values()].sort((left, right) => right.count - left.count),
      extractorFieldLoss: [...extractorFieldLoss.values()]
        .map((entry) => ({
          field: entry.field,
          count: entry.count,
          caseIds: entry.caseIds,
          families: [...entry.families].sort(),
        }))
        .sort((left, right) => right.count - left.count),
    },
  };
}

function buildRouteReferences(total: number): string[] {
  return Array.from({ length: total }, (_, index) => (
    `Smith, J., Doe, A., & Lee, K. (${2020 + (index % 4)}). Example title ${index + 1}. Journal of Quality, ${10 + (index % 5)}(${1 + (index % 3)}), ${11 + index}-${19 + index}. https://doi.org/10.5555/route-${total}-${index + 1}`
  ));
}

async function runRouteBenchmark(count: number, attempts: number) {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: false }));
  const server = await registerRoutes(app);

  try {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not determine benchmark server address');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const references = buildRouteReferences(count);
    const samplesMs: number[] = [];

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const started = performance.now();
      const response = await fetch(`${baseUrl}/api/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          references,
          inputStyle: 'auto',
          outputStyle: 'apa',
          engineVersion: 'v2',
          enrichWithAuthority: false,
        }),
      });
      await response.json();
      samplesMs.push(Number((performance.now() - started).toFixed(2)));
      if (!response.ok) {
        throw new Error(`/api/convert benchmark failed for ${count} citations with status ${response.status}`);
      }
    }

    const warmSamples = samplesMs.slice(1);
    return {
      samplesMs,
      warmP50Ms: percentile(warmSamples.length > 0 ? warmSamples : samplesMs, 50),
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

async function collectManifest(): Promise<BaselineManifest> {
  process.env.ENABLE_LLM_EXTRACTOR = '0';
  process.env.ENABLE_GROBID_EXTRACTOR = '0';
  process.env.ADMIN_PASSWORD ??= 'benchmark-admin';
  process.env.ADMIN_SESSION_SECRET ??= 'benchmark-secret';

  const [stress500, sde250] = await Promise.all([
    runStress500Metrics(),
    runSdeMetrics(),
  ]);
  const route10 = await runRouteBenchmark(10, 3);
  const route500 = await runRouteBenchmark(500, 3);

  return {
    generatedAt: new Date().toISOString(),
    version: 1,
    seedTargets: {
      readyRateTarget: STRESS_READY_RATE_SEED,
      route10WarmP50MsTarget: ROUTE_10_P50_SEED_MS,
      route500WarmP50MsTarget: ROUTE_500_P50_SEED_MS,
    },
    corpusFloors: {
      readyRateMin: stress500.readyRate,
      actionNeededMax: stress500.actionNeededCount,
      populatedTitlesMin: 380,
      populatedRenderedMin: 420,
      populatedYearsMin: 430,
      contaminationCountMin: 45,
    },
    sdeFloors: {
      styleAccuracyMin: sde250.styleAccuracy ?? 0,
      referenceTypeAccuracyMin: sde250.referenceTypeAccuracy ?? 0,
      fieldAccuracyMin: sde250.fieldAccuracy ?? 0,
      splitFailuresMax: sde250.splitFailures,
      missingCaseCountMax: sde250.missingCaseCount,
    },
    routeCeilings: {
      citations10WarmP50MsMax: ROUTE_10_P50_SEED_MS,
      citations500WarmP50MsMax: ROUTE_500_P50_SEED_MS,
    },
    stageTimingCeilingsMs: {
      stress500: Object.fromEntries(Object.entries(stress500.stageTimingsMs).map(([stageId, durationMs]) => [stageId, deriveStageCeiling(durationMs)])),
      sde250: Object.fromEntries(Object.entries(sde250.stageTimingsMs).map(([stageId, durationMs]) => [stageId, deriveStageCeiling(durationMs)])),
    },
    perTypeFloors: sde250.perTypeFloors,
    perFamilyFloors: sde250.perFamilyFloors,
    protectedCases: stress500.protectedCases,
    observed: {
      stress500: {
        citationCount: stress500.citationCount,
        bucketCounts: stress500.bucketCounts,
        readyRate: stress500.readyRate,
        actionNeededCount: stress500.actionNeededCount,
        populatedTitles: stress500.populatedTitles,
        populatedRendered: stress500.populatedRendered,
        populatedYears: stress500.populatedYears,
        contaminationCount: stress500.contaminationCount,
        stageTimingsMs: stress500.stageTimingsMs,
        slowestStages: stress500.slowestStages,
      },
      sde250: {
        expectedCount: sde250.expectedCount,
        actualCount: sde250.actualCount,
        splitFailures: sde250.splitFailures,
        missingCaseCount: sde250.missingCaseCount,
        styleAccuracy: sde250.styleAccuracy,
        referenceTypeAccuracy: sde250.referenceTypeAccuracy,
        fieldAccuracy: sde250.fieldAccuracy,
        stageTimingsMs: sde250.stageTimingsMs,
      },
      routeBench: {
        citations10: route10,
        citations500: route500,
      },
    },
    observabilityReports: sde250.observabilityReports,
  };
}

function compareStageCeilings(scope: string, observed: Record<string, number>, ceilings: Record<string, number>, failures: string[]) {
  for (const [stageId, ceilingMs] of Object.entries(ceilings)) {
    const observedMs = observed[stageId] ?? 0;
    if (observedMs > ceilingMs) {
      failures.push(`${scope} stage ${stageId} exceeded ceiling: observed ${observedMs}ms > ${ceilingMs}ms`);
    }
  }
}

function compareAccuracyFloor(scope: string, observed: number | null, minimum: number | null, failures: string[]) {
  if (minimum == null) return;
  if ((observed ?? 0) < minimum) {
    failures.push(`${scope} regressed: observed ${observed ?? 0} < ${minimum}`);
  }
}

function compareAccuracyCeiling(scope: string, observed: number, maximum: number, failures: string[]) {
  if (observed > maximum) {
    failures.push(`${scope} regressed: observed ${observed} > ${maximum}`);
  }
}

async function run(mode: Mode) {
  const manifest = await collectManifest();

  if (mode === 'freeze') {
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      mode,
      manifestPath: MANIFEST_PATH,
      readyRate: manifest.observed.stress500.readyRate,
      styleAccuracy: manifest.observed.sde250.styleAccuracy,
      referenceTypeAccuracy: manifest.observed.sde250.referenceTypeAccuracy,
      fieldAccuracy: manifest.observed.sde250.fieldAccuracy,
      route10WarmP50Ms: manifest.observed.routeBench.citations10.warmP50Ms,
      route500WarmP50Ms: manifest.observed.routeBench.citations500.warmP50Ms,
    }, null, 2));
    return;
  }

  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing baseline manifest at ${MANIFEST_PATH}. Run freeze first.`);
  }

  const frozen = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as BaselineManifest;
  const failures: string[] = [];

  compareAccuracyFloor('stress500 readyRate', manifest.observed.stress500.readyRate, frozen.corpusFloors.readyRateMin, failures);
  compareAccuracyCeiling('stress500 actionNeededCount', manifest.observed.stress500.actionNeededCount, frozen.corpusFloors.actionNeededMax, failures);
  compareAccuracyFloor('stress500 populatedTitles', manifest.observed.stress500.populatedTitles, frozen.corpusFloors.populatedTitlesMin, failures);
  compareAccuracyFloor('stress500 populatedRendered', manifest.observed.stress500.populatedRendered, frozen.corpusFloors.populatedRenderedMin, failures);
  compareAccuracyFloor('stress500 populatedYears', manifest.observed.stress500.populatedYears, frozen.corpusFloors.populatedYearsMin, failures);
  compareAccuracyFloor('stress500 contaminationCount', manifest.observed.stress500.contaminationCount, frozen.corpusFloors.contaminationCountMin, failures);

  compareAccuracyFloor('sde250 styleAccuracy', manifest.observed.sde250.styleAccuracy, frozen.sdeFloors.styleAccuracyMin, failures);
  compareAccuracyFloor('sde250 referenceTypeAccuracy', manifest.observed.sde250.referenceTypeAccuracy, frozen.sdeFloors.referenceTypeAccuracyMin, failures);
  compareAccuracyFloor('sde250 fieldAccuracy', manifest.observed.sde250.fieldAccuracy, frozen.sdeFloors.fieldAccuracyMin, failures);
  compareAccuracyCeiling('sde250 splitFailures', manifest.observed.sde250.splitFailures, frozen.sdeFloors.splitFailuresMax, failures);
  compareAccuracyCeiling('sde250 missingCaseCount', manifest.observed.sde250.missingCaseCount, frozen.sdeFloors.missingCaseCountMax, failures);

  compareAccuracyCeiling('route 10 warm p50', manifest.observed.routeBench.citations10.warmP50Ms, frozen.routeCeilings.citations10WarmP50MsMax, failures);
  compareAccuracyCeiling('route 500 warm p50', manifest.observed.routeBench.citations500.warmP50Ms, frozen.routeCeilings.citations500WarmP50MsMax, failures);

  compareStageCeilings('stress500', manifest.observed.stress500.stageTimingsMs, frozen.stageTimingCeilingsMs.stress500, failures);
  compareStageCeilings('sde250', manifest.observed.sde250.stageTimingsMs, frozen.stageTimingCeilingsMs.sde250, failures);

  for (const [typeId, frozenMetrics] of Object.entries(frozen.perTypeFloors)) {
    const observedMetrics = manifest.perTypeFloors[typeId];
    if (!observedMetrics) {
      failures.push(`Missing per-type metrics for ${typeId}`);
      continue;
    }
    compareAccuracyFloor(`per-type ${typeId} styleAccuracy`, observedMetrics.styleAccuracy, frozenMetrics.styleAccuracy, failures);
    compareAccuracyFloor(`per-type ${typeId} referenceTypeAccuracy`, observedMetrics.referenceTypeAccuracy, frozenMetrics.referenceTypeAccuracy, failures);
    compareAccuracyFloor(`per-type ${typeId} fieldAccuracy`, observedMetrics.fieldAccuracy, frozenMetrics.fieldAccuracy, failures);
  }

  for (const [familyId, frozenMetrics] of Object.entries(frozen.perFamilyFloors)) {
    const observedMetrics = manifest.perFamilyFloors[familyId];
    if (!observedMetrics) {
      failures.push(`Missing per-family metrics for ${familyId}`);
      continue;
    }
    compareAccuracyCeiling(`per-family ${familyId} splitFailures`, observedMetrics.splitFailures, frozenMetrics.splitFailures, failures);
    compareAccuracyFloor(`per-family ${familyId} styleAccuracy`, observedMetrics.styleAccuracy, frozenMetrics.styleAccuracy, failures);
    compareAccuracyFloor(`per-family ${familyId} referenceTypeAccuracy`, observedMetrics.referenceTypeAccuracy, frozenMetrics.referenceTypeAccuracy, failures);
    compareAccuracyFloor(`per-family ${familyId} fieldAccuracy`, observedMetrics.fieldAccuracy, frozenMetrics.fieldAccuracy, failures);
  }

  for (const [caseId, frozenCase] of Object.entries(frozen.protectedCases)) {
    const observedCase = manifest.protectedCases[caseId];
    if (!observedCase) {
      failures.push(`Missing protected case ${caseId}`);
      continue;
    }
    if (!observedCase.matchedReferenceType || observedCase.observedReferenceType !== frozenCase.expectedReferenceType) {
      failures.push(`Protected case ${caseId} changed reference type: observed ${observedCase.observedReferenceType}, expected ${frozenCase.expectedReferenceType}`);
    }
  }

  console.log(JSON.stringify({
    mode,
    manifestPath: MANIFEST_PATH,
    failures,
    observed: {
      readyRate: manifest.observed.stress500.readyRate,
      styleAccuracy: manifest.observed.sde250.styleAccuracy,
      referenceTypeAccuracy: manifest.observed.sde250.referenceTypeAccuracy,
      fieldAccuracy: manifest.observed.sde250.fieldAccuracy,
      route10WarmP50Ms: manifest.observed.routeBench.citations10.warmP50Ms,
      route500WarmP50Ms: manifest.observed.routeBench.citations500.warmP50Ms,
    },
  }, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

const rawMode = (process.argv[2] ?? 'check').toLowerCase();
const mode: Mode = rawMode === 'freeze' ? 'freeze' : 'check';

run(mode)
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => {
      process.exit(process.exitCode ?? 0);
    }, 100);
  });
