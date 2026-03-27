import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildChunkedReadyCorpusPlan,
  READY_CORPUS_CHUNK_SIZE,
  READY_CORPUS_THRESHOLDS,
  READY_CORPUS_TOTAL,
  READY_REFERENCE_SEEDS,
  type ChunkedReadyMode,
} from '../server/engine/v2/fixtures/chunkedReadyCorpus.js';
import { processV2Conversion } from '../server/engine/v2/pipeline.js';

type CitationBucket = 'ready' | 'worth_reviewing' | 'action_needed' | 'unknown';

type ModeSummary = {
  mode: ChunkedReadyMode;
  total: number;
  ready: number;
  worthReviewing: number;
  actionNeeded: number;
  unknown: number;
  readyRate: number;
  target: number;
  targetMet: boolean;
  partialChunks: number;
  badChunks: number;
  samples: Array<{
    input: string;
    output: string;
    bucket: CitationBucket;
    referenceType: string;
    grade: string;
  }>;
  misses: Array<{
    input: string;
    output: string;
    bucket: CitationBucket;
    flags: string[];
    grade: string;
  }>;
};

function bucketOf(value: unknown): CitationBucket {
  if (value === 'ready' || value === 'worth_reviewing' || value === 'action_needed') {
    return value;
  }
  return 'unknown';
}

