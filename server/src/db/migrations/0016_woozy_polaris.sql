-- Control-plane hardening: job tier indexing + atomic usage scope model.

ALTER TABLE "jobs"
ADD COLUMN IF NOT EXISTS "tier" varchar(20);
--> statement-breakpoint

UPDATE "jobs"
SET "tier" = CASE
  WHEN "org_id" IS NOT NULL THEN 'b2b'
  ELSE 'free'
END
WHERE "tier" IS NULL;
--> statement-breakpoint

ALTER TABLE "jobs"
ALTER COLUMN "tier" SET DEFAULT 'free';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_jobs_status_tier"
ON "jobs" USING btree ("status","tier");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_jobs_status_org"
ON "jobs" USING btree ("status","org_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_jobs_status_user"
ON "jobs" USING btree ("status","user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_jobs_status_api_key"
ON "jobs" USING btree ("status","api_key_id");
--> statement-breakpoint

ALTER TABLE "usage"
ADD COLUMN IF NOT EXISTS "scope_type" varchar(20);
--> statement-breakpoint

ALTER TABLE "usage"
ADD COLUMN IF NOT EXISTS "scope_key" varchar(200);
--> statement-breakpoint

WITH normalized AS (
  SELECT
    u."id",
    u."period",
    COALESCE(
      NULLIF(u."scope_type", ''),
      CASE
        WHEN u."org_id" IS NOT NULL THEN 'org'
        WHEN u."user_id" IS NOT NULL THEN 'user'
        WHEN u."api_key_id" IS NOT NULL THEN 'api_key'
        ELSE 'global'
      END
    ) AS "norm_scope_type",
    COALESCE(
      NULLIF(u."scope_key", ''),
      CASE
        WHEN u."org_id" IS NOT NULL THEN u."org_id"::text
        WHEN u."user_id" IS NOT NULL THEN u."user_id"::text
        WHEN u."api_key_id" IS NOT NULL THEN u."api_key_id"::text
        ELSE 'global'
      END
    ) AS "norm_scope_key",
    COALESCE(u."ref_count", 0) AS "ref_count",
    COALESCE(u."job_count", 0) AS "job_count",
    u."user_id",
    u."org_id",
    u."api_key_id"
  FROM "usage" u
),
aggregated AS (
  SELECT
    n."period",
    n."norm_scope_type",
    n."norm_scope_key",
    MIN(n."id"::text)::uuid AS "keep_id",
    SUM(n."ref_count") AS "ref_count_sum",
    SUM(n."job_count") AS "job_count_sum",
    MAX(n."user_id"::text) FILTER (WHERE n."norm_scope_type" = 'user')::uuid AS "user_id_value",
    MAX(n."org_id"::text) FILTER (WHERE n."norm_scope_type" = 'org')::uuid AS "org_id_value",
    MAX(n."api_key_id"::text) FILTER (WHERE n."norm_scope_type" = 'api_key')::uuid AS "api_key_id_value"
  FROM normalized n
  GROUP BY
    n."period",
    n."norm_scope_type",
    n."norm_scope_key"
),
updated AS (
  UPDATE "usage" u
  SET
    "scope_type" = a."norm_scope_type",
    "scope_key" = a."norm_scope_key",
    "ref_count" = a."ref_count_sum",
    "job_count" = a."job_count_sum",
    "user_id" = CASE WHEN a."norm_scope_type" = 'user' THEN a."user_id_value" ELSE NULL END,
    "org_id" = CASE WHEN a."norm_scope_type" = 'org' THEN a."org_id_value" ELSE NULL END,
    "api_key_id" = CASE WHEN a."norm_scope_type" = 'api_key' THEN a."api_key_id_value" ELSE NULL END
  FROM aggregated a
  WHERE u."id" = a."keep_id"
  RETURNING u."id"
)
DELETE FROM "usage" u
USING aggregated a
WHERE
  u."period" = a."period"
  AND COALESCE(
    NULLIF(u."scope_type", ''),
    CASE
      WHEN u."org_id" IS NOT NULL THEN 'org'
      WHEN u."user_id" IS NOT NULL THEN 'user'
      WHEN u."api_key_id" IS NOT NULL THEN 'api_key'
      ELSE 'global'
    END
  ) = a."norm_scope_type"
  AND COALESCE(
    NULLIF(u."scope_key", ''),
    CASE
      WHEN u."org_id" IS NOT NULL THEN u."org_id"::text
      WHEN u."user_id" IS NOT NULL THEN u."user_id"::text
      WHEN u."api_key_id" IS NOT NULL THEN u."api_key_id"::text
      ELSE 'global'
    END
  ) = a."norm_scope_key"
  AND u."id" <> a."keep_id";
--> statement-breakpoint

ALTER TABLE "usage"
ALTER COLUMN "scope_type" SET DEFAULT 'global';
--> statement-breakpoint

ALTER TABLE "usage"
ALTER COLUMN "scope_key" SET DEFAULT 'global';
--> statement-breakpoint

ALTER TABLE "usage"
ALTER COLUMN "scope_type" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "usage"
ALTER COLUMN "scope_key" SET NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ux_usage_period_scope"
ON "usage" USING btree ("period","scope_type","scope_key");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_usage_api_key_period"
ON "usage" USING btree ("api_key_id","period");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_usage_scope_period"
ON "usage" USING btree ("scope_type","scope_key","period");
