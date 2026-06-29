import { ENGINE_REFERENCE_TYPE_LABELS } from "@/lib/engine-types";

import type {
  ExpectedFieldDefinition,
  TruthApprovalSource,
  TruthAuditReasonCode,
  TruthBlockedReason,
  TruthDatasetSplit,
  TruthGoldKind,
  TruthRenderVariantStyle,
  TruthRowStatus,
  TruthScope,
  TruthStyleEvaluationSuite,
  TruthTask,
  TruthTaskCertificationStatus,
  TruthTrustLevel,
  TruthInputProfile,
  TrainingPackTarget,
} from "./types";

export const cardClass =
  "rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none";

export const APPROVED_TRUTH_PAGE_SIZE = 25;

export const GOLD_REFERENCE_TYPE_OPTIONS = Object.entries(ENGINE_REFERENCE_TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export const DATASET_SPLIT_OPTIONS: Array<{ value: TruthDatasetSplit; label: string; description: string }> = [
  { value: "train", label: "Train", description: "Used for model training." },
  { value: "val", label: "Validation", description: "Used for tuning and threshold checks." },
  { value: "test", label: "Test", description: "Used for release evaluation only." },
  { value: "holdout", label: "Holdout", description: "Sealed set; excluded from default exports." },
];

export const TRUST_LEVEL_OPTIONS: Array<{ value: TruthTrustLevel; label: string; description: string }> = [
  { value: "draft", label: "Draft", description: "Initial row; not yet review-complete." },
  { value: "reviewed", label: "Reviewed", description: "Human-reviewed row." },
  { value: "gold", label: "Gold (legacy)", description: "Legacy trust marker kept for compatibility." },
];

export const GOLD_KIND_OPTIONS: Array<{ value: TruthGoldKind; label: string; description: string }> = [
  { value: "style_clean", label: "Style clean", description: "Normal clean style sample." },
  { value: "style_adversarial", label: "Style adversarial", description: "Confusion-pair sample." },
  { value: "style_noisy", label: "Style noisy", description: "Degraded/noisy style sample." },
  { value: "field_span", label: "Field span", description: "Field-level ambiguity or routing sample." },
  { value: "authority_seed", label: "Authority seed", description: "Feeds local authority pack curation." },
  { value: "overlay_accept", label: "Overlay accept", description: "Accepted post-output overlay row." },
];

export const APPROVAL_SOURCE_OPTIONS: Array<{
  value: TruthApprovalSource;
  label: string;
  description: string;
}> = [
  { value: "manual", label: "Manual", description: "Created directly by admin reviewer." },
  { value: "learning_queue", label: "Learning queue", description: "Promoted from user feedback queue." },
  { value: "overlay_accept", label: "Overlay accept", description: "Promoted from accepted Pro overlay." },
];

export const AUDIT_REASON_OPTIONS: Array<{
  value: TruthAuditReasonCode;
  label: string;
  description: string;
}> = [
  { value: "manual_correction", label: "Manual correction", description: "Human corrected truth content." },
  { value: "sync_expected_to_core", label: "Sync expected/core", description: "Aligned expected and core truth fields." },
  { value: "source_verification", label: "Source verification", description: "Updated using verified source evidence." },
  { value: "crossref_alignment", label: "Crossref alignment", description: "Updated from Crossref DOI metadata." },
  { value: "engine_prefill_alignment", label: "Engine prefill alignment", description: "Aligned with local engine prefill output." },
  { value: "regression_fix", label: "Regression fix", description: "Correction made to fix known benchmark or regression issues." },
  { value: "governance_metadata_update", label: "Governance metadata", description: "Metadata-only governance update with traceability." },
];

export const ROW_STATUS_OPTIONS: Array<{ value: TruthRowStatus; label: string; description: string }> = [
  { value: "draft", label: "Draft", description: "Still being reviewed." },
  { value: "reviewed", label: "Reviewed", description: "Review-complete and export-eligible if certified." },
  { value: "quarantined", label: "Quarantined", description: "Blocked from export until resolved." },
];

export const BLOCKED_REASON_OPTIONS: Array<{ value: TruthBlockedReason; label: string; description: string }> = [
  { value: "source_conflict", label: "Source conflict", description: "Conflicting sources not resolved." },
  { value: "inferability_conflict", label: "Inferability conflict", description: "Field cannot be safely inferred in selected truth scope." },
  { value: "canonicalization_unclear", label: "Canonicalization unclear", description: "Normalization/format choice still uncertain." },
  { value: "split_leakage", label: "Split leakage", description: "Split assignment violates leakage policy." },
  { value: "identifier_invalid", label: "Identifier invalid", description: "DOI/ISBN/ISSN checks failed." },
  { value: "evidence_missing", label: "Evidence missing", description: "Required evidence for this row is incomplete." },
  { value: "review_conflict", label: "Review conflict", description: "Blind pass decisions conflict." },
  { value: "family_incompatible", label: "Family incompatible", description: "Field/type combination is incompatible." },
  { value: "provider_only_fact", label: "Provider-only fact", description: "Value belongs in overlay scope, not core." },
  { value: "needs_research", label: "Needs research", description: "Requires more investigation before certification." },
];

export const TASK_OPTIONS: Array<{ value: TruthTask; label: string; description: string }> = [
  { value: "style", label: "Style", description: "Style model and style benchmarking." },
  { value: "field", label: "Field", description: "Field-level fallback training." },
  { value: "authority_pack", label: "Authority pack", description: "Authority hint pack curation." },
  { value: "overlay_learning", label: "Overlay learning", description: "Post-output overlay learning only." },
];

export const SCOPE_OPTIONS: Array<{ value: TruthScope; label: string; description: string }> = [
  { value: "core", label: "Core", description: "Deterministic core-lane truth." },
  { value: "overlay", label: "Overlay", description: "Pro overlay truth only." },
];

export const INPUT_PROFILE_OPTIONS: Array<{ value: TruthInputProfile; label: string; description: string }> = [
  { value: "doi_list", label: "DOI list", description: "Mostly DOI-only carrier input." },
  { value: "structured_clean", label: "Structured clean", description: "Well-formed citation text." },
  { value: "structured_noisy", label: "Structured noisy", description: "Structured citation with damage or inconsistencies." },
  { value: "pasted_pdf_copy", label: "Pasted PDF copy", description: "PDF copy/paste artifacts are present." },
  { value: "multiline_numbered", label: "Multiline numbered", description: "Line-broken or numbered bibliography input." },
  { value: "ocr_like", label: "OCR-like", description: "OCR corruption or substitution patterns are present." },
];

export const STYLE_EVAL_SUITE_OPTIONS: Array<{
  value: TruthStyleEvaluationSuite;
  label: string;
  description: string;
}> = [
  { value: "supported_exact", label: "Supported exact", description: "The six supported exact styles." },
  { value: "supported_family_only", label: "Supported family only", description: "Family can be inferred, exact style cannot." },
  { value: "unsupported_exact", label: "Unsupported exact", description: "Real style but not one of the six supported exact labels." },
  { value: "unknown_or_ood", label: "Unknown or OOD", description: "Out-of-distribution or unsupported citation-like text." },
  { value: "not_citation_like", label: "Not citation-like", description: "Input is not a citation/reference example." },
];

export const CERTIFICATION_STATUS_OPTIONS: Array<{
  value: TruthTaskCertificationStatus;
  label: string;
  description: string;
}> = [
  { value: "candidate", label: "Candidate", description: "Reviewed, but not yet fully certified." },
  { value: "certified", label: "Certified", description: "Export-eligible for this task and truth scope." },
];

export const TRAINING_PACK_TARGET_OPTIONS: Array<{
  value: TrainingPackTarget;
  label: string;
  description: string;
}> = [
  {
    value: "style_core_gold",
    label: "Gold style/core dataset",
    description: "Canonical style classifier and style benchmark rows.",
  },
  {
    value: "approved_overlay_changes",
    label: "Approved overlay changes",
    description: "Certified Pro overlay corrections that should apply live for matching future inputs.",
  },
  {
    value: "citation_bio_supervision",
    label: "Citation BIO supervision",
    description: "Field/span examples for BIO tagging and extraction supervision.",
  },
  {
    value: "authority_pack",
    label: "Authority pack",
    description: "DOI, journal, ISSN, and authority hints used by deterministic parsing.",
  },
  {
    value: "render_variant_augmentation",
    label: "Render variant augmentation",
    description: "Approved style render variants used for output-format augmentation.",
  },
  {
    value: "regression_fixtures",
    label: "Regression fixtures",
    description: "Hard cases that should become permanent engine regression checks.",
  },
];

export const EXPECTED_FIELD_DEFINITIONS: ExpectedFieldDefinition[] = [
  { key: "authors", label: "Authors", placeholder: "Doe, Jane | Smith, John", help: "Separate authors with |. The form converts this to the stored JSON list." },
  { key: "title", label: "Title", placeholder: "Reference title", help: "Main work title." },
  { key: "year", label: "Year", placeholder: "2024", help: "Publication year." },
  { key: "journal_venue", label: "Journal/Venue", placeholder: "Journal or venue", help: "Shared benchmark union field used by the engine." },
  { key: "journal", label: "Journal", placeholder: "Journal title", help: "Journal/container title when this is a journal article." },
  { key: "venue", label: "Venue", placeholder: "Venue", help: "Venue short label when needed separately." },
  { key: "conferenceTitle", label: "Conference title", placeholder: "Proceedings of ...", help: "Conference/proceedings title." },
  { key: "bookTitle", label: "Book title", placeholder: "Handbook of ...", help: "Book/container title for chapter-like works." },
  { key: "publisher", label: "Publisher", placeholder: "Publisher", help: "Publisher or issuing organization when it is a publisher field." },
  { key: "institution", label: "Institution", placeholder: "Institution", help: "Institution for reports, theses, or institutional works." },
  { key: "volume", label: "Volume", placeholder: "15", help: "Volume number." },
  { key: "issue", label: "Issue", placeholder: "1", help: "Issue number." },
  { key: "pages", label: "Pages", placeholder: "17-24", help: "Page range or locator." },
  { key: "doi", label: "DOI", placeholder: "10.1000/example", help: "DOI without needing the full URL." },
  { key: "url", label: "URL", placeholder: "https://example.com", help: "Canonical URL when relevant." },
  { key: "issn", label: "ISSN", placeholder: "1234-5678", help: "ISSN when known." },
  { key: "isbn", label: "ISBN", placeholder: "978-3-16-148410-0", help: "ISBN when known." },
  { key: "reportNumber", label: "Report number", placeholder: "TR-2024-01", help: "Report or technical report number." },
  { key: "siteName", label: "Site name", placeholder: "WHO", help: "Website/publication site name when the citation is web-like." },
  { key: "patent", label: "Patent", placeholder: "US1234567", help: "Patent identifier." },
  { key: "arxiv", label: "arXiv", placeholder: "arXiv:2401.12345", help: "arXiv identifier." },
  { key: "corrected_output", label: "Expected output", placeholder: "Rendered citation output", help: "Human-reviewed formatted citation string.", multiline: true },
];

export const EXPECTED_FIELD_DEFINITION_BY_KEY = Object.fromEntries(
  EXPECTED_FIELD_DEFINITIONS.map((field) => [field.key, field]),
) as Record<string, ExpectedFieldDefinition>;

export const EXPECTED_OUTPUT_FIELD_KEY = "corrected_output";
export const EXPECTED_OUTPUT_FIELD_DEFINITION = EXPECTED_FIELD_DEFINITION_BY_KEY[EXPECTED_OUTPUT_FIELD_KEY];

export const REQUIRED_EXPECTED_FIELDS_BY_TYPE: Partial<Record<string, string[]>> = {
  "article-journal": ["authors", "title", "journal", "year"],
  "conference-paper": ["authors", "title", "conferenceTitle", "year"],
  book: ["authors", "title", "publisher", "year"],
  "book-chapter": ["authors", "title", "bookTitle", "year"],
  report: ["authors", "title", "institution", "year"],
  thesis: ["authors", "title", "institution", "year"],
  webpage: ["title", "url"],
};

export const STYLE_PAIR_BY_STYLE: Record<string, string> = {
  apa7: "apa7_vs_harvard-ctr",
  "harvard-ctr": "apa7_vs_harvard-ctr",
  mla9: "mla9_vs_chicago-notes-bib",
  "chicago-notes-bib": "mla9_vs_chicago-notes-bib",
  vancouver: "vancouver_vs_ieee",
  ieee: "vancouver_vs_ieee",
};

export const TRUTH_RENDER_VARIANT_STYLE_ORDER: TruthRenderVariantStyle[] = [
  "apa7",
  "harvard-ctr",
  "chicago-notes-bib",
  "vancouver",
  "ieee",
  "mla9",
];

export const TRUTH_RENDER_VARIANT_STYLE_LABELS: Record<TruthRenderVariantStyle, string> = {
  apa7: "APA 7",
  "harvard-ctr": "Harvard-CTR",
  "chicago-notes-bib": "Chicago Notes-Bib",
  vancouver: "Vancouver",
  ieee: "IEEE",
  mla9: "MLA 9",
};

export const TRUTH_ROW_HIGHLIGHT_DURATION_MS = 90_000;
