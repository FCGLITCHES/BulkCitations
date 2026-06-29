import { z } from "zod";

import { engineCitationStyleSchema } from "../../engine/types/runtime-enums.js";

export const datasetSplitSchema = z.enum(["train", "val", "test", "holdout"]);
export const trustLevelSchema = z.enum(["draft", "reviewed", "gold"]);
export const rowStatusSchema = z.enum(["draft", "reviewed", "quarantined"]);
export const blockedReasonSchema = z.enum([
  "source_conflict",
  "inferability_conflict",
  "canonicalization_unclear",
  "split_leakage",
  "identifier_invalid",
  "evidence_missing",
  "review_conflict",
  "family_incompatible",
  "provider_only_fact",
  "needs_research",
]);
export const taskSchema = z.enum(["style", "field", "authority_pack", "overlay_learning"]);
export const truthScopeSchema = z.enum(["core", "overlay"]);
export const taskCertificationStatusSchema = z.enum(["candidate", "certified"]);
export const trainingPackTargetSchema = z.enum([
  "style_core_gold",
  "approved_overlay_changes",
  "citation_bio_supervision",
  "authority_pack",
  "render_variant_augmentation",
  "regression_fixtures",
]);
export const approvedTruthRenderVariantStyleValues = [
  "apa7",
  "harvard-ctr",
  "chicago-notes-bib",
  "vancouver",
  "ieee",
  "mla9",
] as const;
export const approvedTruthRenderVariantStyleSchema = z.enum(approvedTruthRenderVariantStyleValues);
export const truthRenderVariantGenerateSchema = z.object({
  styles: z
    .array(approvedTruthRenderVariantStyleSchema)
    .min(1)
    .max(approvedTruthRenderVariantStyleValues.length)
    .optional(),
});
export const truthRenderVariantPatchSchema = z.object({
  renderedText: z.string().trim().min(1).max(500_000),
  notes: z.string().trim().max(8_000).optional().nullable(),
});
export const truthRenderVariantApproveSchema = z.object({
  approved: z.boolean().optional().default(true),
  approvedBy: z.string().trim().max(120).optional().nullable(),
});
export const styleEvaluationSuiteSchema = z.enum([
  "supported_exact",
  "supported_family_only",
  "unsupported_exact",
  "unknown_or_ood",
  "not_citation_like",
]);
export const inputProfileSchema = z.enum([
  "doi_list",
  "structured_clean",
  "structured_noisy",
  "pasted_pdf_copy",
  "multiline_numbered",
  "ocr_like",
]);
export const styleInferabilityTierSchema = z.enum([
  "tier1_exact_direct",
  "tier2_exact_policy_resolved",
  "tier3_family_only",
  "tier4_not_inferable",
]);
export const difficultyTierSchema = z.enum(["low", "medium", "high", "very_high"]);
export const inferabilityTierSchema = z.enum(["raw_visible", "local_authority_derivable", "overlay_only"]);
export const goldKindSchema = z.enum([
  "style_clean",
  "style_adversarial",
  "style_noisy",
  "field_span",
  "authority_seed",
  "overlay_accept",
]);
export const approvalSourceSchema = z.enum(["manual", "learning_queue", "overlay_accept"]);
export const truthAuditReasonSchema = z.enum([
  "manual_correction",
  "sync_expected_to_core",
  "source_verification",
  "crossref_alignment",
  "engine_prefill_alignment",
  "regression_fix",
  "governance_metadata_update",
]);
export const taskCertificationSchema = z.object({
  task: taskSchema,
  truthScope: truthScopeSchema,
  status: taskCertificationStatusSchema,
  certifiedAt: z.string().datetime().nullable().default(null),
  certifiedBy: z.string().max(120).nullable().default(null),
  requiredReviewPasses: z.number().int().min(1).max(5).default(1),
  completedReviewPasses: z.number().int().min(0).max(5).default(0),
  pass1Hash: z.string().max(128).nullable().default(null),
  pass2Hash: z.string().max(128).nullable().default(null),
  packTarget: trainingPackTargetSchema.optional().nullable(),
  stagedBundleId: z.string().max(160).nullable().default(null),
  stagedAt: z.string().datetime().nullable().default(null),
});
export const styleBundleVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._-]+$/);

