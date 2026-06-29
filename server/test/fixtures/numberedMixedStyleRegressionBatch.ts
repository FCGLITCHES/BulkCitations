import type { CitationStyle, StyleFamily } from '../../src/engine/types/citation.js';

export interface NumberedMixedStyleRegressionCase {
  citation: string;
  expectedStyle: CitationStyle;
  expectedFamily: StyleFamily;
  failureMode:
    | 'numbered_list_false_numeric_bias'
    | 'author_date_group_author_exact_unknown'
    | 'ieee_signature_conflict_dampening'
    | 'placeholder_locator_exact_unknown';
  provenance: string;
}

export const NUMBERED_MIXED_STYLE_REGRESSION_CASES: NumberedMixedStyleRegressionCase[] = [
  {
    citation:
      '1. SHOJI, Mamoru, & Group, LHD Experiment (2020). Radiation Resistant Camera System for Monitoring Deuterium Plasma Discharges in the Large Helical Device. Plasma and Fusion Research, 15(0), 2402039.',
    expectedStyle: 'apa7',
    expectedFamily: 'author_date',
    failureMode: 'author_date_group_author_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '2. Mamoru SHOJI and LHD Experiment Group, "Radiation Resistant Camera System for Monitoring Deuterium Plasma Discharges in the Large Helical Device," Plasma and Fusion Research, vol. 15, no. 0, pp. 2402039, 2020.',
    expectedStyle: 'ieee',
    expectedFamily: 'numeric',
    failureMode: 'ieee_signature_conflict_dampening',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '3. SHOJI M, Group LHDE. Radiation Resistant Camera System for Monitoring Deuterium Plasma Discharges in the Large Helical Device. Plasma and Fusion Research. 2020;15(0):2402039.',
    expectedStyle: 'vancouver',
    expectedFamily: 'numeric',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '4. SHOJI, Mamoru and Group, LHDExperiment, 2020. Radiation Resistant Camera System for Monitoring Deuterium Plasma Discharges in the Large Helical Device. Plasma and Fusion Research, 15(0), pp.2402039.',
    expectedStyle: 'harvard-ctr',
    expectedFamily: 'author_date',
    failureMode: 'author_date_group_author_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '5. SHOJI, Mamoru, and LHD Experiment Group. "Radiation Resistant Camera System for Monitoring Deuterium Plasma Discharges in the Large Helical Device." Plasma and Fusion Research, vol. 15, no. 0, 2020, pp. 2402039.',
    expectedStyle: 'mla9',
    expectedFamily: 'notes_bibliography',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '6. SHOJI, Mamoru, and LHD Experiment Group. "Radiation Resistant Camera System for Monitoring Deuterium Plasma Discharges in the Large Helical Device." Plasma and Fusion Research 15, no. 0 (2020): 2402039.',
    expectedStyle: 'chicago-notes-bib',
    expectedFamily: 'notes_bibliography',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '7. Lowry, OliverH., Rosebrough, NiraJ., Farr, A. Lewis, & Randall, RoseJ. (1951). PROTEIN MEASUREMENT WITH THE FOLIN PHENOL REAGENT. Journal of Biological Chemistry, 193(1), 265-275.',
    expectedStyle: 'apa7',
    expectedFamily: 'author_date',
    failureMode: 'author_date_group_author_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '8. OliverH. Lowry, NiraJ. Rosebrough, A. Lewis Farr, and RoseJ. Randall, "PROTEIN MEASUREMENT WITH THE FOLIN PHENOL REAGENT," Journal of Biological Chemistry, vol. 193, no. 1, pp. 265-275, 1951.',
    expectedStyle: 'ieee',
    expectedFamily: 'numeric',
    failureMode: 'ieee_signature_conflict_dampening',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '9. Lowry OH, Rosebrough NJ, Farr AL, Randall RJ. PROTEIN MEASUREMENT WITH THE FOLIN PHENOL REAGENT. Journal of Biological Chemistry. 1951;193(1):265-275.',
    expectedStyle: 'vancouver',
    expectedFamily: 'numeric',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '10. Lowry, OliverH., Rosebrough, NiraJ., Farr, A.Lewis and Randall, RoseJ., 1951. PROTEIN MEASUREMENT WITH THE FOLIN PHENOL REAGENT. Journal of Biological Chemistry, 193(1), pp.265-275.',
    expectedStyle: 'harvard-ctr',
    expectedFamily: 'author_date',
    failureMode: 'author_date_group_author_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '11. Lowry, OliverH., NiraJ. Rosebrough, A. Lewis Farr, and RoseJ. Randall. "PROTEIN MEASUREMENT WITH THE FOLIN PHENOL REAGENT." Journal of Biological Chemistry, vol. 193, no. 1, 1951, pp. 265-275.',
    expectedStyle: 'mla9',
    expectedFamily: 'notes_bibliography',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '12. Lowry, OliverH., NiraJ. Rosebrough, A. Lewis Farr, and RoseJ. Randall. "PROTEIN MEASUREMENT WITH THE FOLIN PHENOL REAGENT." Journal of Biological Chemistry 193, no. 1 (1951): 265-275.',
    expectedStyle: 'chicago-notes-bib',
    expectedFamily: 'notes_bibliography',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '13. LAEMMLI, U. K. (1970). Cleavage of Structural Proteins during the Assembly of the Head of Bacteriophage T4. Nature, 227(5259), 680-685.',
    expectedStyle: 'apa7',
    expectedFamily: 'author_date',
    failureMode: 'author_date_group_author_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '14. U. K. LAEMMLI, "Cleavage of Structural Proteins during the Assembly of the Head of Bacteriophage T4," Nature, vol. 227, no. 5259, pp. 680-685, 1970.',
    expectedStyle: 'ieee',
    expectedFamily: 'numeric',
    failureMode: 'ieee_signature_conflict_dampening',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '15. LAEMMLI UK. Cleavage of Structural Proteins during the Assembly of the Head of Bacteriophage T4. Nature. 1970;227(5259):680-685.',
    expectedStyle: 'vancouver',
    expectedFamily: 'numeric',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '16. LAEMMLI, U.K., 1970. Cleavage of Structural Proteins during the Assembly of the Head of Bacteriophage T4. Nature, 227(5259), pp.680-685.',
    expectedStyle: 'harvard-ctr',
    expectedFamily: 'author_date',
    failureMode: 'author_date_group_author_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '17. LAEMMLI, U. K.. "Cleavage of Structural Proteins during the Assembly of the Head of Bacteriophage T4." Nature, vol. 227, no. 5259, 1970, pp. 680-685.',
    expectedStyle: 'mla9',
    expectedFamily: 'notes_bibliography',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '18. LAEMMLI, U. K.. "Cleavage of Structural Proteins during the Assembly of the Head of Bacteriophage T4." Nature 227, no. 5259 (1970): 680-685.',
    expectedStyle: 'chicago-notes-bib',
    expectedFamily: 'notes_bibliography',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '25. He, Kaiming, Zhang, Xiangyu, Ren, Shaoqing, & Sun, Jian (2016). Deep Residual Learning for Image Recognition. Journal, ?, 770-778.',
    expectedStyle: 'apa7',
    expectedFamily: 'author_date',
    failureMode: 'placeholder_locator_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '26. Kaiming He, Xiangyu Zhang, Shaoqing Ren, and Jian Sun, "Deep Residual Learning for Image Recognition," Journal, vol. ?, pp. 770-778, 2016.',
    expectedStyle: 'ieee',
    expectedFamily: 'numeric',
    failureMode: 'placeholder_locator_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '27. He K, Zhang X, Ren S, Sun J. Deep Residual Learning for Image Recognition. Journal. 2016;?:770-778.',
    expectedStyle: 'vancouver',
    expectedFamily: 'numeric',
    failureMode: 'placeholder_locator_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '28. He, Kaiming, Zhang, Xiangyu, Ren, Shaoqing and Sun, Jian, 2016. Deep Residual Learning for Image Recognition. Journal, ?, pp.770-778.',
    expectedStyle: 'harvard-ctr',
    expectedFamily: 'author_date',
    failureMode: 'placeholder_locator_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '29. He, Kaiming, Xiangyu Zhang, Shaoqing Ren, and Jian Sun. "Deep Residual Learning for Image Recognition." Journal, vol. ?, 2016, pp. 770-778.',
    expectedStyle: 'mla9',
    expectedFamily: 'notes_bibliography',
    failureMode: 'placeholder_locator_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '30. He, Kaiming, Xiangyu Zhang, Shaoqing Ren, and Jian Sun. "Deep Residual Learning for Image Recognition." Journal ? (2016): 770-778.',
    expectedStyle: 'chicago-notes-bib',
    expectedFamily: 'notes_bibliography',
    failureMode: 'placeholder_locator_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '43. Livak, Kenneth J., & Schmittgen, Thomas D. (2001). Analysis of Relative Gene Expression Data Using Real-Time Quantitative PCR and the 2−ΔΔCT Method. Methods, 25(4), 402-408.',
    expectedStyle: 'apa7',
    expectedFamily: 'author_date',
    failureMode: 'author_date_group_author_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '44. Kenneth J. Livak and Thomas D. Schmittgen, "Analysis of Relative Gene Expression Data Using Real-Time Quantitative PCR and the 2−ΔΔCT Method," Methods, vol. 25, no. 4, pp. 402-408, 2001.',
    expectedStyle: 'ieee',
    expectedFamily: 'numeric',
    failureMode: 'ieee_signature_conflict_dampening',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '45. Livak KJ, Schmittgen TD. Analysis of Relative Gene Expression Data Using Real-Time Quantitative PCR and the 2−ΔΔCT Method. Methods. 2001;25(4):402-408.',
    expectedStyle: 'vancouver',
    expectedFamily: 'numeric',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '46. Livak, KennethJ. and Schmittgen, ThomasD., 2001. Analysis of Relative Gene Expression Data Using Real-Time Quantitative PCR and the 2−ΔΔCT Method. Methods, 25(4), pp.402-408.',
    expectedStyle: 'harvard-ctr',
    expectedFamily: 'author_date',
    failureMode: 'author_date_group_author_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '47. Livak, Kenneth J., and Thomas D. Schmittgen. "Analysis of Relative Gene Expression Data Using Real-Time Quantitative PCR and the 2−ΔΔCT Method." Methods, vol. 25, no. 4, 2001, pp. 402-408.',
    expectedStyle: 'mla9',
    expectedFamily: 'notes_bibliography',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '48. Livak, Kenneth J., and Thomas D. Schmittgen. "Analysis of Relative Gene Expression Data Using Real-Time Quantitative PCR and the 2−ΔΔCT Method." Methods 25, no. 4 (2001): 402-408.',
    expectedStyle: 'chicago-notes-bib',
    expectedFamily: 'notes_bibliography',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '61. Kresse, G., & Furthmüller, J. (1996). Efficient iterative schemes for<i>ab initio</i>total-energy calculations using a plane-wave basis set. Physical review. B, Condensed matter, 54(16), 11169-11186.',
    expectedStyle: 'apa7',
    expectedFamily: 'author_date',
    failureMode: 'author_date_group_author_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '62. G. Kresse and J. Furthmüller, "Efficient iterative schemes for<i>ab initio</i>total-energy calculations using a plane-wave basis set," Physical review. B, Condensed matter, vol. 54, no. 16, pp. 11169-11186, 1996.',
    expectedStyle: 'ieee',
    expectedFamily: 'numeric',
    failureMode: 'ieee_signature_conflict_dampening',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '63. Kresse G, Furthmüller J. Efficient iterative schemes for<i>ab initio</i>total-energy calculations using a plane-wave basis set. Physical review. B, Condensed matter. 1996;54(16):11169-11186.',
    expectedStyle: 'vancouver',
    expectedFamily: 'numeric',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '64. Kresse, G. and Furthmüller, J., 1996. Efficient iterative schemes for<i>ab initio</i>total-energy calculations using a plane-wave basis set. Physical review. B, Condensed matter, 54(16), pp.11169-11186.',
    expectedStyle: 'harvard-ctr',
    expectedFamily: 'author_date',
    failureMode: 'author_date_group_author_exact_unknown',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '65. Kresse, G., and J. Furthmüller. "Efficient iterative schemes for<i>ab initio</i>total-energy calculations using a plane-wave basis set." Physical review. B, Condensed matter, vol. 54, no. 16, 1996, pp. 11169-11186.',
    expectedStyle: 'mla9',
    expectedFamily: 'notes_bibliography',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
  {
    citation:
      '66. Kresse, G., and J. Furthmüller. "Efficient iterative schemes for<i>ab initio</i>total-energy calculations using a plane-wave basis set." Physical review. B, Condensed matter 54, no. 16 (1996): 11169-11186.',
    expectedStyle: 'chicago-notes-bib',
    expectedFamily: 'notes_bibliography',
    failureMode: 'numbered_list_false_numeric_bias',
    provenance: 'user_batch_2026_04_05',
  },
];

export const NUMBERED_MIXED_STYLE_REGRESSION_INPUT = NUMBERED_MIXED_STYLE_REGRESSION_CASES
  .map((entry) => entry.citation)
  .join('\n');

export const EXPECTED_NUMBERED_MIXED_STYLE_REGRESSION_BLOCK_COUNT =
  NUMBERED_MIXED_STYLE_REGRESSION_CASES.length;
