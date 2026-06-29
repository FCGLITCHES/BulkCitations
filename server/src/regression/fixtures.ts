import type { ConvertRequest } from '../engine/types/api.js';
import type { CitationStyle, StyleFamily } from '../engine/types/citation.js';
import type { InputCleanupDecisionReason } from '../engine/types/ingestion.js';
import type { PipelineOptions } from '../engine/types/pipeline.js';

export interface RegressionCase {
  id: string;
  suite: string;
  input: ConvertRequest;
  pipelineOptions?: Partial<PipelineOptions>;
  approvedTruthSeed?: Array<{
    rawText: string;
    expectedFields: Record<string, unknown>;
    expectedType?: string | null;
    expectedStyle?: string | null;
    trustLevel?: 'draft' | 'reviewed' | 'gold';
    reviewedBy?: string | null;
    provenance?: string | null;
  }>;
  expected: {
    total: number;
    titleIncludes?: string;
    renderedIncludes?: string | string[];
    duplicateGroupCount?: number;
    authorityFlag?: string;
    authorCount?: number;
    excludeStage?: string;
    publicStatus?: 'ready' | 'needs_review' | 'needs_action';
    healthReasonIncludes?: string;
    warningCodeIncludes?: string;
    warningCodeExcludes?: string;
    rawScoreMin?: number;
    rawScoreMax?: number;
    displayScoreMin?: number;
    displayScoreMax?: number;
    displayLowerThanRaw?: boolean;
    rawDisplayDeltaMin?: number;
    renderedExcludes?: string | string[];
    detectedStyle?: CitationStyle;
    detectedStyleFamily?: StyleFamily;
    inputStyleUncertain?: boolean;
    effectiveStyle?: CitationStyle;
    effectiveDetectionConfidenceMin?: number;
    formatScoringPath?: 'guaranteed' | 'fallback';
    contentCorrectnessScoreMin?: number;
    cosmeticFormatScoreMin?: number;
    spacingScoreMin?: number;
    noDuplicatePunctScoreMin?: number;
    titleCaseScoreMin?: number;
    doiVerificationStatus?: 'absent' | 'verified' | 'conflicted' | 'unverified';
    inputCleanupApplied?: boolean;
    inputCleanupDecisionReason?: InputCleanupDecisionReason;
    inputCleanupLookedLikePdfCopy?: boolean;
  };
  failureMode: string;
  provenance: string;
}

const SHARED_OUTPUT_STYLES = [
  'apa7',
  'mla9',
  'chicago-author-date',
  'vancouver',
  'ieee',
  'harvard-ctr',
] as const;

const REAL_CUREUS_JOURNAL_WITHOUT_ISSUE =
  'Jiménez-Luna J, Grisoni F, Weskamp N, Schneider G: Artificial intelligence in drug discovery: recent advances and future perspectives. Expert Opin Drug Discov. 2021, 16:949-59. 10.1080/17460441.2021.1909567';
const REAL_CUREUS_VANCOUVER_COMMA_PAGES =
  'Paul D, Sanap G, Shenoy S, Kalyane D, Kalia K, Tekade RK: Artificial intelligence in drug discovery and development. Drug Discov Today. 2021, 26:80-93. 10.1016/j.drudis.2020.10.010';
const REAL_CUREUS_VANCOUVER_COMMA_IDENTIFIER =
  'Sapoval N, Aghazadeh A, Nute MG, et al.: Current progress and open challenges for applying deep learning across the biosciences. Nat Commun. 2022, 13: 10.1038/s41467-022-29268-7';
const REAL_CUREUS_VANCOUVER_SINGLE_WORD_JOURNAL =
  'Norrby PO: Holistic models of reaction selectivity. Nature. 2019, 571:332-3. 10.1038/d41586-019-02148-9';

