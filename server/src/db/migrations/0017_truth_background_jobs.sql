CREATE TABLE IF NOT EXISTS truth_background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  lease_owner varchar(120),
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_truth_background_jobs_status_updated
  ON truth_background_jobs (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_truth_background_jobs_lease_expires
  ON truth_background_jobs (lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_truth_background_jobs_created
  ON truth_background_jobs (created_at);
