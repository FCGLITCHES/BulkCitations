import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { processV2Conversion } from '../server/engine/v2/pipeline.js';
import {
  bestVenue,
  buildBatchContent,
  chunkRecords,
  cleanText,
  normalizeComparisonText,
  normalizedLevenshteinRatio,
  type BenchmarkCorpus,
  type BenchmarkRecord,
} from './academicBenchmarkShared.js';

const CORPUS_PATH = path.resolve('scripts/data/academic-benchmark-corpus-1000.json');
const OUTPUT_DIR = path.resolve('output');

type DebugOptions = {
  batchSize: number;
  batchIndex: number;
  limit: number;
};

type MatchedPair = {
  record: BenchmarkRecord;
  recordIndex: number;
  citation: any;
  citationIndex: number;
};

type Alignment = {
  matched: MatchedPair[];
  missing: Array<{ record: BenchmarkRecord; recordIndex: number }>;
};

function parseArgs(argv: string[]): DebugOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      values.set(key, next);
      index += 1;
    } else {
      values.set(key, 'true');
    }
  }

  return {
    batchSize: Number.parseInt(values.get('batchSize') ?? '50', 10),
    batchIndex: Number.parseInt(values.get('batchIndex') ?? '0', 10),
    limit: Number.parseInt(values.get('limit') ?? '12', 10),
  };
}

function text(value: unknown): string {
  return cleanText(typeof value === 'string' ? value : '');
}

function fieldValue<T>(field: { value: T } | undefined): T | undefined {
  return field?.value;
}

function actualVenue(citation: any): string {
  return cleanText(
    fieldValue(citation.journal)
    ?? fieldValue(citation.conferenceTitle)
    ?? fieldValue(citation.bookTitle)
    ?? fieldValue(citation.publisher)
    ?? fieldValue(citation.institution)
    ?? '',
  );
}

function actualTitle(citation: any): string {
  return cleanText(fieldValue(citation.title) ?? citation.rendered?.formatted ?? '');
}

function alignBatch(records: readonly BenchmarkRecord[], citations: readonly any[]): Alignment {
  const matched: MatchedPair[] = [];
  const missing: Alignment['missing'] = [];
  let expectedIndex = 0;

  for (let citationIndex = 0; citationIndex < citations.length; citationIndex += 1) {
    const citation = citations[citationIndex];
    if (expectedIndex >= records.length) break;

    let bestIndex = expectedIndex;
    let bestScore = -1;
    const searchLimit = Math.min(records.length, expectedIndex + 40);

    for (let candidateIndex = expectedIndex; candidateIndex < searchLimit; candidateIndex += 1) {
      const record = records[candidateIndex]!;
      const titleScore = normalizedLevenshteinRatio(actualTitle(citation), record.expected.title);
      const venueScore = normalizedLevenshteinRatio(actualVenue(citation), bestVenue(record.expected));
      const yearScore = fieldValue(citation.year) === record.expected.year ? 1 : 0;
      const score = (titleScore * 0.65) + (venueScore * 0.2) + (yearScore * 0.15);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = candidateIndex;
      }
    }

    while (expectedIndex < bestIndex) {
      missing.push({ record: records[expectedIndex]!, recordIndex: expectedIndex });
      expectedIndex += 1;
    }

    matched.push({
      record: records[bestIndex]!,
      recordIndex: bestIndex,
      citation,
      citationIndex,
    });
    expectedIndex = bestIndex + 1;
  }

  while (expectedIndex < records.length) {
    missing.push({ record: records[expectedIndex]!, recordIndex: expectedIndex });
    expectedIndex += 1;
  }

  return { matched, missing };
}

