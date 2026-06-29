import {
  DEFAULT_PIPELINE_OPTIONS,
  type PipelineExecutionPolicy,
  type PipelineOptions,
} from '../engine/types/pipeline.js';
import type { ParseProfile } from '../engine/types/parseProfile.js';

export function resolvePipelineExecutionPolicy(
  profile: ParseProfile,
): PipelineExecutionPolicy {
  switch (profile) {
    case 'core_parse_fast':
      return {
        parseProfile: profile,
        providers: 'off',
        llmFallback: 'off',
        styleDetectionMl: 'off',
        authorDisambiguationMl: 'off',
        extractionMl: 'off',
        typeClassificationMl: 'off',
        renderMode: 'structured',
        dedupMode: 'exact_canonical',
        healthMode: 'minimal',
        debugMode: 'off',
        authorityValidation: 'off',
        feedbackMode: 'off',
      };
    case 'core_parse_full':
      return {
        parseProfile: profile,
    providers: 'off',
    llmFallback: 'debug_only',
    styleDetectionMl: 'hint_only',
        authorDisambiguationMl: 'routed',
        extractionMl: 'routed',
        typeClassificationMl: 'routed',
        renderMode: 'full',
        dedupMode: 'full_local',
        healthMode: 'full',
        debugMode: 'sampled',
        authorityValidation: 'local_only',
        feedbackMode: 'off',
      };
    case 'core_parse_full_enrich':
      // Identical to core_parse_full, but turns enrichment on (providers: overlay_only).
      // Used when a tier is allowed inline Phase 8 enrichment, so the full convert behavior
      // (render/dedup/health/authority) is preserved and only enrichment is added.
      return {
        parseProfile: profile,
        providers: 'overlay_only',
        llmFallback: 'debug_only',
        styleDetectionMl: 'hint_only',
        authorDisambiguationMl: 'routed',
        extractionMl: 'routed',
        typeClassificationMl: 'routed',
        renderMode: 'full',
        dedupMode: 'full_local',
        healthMode: 'full',
        debugMode: 'sampled',
        authorityValidation: 'local_only',
        feedbackMode: 'off',
      };
    case 'pro_overlay_enrich':
      return {
        parseProfile: profile,
        providers: 'overlay_only',
        llmFallback: 'off',
        styleDetectionMl: 'hint_only',
        authorDisambiguationMl: 'routed',
        extractionMl: 'routed',
        typeClassificationMl: 'routed',
        renderMode: 'structured',
        dedupMode: 'exact_canonical',
        healthMode: 'minimal',
        debugMode: 'off',
        authorityValidation: 'off',
        feedbackMode: 'off',
      };
    case 'debug_full':
      return {
        parseProfile: profile,
        providers: 'off',
        llmFallback: 'debug_only',
        styleDetectionMl: 'hint_only',
        authorDisambiguationMl: 'routed',
        extractionMl: 'routed',
        typeClassificationMl: 'routed',
        renderMode: 'full',
        dedupMode: 'full_local',
        healthMode: 'full',
        debugMode: 'full',
        authorityValidation: 'local_only',
        feedbackMode: 'full',
      };
    case 'current_runtime':
    default:
      return {
        parseProfile: 'current_runtime',
        providers: 'overlay_only',
        llmFallback: 'debug_only',
        styleDetectionMl: 'hint_only',
        authorDisambiguationMl: 'routed',
        extractionMl: 'routed',
        typeClassificationMl: 'routed',
        renderMode: 'full',
        dedupMode: 'full_local',
        healthMode: 'full',
        debugMode: 'full',
        authorityValidation: 'local_only',
        feedbackMode: 'full',
      };
  }
}

export function normalizePipelineOptions(
  options: Partial<PipelineOptions> | undefined,
): {
  options: PipelineOptions;
  executionPolicy: PipelineExecutionPolicy;
} {
  const parseProfile = options?.parseProfile ?? DEFAULT_PIPELINE_OPTIONS.parseProfile;
  const executionPolicy = resolvePipelineExecutionPolicy(parseProfile);

  const merged: PipelineOptions = {
    ...DEFAULT_PIPELINE_OPTIONS,
    ...(options ?? {}),
    parseProfile,
  };

  return {
    options: {
      ...merged,
      enrich: executionPolicy.providers === 'overlay_only' ? merged.enrich : false,
      llmFallback: executionPolicy.llmFallback === 'debug_only' ? merged.llmFallback : false,
      authorityValidation: executionPolicy.authorityValidation === 'local_only'
        ? merged.authorityValidation
        : false,
      debug: executionPolicy.debugMode === 'off' ? false : merged.debug,
      feedbackLoop: executionPolicy.feedbackMode === 'full' ? merged.feedbackLoop : false,
    },
    executionPolicy,
  };
}
