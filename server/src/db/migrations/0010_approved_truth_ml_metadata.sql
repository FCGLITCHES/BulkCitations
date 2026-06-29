ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "gold_kind" varchar(40);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "adversarial_pair" varchar(80);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "noise_profile" jsonb;--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN IF NOT EXISTS "approval_source" varchar(40);--> statement-breakpoint