export const createTruthSchema = z.object({
  rawText: z.string().min(1),
  expectedFields: z.record(z.unknown()),
  coreTruth: z.record(z.unknown()).optional().nullable(),
  overlayTruth: z.record(z.unknown()).optional().nullable(),
  expectedType: z.string().max(40).optional().nullable(),
  expectedStyle: z.string().max(40).optional().nullable(),
  provenance: z.string().max(2000).optional().nullable(),
  pipelineMajor: z.number().int().optional().nullable(),
  datasetSplit: datasetSplitSchema.optional().nullable(),
  holdoutVersion: z.string().trim().max(40).optional().nullable(),
  trustLevel: trustLevelSchema.optional(),
  rowStatus: rowStatusSchema.optional(),
  blockedReason: blockedReasonSchema.optional().nullable(),
  taskCertifications: z.array(taskCertificationSchema).max(32).optional().nullable(),
  workId: z.string().trim().max(120).optional().nullable(),
  familyId: z.string().trim().max(120).optional().nullable(),
  variantId: z.string().trim().max(120).optional().nullable(),
  canonicalWorkKey: z.string().trim().max(160).optional().nullable(),
  nearDupClusterId: z.string().trim().max(160).optional().nullable(),
  datasetVersion: z.string().trim().max(80).optional().nullable(),
  inputProfile: inputProfileSchema.optional().nullable(),
  styleInferabilityTier: styleInferabilityTierSchema.optional().nullable(),
  styleEvaluationSuite: styleEvaluationSuiteSchema.optional().nullable(),
  isAdversarial: z.boolean().optional().nullable(),
  difficultyTier: difficultyTierSchema.optional().nullable(),
  highImpact: z.boolean().optional().nullable(),
  highImpactReason: z.string().trim().max(80).optional().nullable(),
  inferabilityByField: z.record(inferabilityTierSchema).optional().nullable(),
  goldKind: goldKindSchema.optional().nullable(),
  adversarialPair: z.string().max(80).optional().nullable(),
  noiseProfile: z.array(z.string().max(40)).max(12).optional().nullable(),
  approvalSource: approvalSourceSchema.optional().nullable(),
  reviewedBy: z.string().max(120).optional().nullable(),
  auditReasonCode: truthAuditReasonSchema.optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
});

