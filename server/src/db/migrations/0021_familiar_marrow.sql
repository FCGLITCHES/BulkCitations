CREATE TABLE "bio_candidate_sink" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"job_id" uuid,
	"input_hash" varchar(80) NOT NULL,
	"raw_text" text NOT NULL,
	"expected_type" varchar(40),
	"entity_fields" text[] NOT NULL,
	"entity_starts" integer[] NOT NULL,
	"entity_ends" integer[] NOT NULL,
	"expected_fields" jsonb,
	"unprojected_fields" text[] DEFAULT '{}',
	"dataset_split" varchar(20) DEFAULT 'train',
	"trust_level" varchar(20) DEFAULT 'draft',
	"provenance" varchar(60) NOT NULL,
	"needs_review" boolean DEFAULT true NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "enriched_reference_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"doi" varchar(200),
	"canonical_work_key" varchar(200),
	"fields" jsonb NOT NULL,
	"source_provider" varchar(40),
	"match_confidence" real,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "bio_candidate_sink" ADD CONSTRAINT "bio_candidate_sink_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bio_candidate_sink" ADD CONSTRAINT "bio_candidate_sink_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enriched_reference_cache" ADD CONSTRAINT "enriched_reference_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_bio_candidate_input_hash" ON "bio_candidate_sink" USING btree ("input_hash");--> statement-breakpoint
CREATE INDEX "idx_bio_candidate_needs_review" ON "bio_candidate_sink" USING btree ("needs_review","reviewed");--> statement-breakpoint
CREATE INDEX "idx_bio_candidate_provenance" ON "bio_candidate_sink" USING btree ("provenance");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_enriched_cache_user_doi" ON "enriched_reference_cache" USING btree ("user_id","doi") WHERE user_id IS NOT NULL AND doi IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_enriched_cache_user_work" ON "enriched_reference_cache" USING btree ("user_id","canonical_work_key") WHERE user_id IS NOT NULL AND canonical_work_key IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_enriched_cache_global_doi" ON "enriched_reference_cache" USING btree ("doi") WHERE user_id IS NULL AND doi IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_enriched_cache_global_work" ON "enriched_reference_cache" USING btree ("canonical_work_key") WHERE user_id IS NULL AND canonical_work_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_enriched_cache_doi" ON "enriched_reference_cache" USING btree ("doi");--> statement-breakpoint
CREATE INDEX "idx_enriched_cache_work_key" ON "enriched_reference_cache" USING btree ("canonical_work_key");