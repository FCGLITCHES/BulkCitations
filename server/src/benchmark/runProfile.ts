import type { CitationStyle } from "../engine/types/citation.js";
import type { PipelineOptions } from "../engine/types/pipeline.js";
import type {
  MLClient,
  MlPersonName,
  MLHealthResponse,
  MLRequestOptions,
  StyleDetectionPrediction,
  TypePrediction,
} from "../ml/client.js";
import type { ExtractBatchResponse } from "../ml/client.js";
import { HttpMLClient } from "../ml/client.js";
import type {
  Phase4ExtractAttempt,
  Phase4MetricsSnapshot,
  Phase4MlRuntimeLike,
  Phase4RequestMode,
} from "../ml/phase4Runtime.js";
import { createPipelineDependencies, type PipelineDependencies } from "../pipeline/dependencies.js";
import type { PipelineRuntimeTuning } from "../engine/types/pipeline.js";
import { resolvePipelineRuntimeProfile } from "../pipeline/runtimeProfiles.js";
import {
  resolveBenchmarkHardwareProfile,
  type BenchmarkHardwareProfileResolution,
} from "./hardwareProfiles.js";
import type { BenchmarkRunProfile } from "./types.js";
import type {
  BenchmarkHardwareProfile,
  BenchmarkRuntimeOverrides,
  BenchmarkVariant,
} from "./types.js";

export interface BenchmarkRunProfileResolution {
  dependencies: PipelineDependencies;
  pipelineOptions: Partial<PipelineOptions>;
  runtimeTuning: PipelineRuntimeTuning | null;
  hardwareProfile: BenchmarkHardwareProfile;
  hardwareWarmupRefs: number;
  multicoreThreshold: number | null;
  restoreEnv: () => void;
}

export function resolveBenchmarkRunProfile(
  profile: BenchmarkRunProfile,
  hardwareProfile: BenchmarkHardwareProfile = "default",
  benchmarkVariant: BenchmarkVariant = "grobid_compare",
  runtimeOverrides: BenchmarkRuntimeOverrides = {},
): BenchmarkRunProfileResolution {
  const restoreEnv = applyProfileEnv(profile);
  const runtimeVariant = benchmarkVariant === "parallel" ? "parallel" : "direct";
  const hardware = applyBenchmarkRuntimeOverrides(
    applyStableProfileRuntimeDefaults(
      profile,
      resolveBenchmarkHardwareProfile(hardwareProfile, benchmarkVariant),
      runtimeVariant,
    ),
    runtimeOverrides,
  );
  const benchmarkPipelineOptions: Partial<PipelineOptions> = {
    enrich: false,
    llmFallback: false,
    authorityValidation: false,
    dedup: false,
    groupDuplicates: false,
  };

  if (profile === "heuristic-only") {
    return {
      dependencies: createPipelineDependencies({
        mlClient: new DisabledMlClient(),
        phase4Runtime: new DisabledPhase4Runtime(),
      }),
      pipelineOptions: benchmarkPipelineOptions,
      runtimeTuning: hardware.runtimeTuning,
      hardwareProfile: hardware.profile,
      hardwareWarmupRefs: hardware.warmupRefs,
      multicoreThreshold: hardware.multicoreThreshold,
      restoreEnv,
    };
  }

  if (profile === "hybrid-ml") {
    return {
      dependencies: createPipelineDependencies({
        mlClient: new StyleOnlyMlClient(),
      }),
      pipelineOptions: benchmarkPipelineOptions,
      runtimeTuning: hardware.runtimeTuning,
      hardwareProfile: hardware.profile,
      hardwareWarmupRefs: hardware.warmupRefs,
      multicoreThreshold: hardware.multicoreThreshold,
      restoreEnv,
    };
  }

  if (profile === "site-faithful") {
    // Mirrors the production /convert config so the benchmark number tracks the live site instead of
    // the lean gold best-case: PDF/OCR cleanup on (full), dedup + duplicate grouping on, the REAL ML
    // client (style/author/type routed; Phase-4 extraction follows ML_PHASE4_MODE, default heuristic),
    // and full render/health via the core_parse_full execution policy. Run with
    // --parseProfile=core_parse_full. NOTE: the harness forces BULKREFERENCES_ISOLATED_RUNTIME, so
    // certified approved-truth overlays (a live-site step) are still not exercised here.
    return {
      dependencies: createPipelineDependencies(),
      pipelineOptions: {
        enrich: false,
        llmFallback: false,
        authorityValidation: false,
        dedup: true,
        groupDuplicates: true,
        enablePdfCleanup: true,
        pdfCleanupMode: 'full',
      },
      runtimeTuning: hardware.runtimeTuning,
      hardwareProfile: hardware.profile,
      hardwareWarmupRefs: hardware.warmupRefs,
      multicoreThreshold: hardware.multicoreThreshold,
      restoreEnv,
    };
  }

  return {
    dependencies: createPipelineDependencies(),
    pipelineOptions: benchmarkPipelineOptions,
    runtimeTuning: hardware.runtimeTuning,
    hardwareProfile: hardware.profile,
    hardwareWarmupRefs: hardware.warmupRefs,
    multicoreThreshold: hardware.multicoreThreshold,
    restoreEnv,
  };
}

