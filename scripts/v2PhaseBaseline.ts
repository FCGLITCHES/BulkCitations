import fs from 'node:fs';
import path from 'node:path';
import { createDefaultAdapters } from '../server/engine/v2/adapters.js';
import type { V2AdapterBundle } from '../server/engine/v2/contracts.js';
import {
  buildChunkedReadyCorpusPlan,
  type ChunkedReadyMode,
} from '../server/engine/v2/fixtures/chunkedReadyCorpus.js';
import { processV2Conversion } from '../server/engine/v2/pipeline.js';
import { runAcademicBenchmark } from './runAcademicBenchmark.js';

type Mode = 'freeze' | 'check';

type ControlledCorpusObserved = {
  total: number;
  ready: number;
  readyRate: number;
  worthReviewing: number;
  actionNeeded: number;
  unknown: number;
  partialChunks: number;
  badChunks: number;
};

type BaselineManifest = {
  generatedAt: string;
  version: number;
  strict_external: {
    essential_accuracy_floor: number;
    count_integrity_floor: number;
    non_empty_output_floor: number;
    identity_contamination_ceiling: number | null;
    observed: {
      essential_accuracy_pct: number;
      count_integrity_pct: number;
      non_empty_output_pct: number;
      identity_integrity_pct: number;
      identity_contamination_count: number;
      identity_contamination_by_category: Record<string, number>;
    };
  };
  legacy_comparable: {
    field_average_floor: number | null;
    methodology_version: string;
    frozen_at: string;
    observed: {
      field_average_pct: number;
    };
  };
  controlled_corpus_regression: {
    structured_ready_floor: number;
    semi_structured_ready_floor: number;
    raw_unstructured_ready_floor: number;
    role: 'regression_guard_only';
    observed: Record<ChunkedReadyMode, ControlledCorpusObserved>;
  };
};

const MANIFEST_PATH = path.resolve(process.cwd(), 'scripts/data/v2-phase-baseline.json');
const DEFAULT_STEP_TIMEOUT_MS = 20 * 60 * 1000;
const STRICT_FLOORS = {
  essential_accuracy_floor: 0.384,
  count_integrity_floor: 0.803,
  non_empty_output_floor: 0.803,
  identity_contamination_ceiling: null as number | null,
};

function computePercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function getStepTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.V2_BASELINE_STEP_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STEP_TIMEOUT_MS;
}

