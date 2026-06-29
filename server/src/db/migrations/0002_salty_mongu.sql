CREATE TABLE "egress_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correlation_id" varchar(128) NOT NULL,
	"provider" varchar(40) NOT NULL,
	"route" varchar(200) NOT NULL,
	"method" varchar(10) NOT NULL,
	"status" integer NOT NULL,
	"request_body_bytes" integer NOT NULL,
	"response_body_bytes" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"cache_hit" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "egress_rollups_daily" (
	"period" date NOT NULL,
	"provider" varchar(40) NOT NULL,
	"route" varchar(200) NOT NULL,
	"calls" integer DEFAULT 0,
	"cache_hits" integer DEFAULT 0,
	"request_body_bytes" integer DEFAULT 0,
	"response_body_bytes" integer DEFAULT 0,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "egress_rollups_monthly" (
	"period" varchar(7) NOT NULL,
	"provider" varchar(40) NOT NULL,
	"route" varchar(200) NOT NULL,
	"calls" integer DEFAULT 0,
	"cache_hits" integer DEFAULT 0,
	"request_body_bytes" integer DEFAULT 0,
	"response_body_bytes" integer DEFAULT 0,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_egress_requests_created" ON "egress_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_egress_requests_provider" ON "egress_requests" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "idx_egress_requests_route" ON "egress_requests" USING btree ("route","created_at");--> statement-breakpoint
CREATE INDEX "idx_egress_requests_corr" ON "egress_requests" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_egress_daily_period_provider_route" ON "egress_rollups_daily" USING btree ("period","provider","route");--> statement-breakpoint
CREATE INDEX "idx_egress_daily_period" ON "egress_rollups_daily" USING btree ("period");--> statement-breakpoint
CREATE INDEX "idx_egress_daily_provider" ON "egress_rollups_daily" USING btree ("provider","period");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_egress_monthly_period_provider_route" ON "egress_rollups_monthly" USING btree ("period","provider","route");--> statement-breakpoint
CREATE INDEX "idx_egress_monthly_period" ON "egress_rollups_monthly" USING btree ("period");--> statement-breakpoint
CREATE INDEX "idx_egress_monthly_provider" ON "egress_rollups_monthly" USING btree ("provider","period");