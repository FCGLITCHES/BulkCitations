import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { processV2Conversion } from '../server/engine/v2/pipeline.js';
import {
  bestVenue,
  buildBatchContent,
  chunkRecords,
  cleanText,
  normalizedLevenshteinRatio,
  type BenchmarkCorpus,
  type BenchmarkRecord,
} from './academicBenchmarkShared.js';

const CORPUS_PATH = path.resolve('scripts/data/academic-benchmark-corpus-1000.json');

type TargetPair = {
  expectedType: string;
  actualType: string;
};

function parseArgs(argv: string[]): {
  batchSize: number;
  limit: number;
  targets: TargetPair[];
} {
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

  const targets = (values.get('targets') ?? 'conference:chapter,chapter:conference,conference:journal,book:report,journal:missing')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [expectedType, actualType] = entry.split(':').map((value) => value.trim());
      return { expectedType, actualType };
    })
    .filter((entry) => entry.expectedType && entry.actualType);

  return {
    batchSize: Number.parseInt(values.get('batchSize') ?? '50', 10),
    limit: Number.parseInt(values.get('limit') ?? '80', 10),
    targets,
  };
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

function alignBatch(records: readonly BenchmarkRecord[], citations: readonly any[]) {
  const matched: Array<{ record: BenchmarkRecord; recordIndex: number; citation: any; citationIndex: number }> = [];
  const missing: Array<{ record: BenchmarkRecord; recordIndex: number }> = [];
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
  const batches = chunkRecords(corpus.records, args.batchSize);
  const targetSet = new Set(args.targets.map((target) => `${target.expectedType}:${target.actualType}`));
  const failures: Array<Record<string, unknown>> = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batchRecords = batches[batchIndex]!;
    const content = buildBatchContent(batchRecords);
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

    const alignment = alignBatch(batchRecords, response.citations);

    for (const pair of alignment.matched) {
      const expectedType = pair.record.sourceType;
      const actualType = String(pair.citation.referenceType?.value ?? 'missing');
      if (!targetSet.has(`${expectedType}:${actualType}`)) continue;
      failures.push({
        batchIndex,
        recordId: pair.record.id,
        expectedType,
        actualType,
        inputStyle: pair.record.inputStyle,
        rawInput: pair.record.rawInput,
        parsedTitle: cleanText(fieldValue(pair.citation.title) ?? ''),
        parsedVenue: actualVenue(pair.citation),
        parsedYear: fieldValue(pair.citation.year) ?? '',
        winnerAdapterId: pair.citation.debug?.winner_adapter_id ?? '',
        selectionReason: pair.citation.debug?.selection_reason ?? '',
      });
      if (failures.length >= args.limit) break;
    }

    if (failures.length >= args.limit) break;

    for (const missing of alignment.missing) {
      const expectedType = missing.record.sourceType;
      if (!targetSet.has(`${expectedType}:missing`)) continue;
      failures.push({
        batchIndex,
        recordId: missing.record.id,
        expectedType,
        actualType: 'missing',
        inputStyle: missing.record.inputStyle,
        rawInput: missing.record.rawInput,
      });
      if (failures.length >= args.limit) break;
    }

    if (failures.length >= args.limit) break;
  }

  console.log(JSON.stringify(failures, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
