import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { processV2Conversion } from '../server/engine/v2/pipeline.js';
import { canonicalToParsedReference } from '../server/engine/v2/utils.js';
import { getMissingExpectedFields } from '../server/engine/v2/qualityRules.js';
import type { CanonicalCitation, CitationReviewBucket, ParsedReference } from '../shared/schema.js';

type ManifestEntry = {
  expectedBucket?: CitationReviewBucket;
  correctedCoreFields?: Partial<ParsedReference> & { referenceType?: string };
  note?: string;
};

type Manifest = Record<string, ManifestEntry>;

type Args = {
  inputPath?: string;
  manifestPath?: string;
  filter?: CitationReviewBucket;
  outputDir: string;
  useStdin: boolean;
  dedup: boolean;
};

const DEFAULT_FIXTURE = path.resolve(process.cwd(), 'scripts/data/stress-batch-20260321.txt');
const DEFAULT_MANIFEST = path.resolve(process.cwd(), 'scripts/data/stress-batch-20260321.adjudication.json');
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), 'output/stress');

function parseArgs(argv: string[]): Args {
  const args: Args = {
    outputDir: DEFAULT_OUTPUT_DIR,
    useStdin: false,
    dedup: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--input':
        args.inputPath = argv[index + 1];
        index += 1;
        break;
      case '--manifest':
        args.manifestPath = argv[index + 1];
        index += 1;
        break;
      case '--filter':
        args.filter = argv[index + 1] as CitationReviewBucket;
        index += 1;
        break;
      case '--output-dir':
        args.outputDir = path.resolve(process.cwd(), argv[index + 1]);
        index += 1;
        break;
      case '--stdin':
        args.useStdin = true;
        break;
      case '--dedup':
        args.dedup = true;
        break;
      default:
        break;
    }
  }

  return args;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace(/-/g, '').replace('T', '-');
}

