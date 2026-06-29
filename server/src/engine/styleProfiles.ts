import type { CitationStyle, ReferenceType } from "./types/citation.js";
import type { ExtractedFields } from "./types/citation.js";
import type { OutputQualityReasonCode } from "./quality/outputQualityStatus.js";

export type StyleProfileId = Exclude<CitationStyle, "auto" | "unknown">;
export type StyleProfileField = keyof ExtractedFields;

export interface StyleProfileRegressionExample {
  name: string;
  input: string;
  expectedIncludes: string[];
  failureMode: string;
}

export interface StyleProfile {
  id: StyleProfileId;
  label: string;
  requiredFieldsByType: Partial<Record<ReferenceType, StyleProfileField[]>>;
  commonRepairRules: string[];
  abstainRules: OutputQualityReasonCode[];
  regressionExamples: StyleProfileRegressionExample[];
}

const defaultArticleFields: StyleProfileField[] = [
  "authors",
  "year",
  "title",
  "journal",
];
const defaultBookFields: StyleProfileField[] = [
  "authors",
  "year",
  "title",
  "publisher",
];
const defaultWebpageFields: StyleProfileField[] = ["title", "url"];

export const STYLE_PROFILES: Record<StyleProfileId, StyleProfile> = {
  apa7: {
    id: "apa7",
    label: "APA 7",
    requiredFieldsByType: {
      "article-journal": defaultArticleFields,
      book: defaultBookFields,
      webpage: defaultWebpageFields,
    },
    commonRepairRules: [
      "sentence_case_title",
      "doi_url_normalization",
      "author_initial_cleanup",
    ],
    abstainRules: [
      "missing_required_field",
      "ambiguous_authors",
      "style_render_issue",
    ],
    regressionExamples: [
      {
        name: "apa7_article_doi_render",
        input:
          "Shannon, C. E. (1948). A mathematical theory of communication. Bell System Technical Journal, 27(3), 379-423. https://doi.org/10.1002/j.1538-7305.1948.tb01338.x",
        expectedIncludes: [
          "Shannon",
          "1948",
          "A mathematical theory of communication",
        ],
        failureMode: "apa7_article_required_fields",
      },
    ],
  },
  mla9: {
    id: "mla9",
    label: "MLA 9",
    requiredFieldsByType: {
      "article-journal": defaultArticleFields,
      book: defaultBookFields,
      webpage: defaultWebpageFields,
    },
    commonRepairRules: [
      "title_case_container",
      "url_cleanup",
      "author_name_order_cleanup",
    ],
    abstainRules: [
      "missing_required_field",
      "ambiguous_authors",
      "style_render_issue",
    ],
    regressionExamples: [],
  },
  "chicago-author-date": {
    id: "chicago-author-date",
    label: "Chicago Author-Date",
    requiredFieldsByType: {
      "article-journal": defaultArticleFields,
      book: defaultBookFields,
      webpage: defaultWebpageFields,
    },
    commonRepairRules: [
      "title_case_container",
      "doi_url_normalization",
      "publisher_cleanup",
    ],
    abstainRules: [
      "missing_required_field",
      "ambiguous_authors",
      "style_render_issue",
    ],
    regressionExamples: [],
  },
  "chicago-notes-bib": {
    id: "chicago-notes-bib",
    label: "Chicago Notes and Bibliography",
    requiredFieldsByType: {
      "article-journal": defaultArticleFields,
      book: defaultBookFields,
      webpage: defaultWebpageFields,
    },
    commonRepairRules: [
      "title_case_container",
      "doi_url_normalization",
      "publisher_cleanup",
    ],
    abstainRules: [
      "missing_required_field",
      "ambiguous_authors",
      "style_render_issue",
    ],
    regressionExamples: [],
  },
  vancouver: {
    id: "vancouver",
    label: "Vancouver",
    requiredFieldsByType: {
      "article-journal": ["authors", "title", "journal", "year"],
      book: ["authors", "title", "publisher", "year"],
      webpage: defaultWebpageFields,
    },
    commonRepairRules: [
      "journal_abbreviation_check",
      "author_initial_cleanup",
      "doi_url_normalization",
    ],
    abstainRules: [
      "missing_required_field",
      "ambiguous_authors",
      "style_render_issue",
    ],
    regressionExamples: [],
  },
  ieee: {
    id: "ieee",
    label: "IEEE",
    requiredFieldsByType: {
      "article-journal": ["authors", "title", "journal", "year"],
      book: ["authors", "title", "publisher", "year"],
      webpage: defaultWebpageFields,
    },
    commonRepairRules: [
      "quoted_title_check",
      "numeric_style_marker_check",
      "doi_url_normalization",
    ],
    abstainRules: [
      "missing_required_field",
      "ambiguous_authors",
      "style_render_issue",
    ],
    regressionExamples: [],
  },
  "harvard-ctr": {
    id: "harvard-ctr",
    label: "Harvard Cite Them Right",
    requiredFieldsByType: {
      "article-journal": defaultArticleFields,
      book: defaultBookFields,
      webpage: defaultWebpageFields,
    },
    commonRepairRules: [
      "sentence_case_title",
      "accessed_date_cleanup",
      "doi_url_normalization",
    ],
    abstainRules: [
      "missing_required_field",
      "ambiguous_authors",
      "style_render_issue",
    ],
    regressionExamples: [],
  },
  ama: {
    id: "ama",
    label: "AMA",
    requiredFieldsByType: {
      "article-journal": ["authors", "title", "journal", "year"],
      book: ["authors", "title", "publisher", "year"],
      webpage: defaultWebpageFields,
    },
    commonRepairRules: [
      "journal_abbreviation_check",
      "author_initial_cleanup",
      "doi_url_normalization",
    ],
    abstainRules: [
      "missing_required_field",
      "ambiguous_authors",
      "style_render_issue",
    ],
    regressionExamples: [],
  },
  acs: {
    id: "acs",
    label: "ACS",
    requiredFieldsByType: {
      "article-journal": ["authors", "title", "journal", "year"],
      book: ["authors", "title", "publisher", "year"],
      webpage: defaultWebpageFields,
    },
    commonRepairRules: [
      "journal_abbreviation_check",
      "author_initial_cleanup",
      "doi_url_normalization",
    ],
    abstainRules: [
      "missing_required_field",
      "ambiguous_authors",
      "style_render_issue",
    ],
    regressionExamples: [],
  },
};

export function getStyleProfile(style: CitationStyle): StyleProfile | null {
  if (style === "auto" || style === "unknown") {
    return null;
  }
  return STYLE_PROFILES[style];
}