async function measureMode(mode: ChunkedReadyMode): Promise<ModeSummary> {
  const chunks = buildChunkedReadyCorpusPlan(mode);
  const samples: ModeSummary['samples'] = [];
  const misses: ModeSummary['misses'] = [];

  let total = 0;
  let ready = 0;
  let worthReviewing = 0;
  let actionNeeded = 0;
  let unknown = 0;
  let partialChunks = 0;
  let badChunks = 0;

  for (const chunk of chunks) {
    const { response } = await processV2Conversion({
      sourceType: 'text',
      content: chunk.content,
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: false,
    }, {
      executionMode: 'sync',
    });

    if ((response.processingPath.partialResult ?? false) === true) {
      partialChunks += 1;
    }
    if (response.stats.input_count !== chunk.expectedCount || response.citations.length !== chunk.expectedCount) {
      badChunks += 1;
    }

    for (let index = 0; index < response.citations.length; index += 1) {
      const citation = response.citations[index];
      const input = citation.raw;
      const output = citation.rendered?.formatted ?? '';
      const bucket = bucketOf(citation.quality?.bucket);
      const grade = citation.quality?.grade ?? 'n/a';
      const referenceType = citation.referenceType ?? 'unknown';

      total += 1;
      if (bucket === 'ready') ready += 1;
      if (bucket === 'worth_reviewing') worthReviewing += 1;
      if (bucket === 'action_needed') actionNeeded += 1;
      if (bucket === 'unknown') unknown += 1;

      if (samples.length < 5) {
        samples.push({ input, output, bucket, referenceType, grade });
      }

      if (bucket !== 'ready' && misses.length < 20) {
        misses.push({
          input,
          output,
          bucket,
          flags: citation.quality?.flags ?? [],
          grade,
        });
      }
    }
  }

  const readyRate = ready / Math.max(total, 1);

  return {
    mode,
    total,
    ready,
    worthReviewing,
    actionNeeded,
    unknown,
    readyRate,
    target: READY_CORPUS_THRESHOLDS[mode],
    targetMet: readyRate >= READY_CORPUS_THRESHOLDS[mode],
    partialChunks,
    badChunks,
    samples,
    misses,
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function renderMarkdown(
  timestamp: string,
  outputJsonPath: string,
  summaries: ModeSummary[],
): string {
  const lines: string[] = [];
  lines.push('# Real Ready Corpus Report');
  lines.push('');
  lines.push(`Generated: ${timestamp}`);
  lines.push(`Corpus size: ${READY_CORPUS_TOTAL} citations per mode in ${READY_CORPUS_CHUNK_SIZE}-citation chunks`);
  lines.push(`Machine-readable report: ${outputJsonPath}`);
  lines.push('');
  lines.push('## Seed corpus');
  lines.push('');
  for (const seed of READY_REFERENCE_SEEDS) {
    const source = seed.sourceUrl ? ` ([source](${seed.sourceUrl}))` : '';
    lines.push(`- ${seed.label}${source}`);
  }

  for (const summary of summaries) {
    lines.push('');
    lines.push(`## ${summary.mode}`);
    lines.push('');
    lines.push(`- Ready: ${summary.ready}/${summary.total} (${formatPercent(summary.readyRate)})`);
    lines.push(`- Target: ${formatPercent(summary.target)} (${summary.targetMet ? 'met' : 'missed'})`);
    lines.push(`- Worth reviewing: ${summary.worthReviewing}`);
    lines.push(`- Action needed: ${summary.actionNeeded}`);
    lines.push(`- Unknown: ${summary.unknown}`);
    lines.push(`- Partial chunks: ${summary.partialChunks}`);
    lines.push(`- Bad chunks: ${summary.badChunks}`);
    lines.push('');
    lines.push('### Sample outputs');
    lines.push('');
    for (const sample of summary.samples) {
      lines.push(`- Bucket: ${sample.bucket}; grade: ${sample.grade}; type: ${sample.referenceType}`);
      lines.push(`  Input: ${sample.input}`);
      lines.push(`  Output: ${sample.output}`);
    }
    if (summary.misses.length > 0) {
      lines.push('');
      lines.push('### Non-ready examples');
      lines.push('');
      for (const miss of summary.misses) {
        lines.push(`- Bucket: ${miss.bucket}; grade: ${miss.grade}; flags: ${miss.flags.join(', ') || 'none'}`);
        lines.push(`  Input: ${miss.input}`);
        lines.push(`  Output: ${miss.output}`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const outputDir = path.resolve('output');
  await mkdir(outputDir, { recursive: true });

  const originalFetch = globalThis.fetch;
  const originalLlm = process.env.ENABLE_LLM_EXTRACTOR;
  const originalGrobid = process.env.ENABLE_GROBID_EXTRACTOR;

  process.env.ENABLE_LLM_EXTRACTOR = '0';
  process.env.ENABLE_GROBID_EXTRACTOR = '0';
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('api.crossref.org')) {
      return new Response('', { status: 404 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const summaries = await Promise.all([
      measureMode('structured'),
      measureMode('semi_structured'),
      measureMode('raw_unstructured'),
    ]);
    const timestamp = new Date().toISOString();
    const jsonPath = path.join(outputDir, 'real-ready-corpus-report.json');
    const markdownPath = path.join(outputDir, 'real-ready-corpus-report.md');
    const payload = {
      generatedAt: timestamp,
      corpusTotal: READY_CORPUS_TOTAL,
      chunkSize: READY_CORPUS_CHUNK_SIZE,
      seeds: READY_REFERENCE_SEEDS,
      summaries,
    };

    await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await writeFile(markdownPath, renderMarkdown(timestamp, jsonPath, summaries), 'utf8');

    console.log(JSON.stringify({
      jsonPath,
      markdownPath,
      summaries: summaries.map((summary) => ({
        mode: summary.mode,
        total: summary.total,
        ready: summary.ready,
        readyRate: summary.readyRate,
        target: summary.target,
        targetMet: summary.targetMet,
        worthReviewing: summary.worthReviewing,
        actionNeeded: summary.actionNeeded,
      })),
    }, null, 2));
  } finally {
    if (originalLlm == null) {
      delete process.env.ENABLE_LLM_EXTRACTOR;
    } else {
      process.env.ENABLE_LLM_EXTRACTOR = originalLlm;
    }
    if (originalGrobid == null) {
      delete process.env.ENABLE_GROBID_EXTRACTOR;
    } else {
      process.env.ENABLE_GROBID_EXTRACTOR = originalGrobid;
    }
    globalThis.fetch = originalFetch;
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
