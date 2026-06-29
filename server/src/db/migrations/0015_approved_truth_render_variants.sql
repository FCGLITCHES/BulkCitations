CREATE TABLE IF NOT EXISTS approved_truth_render_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  truth_row_id uuid NOT NULL REFERENCES approved_truth(id) ON DELETE CASCADE,
  style varchar(40) NOT NULL,
  generated_text text NOT NULL,
  rendered_text text NOT NULL,
  source_kind varchar(20) NOT NULL,
  approval_status varchar(20) NOT NULL,
  quality_tier varchar(20) NOT NULL,
  dataset_lane varchar(20) NOT NULL,
  renderer_version varchar(80) NOT NULL,
  stale boolean NOT NULL DEFAULT false,
  generated_at timestamptz DEFAULT now(),
  approved_at timestamptz,
  approved_by varchar(120),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_approved_truth_render_variants_truth_style
  ON approved_truth_render_variants (truth_row_id, style);

CREATE INDEX IF NOT EXISTS idx_approved_truth_render_variants_truth_row
  ON approved_truth_render_variants (truth_row_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_approved_truth_render_variants_style
  ON approved_truth_render_variants (style, updated_at);