export const REGRESSION_FIXTURES: RegressionCase[] = [
  {
    id: 'bare-trailing-doi-recovery',
    suite: 'raw_unstructured',
    input: {
      sourceType: 'text',
      content: 'Gagas, J. (2015). Mouth of Madness. American Book Review, 36(4), 28-29. 10.1353/abr.2015.0061',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      titleIncludes: 'Mouth of Madness',
      renderedIncludes: '10.1353/abr.2015.0061',
    },
    failureMode:
      'A bare trailing DOI (no "doi:"/"https://doi.org/" prefix — the bare_identifier paste pattern) was '
      + 'dropped because extractionFeatures matched the DOI against the *normalized* input, which collapses a '
      + 'bare trailing DOI to a path-less "https://doi.org/" stub, while every other identifier matched the raw '
      + 'input. The raw fallback in extractCitationFeatures recovers it.',
    provenance: 'GROBID head-to-head 2026-06-26 (grobid-pmc noisy-DOI recall 66% -> 98%); real ref American Book Review 36(4)',
  },
  {
    id: 'no-duplicate-pages-placeholder-volume',
    suite: 'raw_unstructured',
    input: {
      sourceType: 'text',
      content: '25. He, Kaiming, Zhang, Xiangyu, Ren, Shaoqing, & Sun, Jian (2016). Deep Residual Learning for Image Recognition. Journal, ?, 770-778.',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      titleIncludes: 'Residual Learning',
      renderedIncludes: '770–778',
      renderedExcludes: ['Journal', '770-778'],
      publicStatus: 'needs_action',
    },
    failureMode:
      'A non-numeric volume placeholder ("?") defeated the structured volume/issue/pages splitter, so the '
      + 'journal field kept the whole tail ("Journal, ?, 770-778"); the locator split then left the literal '
      + 'placeholder "Journal" as the container. Placeholder field values are now cleared before render, so the '
      + 'bogus container is dropped (citation flagged needs_action for the missing journal) and the page range '
      + 'renders exactly once as an en-dash ("770–778"). renderedExcludes guards both the placeholder container '
      + 'and the raw-hyphen duplicate form.',
    provenance: 'User report 2026-06-27 (duplicated pages in rendered citation)',
  },
  {
    id: 'raw-unstructured-shannon-1948',
    suite: 'raw_unstructured',
    input: {
      sourceType: 'text',
      content: 'Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      titleIncludes: 'Mathematical Theory of Communication',
      renderedIncludes: 'Shannon',
      rawScoreMin: 70,
    },
    failureMode: 'raw_unstructured_parse_stability',
    provenance: 'manual',
  },
  {
    id: 'raw-unstructured-pdf-noise-characters',
    suite: 'raw_unstructured',
    input: {
      sourceType: 'text',
      content: 'Shannon,\u200B C. E.\u00A0(1948). A Mathe\uFFFDmatical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.\u0007',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      titleIncludes: 'Mathematical Theory of Communication',
      renderedIncludes: 'Shannon',
      rawScoreMin: 70,
    },
    failureMode: 'raw_unstructured_noise_character_regression',
    provenance: 'manual',
  },
  {
    id: 'pasted-batch-turing-1950',
    suite: 'pasted_text_batches',
    input: {
      sourceType: 'text',
      content: [
        'Turing, A. M. (1950). Computing machinery and intelligence. Mind, 59(236), 433-460.',
        '',
        'Vaswani, A. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30, 5998-6008.',
      ].join('\n'),
      outputStyle: 'apa7',
    },
    expected: {
      total: 2,
      renderedIncludes: 'Turing',
    },
    failureMode: 'pasted_batch_count_drift',
    provenance: 'manual',
  },
  {
    id: 'numbered-batch-mixed-ai',
    suite: 'numbered_multiline',
    input: {
      sourceType: 'text',
      content: [
        '[1] Devlin, J. (2019). BERT: Pre-training of deep bidirectional transformers.',
        '    Proceedings of NAACL-HLT, 4171-4186.',
        '[2] Brown, T. (2020). Language models are few-shot learners.',
        '    Advances in Neural Information Processing Systems, 33, 1877-1901.',
      ].join('\n'),
      outputStyle: 'apa7',
    },
    expected: {
      total: 2,
    },
    failureMode: 'numbered_batch_clumping',
    provenance: 'manual',
  },
  {
    id: 'numbered-bibliography-markers-preserved',
    suite: 'numbered_multiline',
    input: {
      sourceType: 'text',
      content: [
        '[1] Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.',
        '[2] Turing, A. M. (1950). Computing machinery and intelligence. Mind, 59(236), 433-460.',
      ].join('\n'),
      outputStyle: 'apa7',
    },
    pipelineOptions: {
      enrich: false,
      enablePdfCleanup: true,
      pdfCleanupMode: 'full',
    },
    expected: {
      total: 2,
      renderedIncludes: 'Shannon',
      inputCleanupApplied: false,
      inputCleanupDecisionReason: 'not_pdf_like',
      inputCleanupLookedLikePdfCopy: false,
    },
    failureMode: 'numbered_bibliography_marker_preservation',
    provenance: 'manual',
  },
  {
    id: 'pdf-copy-wrapped-doi',
    suite: 'pdf_copy_stress',
    input: {
      sourceType: 'text',
      content: 'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. doi:10.1000/\nexample-study',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      titleIncludes: 'Example study',
      doiVerificationStatus: 'absent',
    },
    failureMode: 'pdf_copy_split_token_artifact',
    provenance: 'manual',
  },
  {
    id: 'pdf-copy-cleanup-selected-real-batch',
    suite: 'pdf_copy_stress',
    input: {
      sourceType: 'text',
      content: [
        '47',
        'Shannon, C. E. (1948). A Mathematic-',
        'al Theory of Communi-',
        'cation. Bell System Technical Journal, 27(3), 379-423.',
        '',
        '48',
        'Turing, A. M. (1950). Computing machinery and intelli-',
        'gence. Mind, 59(236), 433-460.',
      ].join('\n'),
      outputStyle: 'apa7',
    },
    pipelineOptions: {
      enrich: false,
      enablePdfCleanup: true,
      pdfCleanupMode: 'full',
    },
    expected: {
      total: 2,
      titleIncludes: 'Mathematical Theory of Communication',
      inputCleanupApplied: true,
      inputCleanupDecisionReason: 'quality_improved',
      inputCleanupLookedLikePdfCopy: true,
    },
    failureMode: 'pdf_copy_cleanup_selection_regression',
    provenance: 'manual',
  },
  {
    id: 'pdf-copy-cleanup-equal-noise-keeps-baseline',
    suite: 'pdf_copy_stress',
    input: {
      sourceType: 'text',
      content: [
        '47',
        'Shannon, C. E. (1948). A Mathematical Theory of Communication.',
        'Bell System Technical Journal, 27(3), 379-423.',
        '',
        '48',
        'Turing, A. M. (1950). Computing machinery and intelligence.',
        'Mind, 59(236), 433-460.',
      ].join('\n'),
      outputStyle: 'apa7',
    },
    pipelineOptions: {
      enrich: false,
      enablePdfCleanup: true,
      pdfCleanupMode: 'full',
    },
    expected: {
      total: 2,
      inputCleanupApplied: false,
      inputCleanupDecisionReason: 'equal_or_noise',
      inputCleanupLookedLikePdfCopy: true,
    },
    failureMode: 'pdf_copy_cleanup_noise_guard_regression',
    provenance: 'manual',
  },
  {
    id: 'pdf-copy-numbered-footer-artifact-drug-discovery-batch',
    suite: 'pdf_copy_stress',
    input: {
      sourceType: 'text',
      content: [
        '1. Jiménez-Luna J, Grisoni F, Weskamp N, Schneider G: Artificial intelligence in drug discovery: recent',
        'advances and future perspectives. Expert Opin Drug Discov. 2021, 16:949-59.',
        '10.1080/17460441.2021.1909567',
        '',
        '2. Paul D, Sanap G, Shenoy S, Kalyane D, Kalia K, Tekade RK: Artificial intelligence in drug discovery and',
        'development. Drug Discov Today. 2021, 26:80-93. 10.1016/j.drudis.2020.10.010',
        '',
        '3. Sapoval N, Aghazadeh A, Nute MG, et al.: Current progress and open challenges for applying deep learning',
        'across the biosciences. Nat Commun. 2022, 13: 10.1038/s41467-022-29268-7',
        '2023 Singh et al. Cureus 15(8): e44359. DOI 10.7759/cureus.44359 15 of 17',
        '',
        '4. Kim H, Kim E, Lee I, Bae B, Park M, Nam H: Artificial intelligence in drug discovery: a comprehensive review',
        'of data-driven and machine learning approaches. Biotechnol Bioprocess Eng. 2020, 25:895-930.',
        '10.1007/s12257-020-0049-y',
      ].join('\n'),
      outputStyle: 'apa7',
    },
    expected: {
      total: 4,
      renderedIncludes: 'Artificial intelligence in drug discovery',
      renderedExcludes: 'Cureus 15(8): e44359',
    },
    failureMode: 'pdf_footer_page_counter_numbered_batch_clumping',
    provenance: 'manual',
  },
  {
    id: 'doi-fastpath-attention',
    suite: 'doi_fast_path',
    input: {
      sourceType: 'doi_list',
      content: '10.1000/vaswani-2017-attention-is-all-you-need',
      outputStyle: 'apa7',
    },
    approvedTruthSeed: [
      {
        rawText: '10.1000/vaswani-2017-attention-is-all-you-need',
        expectedFields: {
          doi: '10.1000/vaswani-2017-attention-is-all-you-need',
          title: 'Attention Is All You Need',
          authors: ['Vaswani, A.'],
          year: 2017,
          conferenceTitle: 'Advances in Neural Information Processing Systems',
          pages: '5998-6008',
        },
        expectedType: 'conference-paper',
        expectedStyle: 'apa7',
        trustLevel: 'gold',
        reviewedBy: 'regression-test',
        provenance: 'approved_truth_seed',
      },
    ],
    expected: {
      total: 1,
      titleIncludes: 'Attention Is All You Need',
      excludeStage: 'splitting',
    },
    failureMode: 'doi_fastpath_stage_leak',
    provenance: 'manual',
  },
  {
    id: 'doi-fastpath-real-report-number-and-url-survive-render',
    suite: 'doi_fast_path',
    input: {
      sourceType: 'doi_list',
      content: '10.3386/w14448',
      outputStyle: 'apa7',
    },
    approvedTruthSeed: [
      {
        rawText: '10.3386/w14448',
        expectedFields: {
          doi: '10.3386/w14448',
          title: 'Post-1500 Population Flows and the Long Run Determinants of Economic Growth and Inequality',
          authors: ['Louis Putterman', 'David Weil'],
          year: 2008,
          institution: 'National Bureau of Economic Research',
          publisher: 'National Bureau of Economic Research',
          placeOfPublication: 'Cambridge, MA',
          reportNumber: 'w14448',
          url: 'http://www.nber.org/papers/w14448.pdf',
        },
        expectedType: 'report',
        expectedStyle: 'apa7',
        trustLevel: 'gold',
        reviewedBy: 'regression-test',
        provenance: 'benchmarks/grobid-pmc/corpus/raw_sources/crossref.report.json',
      },
    ],
    expected: {
      total: 1,
      titleIncludes: 'Post-1500 Population Flows',
      renderedIncludes: [
        'w14448',
        'Cambridge, MA',
        'https://doi.org/10.3386/w14448',
        'http://www.nber.org/papers/w14448.pdf',
      ],
      publicStatus: 'ready',
      warningCodeExcludes: 'render_eligible_field_omitted',
      doiVerificationStatus: 'verified',
    },
    failureMode: 'real_report_number_and_distinct_url_lost_during_render',
    provenance: 'benchmarks/grobid-pmc/corpus/raw_sources/crossref.report.json',
  },
  {
    id: 'doi-fastpath-real-journal-issn-survives-render',
    suite: 'doi_fast_path',
    input: {
      sourceType: 'doi_list',
      content: '10.17116/rosstomat20251801140',
      outputStyle: 'apa7',
    },
    approvedTruthSeed: [
      {
        rawText: '10.17116/rosstomat20251801140',
        expectedFields: {
          doi: '10.17116/rosstomat20251801140',
          title: 'Substantiation of the anti-inflammatory effect of photodynamic therapy in periodontal diseases',
          authors: ['O.N. Risovannaya', 'T.Sh. Andreasyan', 'N.A. Guseynov'],
          year: 2025,
          journal: 'Russian Journal of Stomatology',
          volume: '18',
          issue: '1',
          pages: '40',
          issn: '2072-6406',
        },
        expectedType: 'article-journal',
        expectedStyle: 'apa7',
        trustLevel: 'gold',
        reviewedBy: 'regression-test',
        provenance: 'benchmarks/grobid-pmc/corpus/raw_sources/crossref.article-journal.json',
      },
    ],
    expected: {
      total: 1,
      titleIncludes: 'Substantiation of the anti-inflammatory effect',
      renderedIncludes: [
        'https://doi.org/10.17116/rosstomat20251801140',
        'ISSN 2072-6406',
      ],
      publicStatus: 'ready',
      warningCodeExcludes: 'render_eligible_field_omitted',
      doiVerificationStatus: 'verified',
    },
    failureMode: 'real_journal_issn_lost_during_render',
    provenance: 'benchmarks/grobid-pmc/corpus/raw_sources/crossref.article-journal.json',
  },
  {
    id: 'doi-fastpath-real-book-isbn-survives-render',
    suite: 'doi_fast_path',
    input: {
      sourceType: 'doi_list',
      content: '10.1007/978-3-319-18938-3',
      outputStyle: 'apa7',
    },
    approvedTruthSeed: [
      {
        rawText: '10.1007/978-3-319-18938-3',
        expectedFields: {
          doi: '10.1007/978-3-319-18938-3',
          title: 'Quantum Microscopy of Biological Systems',
          authors: ['Michael Taylor'],
          year: 2015,
          publisher: 'Springer International Publishing',
          isbn: '9783319189383',
        },
        expectedType: 'book',
        expectedStyle: 'apa7',
        trustLevel: 'gold',
        reviewedBy: 'regression-test',
        provenance: 'benchmarks/grobid-pmc/corpus/raw_sources/crossref.book.json',
      },
    ],
    expected: {
      total: 1,
      titleIncludes: 'Quantum Microscopy of Biological Systems',
      renderedIncludes: [
        'https://doi.org/10.1007/978-3-319-18938-3',
        'ISBN 9783319189383',
      ],
      publicStatus: 'ready',
      warningCodeExcludes: 'render_eligible_field_omitted',
      doiVerificationStatus: 'verified',
    },
    failureMode: 'real_book_isbn_lost_during_render',
    provenance: 'benchmarks/grobid-pmc/corpus/raw_sources/crossref.book.json',
  },
  {
    id: 'duplicate-doi-pair',
    suite: 'duplicate_detection',
    input: {
      sourceType: 'doi_list',
      content: [
        '10.1000/example-duplicate-study',
        '10.1000/example-duplicate-study',
      ].join('\n'),
      outputStyle: 'apa7',
    },
    expected: {
      total: 2,
      duplicateGroupCount: 1,
    },
    failureMode: 'duplicate_cluster_miss',
    provenance: 'manual',
  },
  {
    id: 'duplicate-canonical-work-key-pair',
    suite: 'duplicate_detection',
    input: {
      sourceType: 'text',
      content: [
        '[1] Smith, J. (2020). Example study on AI reliability. Journal of Examples, 12(3), 44-50.',
        '[2] Smith J (2020) Example Study on AI Reliability. Journal of Examples 12(3):44-50.',
      ].join('\n'),
      outputStyle: 'apa7',
    },
    expected: {
      total: 2,
      duplicateGroupCount: 1,
    },
    failureMode: 'duplicate_canonical_work_key_miss',
    provenance: 'manual',
  },
  {
    id: 'retracted-flag-case',
    suite: 'authority_flags',
    input: {
      sourceType: 'text',
      content: 'Smith, J. (2020). Retracted study on examples. Journal of Examples, 12(3), 44-50.',
      outputStyle: 'apa7',
    },
    pipelineOptions: {
      authorityValidation: true,
    },
    expected: {
      total: 1,
      authorityFlag: 'retracted',
      rawScoreMin: 60,
      displayLowerThanRaw: true,
      rawDisplayDeltaMin: 25,
    },
    failureMode: 'authority_retraction_miss',
    provenance: 'manual',
  },
  {
    id: 'website-author-negative',
    suite: 'website_author_negatives',
    input: {
      sourceType: 'text',
      content: 'A guide to T cells. https://example.org/t-cells. Accessed March 2, 2024.',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      authorCount: 0,
    },
    failureMode: 'website_author_false_positive',
    provenance: 'synthetic_negative',
  },
  {
    id: 'health-missing-pages-journal',
    suite: 'health_validation',
    input: {
      sourceType: 'text',
      content: 'Smith, J. (2020). Example study. Journal of Examples, vol. 12, no. 3.',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      publicStatus: 'ready',
      warningCodeIncludes: 'missing_preferred_fields',
    },
    failureMode: 'journal_missing_locator_health_regression',
    provenance: 'synthetic_negative',
  },
  {
    id: 'health-real-cureus-journal-missing-issue-stays-ready',
    suite: 'health_validation',
    input: {
      sourceType: 'text',
      content: REAL_CUREUS_JOURNAL_WITHOUT_ISSUE,
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      warningCodeIncludes: 'missing_preferred_fields',
      renderedIncludes: [
        'Artificial intelligence in drug discovery',
        '*16*',
        '949–959',
        'https://doi.org/10.1080/17460441.2021.1909567',
      ],
    },
    failureMode: 'journal_issue_false_positive_real_batch_regression',
    provenance: 'cureus-drug-discovery-batch',
  },
  ...SHARED_OUTPUT_STYLES
    .filter((style) => style !== 'apa7')
    .map((style): RegressionCase => ({
      id: `health-real-cureus-journal-missing-issue-${style}-stays-ready`,
      suite: 'health_validation',
      input: {
        sourceType: 'text',
        content: REAL_CUREUS_JOURNAL_WITHOUT_ISSUE,
        outputStyle: style,
      },
      expected: {
        total: 1,
        publicStatus: 'ready',
        warningCodeIncludes: 'missing_preferred_fields',
      },
      failureMode: 'journal_issue_false_positive_cross_output_regression',
      provenance: 'cureus-drug-discovery-batch',
    })),
  {
    id: 'health-invalid-year-journal',
    suite: 'health_validation',
    input: {
      sourceType: 'text',
      content: 'Smith, J. (3026). Example study. Journal of Examples, 12(3), 44-50.',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      publicStatus: 'needs_action',
      healthReasonIncludes: 'invalid year value',
    },
    failureMode: 'invalid_year_health_regression',
    provenance: 'synthetic_negative',
  },
  {
    id: 'health-lone-author-webpage',
    suite: 'health_validation',
    input: {
      sourceType: 'text',
      content: 'J. (2024). T cell guide. https://example.org/t-cells. Accessed March 2, 2024.',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      publicStatus: 'ready',
    },
    failureMode: 'lone_author_artifact_health_regression',
    provenance: 'synthetic_negative',
  },
  {
    id: 'mixed-style-batch',
    suite: 'mixed_style',
    input: {
      sourceType: 'text',
      content: [
        'Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.',
        '',
        '[2] Doe, A. Example engineering paper. Journal of Examples. 2020;12(3):44-50.',
      ].join('\n'),
      outputStyle: 'apa7',
    },
    expected: {
      total: 2,
    },
    failureMode: 'mixed_style_split_or_style_regression',
    provenance: 'manual',
  },
  {
    id: 'style-detect-apa-shannon',
    suite: 'style_detection',
    input: {
      sourceType: 'text',
      content: 'Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.',
      outputStyle: 'auto',
    },
    expected: {
      total: 1,
      detectedStyleFamily: 'author_date',
      detectedStyle: 'apa7',
      inputStyleUncertain: false,
    },
    failureMode: 'style_detection_author_date_apa_regression',
    provenance: 'manual',
  },
  {
    id: 'style-detect-harvard-bare-year',
    suite: 'style_detection',
    input: {
      sourceType: 'text',
      content: 'Smith, J., 2020. Example study. Journal of Examples, 12(3), pp. 44-50.',
      outputStyle: 'auto',
    },
    expected: {
      total: 1,
      detectedStyleFamily: 'author_date',
      detectedStyle: 'harvard-ctr',
      inputStyleUncertain: false,
    },
    failureMode: 'style_detection_author_date_harvard_regression',
    provenance: 'manual',
  },
  {
    id: 'style-detect-chicago-author-date',
    suite: 'style_detection',
    input: {
      sourceType: 'text',
      content: 'Smith, John. 2020. Example Study. Journal of Examples 12 (3): 44-50.',
      outputStyle: 'auto',
    },
    expected: {
      total: 1,
      detectedStyleFamily: 'author_date',
      detectedStyle: 'chicago-author-date',
      inputStyleUncertain: false,
    },
    failureMode: 'style_detection_chicago_author_date_regression',
    provenance: 'manual',
  },
  {
    id: 'style-detect-ieee-bracketed',
    suite: 'style_detection',
    input: {
      sourceType: 'text',
      content: '[1] A. Doe, "Circuit paper," Journal of Testing, vol. 4, no. 2, pp. 10-14, 2022.',
      outputStyle: 'auto',
    },
    expected: {
      total: 1,
      detectedStyleFamily: 'numeric',
      detectedStyle: 'ieee',
      inputStyleUncertain: false,
    },
    failureMode: 'style_detection_ieee_regression',
    provenance: 'manual',
  },
  {
    id: 'style-detect-vancouver-gomes',
    suite: 'style_detection',
    input: {
      sourceType: 'text',
      content: 'Gomes MA, Kovaleski JL, Pagani RN, da Silva VL. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology. 2022 Oct 3;46(7):608-16.',
      outputStyle: 'auto',
    },
    expected: {
      total: 1,
      detectedStyleFamily: 'numeric',
      detectedStyle: 'vancouver',
      inputStyleUncertain: false,
    },
    failureMode: 'style_detection_vancouver_regression',
    provenance: 'manual',
  },
  {
    id: 'style-detect-vancouver-cureus-comma-pages',
    suite: 'style_detection',
    input: {
      sourceType: 'text',
      content: REAL_CUREUS_VANCOUVER_COMMA_PAGES,
      outputStyle: 'auto',
    },
    expected: {
      total: 1,
      detectedStyleFamily: 'numeric',
      detectedStyle: 'vancouver',
      inputStyleUncertain: false,
    },
    failureMode: 'style_detection_real_batch_biomedical_comma_pages_regression',
    provenance: 'cureus-drug-discovery-batch',
  },
  {
    id: 'style-detect-vancouver-cureus-comma-identifier',
    suite: 'style_detection',
    input: {
      sourceType: 'text',
      content: REAL_CUREUS_VANCOUVER_COMMA_IDENTIFIER,
      outputStyle: 'auto',
    },
    expected: {
      total: 1,
      detectedStyleFamily: 'numeric',
      detectedStyle: 'vancouver',
      inputStyleUncertain: false,
    },
    failureMode: 'style_detection_real_batch_biomedical_comma_identifier_regression',
    provenance: 'cureus-drug-discovery-batch',
  },
  {
    id: 'style-detect-vancouver-cureus-single-word-journal',
    suite: 'style_detection',
    input: {
      sourceType: 'text',
      content: REAL_CUREUS_VANCOUVER_SINGLE_WORD_JOURNAL,
      outputStyle: 'auto',
    },
    expected: {
      total: 1,
      detectedStyleFamily: 'numeric',
      detectedStyle: 'vancouver',
      inputStyleUncertain: false,
    },
    failureMode: 'style_detection_real_batch_single_word_journal_regression',
    provenance: 'cureus-drug-discovery-batch',
  },
  {
    id: 'style-detect-web-accessed-family',
    suite: 'style_detection',
    input: {
      sourceType: 'text',
      content: 'World Health Organization. T cell guidance. https://www.who.int/news-room/fact-sheets/detail/t-cells. Accessed March 2, 2024.',
      outputStyle: 'auto',
    },
    expected: {
      total: 1,
      detectedStyleFamily: 'web_accessed',
      detectedStyle: 'unknown',
      inputStyleUncertain: true,
    },
    failureMode: 'style_detection_web_accessed_regression',
    provenance: 'manual',
  },
  {
    id: 'style-detect-unknown-input-defaults-effective-apa7',
    suite: 'style_detection',
    input: {
      sourceType: 'text',
      content: 'World Health Organization. T cell guidance. https://www.who.int/news-room/fact-sheets/detail/t-cells. Accessed March 2, 2024.',
      outputStyle: 'auto',
    },
    expected: {
      total: 1,
      detectedStyleFamily: 'web_accessed',
      detectedStyle: 'unknown',
      inputStyleUncertain: true,
      effectiveStyle: 'apa7',
      renderedIncludes: [
        'Retrieved March 2, 2024',
        'https://www.who.int/news-room/fact-sheets/detail/t-cells',
      ],
      warningCodeExcludes: 'style_unknown',
    },
    failureMode: 'unknown_input_default_render_style_regression',
    provenance: 'manual',
  },
  {
    id: 'style-detect-family-only-numeric',
    suite: 'style_detection',
    input: {
      sourceType: 'text',
      content: '1. Smith J, Doe A. Example study. J Examples. 2020, 12(3), 44-50.',
      outputStyle: 'auto',
    },
    expected: {
      total: 1,
      detectedStyleFamily: 'numeric',
      detectedStyle: 'unknown',
      inputStyleUncertain: true,
    },
    failureMode: 'style_detection_numeric_family_only_regression',
    provenance: 'manual',
  },
  {
    id: 'style-detect-sparse-vancouver-stays-family-only',
    suite: 'style_detection',
    input: {
      sourceType: 'text',
      content: 'Smith J. Article title. J Med. 2023;45:100.',
      outputStyle: 'auto',
    },
    expected: {
      total: 1,
      detectedStyleFamily: 'numeric',
      detectedStyle: 'unknown',
      inputStyleUncertain: true,
    },
    failureMode: 'style_detection_numeric_overcommitment_regression',
    provenance: 'manual',
  },
  {
    id: 'style-detect-parenthesized-author-date-stays-family-only-without-apa-punctuation',
    suite: 'style_detection',
    input: {
      sourceType: 'text',
      content: 'Smith J (2023) Article title. Journal of Medicine 45(2):100-110.',
      outputStyle: 'auto',
    },
    expected: {
      total: 1,
      detectedStyleFamily: 'author_date',
      detectedStyle: 'unknown',
      inputStyleUncertain: true,
    },
    failureMode: 'style_detection_author_date_overcommitment_regression',
    provenance: 'manual',
  },
  {
    id: 'heuristic-text-format-high-example-study',
    suite: 'scoring_v2',
    input: {
      sourceType: 'text',
      content: 'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. doi:10.1000/example-study',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      titleIncludes: 'Example study',
      warningCodeExcludes: 'style_unknown',
      effectiveStyle: 'apa7',
      effectiveDetectionConfidenceMin: 0.9,
      formatScoringPath: 'guaranteed',
      contentCorrectnessScoreMin: 0.95,
      cosmeticFormatScoreMin: 0.95,
      spacingScoreMin: 1,
      noDuplicatePunctScoreMin: 1,
      titleCaseScoreMin: 1,
      doiVerificationStatus: 'absent',
    },
    failureMode: 'heuristics_mode_format_under_scored',
    provenance: 'manual',
  },
  {
    id: 'heuristic-text-wrong-doi-neunet-suppressed',
    suite: 'scoring_v2',
    input: {
      sourceType: 'text',
      content: 'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. doi:https://doi.org/10.1016/j.neunet.2025.108137',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      renderedExcludes: 'https://doi.org/10.1016/j.neunet.2025.108137',
      effectiveStyle: 'apa7',
      effectiveDetectionConfidenceMin: 0.9,
      doiVerificationStatus: 'absent',
      spacingScoreMin: 1,
      noDuplicatePunctScoreMin: 1,
    },
    failureMode: 'incorrect_doi_neunet_suppressed',
    provenance: 'manual',
  },
  {
    id: 'heuristic-text-wrong-doi-taylor-suppressed',
    suite: 'scoring_v2',
    input: {
      sourceType: 'text',
      content: 'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. doi:https://doi.org/10.1201/9781315389325-7',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      renderedExcludes: 'https://doi.org/10.1201/9781315389325-7',
      effectiveStyle: 'apa7',
      effectiveDetectionConfidenceMin: 0.9,
      doiVerificationStatus: 'absent',
      spacingScoreMin: 1,
      noDuplicatePunctScoreMin: 1,
    },
    failureMode: 'incorrect_doi_taylor_suppressed',
    provenance: 'manual',
  },
  {
    id: 'heuristic-text-gomes-vancouver-pages-expanded',
    suite: 'scoring_v2',
    input: {
      sourceType: 'text',
      content: 'Gomes MA, Kovaleski JL, Pagani RN, da Silva VL. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology. 2022 Oct 3;46(7):608-16.',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      publicStatus: 'ready',
      renderedIncludes: [
        '*46*(7)',
        '608–616',
      ],
      warningCodeExcludes: 'input_style_uncertain',
      effectiveStyle: 'apa7',
      effectiveDetectionConfidenceMin: 0.9,
      formatScoringPath: 'guaranteed',
      contentCorrectnessScoreMin: 0.99,
      cosmeticFormatScoreMin: 0.99,
      spacingScoreMin: 1,
      noDuplicatePunctScoreMin: 1,
      titleCaseScoreMin: 1,
      rawScoreMin: 85,
      doiVerificationStatus: 'absent',
    },
    failureMode: 'vancouver_abbreviated_pages_and_style_uncertainty_regression',
    provenance: 'manual',
  },
  {
    id: 'heuristic-text-paul-drug-discovery-doi-and-pages-survive-render',
    suite: 'scoring_v2',
    input: {
      sourceType: 'text',
      content: REAL_CUREUS_VANCOUVER_COMMA_PAGES,
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      publicStatus: 'ready',
      renderedIncludes: [
        '*26*',
        '80–93',
        'https://doi.org/10.1016/j.drudis.2020.10.010',
      ],
      warningCodeExcludes: 'input_style_uncertain',
      effectiveStyle: 'apa7',
      effectiveDetectionConfidenceMin: 0.9,
      formatScoringPath: 'guaranteed',
      contentCorrectnessScoreMin: 0.99,
      cosmeticFormatScoreMin: 0.99,
      spacingScoreMin: 1,
      noDuplicatePunctScoreMin: 1,
      titleCaseScoreMin: 1,
      rawScoreMin: 85,
    },
    failureMode: 'real_batch_volume_locator_and_doi_render_regression',
    provenance: 'cureus-drug-discovery-batch',
  },
  {
    id: 'heuristic-text-mccoy-e-locator-survives-render',
    suite: 'scoring_v2',
    input: {
      sourceType: 'text',
      content: 'McCoy, L. G., Banja, J. D., Ghassemi, M., & Celi, L. A. (2020). Ensuring machine learning for healthcare works for all. BMJ Health & Care Informatics, 27(3), e100237.',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      publicStatus: 'ready',
      renderedIncludes: [
        '*27*(3)',
        'e100237',
      ],
      warningCodeExcludes: 'input_style_uncertain',
      effectiveStyle: 'apa7',
      effectiveDetectionConfidenceMin: 0.9,
      formatScoringPath: 'guaranteed',
      contentCorrectnessScoreMin: 0.99,
      cosmeticFormatScoreMin: 0.99,
      spacingScoreMin: 1,
      noDuplicatePunctScoreMin: 1,
      titleCaseScoreMin: 1,
      rawScoreMin: 85,
      doiVerificationStatus: 'absent',
    },
    failureMode: 'e_locator_render_survival_regression',
    provenance: 'manual',
  },
  {
    id: 'heuristic-text-shailaja-conference-title-cleanup',
    suite: 'scoring_v2',
    input: {
      sourceType: 'text',
      content: 'Shailaja K, Seetharamulu B, Jabbar MA. Machine learning in healthcare: A review. In 2018 Second International Conference on Electronics, Communication and Aerospace Technology (ICECA) 2018 Mar 29 (pp. 910-914). IEEE.',
      outputStyle: 'apa7',
    },
    expected: {
      total: 1,
      publicStatus: 'ready',
      renderedIncludes: [
        'Second International Conference on Electronics, Communication and Aerospace Technology (ICECA)',
        '910–914',
      ],
      renderedExcludes: '2018 Mar 29',
      warningCodeExcludes: 'input_style_uncertain',
      effectiveStyle: 'apa7',
      effectiveDetectionConfidenceMin: 0.9,
      formatScoringPath: 'guaranteed',
      contentCorrectnessScoreMin: 0.99,
      cosmeticFormatScoreMin: 0.99,
      spacingScoreMin: 1,
      noDuplicatePunctScoreMin: 1,
      rawScoreMin: 85,
      doiVerificationStatus: 'absent',
    },
    failureMode: 'conference_title_date_duplication_and_field_selection_regression',
    provenance: 'manual',
  },
  {
    id: 'ieee-guaranteed-style-score-path',
    suite: 'scoring_v2',
    input: {
      sourceType: 'doi_list',
      content: '10.1000/example-study',
      outputStyle: 'ieee',
    },
    approvedTruthSeed: [
      {
        rawText: '10.1000/example-study',
        expectedFields: {
          doi: '10.1000/example-study',
          title: 'Example study',
          authors: ['Smith, J.'],
          year: 2020,
          journal: 'Journal of Examples',
          volume: '12',
          issue: '3',
          pages: '44-50',
        },
        expectedType: 'article-journal',
        expectedStyle: 'ieee',
        trustLevel: 'gold',
        reviewedBy: 'regression-test',
        provenance: 'approved_truth_seed',
      },
    ],
    expected: {
      total: 1,
      renderedIncludes: 'Example',
      publicStatus: 'ready',
      rawScoreMin: 80,
      formatScoringPath: 'guaranteed',
    },
    failureMode: 'ieee_guaranteed_style_score_regression',
    provenance: 'manual',
  },
  {
    id: 'harvard-guaranteed-style-score-path',
    suite: 'scoring_v2',
    input: {
      sourceType: 'doi_list',
      content: '10.1000/example-study',
      outputStyle: 'harvard-ctr',
    },
    approvedTruthSeed: [
      {
        rawText: '10.1000/example-study',
        expectedFields: {
          doi: '10.1000/example-study',
          title: 'Example study',
          authors: ['Smith, J.'],
          year: 2020,
          journal: 'Journal of Examples',
          volume: '12',
          issue: '3',
          pages: '44-50',
        },
        expectedType: 'article-journal',
        expectedStyle: 'harvard-ctr',
        trustLevel: 'gold',
        reviewedBy: 'regression-test',
        provenance: 'approved_truth_seed',
      },
    ],
    expected: {
      total: 1,
      renderedIncludes: 'Example',
      publicStatus: 'ready',
      rawScoreMin: 80,
      formatScoringPath: 'guaranteed',
    },
    failureMode: 'harvard_guaranteed_style_score_regression',
    provenance: 'manual',
  },
  {
    id: 'ama-guaranteed-style-score-path',
    suite: 'scoring_v2',
    input: {
      sourceType: 'doi_list',
      content: '10.1000/example-study',
      outputStyle: 'ama',
    },
    approvedTruthSeed: [
      {
        rawText: '10.1000/example-study',
        expectedFields: {
          doi: '10.1000/example-study',
          title: 'Example study',
          authors: ['Smith, J.'],
          year: 2020,
          journal: 'Journal of Examples',
          volume: '12',
          issue: '3',
          pages: '44-50',
        },
        expectedType: 'article-journal',
        expectedStyle: 'ama',
        trustLevel: 'gold',
        reviewedBy: 'regression-test',
        provenance: 'approved_truth_seed',
      },
    ],
    expected: {
      total: 1,
      renderedIncludes: 'Example',
      rawScoreMin: 85,
      formatScoringPath: 'guaranteed',
      warningCodeExcludes: 'render_style_fallback',
    },
    failureMode: 'guaranteed_style_score_path_regression',
    provenance: 'manual',
  },
];
