import type { ConvertRequest } from '../engine/types/api.js';
import type { ParseProfile } from '../engine/types/parseProfile.js';
import { ENGINE_PARSE_PROFILES } from '../engine/types/parseProfile.js';
import {
  BENCHMARK_ARTIFACT_DETAILS,
  BENCHMARK_HARDWARE_PROFILES,
  BENCHMARK_SLICE_PRESETS,
  BENCHMARK_VARIANTS,
  type BenchmarkArtifactDetail,
  type BenchmarkHardwareProfile,
  type BenchmarkRuntimeOverrides,
  type BenchmarkSlicePreset,
  type BenchmarkSliceRange,
  type BenchmarkVariant,
} from './types.js';
import {
  normalizeBenchmarkSliceRange,
  resolveBenchmarkSliceSelection,
  type ResolvedBenchmarkSliceSelection,
} from './selection.js';

const BENCHMARK_SOURCE_TYPES: ConvertRequest['sourceType'][] = ['text', 'doi_list'];

function readPositiveIntegerFlag(argv: string[], flag: string): number | undefined {
  const rawValue = argv.find((entry) => entry.startsWith(flag))?.slice(flag.length);
  if (rawValue == null) {
    return undefined;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag.slice(2, -1)} must be a positive integer.`);
  }
  return parsed;
}

export function readBenchmarkSourceType(argv: string[]): ConvertRequest['sourceType'] {
  const value = argv.find((entry) => entry.startsWith('--sourceType='))?.slice('--sourceType='.length);
  return BENCHMARK_SOURCE_TYPES.includes(value as ConvertRequest['sourceType'])
    ? (value as ConvertRequest['sourceType'])
    : 'text';
}

export function readBenchmarkParseProfile(argv: string[]): ParseProfile {
  const value = argv.find((entry) => entry.startsWith('--parseProfile='))?.slice('--parseProfile='.length);
  return ENGINE_PARSE_PROFILES.includes(value as ParseProfile)
    ? (value as ParseProfile)
    : 'current_runtime';
}

export function readBenchmarkHardwareProfile(argv: string[]): BenchmarkHardwareProfile {
  const value = argv.find((entry) => entry.startsWith('--hardwareProfile='))?.slice('--hardwareProfile='.length);
  return BENCHMARK_HARDWARE_PROFILES.includes(value as BenchmarkHardwareProfile)
    ? (value as BenchmarkHardwareProfile)
    : 'default';
}

export function readBenchmarkVariant(argv: string[]): BenchmarkVariant {
  const value = argv.find((entry) => entry.startsWith('--benchmarkVariant='))?.slice('--benchmarkVariant='.length);
  return BENCHMARK_VARIANTS.includes(value as BenchmarkVariant)
    ? (value as BenchmarkVariant)
    : 'grobid_compare';
}

export function readBenchmarkArtifactDetail(argv: string[]): BenchmarkArtifactDetail {
  const value = argv.find((entry) => entry.startsWith('--artifactDetail='))?.slice('--artifactDetail='.length);
  return BENCHMARK_ARTIFACT_DETAILS.includes(value as BenchmarkArtifactDetail)
    ? (value as BenchmarkArtifactDetail)
    : 'full';
}

export function readBenchmarkArtifactNamespace(argv: string[]): string | null {
  const value = argv.find((entry) => entry.startsWith('--artifactNamespace='))?.slice('--artifactNamespace='.length);
  if (!value) {
    return null;
  }
  if (!/^[a-z0-9_]+$/u.test(value)) {
    throw new Error(
      "Benchmark artifact namespace must use only lowercase letters, numbers, and underscores.",
    );
  }
  return value;
}

export function readBenchmarkSlicePreset(argv: string[]): BenchmarkSlicePreset | null {
  const value = argv.find((entry) => entry.startsWith('--slicePreset='))?.slice('--slicePreset='.length);
  return BENCHMARK_SLICE_PRESETS.includes(value as BenchmarkSlicePreset)
    ? (value as BenchmarkSlicePreset)
    : null;
}

export function readBenchmarkSliceRange(argv: string[]): BenchmarkSliceRange | null {
  const rawStart = argv.find((entry) => entry.startsWith('--sliceStart='))?.slice('--sliceStart='.length);
  const rawEnd = argv.find((entry) => entry.startsWith('--sliceEnd='))?.slice('--sliceEnd='.length);
  const startRow = rawStart == null ? null : Number.parseInt(rawStart, 10);
  const endRow = rawEnd == null ? null : Number.parseInt(rawEnd, 10);
  return normalizeBenchmarkSliceRange(startRow, endRow);
}

export function readBenchmarkSliceSelection(argv: string[]): ResolvedBenchmarkSliceSelection {
  const rawStart = argv.find((entry) => entry.startsWith('--sliceStart='))?.slice('--sliceStart='.length);
  const rawEnd = argv.find((entry) => entry.startsWith('--sliceEnd='))?.slice('--sliceEnd='.length);
  const startRow = rawStart == null ? null : Number.parseInt(rawStart, 10);
  const endRow = rawEnd == null ? null : Number.parseInt(rawEnd, 10);
  const preset = readBenchmarkSlicePreset(argv);
  return resolveBenchmarkSliceSelection({
    startRow,
    endRow,
    preset,
  });
}

export function readBenchmarkRuntimeOverrides(argv: string[]): BenchmarkRuntimeOverrides {
  const chunkSize = readPositiveIntegerFlag(argv, '--chunkSize=');
  const maxConcurrency = readPositiveIntegerFlag(argv, '--maxConcurrency=');
  const warmupRefs = readPositiveIntegerFlag(argv, '--warmupRefs=');
  const multicoreThreshold = readPositiveIntegerFlag(argv, '--multicoreThreshold=');

  return {
    ...(chunkSize == null ? {} : { chunkSize }),
    ...(maxConcurrency == null ? {} : { maxConcurrency }),
    ...(warmupRefs == null ? {} : { warmupRefs }),
    ...(multicoreThreshold == null ? {} : { multicoreThreshold }),
  };
}
