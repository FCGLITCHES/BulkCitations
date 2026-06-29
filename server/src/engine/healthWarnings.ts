import type { HealthWarning, WarningSeverity } from './types/citation.js';

const WARNING_SEVERITY_MAP: Record<string, WarningSeverity> = {
  invalid_author_span: 'review',
  overlapping_spans: 'review',
  unclosed_bio_sequence: 'review',
  missing_required_ml_span: 'review',
  uncertain_split_block: 'review',
  split_block_too_short: 'review',
  split_block_too_long: 'review',
  style_unknown: 'review',
  input_style_uncertain: 'info',
  missing_preferred_fields: 'info',
  type_unknown: 'review',
  low_split_quality: 'review',
  uncertain_detection: 'review',
  sampled_detection: 'info',
  pdf_copy_cleanup_applied: 'info',
  schema_without_mandatory_fields: 'review',
  render_style_fallback: 'review',
  render_output_empty_or_invalid: 'action',
  render_output_structurally_incomplete: 'review',
  render_eligible_field_omitted: 'review',
  locator_lost_during_render: 'action',
  doi_lost_during_render: 'action',
  doi_conflicted: 'review',
  doi_unverified: 'info',
  venue_missing_in_render: 'review',
  authority_expression_of_concern: 'review',
  authority_author_conflict: 'review',
  authority_metadata_mismatch: 'review',
  authority_retraction_notice: 'action',
  // High-confidence-but-implausible field values (present, so not "missing", but
  // structurally wrong — e.g. an author span that swallowed the title, or a page
  // range whose start > end). Flags the engine's confident-wrong blind spot.
  suspect_author_value: 'review',
  suspect_locator_value: 'review',
  // The source author span was truncated with "et al." — the stored author list
  // is intentionally incomplete. Surface it as an informational signal (et al. is
  // normal, citation-correct truncation) without demoting the citation's status.
  author_list_incomplete: 'info',
  // A needs_action reference was auto-recovered by pro enrichment against a verified
  // provider match. Informational only (the ref is now ready) — surfaced so the user
  // can see which references were corrected by enrichment.
  enrichment_recovered: 'info',
  // A provider lookup returned a record that CONFLICTS with the extracted citation
  // (title/author/year disagree) on a reference with no anchoring DOI. The record was
  // withheld rather than applied, so no fabricated metadata leaked in — but the conflict
  // is surfaced for review. This is the honesty guard for scrambled input (real title
  // bolted onto wrong author/year): we never silently "correct" it into a different work.
  enrichment_mismatch: 'review',
} as const;

export function toHealthWarning(code: string, message?: string): HealthWarning {
  return {
    code,
    severity: WARNING_SEVERITY_MAP[code] ?? 'info',
    ...(message ? { message } : {}),
  };
}

export function uniqueHealthWarnings(warnings: HealthWarning[]): HealthWarning[] {
  const seen = new Set<string>();
  const result: HealthWarning[] = [];

  for (const warning of warnings) {
    const key = `${warning.code}:${warning.severity}:${warning.message ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(warning);
  }

  return result;
}