function applyStableProfileRuntimeDefaults(
  profile: BenchmarkRunProfile,
  hardware: BenchmarkHardwareProfileResolution,
  runtimeVariant: "direct" | "parallel",
): BenchmarkHardwareProfileResolution {
  if (profile !== "current-runtime-stable350") {
    return hardware;
  }

  const baseRuntimeTuning =
    hardware.runtimeTuning ?? resolvePipelineRuntimeProfile("site_default", runtimeVariant).runtimeTuning;

  if (runtimeVariant === "parallel") {
    return {
      ...hardware,
      runtimeTuning: {
        ...baseRuntimeTuning,
        batchSize: Math.min(baseRuntimeTuning.batchSize, 192),
        maxConcurrency: Math.min(baseRuntimeTuning.maxConcurrency, 10),
        ...(baseRuntimeTuning.fastLaneMulticoreMinRefs == null
          ? {}
          : {
              fastLaneMulticoreMinRefs: Math.max(
                192,
                Math.min(baseRuntimeTuning.fastLaneMulticoreMinRefs, 256),
              ),
            }),
      },
      warmupRefs: Math.min(hardware.warmupRefs, 192),
      multicoreThreshold: Math.min(hardware.multicoreThreshold ?? 256, 256),
    };
  }

  return {
    ...hardware,
    runtimeTuning: {
      ...baseRuntimeTuning,
      batchSize: Math.min(baseRuntimeTuning.batchSize, 192),
      maxConcurrency: Math.min(baseRuntimeTuning.maxConcurrency, 7),
      ...(baseRuntimeTuning.fastLaneMulticoreMinRefs == null
        ? {}
        : { fastLaneMulticoreMinRefs: Math.min(baseRuntimeTuning.fastLaneMulticoreMinRefs, 256) }),
    },
    warmupRefs: Math.min(hardware.warmupRefs, 192),
    multicoreThreshold: Math.min(hardware.multicoreThreshold ?? 256, 256),
  };
}

function applyBenchmarkRuntimeOverrides(
  hardware: BenchmarkHardwareProfileResolution,
  runtimeOverrides: BenchmarkRuntimeOverrides,
): BenchmarkHardwareProfileResolution {
  if (
    runtimeOverrides.chunkSize == null
    && runtimeOverrides.maxConcurrency == null
    && runtimeOverrides.warmupRefs == null
    && runtimeOverrides.multicoreThreshold == null
  ) {
    return hardware;
  }

  const baseRuntimeTuning =
    hardware.runtimeTuning ?? resolvePipelineRuntimeProfile("site_default").runtimeTuning;
  const multicoreThreshold = runtimeOverrides.multicoreThreshold ?? hardware.multicoreThreshold;

  return {
    ...hardware,
    runtimeTuning: {
      ...baseRuntimeTuning,
      ...(runtimeOverrides.chunkSize == null ? {} : { batchSize: runtimeOverrides.chunkSize }),
      ...(runtimeOverrides.maxConcurrency == null
        ? {}
        : { maxConcurrency: runtimeOverrides.maxConcurrency }),
      ...(multicoreThreshold == null ? {} : { fastLaneMulticoreMinRefs: multicoreThreshold }),
    },
    warmupRefs: runtimeOverrides.warmupRefs ?? hardware.warmupRefs,
    multicoreThreshold,
  };
}

