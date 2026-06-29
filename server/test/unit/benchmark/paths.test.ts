import { afterEach, describe, expect, it } from "vitest";

import {
  benchmarkArtifactPrefix,
  benchmarkBaselinePath,
  benchmarkRunArtifactPaths,
  resolveBenchmarkPaths,
} from "../../../src/benchmark/paths.js";

const ORIGINAL_BENCHMARK_RESULTS_DESTINATION = process.env.BENCHMARK_RESULTS_DESTINATION;
const ORIGINAL_CI = process.env.CI;
const ORIGINAL_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS;

describe("benchmark artifact paths", () => {
  afterEach(() => {
    if (ORIGINAL_BENCHMARK_RESULTS_DESTINATION === undefined) {
      delete process.env.BENCHMARK_RESULTS_DESTINATION;
    } else {
      process.env.BENCHMARK_RESULTS_DESTINATION = ORIGINAL_BENCHMARK_RESULTS_DESTINATION;
    }

    if (ORIGINAL_CI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = ORIGINAL_CI;
    }

    if (ORIGINAL_GITHUB_ACTIONS === undefined) {
      delete process.env.GITHUB_ACTIONS;
    } else {
      process.env.GITHUB_ACTIONS = ORIGINAL_GITHUB_ACTIONS;
    }
  });

  it("writes benchmark artifacts into a local-only directory outside CI by default", () => {
    delete process.env.BENCHMARK_RESULTS_DESTINATION;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;

    const paths = resolveBenchmarkPaths("pilot", "heuristic-only");
    expect(paths.resultsDir.replace(/\\/g, "/")).toContain("/benchmarks/grobid-pmc/results/local");
    expect(benchmarkBaselinePath("pilot", "heuristic-only", "2026-04-22").replace(/\\/g, "/")).toContain(
      "/benchmarks/grobid-pmc/results/pilot.baseline_2026-04-22.json",
    );
  });

  it("keeps checked-in benchmark paths when explicitly requested", () => {
    process.env.BENCHMARK_RESULTS_DESTINATION = "checked-in";
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;

    const paths = resolveBenchmarkPaths("pilot", "heuristic-only");
    expect(paths.resultsDir.replace(/\\/g, "/")).toContain("/benchmarks/grobid-pmc/results");
    expect(paths.resultsDir.replace(/\\/g, "/")).not.toContain("/benchmarks/grobid-pmc/results/local");
  });

  it("preserves the legacy prefix when no hardware or variant override is provided", () => {
    expect(benchmarkArtifactPrefix("pilot", "heuristic-only")).toBe("pilot");
    expect(benchmarkArtifactPrefix("full", "current-runtime")).toBe("full.current-runtime");
  });

  it("namespaces artifacts when hardware and non-default benchmark variants are provided", () => {
    const prefix = benchmarkArtifactPrefix("full", "current-runtime", {
      hardwareProfile: "benchmark_5600h",
      benchmarkVariant: "parallel",
    });

    expect(prefix).toBe("full.current-runtime.parallel.benchmark_5600h");

    const paths = resolveBenchmarkPaths("full", "current-runtime", {
      hardwareProfile: "benchmark_5600h",
      benchmarkVariant: "parallel",
    });
    expect(paths.parserOutputPath.replace(/\\/g, "/")).toContain(
      "full.current-runtime.parallel.benchmark_5600h.parser_output.json",
    );
    expect(paths.runtimeMetricsPath.replace(/\\/g, "/")).toContain(
      "full.current-runtime.parallel.benchmark_5600h.runtime_metrics.json",
    );

    const runArtifacts = benchmarkRunArtifactPaths(
      "full",
      "current-runtime",
      "2026-04-20T16:00:00.000Z",
      {
        hardwareProfile: "benchmark_5600h",
        benchmarkVariant: "parallel",
      },
    );
    expect(runArtifacts.resultPath.replace(/\\/g, "/")).toContain(
      "full.current-runtime.parallel.benchmark_5600h.run_2026-04-20T16-00-00-000Z.json",
    );
    expect(
      benchmarkBaselinePath("full", "current-runtime", "2026-04-20", {
        hardwareProfile: "benchmark_5600h",
        benchmarkVariant: "parallel",
      }).replace(/\\/g, "/"),
    ).toContain("full.current-runtime.parallel.benchmark_5600h.baseline_2026-04-20.json");
  });

  it("namespaces artifacts for slice-scoped runs so pathological slices do not overwrite full outputs", () => {
    const prefix = benchmarkArtifactPrefix("full", "current-runtime", {
      hardwareProfile: "benchmark_5600h",
      sliceLabel: "slice_3001_3400",
    });

    expect(prefix).toBe("full.current-runtime.benchmark_5600h.slice_3001_3400");
    expect(
      resolveBenchmarkPaths("full", "current-runtime", {
        hardwareProfile: "benchmark_5600h",
        sliceLabel: "slice_3001_3400",
      }).latestResultPath.replace(/\\/g, "/"),
    ).toContain("full.current-runtime.benchmark_5600h.slice_3001_3400.latest.json");
  });

  it("adds explicit artifact namespaces before variant and hardware suffixes", () => {
    const prefix = benchmarkArtifactPrefix("full", "current-runtime", {
      artifactNamespace: "full_canonical",
      hardwareProfile: "benchmark_5600h",
      benchmarkVariant: "parallel",
    });

    expect(prefix).toBe("full.current-runtime.full_canonical.parallel.benchmark_5600h");
  });

  it("uses stable preset labels for first-class pathological slice artifacts", () => {
    const prefix = benchmarkArtifactPrefix("full", "current-runtime", {
      hardwareProfile: "benchmark_5600h",
      sliceLabel: "pathological_3001_3400",
    });

    expect(prefix).toBe("full.current-runtime.benchmark_5600h.pathological_3001_3400");
    expect(
      resolveBenchmarkPaths("full", "current-runtime", {
        hardwareProfile: "benchmark_5600h",
        sliceLabel: "pathological_3001_3400",
      }).latestResultPath.replace(/\\/g, "/"),
    ).toContain("full.current-runtime.benchmark_5600h.pathological_3001_3400.latest.json");
  });
});
