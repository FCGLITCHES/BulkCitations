import { readFile } from 'node:fs/promises';
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

function parseArgs(argv: string[]): { sourceTypes: Set<string>; batchSize: number } {
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

  const sourceTypes = new Set(
    (values.get('sourceTypes') ?? 'conference,chapter,book,report')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  return {
    sourceTypes,
    batchSize: Number.parseInt(values.get('batchSize') ?? '150', 10),
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  process.env.ENABLE_LLM_EXTRACTOR = '0';
  process.env.ENABLE_GROBID_EXTRACTOR = '0';

  const corpus = JSON.parse(await readFile(CORPUS_PATH, 'utf8')) as BenchmarkCorpus;
  const filteredRecords = corpus.records.filter((record) => args.sourceTypes.has(record.sourceType));
  const batches = chunkRecords(filteredRecords, args.batchSize);
  const failures: Array<Record<string, unknown>> = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const records = batches[batchIndex]!;
    const content = buildBatchContent(records);
    const { response } = await processV2Conversion({
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
    });

    const alignment = alignBatch(records, response.citations);

    for (const missing of alignment.missing) {
      if (!['conference', 'chapter', 'journal', 'report', 'book'].includes(missing.record.sourceType)) continue;
      failures.push({
        kind: 'missing',
        batchIndex,
        recordIndex: missing.recordIndex,
        recordId: missing.record.id,
        sourceType: missing.record.sourceType,
        inputStyle: missing.record.inputStyle,
        rawInput: missing.record.rawInput,
      });
    }

    for (const pair of alignment.matched) {
      const expectedType = pair.record.sourceType;
      const actualType = String(pair.citation.referenceType?.value ?? 'missing');
      if (
        (expectedType === 'conference' || expectedType === 'chapter' || expectedType === 'book' || expectedType === 'report')
        && expectedType !== actualType
      ) {
        failures.push({
          kind: 'type_mismatch',
          batchIndex,
          recordIndex: pair.recordIndex,
          recordId: pair.record.id,
          sourceType: expectedType,
          actualType,
          inputStyle: pair.record.inputStyle,
          rawInput: pair.record.rawInput,
          parsedTitle: text(fieldValue(pair.citation.title)),
          parsedVenue: actualVenue(pair.citation),
        });
      }
    }
  }

  console.log(JSON.stringify(failures.slice(0, 120), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
