import type { CitationStyle, StyleFamily, StyleSignalCode } from './types/citation.js';

export type SignalWeightTable = Partial<Record<StyleSignalCode, number>>;

export const STYLE_FAMILY_BY_STYLE: Record<
  Exclude<CitationStyle, 'auto' | 'unknown'>,
  StyleFamily
> = {
  apa7: 'author_date',
  'harvard-ctr': 'author_date',
  'chicago-author-date': 'author_date',
  mla9: 'notes_bibliography',
  'chicago-notes-bib': 'notes_bibliography',
  vancouver: 'numeric',
  ieee: 'numeric',
  ama: 'numeric',
  acs: 'numeric',
};

export const FAMILY_DEFAULT_STYLE: Record<StyleFamily, CitationStyle> = {
  author_date: 'apa7',
  numeric: 'vancouver',
  notes_bibliography: 'mla9',
  web_accessed: 'apa7',
  unknown: 'unknown',
};

export const EXACT_STYLES_BY_FAMILY: Record<
  Exclude<StyleFamily, 'unknown' | 'web_accessed'>,
  CitationStyle[]
> = {
  author_date: ['apa7', 'harvard-ctr', 'chicago-author-date'],
  numeric: ['vancouver', 'ieee', 'ama', 'acs'],
  notes_bibliography: ['mla9', 'chicago-notes-bib'],
};

export const FAMILY_SIGNAL_WEIGHTS: Record<Exclude<StyleFamily, 'unknown'>, SignalWeightTable> = {
  author_date: {
    year_parenthesized_after_authors: 3.2,
    year_bare_after_authors: 2.8,
    ieee_incompatible_author_date_year_placement: 1.2,
    year_early_position: 1.3,
    author_year_lead: 1.4,
    author_initials_surname: 1.2,
    author_separator_ampersand: 0.7,
    title_sentence_case: 0.9,
    cue_journal: 0.5,
    cue_book_publisher: 0.5,
    marker_edition: 0.4,
    identifier_doi: 0.3,
    punctuation_period_dense: 0.4,
  },
  numeric: {
    bracketed_enumerator: 3.0,
    // Plain ordered-list numbering is common across all style families, so it
    // should not strongly bias the detector toward numeric formats on its own.
    numeric_dot_enumerator: 0.15,
    numeric_paren_enumerator: 0.75,
    parenthesized_enumerator: 0.5,
    author_initials_surname: 1.1,
    author_surname_initials: 1.5,
    author_separator_semicolon: 1.5,
    author_bucket_many: 0.6,
    year_repeated_conference: 0.5,
    year_late_position: 0.6,
    cue_conference: 0.5,
    cue_journal: 0.6,
    cue_journal_abbrev: 0.9,
    locator_vol: 0.8,
    locator_no: 0.6,
    locator_pp: 0.8,
    locator_ieee_signature: 2.4,
    locator_semicolon_volume_issue_pages: 2.4,
    locator_volume_issue_pages: 1.6,
    locator_year_comma_volume_colon_pages: 2.1,
    locator_year_comma_volume_colon_identifier: 2.0,
    locator_page_range_only: 0.5,
    identifier_doi: 0.6,
    identifier_at_end: 0.8,
    identifier_doi_tail_numeric: 1.0,
    capitalization_numeric_minimal: 0.8,
    punctuation_comma_dense: 0.4,
  },
  notes_bibliography: {
    quoted_title: 2.2,
    title_title_case: 1.0,
    title_followed_by_period: 0.5,
    title_followed_by_comma: 0.7,
    year_late_position: 1.8,
    author_initials_surname: 0.7,
    cue_book_publisher: 0.7,
    marker_editor: 0.6,
    marker_translator: 0.4,
    marker_edition: 0.4,
    locator_vol: 0.5,
    locator_no: 0.4,
    locator_pp: 0.5,
    punctuation_period_dense: 0.4,
    punctuation_comma_dense: 0.4,
  },
  web_accessed: {
    identifier_accessed_retrieved: 3.0,
    identifier_url: 2.2,
    identifier_at_end: 1.1,
    cue_web_access: 2.2,
    web_url_without_scholarly_locators: 2.5,
    web_host_like_container: 1.1,
    year_late_position: 0.4,
  },
};