export const patchTruthSchema = createTruthSchema.partial();
export const truthBulkIdsSchema = z.array(z.string().trim().min(1).max(120)).min(2).max(100);
export const truthBackgroundIdsSchema = z.array(z.string().trim().min(1).max(120)).min(1).max(100);
export const truthRefillIdsSchema = z.array(z.string().trim().min(1).max(120)).min(1).max(100);
export const truthPrefillSchema = z.object({
  rawText: z.string().trim().min(1).max(500_000),
  outputStyle: engineCitationStyleSchema.optional().default("auto"),
});
export const truthCrossrefPrefillSchema = z.object({
  rawText: z.string().trim().min(1).max(500_000),
  expectedFields: z.record(z.unknown()).optional().default({}),
  provenance: z.string().trim().max(2000).optional().nullable(),
});
export const truthRenderPreviewSchema = z.object({
  rawText: z.string().trim().max(500_000).optional().default(""),
  expectedFields: z.record(z.unknown()).optional().default({}),
  expectedType: z.string().trim().max(40).optional().nullable(),
  expectedStyle: engineCitationStyleSchema.optional().default("auto"),
});
export const truthEditorDraftModeSchema = z.enum(["create", "edit"]);
export const truthEditorDraftPayloadSchema = z.object({
  mode: truthEditorDraftModeSchema.default("create"),
  editingId: z.string().trim().max(120).optional().nullable(),
  rawText: z.string().max(500_000).default(""),
  expectedFieldValues: z.record(z.string().max(100_000)).default({}),
  engineRenderedOutput: z.string().max(500_000).default(""),
  enginePreviewWarnings: z.array(z.string().max(200)).max(64).default([]),
  enginePreviewStale: z.boolean().default(false),
  expectedOutputDirty: z.boolean().default(false),
  expectedType: z.string().max(40).default(""),
  expectedStyle: z.string().max(40).default(""),
  provenance: z.string().max(2000).default(""),
  pipelineMajor: z.string().max(40).default(""),
  datasetSplit: z.union([datasetSplitSchema, z.literal("")]).default(""),
  trustLevel: trustLevelSchema.default("draft"),
  rowStatus: rowStatusSchema.default("draft"),
  blockedReason: z.union([blockedReasonSchema, z.literal("")]).default(""),
  goldKind: z.union([goldKindSchema, z.literal("")]).default(""),
  adversarialPair: z.string().max(80).default(""),
  noiseProfile: z.string().max(400).default(""),
  approvalSource: z.union([approvalSourceSchema, z.literal("")]).default(""),
  reviewedBy: z.string().max(120).default(""),
  auditReasonCode: z.union([truthAuditReasonSchema, z.literal("")]).default(""),
  notes: z.string().max(8000).default(""),
});
export const truthBulkPrefillSchema = z.object({
  ids: truthRefillIdsSchema,
});
export const truthBulkCrossrefSchema = z.object({
  ids: truthRefillIdsSchema,
});
export const truthBulkUpdateBaseSchema = z.object({
  trustLevel: trustLevelSchema.optional(),
  rowStatus: rowStatusSchema.optional(),
  blockedReason: blockedReasonSchema.optional().nullable(),
});
export const truthBulkUpdateSchema = truthBulkUpdateBaseSchema
  .extend({
    ids: truthRefillIdsSchema,
  })
  .superRefine((value, ctx) => {
    if (!value.trustLevel && !value.rowStatus) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one bulk field to update.",
        path: ["trustLevel"],
      });
    }
    if (value.rowStatus === "quarantined" && !value.blockedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "blockedReason is required when rowStatus is quarantined.",
        path: ["blockedReason"],
      });
    }
    if (value.rowStatus && value.rowStatus !== "quarantined" && value.blockedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "blockedReason can only be set when rowStatus is quarantined.",
        path: ["blockedReason"],
      });
    }
    if (!value.rowStatus && value.blockedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "blockedReason requires rowStatus=quarantined.",
        path: ["blockedReason"],
      });
    }
  });
export const truthBulkUpdatePayloadSchema = truthBulkUpdateBaseSchema.superRefine((value, ctx) => {
  if (!value.trustLevel && !value.rowStatus) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Select at least one bulk field to update.",
      path: ["trustLevel"],
    });
  }
  if (value.rowStatus === "quarantined" && !value.blockedReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "blockedReason is required when rowStatus is quarantined.",
      path: ["blockedReason"],
    });
  }
  if (value.rowStatus && value.rowStatus !== "quarantined" && value.blockedReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "blockedReason can only be set when rowStatus is quarantined.",
      path: ["blockedReason"],
    });
  }
  if (!value.rowStatus && value.blockedReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "blockedReason requires rowStatus=quarantined.",
      path: ["blockedReason"],
    });
  }
});
export const truthBulkDeleteSchema = z.object({
  ids: truthBulkIdsSchema,
});
export const truthBulkFilterSchema = z.object({
  trustLevel: trustLevelSchema.optional(),
  datasetSplit: datasetSplitSchema.optional(),
  rowStatus: rowStatusSchema.optional(),
  datasetVersion: z.string().trim().max(80).optional(),
  goldKind: goldKindSchema.optional(),
  expectedStyle: z.string().trim().max(40).optional(),
  adversarialPair: z.string().trim().max(80).optional(),
  styleEvaluationSuite: styleEvaluationSuiteSchema.optional(),
  certificationView: z.enum(["pending", "certified"]).optional(),
});
export const truthBackgroundBulkOperationSchema = z.enum(["prefill", "crossref", "delete", "certify", "update"]);
export const truthBackgroundPageRangeSchema = z
  .object({
    startPage: z.number().int().min(1),
    endPage: z.number().int().min(1),
  })
  .superRefine((value, ctx) => {
    if (value.endPage < value.startPage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endPage must be greater than or equal to startPage.",
        path: ["endPage"],
      });
    }
  });
