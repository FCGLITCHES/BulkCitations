export interface DoNotPortPhaseAStub {
  id: string;
  legacyBehavior: string;
  whyWrong: string;
  input: string;
  expectedV2Behavior: {
    referenceType?: string;
    expectedValidationCodes?: string[];
    expectedAuthorTokens?: string[];
    note: string;
  };
}

// Phase A classification stubs only.
// These are committed so `do not port` decisions can close during the audit
// without pretending the final automated regression already exists.
export const DO_NOT_PORT_PHASE_A_STUBS: DoNotPortPhaseAStub[] = [
  {
    id: 'legacy_static_year_cap',
    legacyBehavior: 'Legacy parsing relies on static year-matching heuristics that can reject or distort out-of-range years before validation gets a chance to reason about them.',
    whyWrong: 'v2 should preserve the extracted year token and let validation emit `year_out_of_range` rather than silently collapsing the year with parser-era caps.',
    input: 'Smith, J. (2101). Forecasting citation systems beyond the current century. Journal of Temporal Computing, 99(1), 1-9.',
    expectedV2Behavior: {
      referenceType: 'journal',
      expectedValidationCodes: ['year_out_of_range'],
      note: 'Keep the extracted year visible to the pipeline and treat it as a validation concern, not a parser-era hard cap.',
    },
  },
  {
    id: 'legacy_place_publisher_book_bias',
    legacyBehavior: 'Legacy type scoring gives strong book weight to `Place: Publisher` tails and can force institutional reports into `book`.',
    whyWrong: 'v2 must preserve `report` and institutional behavior for references that have report semantics even when they also contain a place/publisher tail.',
    input: 'World Health Organization. Global tuberculosis report 2023. Geneva: World Health Organization; 2023.',
    expectedV2Behavior: {
      referenceType: 'report',
      expectedAuthorTokens: ['World Health Organization'],
      note: 'Do not port the old book bias; keep the institutional/report path authoritative here.',
    },
  },
  {
    id: 'legacy_non_ascii_initial_bias',
    legacyBehavior: 'Legacy author heuristics lean on ASCII uppercase assumptions and can misread non-ASCII name shapes as initials noise or malformed tokens.',
    whyWrong: 'v2 should preserve diacritic-bearing surnames and given-name structure instead of flattening them into initials-first noise.',
    input: 'Alvarez, J., Zou, L., and Aksoy, S. "Unicode author handling in multilingual citation pipelines." Journal of Global Information Systems, 12(3), 44-58. Related multilingual records include Álvarez, José; Żou, Łin; and Aksoy, Şelin.',
    expectedV2Behavior: {
      referenceType: 'journal',
      expectedAuthorTokens: ['Álvarez', 'Żou', 'Aksoy'],
      note: 'Phase D should replace this placeholder multilingual-name stub with the final approved non-ASCII regression fixture once the exact corpus sample is selected.',
    },
  },
];
