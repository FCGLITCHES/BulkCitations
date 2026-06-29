ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "canonical_work_key" varchar(160);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "near_dup_cluster_id" varchar(160);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "dataset_version" varchar(80);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "style_inferability_tier" varchar(40);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "style_evaluation_suite" varchar(40);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "is_adversarial" boolean;--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "difficulty_tier" varchar(20);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approved_truth_dataset_version_idx" ON "approved_truth" ("dataset_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approved_truth_canonical_work_key_idx" ON "approved_truth" ("canonical_work_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approved_truth_near_dup_cluster_idx" ON "approved_truth" ("near_dup_cluster_id");--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'approved_truth_style_inferability_tier_check'
  ) THEN
    ALTER TABLE "approved_truth"
    ADD CONSTRAINT "approved_truth_style_inferability_tier_check"
    CHECK ("style_inferability_tier" IS NULL OR "style_inferability_tier" IN (
      'tier1_exact_direct',
      'tier2_exact_policy_resolved',
      'tier3_family_only',
      'tier4_not_inferable'
    ));
  END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'approved_truth_style_evaluation_suite_check'
  ) THEN
    ALTER TABLE "approved_truth"
    ADD CONSTRAINT "approved_truth_style_evaluation_suite_check"
    CHECK ("style_evaluation_suite" IS NULL OR "style_evaluation_suite" IN (
      'supported_exact',
      'supported_family_only',
      'unsupported_exact',
      'unknown_or_ood',
      'not_citation_like'
    ));
  END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'approved_truth_difficulty_tier_check'
  ) THEN
    ALTER TABLE "approved_truth"
    ADD CONSTRAINT "approved_truth_difficulty_tier_check"
    CHECK ("difficulty_tier" IS NULL OR "difficulty_tier" IN (
      'low',
      'medium',
      'high',
      'very_high'
    ));
  END IF;
END
$$;--> statement-breakpoint