async function withStepTimeout<T>(label: string, task: () => Promise<T>): Promise<T> {
  const timeoutMs = getStepTimeoutMs();
  const start = Date.now();
  console.log(`[v2-phase-baseline] ${label} starting timeoutMs=${timeoutMs}`);
  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    const result = await Promise.race([
      task(),
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`[v2-phase-baseline] ${label} exceeded timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
    console.log(`[v2-phase-baseline] ${label} done durationMs=${Date.now() - start}`);
    return result;
  } catch (error) {
    console.error(`[v2-phase-baseline] ${label} failed durationMs=${Date.now() - start}`);
    throw error;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function measureReadyMode(
  mode: ChunkedReadyMode,
  adapters?: V2AdapterBundle,
): Promise<ControlledCorpusObserved> {
  const chunks = buildChunkedReadyCorpusPlan(mode);
  let total = 0;
  let ready = 0;
  let worthReviewing = 0;
  let actionNeeded = 0;
  let unknown = 0;
  let partialChunks = 0;
  let badChunks = 0;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    console.log(`[v2-phase-baseline] controlled mode=${mode} chunk=${chunkIndex + 1}/${chunks.length} starting`);
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
      adapters,
      executionMode: 'sync',
    });
    console.log(
      `[v2-phase-baseline] controlled mode=${mode} chunk=${chunkIndex + 1}/${chunks.length} done actual=${response.citations.length}/${chunk.expectedCount} partial=${response.processingPath.partialResult ? 'yes' : 'no'}`,
    );

    if (response.processingPath.partialResult) partialChunks += 1;
    if (response.stats.input_count !== chunk.expectedCount || response.citations.length !== chunk.expectedCount) badChunks += 1;

    for (const citation of response.citations) {
      total += 1;
      const bucket = citation.quality?.bucket ?? 'unknown';
      if (bucket === 'ready') ready += 1;
      else if (bucket === 'worth_reviewing') worthReviewing += 1;
      else if (bucket === 'action_needed') actionNeeded += 1;
      else unknown += 1;
    }
  }

  return {
    total,
    ready,
    readyRate: computePercent(ready, total),
    worthReviewing,
    actionNeeded,
    unknown,
    partialChunks,
    badChunks,
  };
}

async function collectManifest(): Promise<BaselineManifest> {
  process.env.ENABLE_LLM_EXTRACTOR = '0';
  process.env.ENABLE_GROBID_EXTRACTOR = '0';

  const academicAdapters = createDefaultAdapters();
  const controlledAdapters = createDefaultAdapters();

  const academic = await withStepTimeout('academic_benchmark', () => runAcademicBenchmark({
    adapters: academicAdapters,
  }));
  const structured = await withStepTimeout('controlled_structured', () => measureReadyMode('structured', controlledAdapters));
  const semiStructured = await withStepTimeout('controlled_semi_structured', () => measureReadyMode('semi_structured', controlledAdapters));
  const rawUnstructured = await withStepTimeout('controlled_raw_unstructured', () => measureReadyMode('raw_unstructured', controlledAdapters));

  return {
    generatedAt: new Date().toISOString(),
    version: 2,
    strict_external: {
      ...STRICT_FLOORS,
      observed: {
        essential_accuracy_pct: Number((academic.strict_external.essentialAccuracyPct / 100).toFixed(4)),
        count_integrity_pct: Number((academic.strict_external.countIntegrityPct / 100).toFixed(4)),
        non_empty_output_pct: Number((academic.strict_external.nonEmptyOutputPct / 100).toFixed(4)),
        identity_integrity_pct: Number((academic.strict_external.identityIntegrityPct / 100).toFixed(4)),
        identity_contamination_count: academic.strict_external.identityContaminationCount,
        identity_contamination_by_category: academic.strict_external.identityContaminationByCategory,
      },
    },
    legacy_comparable: {
      field_average_floor: Number((academic.legacy_comparable.fieldAveragePct / 100).toFixed(4)),
      methodology_version: academic.legacy_comparable.methodologyVersion,
      frozen_at: academic.legacy_comparable.frozenAt,
      observed: {
        field_average_pct: Number((academic.legacy_comparable.fieldAveragePct / 100).toFixed(4)),
      },
    },
    controlled_corpus_regression: {
      structured_ready_floor: 1.0,
      semi_structured_ready_floor: 1.0,
      raw_unstructured_ready_floor: 1.0,
      role: 'regression_guard_only',
      observed: {
        structured,
        semi_structured: semiStructured,
        raw_unstructured: rawUnstructured,
      },
    },
  };
}

function compareFloor(label: string, observed: number, floor: number | null, failures: string[]) {
  if (floor == null) return;
  if (observed < floor) failures.push(`${label} regressed: observed ${observed} < ${floor}`);
}

function compareCeiling(label: string, observed: number, ceiling: number | null, failures: string[], warnings: string[]) {
  if (ceiling == null) {
    warnings.push(`${label} observed ${observed}; ceiling not calibrated yet`);
    return;
  }
  if (observed > ceiling) failures.push(`${label} regressed: observed ${observed} > ${ceiling}`);
}

async function run(mode: Mode) {
  const manifest = await collectManifest();

  if (mode === 'freeze') {
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      mode,
      manifestPath: MANIFEST_PATH,
      strict_external: manifest.strict_external,
      legacy_comparable: manifest.legacy_comparable,
      controlled_corpus_regression: manifest.controlled_corpus_regression,
    }, null, 2));
    return;
  }

  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing baseline manifest at ${MANIFEST_PATH}. Run freeze first.`);
  }

  const frozen = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as BaselineManifest;
  const failures: string[] = [];
  const warnings: string[] = [];

  compareFloor('strict_external essential_accuracy', manifest.strict_external.observed.essential_accuracy_pct, frozen.strict_external.essential_accuracy_floor, failures);
  compareFloor('strict_external count_integrity', manifest.strict_external.observed.count_integrity_pct, frozen.strict_external.count_integrity_floor, failures);
  compareFloor('strict_external non_empty_output', manifest.strict_external.observed.non_empty_output_pct, frozen.strict_external.non_empty_output_floor, failures);
  compareCeiling(
    'strict_external identity_contamination',
    manifest.strict_external.observed.identity_contamination_count,
    frozen.strict_external.identity_contamination_ceiling,
    failures,
    warnings,
  );

  compareFloor(
    'legacy_comparable field_average',
    manifest.legacy_comparable.observed.field_average_pct,
    frozen.legacy_comparable.field_average_floor,
    failures,
  );

  compareFloor(
    'controlled structured ready_rate',
    manifest.controlled_corpus_regression.observed.structured.readyRate,
    frozen.controlled_corpus_regression.structured_ready_floor,
    failures,
  );
  compareFloor(
    'controlled semi_structured ready_rate',
    manifest.controlled_corpus_regression.observed.semi_structured.readyRate,
    frozen.controlled_corpus_regression.semi_structured_ready_floor,
    failures,
  );
  compareFloor(
    'controlled raw_unstructured ready_rate',
    manifest.controlled_corpus_regression.observed.raw_unstructured.readyRate,
    frozen.controlled_corpus_regression.raw_unstructured_ready_floor,
    failures,
  );

  console.log(JSON.stringify({
    mode,
    manifestPath: MANIFEST_PATH,
    failures,
    warnings,
    observed: manifest,
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
