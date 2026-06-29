CREATE TABLE "active_learning_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"citation_id" uuid,
	"correction_id" uuid,
	"report_id" uuid,
	"source" varchar(20),
	"maturity_level" varchar(20) DEFAULT 'manual',
	"priority" integer DEFAULT 0,
	"training_data" jsonb NOT NULL,
	"processed" boolean DEFAULT false,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"key_prefix" varchar(8) NOT NULL,
	"name" varchar(80),
	"tier" varchar(20) DEFAULT 'free',
	"rate_limit" integer,
	"is_active" boolean DEFAULT true,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "approved_truth" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"raw_text" text NOT NULL,
	"expected_fields" jsonb NOT NULL,
	"expected_type" varchar(40),
	"expected_style" varchar(40),
	"provenance" varchar(50),
	"pipeline_major" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "approved_truth_input_hash_unique" UNIQUE("input_hash")
);
--> statement-breakpoint
CREATE TABLE "authority_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"citation_id" uuid,
	"doi" varchar(200),
	"retraction_hit" boolean DEFAULT false,
	"expression_of_concern" boolean DEFAULT false,
	"author_conflict" boolean DEFAULT false,
	"flags" jsonb DEFAULT '[]'::jsonb,
	"checked_at" timestamp with time zone,
	"next_recheck_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"batch_index" integer NOT NULL,
	"raw_blocks" jsonb NOT NULL,
	"count_audit" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "citation_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"citation_id" uuid,
	"user_id" uuid,
	"source" varchar(20) DEFAULT 'user',
	"failure_category" varchar(30) NOT NULL,
	"failure_categories" text[] DEFAULT '{}',
	"user_note" text,
	"status" varchar(20) DEFAULT 'pending',
	"fingerprint" varchar(64),
	"report_count" integer DEFAULT 1,
	"ip_hash" varchar(64),
	"engine_snapshot" jsonb,
	"stage_blame" jsonb,
	"corrected_fields" jsonb,
	"resolution_trace" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "citation_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"citation_id" uuid,
	"version_num" integer NOT NULL,
	"fields" jsonb NOT NULL,
	"changed_by" varchar(20),
	"change_source" varchar(40),
	"changed_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"batch_id" uuid,
	"user_id" uuid,
	"reference_index" integer NOT NULL,
	"raw_text" text NOT NULL,
	"reference_type" varchar(40) DEFAULT 'unknown',
	"detected_style" varchar(40),
	"output_style" varchar(40) NOT NULL,
	"pipeline_major" integer DEFAULT 3 NOT NULL,
	"public_status" varchar(20) DEFAULT 'needs_review' NOT NULL,
	"status" varchar(20) DEFAULT 'active',
	"duplicate_of" uuid,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_score" real,
	"display_score" real,
	"score_bucket" varchar(1),
	"authority_flags" jsonb DEFAULT '[]'::jsonb,
	"authority_checked_at" timestamp with time zone,
	"rendered_text" text,
	"rendered_warnings" text[] DEFAULT '{}',
	"stage_log" jsonb DEFAULT '[]'::jsonb,
	"split_meta" jsonb,
	"extraction_meta" jsonb,
	"enrichment_meta" jsonb,
	"normalization_meta" jsonb,
	"provenance_meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "duplicate_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"primary_id" uuid,
	"member_ids" uuid[] NOT NULL,
	"method" varchar(20),
	"jaccard_score" real,
	"auto_merged" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "export_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"format" varchar(10) NOT NULL,
	"blob_key" varchar(500),
	"inline_content" text,
	"size_bytes" integer,
	"retained_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ingested_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"source_type" varchar(20) NOT NULL,
	"blob_key" varchar(500),
	"raw_text_hash" varchar(64),
	"file_size" integer,
	"page_count" integer,
	"retained_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "job_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"attempt_number" integer NOT NULL,
	"status" varchar(20) NOT NULL,
	"error" jsonb,
	"stage_log" jsonb DEFAULT '[]'::jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"org_id" uuid,
	"project_id" uuid,
	"api_key_id" uuid,
	"idempotency_key" varchar(128),
	"status" varchar(20) DEFAULT 'pending',
	"execution_mode" varchar(10) DEFAULT 'sync',
	"source_type" varchar(20) NOT NULL,
	"input_hash" varchar(64),
	"output_style" varchar(40) DEFAULT 'apa7' NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb,
	"pipeline_major" integer DEFAULT 3 NOT NULL,
	"total_refs" integer DEFAULT 0,
	"processed_refs" integer DEFAULT 0,
	"failed_refs" integer DEFAULT 0,
	"current_phase" varchar(30),
	"count_audit" jsonb,
	"summary" jsonb,
	"failed_indices" integer[] DEFAULT '{}',
	"retry_payload" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "legacy_citations" (
	"citation_id" uuid PRIMARY KEY NOT NULL,
	"legacy_version" text,
	"missing_fields" jsonb DEFAULT '[]'::jsonb,
	"review_status" text DEFAULT 'unreviewed',
	"flagged_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"domain" varchar(200),
	"tier" varchar(20) DEFAULT 'free',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"org_id" uuid,
	"name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "provider_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(20) NOT NULL,
	"cache_key" varchar(128) NOT NULL,
	"payload" jsonb NOT NULL,
	"hit_count" integer DEFAULT 0,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "provider_cache_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE TABLE "regression_fixtures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_name" varchar(80) NOT NULL,
	"verbatim_input" text NOT NULL,
	"expected_output" jsonb NOT NULL,
	"failure_mode" varchar(60),
	"provenance" varchar(50),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "regression_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"pipeline_major" integer NOT NULL,
	"stage_id" varchar(50),
	"suite_name" varchar(80),
	"pass_count" integer DEFAULT 0,
	"fail_count" integer DEFAULT 0,
	"skip_count" integer DEFAULT 0,
	"failures" jsonb DEFAULT '[]'::jsonb,
	"triggered_by" varchar(30)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"org_id" uuid,
	"api_key_id" uuid,
	"period" date NOT NULL,
	"ref_count" integer DEFAULT 0,
	"job_count" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "user_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"citation_id" uuid,
	"user_id" uuid,
	"field_name" varchar(60) NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"correction_type" varchar(20),
	"status" varchar(20) DEFAULT 'pending',
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"email" varchar(255) NOT NULL,
	"name" varchar(160),
	"password_hash" varchar(255) NOT NULL,
	"tier" varchar(20) DEFAULT 'free',
	"daily_ref_count" integer DEFAULT 0,
	"daily_ref_reset" timestamp with time zone DEFAULT now(),
	"is_admin" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "active_learning_queue" ADD CONSTRAINT "active_learning_queue_citation_id_citations_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."citations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_learning_queue" ADD CONSTRAINT "active_learning_queue_correction_id_user_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "public"."user_corrections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_learning_queue" ADD CONSTRAINT "active_learning_queue_report_id_citation_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."citation_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_checks" ADD CONSTRAINT "authority_checks_citation_id_citations_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."citations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_reports" ADD CONSTRAINT "citation_reports_citation_id_citations_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."citations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_reports" ADD CONSTRAINT "citation_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_versions" ADD CONSTRAINT "citation_versions_citation_id_citations_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."citations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_groups" ADD CONSTRAINT "duplicate_groups_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_groups" ADD CONSTRAINT "duplicate_groups_primary_id_citations_id_fk" FOREIGN KEY ("primary_id") REFERENCES "public"."citations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_artifacts" ADD CONSTRAINT "export_artifacts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingested_sources" ADD CONSTRAINT "ingested_sources_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_citations" ADD CONSTRAINT "legacy_citations_citation_id_citations_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."citations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_corrections" ADD CONSTRAINT "user_corrections_citation_id_citations_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."citations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_corrections" ADD CONSTRAINT "user_corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_corrections" ADD CONSTRAINT "user_corrections_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_learning_queue_processed" ON "active_learning_queue" USING btree ("processed","priority");--> statement-breakpoint
CREATE INDEX "idx_api_keys_hash" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "idx_api_keys_user" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_reports_citation" ON "citation_reports" USING btree ("citation_id");--> statement-breakpoint
CREATE INDEX "idx_reports_status" ON "citation_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_reports_fingerprint" ON "citation_reports" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "idx_citations_job" ON "citations" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_citations_user" ON "citations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_citations_status" ON "citations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_citations_public" ON "citations" USING btree ("public_status");--> statement-breakpoint
CREATE INDEX "idx_citations_bucket" ON "citations" USING btree ("score_bucket");--> statement-breakpoint
CREATE INDEX "idx_citations_created" ON "citations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_jobs_user" ON "jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_status" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_jobs_hash" ON "jobs" USING btree ("input_hash");--> statement-breakpoint
CREATE INDEX "idx_jobs_created" ON "jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_provider_cache_key" ON "provider_cache" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "idx_provider_cache_expires" ON "provider_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_usage_user_period" ON "usage" USING btree ("user_id","period");--> statement-breakpoint
CREATE INDEX "idx_usage_org_period" ON "usage" USING btree ("org_id","period");--> statement-breakpoint
CREATE INDEX "idx_corrections_citation" ON "user_corrections" USING btree ("citation_id");--> statement-breakpoint
CREATE INDEX "idx_corrections_status" ON "user_corrections" USING btree ("status");