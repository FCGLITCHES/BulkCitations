ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "core_truth" jsonb;--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "overlay_truth" jsonb;--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "row_status" varchar(20) DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "blocked_reason" varchar(40);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "task_certifications" jsonb;--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "evidence_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "work_id" varchar(120);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "family_id" varchar(120);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "variant_id" varchar(120);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "input_profile" varchar(40);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "high_impact" boolean;--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "high_impact_reason" varchar(80);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "holdout_version" varchar(40);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "inferability_by_field" jsonb;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'approved_truth_row_status_check'
  ) THEN
    ALTER TABLE "approved_truth"
    ADD CONSTRAINT "approved_truth_row_status_check" CHECK ("row_status" IN ('draft', 'reviewed', 'quarantined'));
  END IF;
END
$$;--> statement-breakpoint
