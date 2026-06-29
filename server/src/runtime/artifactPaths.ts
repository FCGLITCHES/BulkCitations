import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function readOverride(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function resolveRepositoryRoot(): string {
  const candidates = [process.cwd(), resolve(process.cwd(), '..')];
  for (const candidate of candidates) {
    if (
      existsSync(resolve(candidate, 'server'))
      && existsSync(resolve(candidate, 'ml-service'))
    ) {
      return candidate;
    }
  }
  return process.cwd();
}

export function resolveStyleGoldOutputPath(): string {
  return readOverride('BULKREFERENCES_STYLE_GOLD_OUTPUT_PATH')
    ?? resolve(resolveMlServiceRoot(), 'training', 'style_gold.jsonl');
}

export function resolveGoldDatasetRoot(): string {
  return readOverride('BULKREFERENCES_GOLD_DATASET_ROOT')
    ?? resolve(resolveMlServiceRoot(), 'training', 'gold-datasets');
}

export function resolveBioDatasetRoot(): string {
  return readOverride('BULKREFERENCES_BIO_DATASET_ROOT')
    ?? resolve(resolveMlServiceRoot(), 'datasets', 'citation-bio');
}

export function resolveStyleModelRoot(): string {
  return readOverride('BULKREFERENCES_STYLE_MODEL_ROOT')
    ?? resolve(resolveMlServiceRoot(), 'models', 'style-model');
}

export function resolveBioModelRoot(): string {
  return readOverride('BULKREFERENCES_BIO_MODEL_ROOT')
    ?? resolve(resolveMlServiceRoot(), 'models');
}

export function resolveMlServiceRoot(): string {
  return readOverride('BULKREFERENCES_ML_SERVICE_ROOT')
    ?? resolve(resolveRepositoryRoot(), 'ml-service');
}

export function resolveBenchmarkResultsRoot(): string {
  return readOverride('BULKREFERENCES_BENCHMARK_RESULTS_ROOT')
    ?? resolve(resolveRepositoryRoot(), 'benchmarks', 'grobid-pmc', 'results');
}

export function resolvePythonTrainingScriptPath(): string {
  return readOverride('BULKREFERENCES_PYTHON_STYLE_TRAINING_SCRIPT_PATH')
    ?? resolve(resolveMlServiceRoot(), 'tools', 'train_style_bundle.py');
}

export function resolvePythonBioTrainingScriptPath(): string {
  return readOverride('BULKREFERENCES_PYTHON_BIO_TRAINING_SCRIPT_PATH')
    ?? resolve(resolveMlServiceRoot(), 'tools', 'train_bio_bundle.py');
}

export function resolvePythonPromotionScriptPath(): string {
  return readOverride('BULKREFERENCES_PYTHON_STYLE_PROMOTION_SCRIPT_PATH')
    ?? resolve(resolveMlServiceRoot(), 'tools', 'promote_style_bundle.py');
}

export function resolvePythonBundlePromotionScriptPath(): string {
  return readOverride('BULKREFERENCES_PYTHON_BUNDLE_PROMOTION_SCRIPT_PATH')
    ?? resolve(resolveMlServiceRoot(), 'tools', 'promote_bundle.py');
}
