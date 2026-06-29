ALTER TABLE "citation_reports" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "citation_reports" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
UPDATE "citation_reports" AS "reports"
SET "job_id" = "citations"."job_id"
FROM "citations"
WHERE "reports"."citation_id" = "citations"."id"
  AND "reports"."job_id" IS NULL;--> statement-breakpoint
UPDATE "citation_reports"
SET "updated_at" = "created_at"
WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "citation_reports" ADD CONSTRAINT "citation_reports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reports_job_status_updated" ON "citation_reports" USING btree ("job_id","status","updated_at");--> statement-breakpoint
CREATE TABLE "batch_health_summaries" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"owner_label" varchar(255) NOT NULL,
	"owner_type" varchar(20) NOT NULL,
	"output_style" varchar(40),
	"created_at" timestamp with time zone NOT NULL,
	"latest_actionable_at" timestamp with time zone,
	"total_citations" integer DEFAULT 0 NOT NULL,
	"flagged_citation_count" integer DEFAULT 0 NOT NULL,
	"ready_count" integer DEFAULT 0 NOT NULL,
	"needs_review_count" integer DEFAULT 0 NOT NULL,
	"needs_action_count" integer DEFAULT 0 NOT NULL,
	"open_pending_report_count" integer DEFAULT 0 NOT NULL,
	"open_proposed_report_count" integer DEFAULT 0 NOT NULL,
	"open_report_total" integer DEFAULT 0 NOT NULL,
	"health_label" varchar(20) NOT NULL,
	"queue_source" varchar(20) NOT NULL,
	"in_queue" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "batch_health_summaries" ADD CONSTRAINT "batch_health_summaries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_batch_health_in_queue_latest" ON "batch_health_summaries" USING btree ("in_queue","latest_actionable_at");--> statement-breakpoint
CREATE INDEX "idx_batch_health_label_source" ON "batch_health_summaries" USING btree ("health_label","queue_source");--> statement-breakpoint