/** Per exact style — only some styles have hand-tuned rows; others fall back to family weights. */
type ExactStyleWeightRow = Partial<
  Record<Exclude<CitationStyle, 'auto' | 'unknown'>, SignalWeightTable>
>;

export const EXACT_STYLE_SIGNAL_WEIGHTS: Record<
  Exclude<StyleFamily, 'unknown' | 'web_accessed'>,
  ExactStyleWeightRow
> = {
  author_date: {
    apa7: {
      year_parenthesized_after_authors: 3.0,
      year_bare_after_authors: 0.9,
      ieee_incompatible_author_date_year_placement: 0.65,
      author_initials_surname: 0.8,
      author_separator_ampersand: 0.5,
      author_separator_and: 0.4,
      cue_journal: 0.35,
      title_sentence_case: 0.8,
      title_followed_by_period: 0.4,
      punctuation_period_dense: 0.4,
    },
    'harvard-ctr': {
      year_bare_after_authors: 3.2,
      ieee_incompatible_author_date_year_placement: 0.15,
      author_initials_surname: 0.8,
      title_sentence_case: 0.7,
      punctuation_comma_dense: 0.3,
    },
    'chicago-author-date': {
      year_bare_after_authors: 1.5,
      year_early_position: 0.8,
      title_title_case: 0.9,
      title_followed_by_period: 0.5,
      cue_book_publisher: 0.4,
    },
  },
  numeric: {
    vancouver: {
      author_surname_initials: 1.6,
      locator_semicolon_volume_issue_pages: 2.6,
      locator_year_comma_volume_colon_pages: 2.5,
      locator_year_comma_volume_colon_identifier: 2.4,
      identifier_at_end: 0.6,
      identifier_doi_tail_numeric: 1.1,
      cue_journal_abbrev: 0.8,
      capitalization_numeric_minimal: 0.5,
      year_repeated_conference: 0.3,
    },
    ieee: {
      bracketed_enumerator: 0.8,
      author_initials_surname: 0.9,
      quoted_title: 1.8,
      locator_vol: 0.9,
      locator_no: 0.9,
      locator_pp: 1.1,
      locator_ieee_signature: 3.0,
      ieee_incompatible_author_date_year_placement: -4.5,
      punctuation_comma_dense: 0.5,
    },
    ama: {
      author_surname_initials: 0.9,
      locator_vol: 0.8,
      locator_no: 0.6,
      year_late_position: 0.4,
      capitalization_numeric_minimal: 0.3,
    },
    acs: {
      author_surname_initials: 0.7,
      title_sentence_case: 0.4,
      identifier_doi: 0.5,
      locator_vol: 0.5,
      locator_page_range_only: 0.3,
    },
  },
  notes_bibliography: {
    mla9: {
      quoted_title: 1.8,
      year_late_position: 1.6,
      locator_vol: 0.7,
      locator_no: 0.6,
      locator_pp: 0.7,
      punctuation_comma_dense: 0.5,
      title_title_case: 0.4,
    },
    'chicago-notes-bib': {
      quoted_title: 1.0,
      year_late_position: 0.9,
      title_followed_by_period: 0.6,
      cue_book_publisher: 0.6,
      marker_editor: 0.5,
      punctuation_period_dense: 0.4,
    },
  },
};

export const FAMILY_STRONG_SIGNALS: Record<Exclude<StyleFamily, 'unknown'>, StyleSignalCode[]> = {
  author_date: [
    'year_parenthesized_after_authors',
    'year_bare_after_authors',
    'year_early_position',
    'author_year_lead',
  ],
  numeric: [
    'bracketed_enumerator',
    'numeric_dot_enumerator',
    'numeric_paren_enumerator',
    'locator_semicolon_volume_issue_pages',
    'locator_year_comma_volume_colon_pages',
    'locator_year_comma_volume_colon_identifier',
  ],
  notes_bibliography: ['quoted_title', 'year_late_position'],
  web_accessed: ['identifier_accessed_retrieved', 'web_url_without_scholarly_locators'],
};
