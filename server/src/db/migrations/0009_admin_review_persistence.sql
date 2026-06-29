ALTER TABLE "citation_reports" ADD COLUMN "review_state" jsonb;--> statement-breakpoint
ALTER TABLE "user_corrections" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "user_corrections" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
UPDATE "user_corrections" AS "corrections"
SET "job_id" = "citations"."job_id"
FROM "citations"
WHERE "corrections"."citation_id" = "citations"."id"
  AND "corrections"."job_id" IS NULL;--> statement-breakpoint
UPDATE "user_corrections"
SET "updated_at" = "created_at"
WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "user_corrections" ADD CONSTRAINT "user_corrections_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_corrections_job" ON "user_corrections" USING btree ("job_id");--> statement-breakpoint
