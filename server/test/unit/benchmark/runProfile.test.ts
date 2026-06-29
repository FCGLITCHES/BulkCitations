import { afterEach, describe, expect, it } from "vitest";

import { resolveBenchmarkRunProfile } from "../../../src/benchmark/runProfile.js";

describe("benchmark run profile", () => {
  afterEach(() => {
    delete process.env.ML_PHASE4_MODE;
    delete process.env.ML_PHASE4_PRIMARY_FRACTION;
    delete process.env.ML_PHASE4_SHADOW_FRACTION;
  });

  it("forces deterministic local-only options for the heuristic-only profile", async () => {
    process.env.ML_PHASE4_MODE = "shadow";
    process.env.ML_PHASE4_PRIMARY_FRACTION = "0.4";
    process.env.ML_PHASE4_SHADOW_FRACTION = "1";

    const profile = resolveBenchmarkRunProfile("heuristic-only", "benchmark_5600h");

    expect(profile.pipelineOptions).toMatchObject({
      enrich: false,
      llmFallback: false,
      authorityValidation: false,
      dedup: false,
      groupDuplicates: false,
    });
    expect(profile.hardwareProfile).toBe("benchmark_5600h");
    expect(profile.runtimeTuning).toEqual({
      profile: "benchmark_5600h",
      batchSize: 192,
      maxConcurrency: 7,
      fastLaneMulticoreMinRefs: 256,
    });
    expect(profile.hardwareWarmupRefs).toBe(192);
    expect(profile.multicoreThreshold).toBe(256);
    expect(process.env.ML_PHASE4_MODE).toBe("heuristic");
    expect(process.env.ML_PHASE4_PRIMARY_FRACTION).toBe("0");
    expect(process.env.ML_PHASE4_SHADOW_FRACTION).toBe("0");

    await expect(profile.dependencies.mlClient?.health()).resolves.toMatchObject({
      status: "unavailable",
      artifactsReady: false,
    });
    expect(profile.dependencies.phase4Runtime?.getCachedHealth()).toMatchObject({
      status: "unavailable",
      artifactsReady: false,
    });

    profile.restoreEnv();

    expect(process.env.ML_PHASE4_MODE).toBe("shadow");
    expect(process.env.ML_PHASE4_PRIMARY_FRACTION).toBe("0.4");
    expect(process.env.ML_PHASE4_SHADOW_FRACTION).toBe("1");
  });

  it("keeps benchmark runs deterministic and alignment-safe for the current-runtime profile", () => {
    process.env.ML_PHASE4_MODE = "primary";

    const profile = resolveBenchmarkRunProfile("current-runtime");

    expect(profile.pipelineOptions).toEqual({
      enrich: false,
      llmFallback: false,
      authorityValidation: false,
      dedup: false,
      groupDuplicates: false,
    });
    expect(process.env.ML_PHASE4_MODE).toBe("primary");
    expect(profile.hardwareProfile).toBe("default");
    expect(profile.runtimeTuning).toBeNull();

    profile.restoreEnv();

    expect(process.env.ML_PHASE4_MODE).toBe("primary");
  });

  it("keeps deterministic extraction while enabling only the local ml style lane for hybrid-ml", async () => {
    process.env.ML_PHASE4_MODE = "heuristic";
    process.env.ML_PHASE4_PRIMARY_FRACTION = "0";
    process.env.ML_PHASE4_SHADOW_FRACTION = "1";

    const profile = resolveBenchmarkRunProfile("hybrid-ml", "server_16c");

    expect(profile.pipelineOptions).toMatchObject({
      enrich: false,
      llmFallback: false,
      authorityValidation: false,
      dedup: false,
      groupDuplicates: false,
    });
    expect(profile.runtimeTuning).toEqual({
      profile: "server_16c",
      batchSize: 160,
      maxConcurrency: 15,
      fastLaneMulticoreMinRefs: 512,
    });
    expect(profile.hardwareWarmupRefs).toBe(320);
    expect(profile.multicoreThreshold).toBe(512);
    expect(process.env.ML_PHASE4_MODE).toBe("heuristic");
    expect(process.env.ML_PHASE4_PRIMARY_FRACTION).toBe("0");
    expect(process.env.ML_PHASE4_SHADOW_FRACTION).toBe("0");
    await expect(profile.dependencies.mlClient?.classifyType(["Example citation"])).rejects.toThrow(
      "Benchmark hybrid-ml profile keeps type classification deterministic.",
    );
    await expect(
      profile.dependencies.mlClient?.authorNer(["Smith, J."]),
    ).rejects.toThrow(
      "Benchmark hybrid-ml profile keeps author disambiguation deterministic.",
    );

    profile.restoreEnv();

    expect(process.env.ML_PHASE4_MODE).toBe("heuristic");
    expect(process.env.ML_PHASE4_PRIMARY_FRACTION).toBe("0");
    expect(process.env.ML_PHASE4_SHADOW_FRACTION).toBe("1");
  });

  it("uses a higher worker count for the parallel 5600h benchmark variant", () => {
    const profile = resolveBenchmarkRunProfile("heuristic-only", "benchmark_5600h", "parallel");

    expect(profile.runtimeTuning).toEqual({
      profile: "benchmark_5600h",
      batchSize: 256,
      maxConcurrency: 11,
      fastLaneMulticoreMinRefs: 256,
    });
    expect(profile.hardwareWarmupRefs).toBe(256);

    profile.restoreEnv();
  });

  it("applies explicit benchmark runtime overrides on top of the selected hardware profile", () => {
    const profile = resolveBenchmarkRunProfile(
      "current-runtime",
      "benchmark_5600h",
      "parallel",
      {
        chunkSize: 256,
        maxConcurrency: 10,
        warmupRefs: 320,
        multicoreThreshold: 384,
      },
    );

    expect(profile.runtimeTuning).toEqual({
      profile: "benchmark_5600h",
      batchSize: 256,
      maxConcurrency: 10,
      fastLaneMulticoreMinRefs: 384,
    });
    expect(profile.hardwareWarmupRefs).toBe(320);
    expect(profile.multicoreThreshold).toBe(384);

    profile.restoreEnv();
  });

  it("uses a stability-first runtime envelope for current-runtime-stable350 on 5600h parallel runs", () => {
    const profile = resolveBenchmarkRunProfile(
      "current-runtime-stable350",
      "benchmark_5600h",
      "parallel",
    );

    expect(profile.pipelineOptions).toEqual({
      enrich: false,
      llmFallback: false,
      authorityValidation: false,
      dedup: false,
      groupDuplicates: false,
    });
    expect(profile.runtimeTuning).toEqual({
      profile: "benchmark_5600h",
      batchSize: 192,
      maxConcurrency: 10,
      fastLaneMulticoreMinRefs: 256,
    });
    expect(profile.hardwareWarmupRefs).toBe(192);
    expect(profile.multicoreThreshold).toBe(256);

    profile.restoreEnv();
  });
});
