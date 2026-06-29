import { Phase3StyleDetect } from '../engine/phases/phase3StyleDetect.js';
import { Phase4Extract } from '../engine/phases/phase4Extract.js';
import { Phase5AuthorDisambig } from '../engine/phases/phase5AuthorDisambig.js';
import { Phase5_8StructuralFamilyRouter } from '../engine/phases/phase5_8StructuralFamilyRouter.js';
import { Phase6TypeClassify } from '../engine/phases/phase6TypeClassify.js';
import { Phase8Enrich } from '../engine/phases/phase8Enrich.js';
import { HttpMLClient, type MLClient } from '../ml/client.js';
import { Phase4MlRuntime, type Phase4MlRuntimeLike } from '../ml/phase4Runtime.js';
import { crossrefService, type CrossrefService } from '../services/crossref.js';

export interface CorePipelineStages {
  styleDetect: Phase3StyleDetect;
  extract: Phase4Extract;
  authorDisambig: Phase5AuthorDisambig;
  structuralFamilyRouter: Phase5_8StructuralFamilyRouter;
  typeClassify: Phase6TypeClassify;
}

export interface PipelineDependencies {
  mlClient?: MLClient;
  phase4Runtime?: Phase4MlRuntimeLike;
  coreStages: CorePipelineStages;
  crossrefService: CrossrefService;
  enrichmentPhase?: Phase8Enrich;
}

let sharedDependencies: PipelineDependencies | null = null;

export function createPipelineDependencies(
  overrides: Partial<PipelineDependencies> = {},
): PipelineDependencies {
  if (Object.keys(overrides).length === 0 && sharedDependencies) {
    return sharedDependencies;
  }

  const mlClient = overrides.mlClient ?? sharedDependencies?.mlClient ?? new HttpMLClient();
  const phase4Runtime = overrides.phase4Runtime ?? sharedDependencies?.phase4Runtime ?? new Phase4MlRuntime(mlClient);
  const resolvedCrossref = overrides.crossrefService ?? sharedDependencies?.crossrefService ?? crossrefService;
  const coreStages = {
    styleDetect: overrides.coreStages?.styleDetect ?? new Phase3StyleDetect(mlClient),
    extract: overrides.coreStages?.extract ?? new Phase4Extract(phase4Runtime),
    authorDisambig: overrides.coreStages?.authorDisambig ?? new Phase5AuthorDisambig(mlClient),
    structuralFamilyRouter:
      overrides.coreStages?.structuralFamilyRouter ?? new Phase5_8StructuralFamilyRouter(),
    typeClassify: overrides.coreStages?.typeClassify ?? new Phase6TypeClassify(mlClient),
  } satisfies CorePipelineStages;

  const dependencies: PipelineDependencies = {
    ...(mlClient ? { mlClient } : {}),
    ...(phase4Runtime ? { phase4Runtime } : {}),
    coreStages,
    crossrefService: resolvedCrossref,
    ...(overrides.enrichmentPhase
      ? { enrichmentPhase: overrides.enrichmentPhase }
      : {}),
  };

  if (Object.keys(overrides).length === 0) {
    sharedDependencies = dependencies;
  }

  return dependencies;
}
