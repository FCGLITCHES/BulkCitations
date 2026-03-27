import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BENCHMARK_QUOTAS,
  cleanText,
  crossrefToBenchmarkRecord,
  deterministicShuffle,
  type BenchmarkCorpus,
  type BenchmarkRecord,
  type BenchmarkQuota,
  type CrossrefWork,
} from './academicBenchmarkShared.js';

const OUTPUT_PATH = path.resolve('scripts/data/academic-benchmark-corpus-1000.json');
const USER_AGENT = 'Citing Academic Benchmark/1.0 (mailto:benchmark@internal.example)';
const CROSSREF_SAMPLE_SIZE = 100;
const MAX_EXTRA_ROUNDS = 8;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCrossrefSample(crossrefType: string): Promise<CrossrefWork[]> {
  const url = new URL('https://api.crossref.org/works');
  url.searchParams.set('filter', `type:${crossrefType}`);
  url.searchParams.set('sample', String(CROSSREF_SAMPLE_SIZE));
  url.searchParams.set('select', [
    'DOI',
    'type',
    'title',
    'subtitle',
    'author',
    'editor',
    'issued',
    'published',
    'published-print',
    'published-online',
    'created',
    'publisher',
    'publisher-location',
    'container-title',
    'short-container-title',
    'volume',
    'issue',
    'page',
    'article-number',
  ].join(','));

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Crossref request failed for ${crossrefType}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as {
    message?: {
      items?: CrossrefWork[];
    };
  };

  return payload.message?.items ?? [];
}

async function collectQuota(quota: BenchmarkQuota, retrievalDate: string): Promise<BenchmarkRecord[]> {
  const byDoi = new Map<string, BenchmarkRecord>();
  let attempts = 0;
  let recordIndex = 0;

  while (byDoi.size < quota.target && attempts < quota.sampleRounds + MAX_EXTRA_ROUNDS) {
    attempts += 1;
    const items = await fetchCrossrefSample(quota.crossrefType);
    for (const item of items) {
      const doi = cleanText(item.DOI);
      if (!doi || byDoi.has(doi)) continue;

      const record = crossrefToBenchmarkRecord(item, quota.sourceType, retrievalDate, recordIndex);
      recordIndex += 1;
      if (!record) continue;

      byDoi.set(doi, record);
      if (byDoi.size >= quota.target) break;
    }

    await sleep(300);
  }

  if (byDoi.size < quota.target) {
    throw new Error(`Unable to collect ${quota.target} valid ${quota.sourceType} records. Collected ${byDoi.size}.`);
  }

  return Array.from(byDoi.values()).slice(0, quota.target);
}

async function main(): Promise<void> {
  const retrievalDate = new Date().toISOString();
  const allRecords: BenchmarkRecord[] = [];

  for (const quota of BENCHMARK_QUOTAS) {
    const records = await collectQuota(quota, retrievalDate);
    allRecords.push(...records);
  }

  const shuffled = deterministicShuffle(allRecords, 20260327);
  const corpus: BenchmarkCorpus = {
    generatedAt: retrievalDate,
    methodologyVersion: 'academic-benchmark-v1',
    totalRecords: shuffled.length,
    quotas: BENCHMARK_QUOTAS,
    records: shuffled,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8');

  const byType = Object.fromEntries(
    BENCHMARK_QUOTAS.map((quota) => [
      quota.sourceType,
      shuffled.filter((record) => record.sourceType === quota.sourceType).length,
    ]),
  );

  console.log(JSON.stringify({
    outputPath: OUTPUT_PATH,
    totalRecords: shuffled.length,
    byType,
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