export const promoteSchema = z.object({
  rawText: z.string().min(1).optional(),
  expectedFields: z.record(z.unknown()),
  coreTruth: z.record(z.unknown()).optional().nullable(),
  overlayTruth: z.record(z.unknown()).optional().nullable(),
  expectedType: z.string().max(40).optional().nullable(),
  expectedStyle: z.string().max(40).optional().nullable(),
  provenance: z.string().max(2000).optional().nullable(),
  pipelineMajor: z.number().int().optional().nullable(),
  datasetSplit: datasetSplitSchema.optional().nullable(),
  holdoutVersion: z.string().trim().max(40).optional().nullable(),
  trustLevel: trustLevelSchema.optional(),
  rowStatus: rowStatusSchema.optional(),
  blockedReason: blockedReasonSchema.optional().nullable(),
  taskCertifications: z.array(taskCertificationSchema).max(32).optional().nullable(),
  workId: z.string().trim().max(120).optional().nullable(),
  familyId: z.string().trim().max(120).optional().nullable(),
  variantId: z.string().trim().max(120).optional().nullable(),
  canonicalWorkKey: z.string().trim().max(160).optional().nullable(),
  nearDupClusterId: z.string().trim().max(160).optional().nullable(),
  datasetVersion: z.string().trim().max(80).optional().nullable(),
  inputProfile: inputProfileSchema.optional().nullable(),
  styleInferabilityTier: styleInferabilityTierSchema.optional().nullable(),
  styleEvaluationSuite: styleEvaluationSuiteSchema.optional().nullable(),
  isAdversarial: z.boolean().optional().nullable(),
  difficultyTier: difficultyTierSchema.optional().nullable(),
  highImpact: z.boolean().optional().nullable(),
  highImpactReason: z.string().trim().max(80).optional().nullable(),
  inferabilityByField: z.record(inferabilityTierSchema).optional().nullable(),
  goldKind: goldKindSchema.optional().nullable(),
  adversarialPair: z.string().max(80).optional().nullable(),
  noiseProfile: z.array(z.string().max(40)).max(12).optional().nullable(),
  approvalSource: approvalSourceSchema.optional().nullable(),
  reviewedBy: z.string().max(120).optional().nullable(),
  auditReasonCode: truthAuditReasonSchema.optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
});
export const learningQueueBulkProcessSchema = z.object({
  ids: truthRefillIdsSchema,
});
export const learningQueueBulkPromoteSchema = z
  .object({
    ids: truthRefillIdsSchema,
    expectedType: z.string().trim().max(40).optional().nullable(),
    expectedStyle: z.string().trim().max(40).optional().nullable(),
    datasetSplit: datasetSplitSchema.optional().nullable(),
    trustLevel: trustLevelSchema.optional().default("reviewed"),
    rowStatus: rowStatusSchema.optional().default("reviewed"),
    blockedReason: blockedReasonSchema.optional().nullable(),
    goldKind: goldKindSchema.optional().nullable(),
    adversarialPair: z.string().trim().max(80).optional().nullable(),
    noiseProfile: z.array(z.string().max(40)).max(12).optional().nullable(),
    approvalSource: approvalSourceSchema.optional().nullable(),
    reviewedBy: z.string().trim().max(120).optional().nullable(),
    auditReasonCode: truthAuditReasonSchema,
    notes: z.string().max(8000).optional().nullable(),
    provenance: z.string().max(2000).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.rowStatus === "quarantined" && !value.blockedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "blockedReason is required when rowStatus is quarantined.",
        path: ["blockedReason"],
      });
    }
    if (value.rowStatus !== "quarantined" && value.blockedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "blockedReason can only be set when rowStatus is quarantined.",
        path: ["blockedReason"],
      });
    }
    if (value.goldKind === "style_adversarial" && !(value.adversarialPair?.trim() ?? "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "adversarialPair is required when goldKind is style_adversarial.",
        path: ["adversarialPair"],
      });
    }
  });