function preview(value: string, limit = 140): string {
  const normalized = cleanText(value);
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3)}...`;
}

function likelyAbsorbedBy(expected: BenchmarkRecord, citations: readonly any[]): Array<{
  citationIndex: number;
  evidence: string[];
  score: number;
}> {
  const normalizedExpectedTitle = normalizeComparisonText(expected.expected.title);
  const normalizedExpectedDoi = normalizeComparisonText(expected.expected.doi ?? expected.doi);
  const matches: Array<{ citationIndex: number; evidence: string[]; score: number }> = [];

  citations.forEach((citation, citationIndex) => {
    const splitChunk = text(citation.stageDebug?.split?.cleanedChunk);
    const raw = text(citation.raw);
    const workingChunk = text(citation.stageDebug?.extract?.preparedWorkingChunk?.joinedText);
    const haystack = [splitChunk, raw, workingChunk].filter(Boolean).join(' ');
    if (!haystack) return;

    const normalizedHaystack = normalizeComparisonText(haystack);
    const evidence: string[] = [];
    let score = 0;

    if (normalizedExpectedDoi && normalizedHaystack.includes(normalizedExpectedDoi)) {
      evidence.push('doi_in_chunk');
      score += 2;
    }
    if (normalizedExpectedTitle && normalizedHaystack.includes(normalizedExpectedTitle)) {
      evidence.push('title_in_chunk');
      score += 2;
    }

    const titleSimilarity = normalizedLevenshteinRatio(actualTitle(citation), expected.expected.title);
    if (titleSimilarity >= 0.75) {
      evidence.push(`title_similarity_${titleSimilarity.toFixed(2)}`);
      score += titleSimilarity;
    }

    if (evidence.length > 0) {
      matches.push({ citationIndex, evidence, score: Number(score.toFixed(2)) });
    }
  });

  return matches.sort((left, right) => right.score - left.score).slice(0, 3);
}

function summarizeMatchedPairs(pairs: readonly MatchedPair[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const pair of pairs) {
    const chunkLength = Number(pair.citation.stageDebug?.split?.chunkLength ?? 0);
    const flags = pair.citation.stageDebug?.split?.contaminationFlags ?? [];
    const branch = String(pair.citation.stageDebug?.extract?.selectedBranch ?? 'none');
    const fallback = pair.citation.rendered?.warnings?.includes('warning:render_output_empty_or_invalid') ? 'render_fallback' : 'render_ok';

    if (chunkLength > 800) {
      summary.oversized_chunk = (summary.oversized_chunk ?? 0) + 1;
    }
    for (const flag of flags) {
      summary[`split_flag:${flag}`] = (summary[`split_flag:${flag}`] ?? 0) + 1;
    }
    summary[`extract_branch:${branch}`] = (summary[`extract_branch:${branch}`] ?? 0) + 1;
    summary[fallback] = (summary[fallback] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(summary).sort((left, right) => right[1] - left[1]),
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.error(`[debugAcademicBenchmarkBatch] loading corpus from ${CORPUS_PATH}`);
  const corpus = JSON.parse(await readFile(CORPUS_PATH, 'utf8')) as BenchmarkCorpus;
  const batches = chunkRecords(corpus.records, options.batchSize);
  const records = batches[options.batchIndex];

  if (!records) {
    throw new Error(`Batch index ${options.batchIndex} is out of range for batch size ${options.batchSize}.`);
  }

  process.env.ENABLE_LLM_EXTRACTOR = '0';
  process.env.ENABLE_GROBID_EXTRACTOR = '0';

  const content = buildBatchContent(records);
  console.error(`[debugAcademicBenchmarkBatch] starting pipeline for batchSize=${options.batchSize} batchIndex=${options.batchIndex}`);
  const startedAt = performance.now();
  const { response } = await processV2Conversion({
    sourceType: 'text',
    content,
    inputStyle: 'auto',
    outputStyle: 'apa',
    enrich: false,
    dedup: false,
    group: false,
    debug: true,
  }, {
    executionMode: 'sync',
  });
  const durationMs = Number((performance.now() - startedAt).toFixed(2));
  console.error(`[debugAcademicBenchmarkBatch] pipeline completed in ${durationMs} ms with ${response.citations.length} citations`);

  const alignment = alignBatch(records, response.citations);
  const matchedPairs = alignment.matched;
  console.error(`[debugAcademicBenchmarkBatch] alignment completed with ${alignment.missing.length} missing records`);

  const report = {
    request: options,
    durationMs,
    inputProfile: response.inputProfile,
    stats: response.stats,
    stageTimings: response.processingPath.stageTimings,
    pipelineLogTail: response.pipeline_log.slice(-8),
    countIntegrity: {
      expected: records.length,
      actual: response.citations.length,
      missing: alignment.missing.length,
    },
    matchedSummary: summarizeMatchedPairs(matchedPairs),
    missingExamples: alignment.missing.slice(0, options.limit).map(({ record, recordIndex }) => ({
      recordIndex,
      recordId: record.id,
      sourceType: record.sourceType,
      inputStyle: record.inputStyle,
      perturbation: record.perturbation,
      expectedTitle: record.expected.title,
      expectedVenue: bestVenue(record.expected),
      rawPreview: preview(record.rawInput),
      likelyAbsorbedBy: likelyAbsorbedBy(record, response.citations),
    })),
    firstActualCitations: response.citations.slice(0, options.limit).map((citation: any, citationIndex: number) => ({
      citationIndex,
      referenceType: citation.referenceType,
      title: actualTitle(citation),
      venue: actualVenue(citation),
      rendered: preview(citation.rendered?.formatted ?? ''),
      qualityBucket: citation.quality?.bucket ?? null,
      renderWarnings: citation.rendered?.warnings ?? [],
      split: {
        reasons: citation.stageDebug?.split?.splitReasons ?? [],
        flags: citation.stageDebug?.split?.contaminationFlags ?? [],
        chunkLength: citation.stageDebug?.split?.chunkLength ?? 0,
        lineCount: citation.stageDebug?.split?.lineCount ?? 0,
        cleanedChunkPreview: preview(text(citation.stageDebug?.split?.cleanedChunk)),
      },
      extract: {
        selectedBranch: citation.stageDebug?.extract?.selectedBranch ?? null,
        selectionReason: citation.stageDebug?.extract?.selectionReason ?? null,
        extractorPath: citation.stageDebug?.extract?.extractorPath ?? null,
        warningFlags: citation.stageDebug?.extract?.warningFlags ?? [],
      },
    })),
  };

  const outputPath = path.join(
    OUTPUT_DIR,
    `debug-academic-batch-${options.batchSize}-${options.batchIndex}.json`,
  );
  console.error(`[debugAcademicBenchmarkBatch] writing report to ${outputPath}`);
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    outputPath,
    batchSize: options.batchSize,
    batchIndex: options.batchIndex,
    durationMs,
    expectedCount: records.length,
    actualCount: response.citations.length,
    missingCount: alignment.missing.length,
    matchedSummary: summarizeMatchedPairs(matchedPairs),
  }, null, 2));
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
