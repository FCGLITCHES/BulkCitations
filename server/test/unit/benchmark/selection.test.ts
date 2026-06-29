import { describe, expect, it } from "vitest";

import {
  applyBenchmarkSlice,
  benchmarkSliceLabel,
  benchmarkSlicePresetRange,
  normalizeBenchmarkSliceRange,
  resolveBenchmarkSliceSelection,
} from "../../../src/benchmark/selection.js";

describe("benchmark slice selection", () => {
  it("returns null when no slice range is supplied", () => {
    expect(normalizeBenchmarkSliceRange(null, null)).toBeNull();
  });

  it("validates one-based inclusive slice ranges", () => {
    expect(normalizeBenchmarkSliceRange(3001, 3400)).toEqual({
      startRow: 3001,
      endRow: 3400,
    });
    expect(benchmarkSliceLabel({ startRow: 3001, endRow: 3400 })).toBe("slice_3001_3400");
    expect(() => normalizeBenchmarkSliceRange(0, 10)).toThrow(/positive/i);
    expect(() => normalizeBenchmarkSliceRange(10, 9)).toThrow(/greater than or equal/i);
    expect(() => normalizeBenchmarkSliceRange(10, null)).toThrow(/requires both/i);
  });

  it("applies one-based inclusive slicing to manifest-ordered rows", () => {
    expect(applyBenchmarkSlice(["a", "b", "c", "d", "e"], {
      startRow: 2,
      endRow: 4,
    })).toEqual(["b", "c", "d"]);
  });

  it("resolves named slice presets to stable labels and ranges", () => {
    expect(benchmarkSlicePresetRange("grobid_3500_citation_list")).toEqual({
      startRow: 1,
      endRow: 3500,
    });
    expect(benchmarkSlicePresetRange("pathological_3001_3400")).toEqual({
      startRow: 3001,
      endRow: 3400,
    });
    expect(resolveBenchmarkSliceSelection({
      startRow: null,
      endRow: null,
      preset: "pathological_3001_3400",
    })).toEqual({
      slicePreset: "pathological_3001_3400",
      sliceRange: {
        startRow: 3001,
        endRow: 3400,
      },
      sliceLabel: "pathological_3001_3400",
    });
  });

  it("rejects mixing a named slice preset with explicit row bounds", () => {
    expect(() =>
      resolveBenchmarkSliceSelection({
        startRow: 3001,
        endRow: 3400,
        preset: "pathological_3001_3400",
      }),
    ).toThrow(/either --slicePreset or --sliceStart\/--sliceEnd/i);
  });
});