export const syncCoreTruthSchema = z.object({
  auditReasonCode: truthAuditReasonSchema.optional().nullable(),
  reviewedBy: z.string().max(120).optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
});
export const certifyTruthSchema = z.object({
  task: taskSchema,
  truthScope: truthScopeSchema,
  status: taskCertificationStatusSchema.default("certified"),
  packTarget: trainingPackTargetSchema.optional().nullable(),
  requiredReviewPasses: z.number().int().min(1).max(5).default(1),
  completedReviewPasses: z.number().int().min(0).max(5).optional(),
  certifiedBy: z.string().trim().max(120).optional().nullable(),
  decisionHash: z.string().trim().max(128).optional().nullable(),
});
export const truthBulkCertifySchema = certifyTruthSchema.extend({
  ids: truthBulkIdsSchema,
});
export const truthBackgroundBulkSchema = z
  .object({
    operation: truthBackgroundBulkOperationSchema,
    filters: truthBulkFilterSchema.optional().default({}),
    pageSize: z.number().int().min(1).max(100).optional().default(25),
    ids: truthBackgroundIdsSchema.optional(),
    pageRange: truthBackgroundPageRangeSchema.optional().nullable(),
    certify: certifyTruthSchema.optional().nullable(),
    update: truthBulkUpdatePayloadSchema.optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.ids && Object.keys(value.filters ?? {}).length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either ids or filters, not both.",
        path: ["ids"],
      });
    }
    if (value.ids && value.pageRange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either ids or pageRange, not both.",
        path: ["pageRange"],
      });
    }
    if (value.operation === "certify" && !value.certify) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "certify payload is required for certify background jobs.",
        path: ["certify"],
      });
    }
    if (value.operation === "update" && !value.update) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "update payload is required for update background jobs.",
        path: ["update"],
      });
    }
  });

export type TruthTaskOption = z.infer<typeof taskSchema>;
export type TruthScopeOption = z.infer<typeof truthScopeSchema>;
export type TrainingPackTargetOption = z.infer<typeof trainingPackTargetSchema>;
export type CertifyTruthInput = z.infer<typeof certifyTruthSchema>;
export type BulkTruthUpdateInput = z.infer<typeof truthBulkUpdatePayloadSchema>;
export type TruthBulkFilterInput = z.infer<typeof truthBulkFilterSchema>;
export type TruthBackgroundBulkOperation = z.infer<typeof truthBackgroundBulkOperationSchema>;
export type TruthBackgroundPageRangeInput = z.infer<typeof truthBackgroundPageRangeSchema>;
export type TruthEditorDraftInput = z.infer<typeof truthEditorDraftPayloadSchema>;
export type TruthAuditReasonCode = z.infer<typeof truthAuditReasonSchema>;
export type LearningQueueBulkProcessInput = z.infer<typeof learningQueueBulkProcessSchema>;
export type LearningQueueBulkPromoteInput = z.infer<typeof learningQueueBulkPromoteSchema>;

export const buildStyleBundleSchema = z.object({
  version: styleBundleVersionSchema.optional(),
  datasetVersion: z.string().trim().min(1).max(80).optional(),
  includeHoldout: z.boolean().optional().default(false),
});

export const promoteStyleBundleSchema = z.object({
  version: styleBundleVersionSchema,
});

export const bioDatasetFileSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9._-]+$/);

export const buildBioBundleSchema = z.object({
  version: styleBundleVersionSchema.optional(),
  datasetFile: bioDatasetFileSchema.optional(),
});

export const promoteBioBundleSchema = z.object({
  version: styleBundleVersionSchema,
});

export const freezeStyleGoldDatasetSchema = z.object({
  datasetVersion: z.string().trim().min(1).max(80).optional(),
  includeHoldout: z.boolean().optional().default(false),
  enforceDiversityGates: z.boolean().optional().default(true),
});
