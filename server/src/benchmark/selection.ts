import type {
  BenchmarkManifestRow,
  BenchmarkSlicePreset,
  BenchmarkSliceRange,
} from "./types.js";

const BENCHMARK_SLICE_PRESET_RANGES: Record<BenchmarkSlicePreset, BenchmarkSliceRange> = {
  grobid_3500_citation_list: {
    startRow: 1,
    endRow: 3500,
  },
  pathological_3001_3400: {
    startRow: 3001,
    endRow: 3400,
  },
};

export interface ResolvedBenchmarkSliceSelection {
  sliceRange: BenchmarkSliceRange | null;
  sliceLabel?: string;
  slicePreset?: BenchmarkSlicePreset;
}

export function normalizeBenchmarkSliceRange(
  startRow: number | null,
  endRow: number | null,
): BenchmarkSliceRange | null {
  if (startRow == null && endRow == null) {
    return null;
  }

  if (startRow == null || endRow == null) {
    throw new Error(
      "Benchmark slice selection requires both --sliceStart and --sliceEnd as 1-based inclusive row numbers.",
    );
  }

  if (!Number.isInteger(startRow) || !Number.isInteger(endRow)) {
    throw new Error("Benchmark slice row numbers must be integers.");
  }

  if (startRow <= 0 || endRow <= 0) {
    throw new Error("Benchmark slice row numbers must be positive.");
  }

  if (endRow < startRow) {
    throw new Error("Benchmark slice end row must be greater than or equal to the start row.");
  }

  return {
    startRow,
    endRow,
  };
}

export function benchmarkSliceLabel(slice: BenchmarkSliceRange | null): string | undefined {
  if (!slice) {
    return undefined;
  }
  return `slice_${slice.startRow}_${slice.endRow}`;
}

export function benchmarkSlicePresetRange(preset: BenchmarkSlicePreset): BenchmarkSliceRange {
  return BENCHMARK_SLICE_PRESET_RANGES[preset];
}

export function resolveBenchmarkSliceSelection(options: {
  startRow: number | null;
  endRow: number | null;
  preset?: BenchmarkSlicePreset | null;
}): ResolvedBenchmarkSliceSelection {
  const explicitRange = normalizeBenchmarkSliceRange(options.startRow, options.endRow);
  if (options.preset && explicitRange) {
    throw new Error(
      "Benchmark slice selection must use either --slicePreset or --sliceStart/--sliceEnd, not both.",
    );
  }

  if (options.preset) {
    return {
      sliceRange: benchmarkSlicePresetRange(options.preset),
      sliceLabel: options.preset,
      slicePreset: options.preset,
    };
  }

  const explicitLabel = benchmarkSliceLabel(explicitRange);
  if (explicitLabel) {
    return {
      sliceRange: explicitRange,
      sliceLabel: explicitLabel,
    };
  }

  return {
    sliceRange: explicitRange,
  };
}

export function benchmarkSliceRowCount(slice: BenchmarkSliceRange | null): number | undefined {
  if (!slice) {
    return undefined;
  }
  return slice.endRow - slice.startRow + 1;
}

export function applyBenchmarkSlice<T>(
  values: readonly T[],
  slice: BenchmarkSliceRange | null,
): T[] {
  if (!slice) {
    return [...values];
  }

  const startIndex = slice.startRow - 1;
  const endIndexExclusive = slice.endRow;
  if (startIndex >= values.length) {
    throw new Error(
      `Benchmark slice start row ${slice.startRow} exceeds available rows ${values.length}.`,
    );
  }

  return values.slice(startIndex, Math.min(endIndexExclusive, values.length));
}

export function describeBenchmarkSlice(slice: BenchmarkSliceRange | null): string | undefined {
  if (!slice) {
    return undefined;
  }
  return `${slice.startRow}-${slice.endRow}`;
}

export function assertSlicedBenchmarkAlignment(
  manifest: BenchmarkManifestRow[],
  inputs: string[],
  slice: BenchmarkSliceRange | null,
): void {
  if (manifest.length !== inputs.length) {
    const sliceDescription = describeBenchmarkSlice(slice);
    throw new Error(
      sliceDescription
        ? `Sliced benchmark manifest/input alignment failed for rows ${sliceDescription}: ${manifest.length} manifest rows vs ${inputs.length} formatted inputs.`
        : `Benchmark manifest/input alignment failed: ${manifest.length} manifest rows vs ${inputs.length} formatted inputs.`,
    );
  }
}