export function applyProfileEnv(profile: BenchmarkRunProfile): () => void {
  const previous = {
    ML_PHASE4_MODE: process.env.ML_PHASE4_MODE,
    ML_PHASE4_PRIMARY_FRACTION: process.env.ML_PHASE4_PRIMARY_FRACTION,
    ML_PHASE4_SHADOW_FRACTION: process.env.ML_PHASE4_SHADOW_FRACTION,
  };

  if (profile === "heuristic-only") {
    process.env.ML_PHASE4_MODE = "heuristic";
    process.env.ML_PHASE4_PRIMARY_FRACTION = "0";
    process.env.ML_PHASE4_SHADOW_FRACTION = "0";
  } else if (profile === "hybrid-ml") {
    // Stage 2B benchmarks the local ML style lane only; extraction stays deterministic.
    process.env.ML_PHASE4_MODE = "heuristic";
    process.env.ML_PHASE4_PRIMARY_FRACTION = "0";
    process.env.ML_PHASE4_SHADOW_FRACTION = "0";
  }

  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  };
}

class DisabledMlClient implements MLClient {
  async health(): Promise<MLHealthResponse> {
    return {
      status: "unavailable",
      activeModelVersion: null,
      featureVersion: null,
      artifactsReady: false,
      lastSuccessfulInferenceAt: null,
    };
  }

  async detectStyle(_texts: string[], _options?: MLRequestOptions): Promise<StyleDetectionPrediction[]> {
    throw new Error("Benchmark heuristic-only profile disables ML style detection.");
  }

  async extract(_texts: string[], _styles: CitationStyle[]): Promise<ExtractBatchResponse> {
    throw new Error("Benchmark heuristic-only profile disables ML extraction.");
  }

  async authorNer(_authorTexts: string[]): Promise<Array<{ authors: []; confidence: number }>> {
    throw new Error("Benchmark heuristic-only profile disables ML author disambiguation.");
  }

  async classifyType(_texts: string[]): Promise<TypePrediction[]> {
    throw new Error("Benchmark heuristic-only profile disables ML type classification.");
  }
}

class StyleOnlyMlClient implements MLClient {
  private readonly transport = new HttpMLClient();

  health(): Promise<MLHealthResponse> {
    return this.transport.health();
  }

  detectStyle(texts: string[], options?: MLRequestOptions): Promise<StyleDetectionPrediction[]> {
    return this.transport.detectStyle(texts, options);
  }

  async extract(_texts: string[], _styles: CitationStyle[]): Promise<ExtractBatchResponse> {
    throw new Error("Benchmark hybrid-ml profile keeps Phase 4 extraction deterministic.");
  }

  async authorNer(_authorTexts: string[]): Promise<Array<{ authors: MlPersonName[]; confidence: number }>> {
    throw new Error("Benchmark hybrid-ml profile keeps author disambiguation deterministic.");
  }

  async classifyType(_texts: string[]): Promise<TypePrediction[]> {
    throw new Error("Benchmark hybrid-ml profile keeps type classification deterministic.");
  }
}

class DisabledPhase4Runtime implements Phase4MlRuntimeLike {
  getCachedHealth(): MLHealthResponse | null {
    return {
      status: "unavailable",
      activeModelVersion: null,
      featureVersion: null,
      artifactsReady: false,
      lastSuccessfulInferenceAt: null,
    };
  }

  async refreshHealth(): Promise<MLHealthResponse | null> {
    return this.getCachedHealth();
  }

  async extract(
    mode: Phase4RequestMode,
    _texts: string[],
    _styles: CitationStyle[],
  ): Promise<Phase4ExtractAttempt> {
    return {
      mode,
      outcome: mode === "shadow" ? "shadow_dropped" : "health_blocked",
      attempted: false,
      health: this.getCachedHealth(),
      error: {
        code: "MODEL_UNAVAILABLE",
        message: "Benchmark heuristic-only profile disables Phase 4 ML extraction.",
      },
    };
  }

  recordFallback(_reason: string): void {}

  recordShadowDrop(_reason: string): void {}

  getMetricsSnapshot(): Phase4MetricsSnapshot {
    return {
      requestsTotal: {},
      latencyMs: {},
      fallbacksTotal: {},
      shadowDropsTotal: {},
      breakerState: "closed",
      queueDepth: 0,
    };
  }
}
