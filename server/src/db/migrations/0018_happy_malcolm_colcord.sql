CREATE TABLE "runtime_overrides" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_runtime_overrides_updated" ON "runtime_overrides" USING btree ("updated_at");--> statement-breakpoint
