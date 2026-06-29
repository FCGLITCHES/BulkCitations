ALTER TABLE "active_learning_queue" ADD COLUMN "promoted_to_truth_id" uuid;--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN "dataset_split" varchar(20);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN "trust_level" varchar(20) DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN "reviewed_by" varchar(120);--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approved_truth" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "active_learning_queue" ADD CONSTRAINT "active_learning_queue_promoted_to_truth_id_approved_truth_id_fk" FOREIGN KEY ("promoted_to_truth_id") REFERENCES "public"."approved_truth"("id") ON DELETE set null ON UPDATE no action;