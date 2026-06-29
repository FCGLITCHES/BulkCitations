CREATE TABLE "citation_extraction_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"citation_id" uuid NOT NULL,
	"job_id" uuid,
	"run_mode" varchar(20) NOT NULL,
	"model_version" varchar(80),
	"feature_version" varchar(80),
	"style_used" varchar(40) NOT NULL,
	"overall_confidence" real,
	"field_confidences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"uncertain_fields" text[] DEFAULT '{}' NOT NULL,
	"entities" jsonb,
	"shadow_diff" jsonb,
	"ml_error" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
DROP INDEX "idx_citations_bucket";--> statement-breakpoint
ALTER TABLE "citation_extraction_history" ADD CONSTRAINT "citation_extraction_history_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_citation_extraction_history_citation" ON "citation_extraction_history" USING btree ("citation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_citation_extraction_history_job" ON "citation_extraction_history" USING btree ("job_id","created_at");--> statement-breakpoint
ALTER TABLE "citations" DROP COLUMN "score_bucket";