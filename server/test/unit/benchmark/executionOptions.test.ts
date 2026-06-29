import { describe, expect, it } from 'vitest';

import {
  readBenchmarkArtifactDetail,
  readBenchmarkArtifactNamespace,
  readBenchmarkHardwareProfile,
  readBenchmarkParseProfile,
  readBenchmarkRuntimeOverrides,
  readBenchmarkSlicePreset,
  readBenchmarkSliceRange,
  readBenchmarkSliceSelection,
  readBenchmarkSourceType,
  readBenchmarkVariant,
} from '../../../src/benchmark/executionOptions.js';

describe('benchmark execution options', () => {
  it('defaults to text/current_runtime and the baseline benchmark namespace when flags are absent', () => {
    expect(readBenchmarkSourceType(['node', 'run-engine.ts'])).toBe('text');
    expect(readBenchmarkParseProfile(['node', 'run-engine.ts'])).toBe('current_runtime');
    expect(readBenchmarkHardwareProfile(['node', 'run-engine.ts'])).toBe('default');
    expect(readBenchmarkVariant(['node', 'run-engine.ts'])).toBe('grobid_compare');
    expect(readBenchmarkArtifactDetail(['node', 'run-engine.ts'])).toBe('full');
    expect(readBenchmarkArtifactNamespace(['node', 'run-engine.ts'])).toBeNull();
    expect(readBenchmarkSlicePreset(['node', 'run-engine.ts'])).toBeNull();
    expect(readBenchmarkSliceRange(['node', 'run-engine.ts'])).toBeNull();
    expect(readBenchmarkRuntimeOverrides(['node', 'run-engine.ts'])).toEqual({});
    expect(readBenchmarkSliceSelection(['node', 'run-engine.ts'])).toEqual({
      sliceRange: null,
      sliceLabel: undefined,
    });
  });

  it('reads explicit sourceType, parseProfile, hardwareProfile, benchmarkVariant, and slice flags', () => {
    const argv = [
      'node',
      'run-engine.ts',
      '--sourceType=doi_list',
      '--parseProfile=core_parse_fast',
      '--hardwareProfile=benchmark_5600h',
      '--benchmarkVariant=parallel',
      '--artifactDetail=summary',
      '--artifactNamespace=full_canonical',
      '--chunkSize=256',
      '--maxConcurrency=10',
      '--warmupRefs=320',
      '--multicoreThreshold=384',
      '--sliceStart=3001',
      '--sliceEnd=3400',
    ];

    expect(readBenchmarkSourceType(argv)).toBe('doi_list');
    expect(readBenchmarkParseProfile(argv)).toBe('core_parse_fast');
    expect(readBenchmarkHardwareProfile(argv)).toBe('benchmark_5600h');
    expect(readBenchmarkVariant(argv)).toBe('parallel');
    expect(readBenchmarkArtifactDetail(argv)).toBe('summary');
    expect(readBenchmarkArtifactNamespace(argv)).toBe('full_canonical');
    expect(readBenchmarkRuntimeOverrides(argv)).toEqual({
      chunkSize: 256,
      maxConcurrency: 10,
      warmupRefs: 320,
      multicoreThreshold: 384,
    });
    expect(readBenchmarkSliceRange(argv)).toEqual({
      startRow: 3001,
      endRow: 3400,
    });
    expect(readBenchmarkSliceSelection(argv)).toEqual({
      sliceRange: {
        startRow: 3001,
        endRow: 3400,
      },
      sliceLabel: 'slice_3001_3400',
    });
  });

  it('reads named slice presets and resolves their stable artifact label', () => {
    const argv = [
      'node',
      'run-engine.ts',
      '--slicePreset=grobid_3500_citation_list',
    ];

    expect(readBenchmarkSlicePreset(argv)).toBe('grobid_3500_citation_list');
    expect(readBenchmarkSliceSelection(argv)).toEqual({
      slicePreset: 'grobid_3500_citation_list',
      sliceRange: {
        startRow: 1,
        endRow: 3500,
      },
      sliceLabel: 'grobid_3500_citation_list',
    });
  });

  it('rejects invalid runtime override flags', () => {
    expect(() => readBenchmarkRuntimeOverrides(['node', 'run-engine.ts', '--chunkSize=0'])).toThrow(
      'chunkSize must be a positive integer.',
    );
    expect(() =>
      readBenchmarkRuntimeOverrides(['node', 'run-engine.ts', '--maxConcurrency=abc'])
    ).toThrow('maxConcurrency must be a positive integer.');
  });
});