function computeFingerprint(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

function loadManifest(manifestPath: string | undefined): Manifest | undefined {
  const resolvedPath = manifestPath ?? DEFAULT_MANIFEST;
  if (!fs.existsSync(resolvedPath)) return undefined;
  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8')) as Manifest;
}

function venueValue(parsed: ParsedReference): string | undefined {
  return parsed.conferenceTitle ?? parsed.bookTitle ?? parsed.journal ?? parsed.publisher ?? parsed.url;
}

function diagnoseCitation(citation: CanonicalCitation): { likelyLayer: string; summary: string } {
  const codes = new Set(citation.validationIssues.map((issue) => issue.code));

  if ([...codes].some((code) => code.includes('header_bleed') || code.includes('doi_orphan') || code.includes('multiline_truncation') || code.includes('page_artifact') || code.includes('oversized_chunk') || code.startsWith('embedded_reference_start') || code.startsWith('multiple_'))) {
    return {
      likelyLayer: 'split',
      summary: 'Split-stage contamination likely combined, truncated, or polluted this citation chunk.',
    };
  }

  if (citation.resolution?.status === 'insufficient_evidence') {
    return {
      likelyLayer: 'extract',
      summary: 'Extraction did not preserve enough title/author evidence for strict resolution.',
    };
  }

  if (citation.resolution && ['ambiguous_match', 'no_exact_match', 'provider_no_coverage', 'provider_error'].includes(citation.resolution.status)) {
    return {
      likelyLayer: 'enrich',
      summary: `Resolution ended with ${citation.resolution.status}. Candidate ranking or provider coverage likely needs tuning.`,
    };
  }

  if (codes.has('connector_as_author') || codes.has('author_structure_unstable') || codes.has('authors_missing') || codes.has('initials_as_surname')) {
    return {
      likelyLayer: 'extract',
      summary: 'Author parsing is unstable and likely needs extractor or normalization changes.',
    };
  }

  if (codes.has('protected_title_token_corrupted') || codes.has('protected_venue_token_corrupted')) {
    return {
      likelyLayer: 'normalize',
      summary: 'Protected token preservation failed during normalization or extraction.',
    };
  }

  if ((citation.resolution?.conflictFields.length ?? 0) > 0) {
    return {
      likelyLayer: 'enrich',
      summary: 'Verified external metadata conflicts with extracted fields and needs merge-policy or parser tuning.',
    };
  }

  if ((citation.quality?.missingRequired.length ?? 0) > 0) {
    return {
      likelyLayer: 'extract',
      summary: 'Core required fields are still missing after extraction and merge.',
    };
  }

  if ((citation.quality?.bucket ?? 'worth_reviewing') === 'worth_reviewing') {
    return {
      likelyLayer: 'score',
      summary: 'Citation is structurally plausible but below the ready threshold after validation.',
    };
  }

  return {
    likelyLayer: 'render',
    summary: 'Citation cleared validation and scoring checks.',
  };
}

function buildCitationReport(citation: CanonicalCitation, index: number, manifest?: Manifest) {
  const fingerprint = computeFingerprint(citation.raw);
  const parsedFields = citation.stageDebug?.extract && 'selectedParsed' in citation.stageDebug.extract
    ? (citation.stageDebug.extract.selectedParsed as ParsedReference)
    : canonicalToParsedReference(citation);
  const mergedFields = canonicalToParsedReference(citation);
  const expectedMissing = getMissingExpectedFields(citation);
  const diagnosis = diagnoseCitation(citation);
  const manifestEntry = manifest?.[fingerprint];

  return {
    index: index + 1,
    citationId: citation.id,
    fingerprint,
    raw: citation.raw,
    status: citation.status,
    referenceType: citation.referenceType,
    parsedFields,
    mergedFields,
    resolution: citation.resolution ?? null,
    enrichment: citation.enrichment ?? null,
    missingFields: {
      required: citation.quality?.missingRequired ?? [],
      expected: expectedMissing,
      optional: citation.quality?.missingOptional ?? [],
    },
    validationCodes: citation.validationIssues.map((issue) => issue.code),
    validationIssues: citation.validationIssues,
    quality: citation.quality ?? null,
    renderedOutput: citation.rendered?.formatted ?? null,
    fieldConfidence: {
      authors: citation.authors.confidence,
      title: citation.title.confidence,
      year: citation.year.confidence,
      venue: Math.max(citation.journal.confidence, citation.conferenceTitle.confidence, citation.bookTitle.confidence, citation.publisher.confidence, citation.institution.confidence, citation.url.confidence),
    },
    bucket: citation.quality?.bucket ?? 'worth_reviewing',
    bucketReasons: citation.quality?.bucketReasons ?? [],
    diagnosis,
    adjudication: manifestEntry
      ? {
          expectedBucket: manifestEntry.expectedBucket ?? null,
          bucketMatches: manifestEntry.expectedBucket ? manifestEntry.expectedBucket === citation.quality?.bucket : null,
          readyMatches: manifestEntry.expectedBucket ? (manifestEntry.expectedBucket === 'ready') === (citation.quality?.bucket === 'ready') : null,
          correctedCoreFields: manifestEntry.correctedCoreFields ?? null,
          note: manifestEntry.note ?? null,
        }
      : null,
    debug: citation.stageDebug ?? null,
  };
}

function summarizeProviders(citations: CanonicalCitation[]) {
  const resolutionStatusCounts: Record<string, number> = {};
  const providerCounts: Record<string, number> = {};
  const matchStrategyCounts: Record<string, number> = {};

  for (const citation of citations) {
    if (citation.resolution?.status) {
      resolutionStatusCounts[citation.resolution.status] = (resolutionStatusCounts[citation.resolution.status] ?? 0) + 1;
    }
    if (citation.resolution?.provider) {
      providerCounts[citation.resolution.provider] = (providerCounts[citation.resolution.provider] ?? 0) + 1;
    }
    if (citation.resolution?.matchStrategy) {
      matchStrategyCounts[citation.resolution.matchStrategy] = (matchStrategyCounts[citation.resolution.matchStrategy] ?? 0) + 1;
    }
  }

  return {
    resolutionStatusCounts,
    providerCounts,
    matchStrategyCounts,
  };
}

function summarizeAdjudication(citations: ReturnType<typeof buildCitationReport>[], manifest?: Manifest) {
  if (!manifest) return null;

  const adjudicated = citations.filter((citation) => citation.adjudication?.expectedBucket);
  if (adjudicated.length === 0) return null;

  const exactBucketMatches = adjudicated.filter((citation) => citation.adjudication?.bucketMatches).length;
  const readyBinaryMatches = adjudicated.filter((citation) => citation.adjudication?.readyMatches).length;
  const predictedReady = adjudicated.filter((citation) => citation.bucket === 'ready').length;
  const goldReady = adjudicated.filter((citation) => citation.adjudication?.expectedBucket === 'ready').length;
  const trueReady = adjudicated.filter((citation) => citation.bucket === 'ready' && citation.adjudication?.expectedBucket === 'ready').length;

  return {
    adjudicatedCount: adjudicated.length,
    exactBucketAccuracy: Number((exactBucketMatches / adjudicated.length).toFixed(4)),
    hybridReadyAccuracy: Number((readyBinaryMatches / adjudicated.length).toFixed(4)),
    readyPrecision: predictedReady > 0 ? Number((trueReady / predictedReady).toFixed(4)) : null,
    readyRecall: goldReady > 0 ? Number((trueReady / goldReady).toFixed(4)) : null,
  };
}

async function loadInput(args: Args): Promise<{ content: string; fixtureStem: string; source: string }> {
  if (args.useStdin || (!args.inputPath && !process.stdin.isTTY)) {
    const content = await readStdin();
    return {
      content,
      fixtureStem: 'stdin-batch',
      source: 'stdin',
    };
  }

  const inputPath = path.resolve(process.cwd(), args.inputPath ?? DEFAULT_FIXTURE);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input fixture not found: ${inputPath}`);
  }

  return {
    content: fs.readFileSync(inputPath, 'utf8'),
    fixtureStem: path.basename(inputPath, path.extname(inputPath)),
    source: inputPath,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = await loadInput(args);
  const manifest = loadManifest(args.manifestPath);

  const originalConsoleLog = console.log;
  let suppressedStructuredLogCount = 0;
  console.log = (...parts: unknown[]) => {
    const rendered = parts.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join(' ');
    const trimmed = rendered.trim();
    if (trimmed.startsWith('{') && /"stage"\s*:/.test(trimmed)) {
      suppressedStructuredLogCount += 1;
      return;
    }
    originalConsoleLog(...parts);
  };

  const { response } = await processV2Conversion({
    sourceType: 'text',
    content: input.content,
    inputStyle: 'auto',
    outputStyle: 'apa',
    enrich: true,
    dedup: args.dedup,
    group: false,
    debug: true,
  }).finally(() => {
    console.log = originalConsoleLog;
  });

  const citations = response.citations.filter((citation) => citation.status !== 'merged');
  const citationReports = citations.map((citation, index) => buildCitationReport(citation, index, manifest));
  const bucketCounts = {
    ready: citationReports.filter((citation) => citation.bucket === 'ready').length,
    worth_reviewing: citationReports.filter((citation) => citation.bucket === 'worth_reviewing').length,
    action_needed: citationReports.filter((citation) => citation.bucket === 'action_needed').length,
  };
  const outputDir = args.outputDir;
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.resolve(outputDir, `${timestamp()}-${input.fixtureStem}.json`);

  const report = {
    generatedAt: new Date().toISOString(),
    input: {
      source: input.source,
      fixtureStem: input.fixtureStem,
      bytes: Buffer.byteLength(input.content, 'utf8'),
      dedup: args.dedup,
    },
    job: {
      jobId: response.job_id,
      processedAt: response.processed_at,
      processingPath: response.processingPath,
      pipelineLog: response.pipeline_log,
    },
    summary: {
      citationCount: citationReports.length,
      bucketCounts,
      readyRate: citationReports.length > 0 ? Number((bucketCounts.ready / citationReports.length).toFixed(4)) : 0,
      averageConfidence: response.stats.avg_confidence,
    },
    providerStats: summarizeProviders(citations),
    debugSummary: {
      suppressedStructuredLogCount,
    },
    adjudication: summarizeAdjudication(citationReports, manifest),
    citations: citationReports,
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Wrote report: ${outputPath}`);
  console.log(`Counts: ready=${bucketCounts.ready}, worth_reviewing=${bucketCounts.worth_reviewing}, action_needed=${bucketCounts.action_needed}`);

  if (args.filter) {
    const filtered = citationReports.filter((citation) => citation.bucket === args.filter);
    console.log(`Filtered ${args.filter}: ${filtered.length}`);
    for (const citation of filtered) {
      console.log([
        `#${citation.index}`,
        citation.diagnosis.likelyLayer,
        citation.bucket,
        citation.bucketReasons[0] ?? citation.diagnosis.summary,
      ].join(' | '));
    }
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
