export interface RegressionFixture {
  id: string;
  description: string;
  expectedToFail?: boolean;
  references: string[];
  expectedDetectedStyle?: string;
  expectedDuplicateCount?: number;
  expectedUniqueCount?: number;
  expectedMergedTitle?: string;
  expectedMergedAuthors?: string[];
  expectedOutputText?: string;
  expectedOutputIncludes?: string[];
  expectedReferenceType?: string;
  forbiddenOutputPatterns?: RegExp[];
}

export const regressionFixtures: RegressionFixture[] = [
  {
    id: 'baron-mixed-format-family',
    description: 'Six mixed-style variants of the Baron and Kenny paper should collapse into one duplicate family.',
    references: [
      'Baron, ReubenM. and Kenny, DavidA., 1986. The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.. Journal of Personality and Social Psychology, 51(6), pp.1173-1182.',
      'Baron, Reuben M., and David A. Kenny. "The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.." Journal of Personality and Social Psychology, vol. 51, no. 6, 1986, pp. 1173-1182.',
      'Baron, Reuben M., and David A. Kenny. "The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.." Journal of Personality and Social Psychology 51, no. 6 (1986): 1173-1182.',
      'Baron, Reuben M., & Kenny, David A. (1986). The moderator–mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.. Journal of Personality and Social Psychology, 51(6), 1173-1182.',
      'Reuben M. Baron and David A. Kenny, "The moderator–mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.," Journal of Personality and Social Psychology, vol. 51, no. 6, pp. 1173-1182, 1986.',
      'Baron RM, Kenny DA. The moderator–mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.. Journal of Personality and Social Psychology. 1986;51(6):1173-1182.',
    ],
    expectedDuplicateCount: 4,
    expectedUniqueCount: 2,
    expectedMergedTitle: 'The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations',
    expectedMergedAuthors: ['Baron', 'Kenny'],
    forbiddenOutputPatterns: [
      /\bBaron,\s*M,\s*R\b/i,
      /\bKenny,\s*&\b/i,
      /\bR,\s*&\s*Kenny\b/i,
      /\bVol,\b/i,
    ],
  },
  {
    id: 'jensen-mixed-format-family',
    description: 'Six mixed-style variants of Jensen and Meckling should collapse into one duplicate family.',
    references: [
      'Jensen, Michael C., & Meckling, William H. (1976). Theory of the firm: Managerial behavior, agency costs and ownership structure. Journal of Financial Economics, 3(4), 305-360.',
      'Michael C. Jensen and William H. Meckling, "Theory of the firm: Managerial behavior, agency costs and ownership structure," Journal of Financial Economics, vol. 3, no. 4, pp. 305-360, 1976.',
      'Jensen MC, Meckling WH. Theory of the firm: Managerial behavior, agency costs and ownership structure. Journal of Financial Economics. 1976;3(4):305-360.',
      'Jensen, MichaelC. and Meckling, WilliamH., 1976. Theory of the firm: Managerial behavior, agency costs and ownership structure. Journal of Financial Economics, 3(4), pp.305-360.',
      'Jensen, Michael C., and William H. Meckling. "Theory of the firm: Managerial behavior, agency costs and ownership structure." Journal of Financial Economics, vol. 3, no. 4, 1976, pp. 305-360.',
      'Jensen, Michael C., and William H. Meckling. "Theory of the firm: Managerial behavior, agency costs and ownership structure." Journal of Financial Economics 3, no. 4 (1976): 305-360.',
    ],
    expectedDuplicateCount: 4,
    expectedUniqueCount: 2,
    expectedMergedTitle: 'Theory of the firm: Managerial behavior, agency costs and ownership structure',
    expectedMergedAuthors: ['Jensen', 'Meckling'],
    forbiddenOutputPatterns: [
      /\bJensen,\s*C,\s*M\b/i,
      /\bMeckling,\s*&\b/i,
      /\bVol,\b/i,
    ],
  },
  {
    id: 'zadeh-mixed-format-family',
    description: 'Six mixed-style variants of Zadeh should collapse into one clean duplicate family.',
    references: [
      'Zadeh, L.A. (1965). Fuzzy sets. Information and Control, 8(3), 338-353.',
      'L.A. Zadeh, "Fuzzy sets," Information and Control, vol. 8, no. 3, pp. 338-353, 1965.',
      'Zadeh LA. Fuzzy sets. Information and Control. 1965;8(3):338-353.',
      'Zadeh, L.A., 1965. Fuzzy sets. Information and Control, 8(3), pp.338-353.',
      'Zadeh, L.A.. "Fuzzy sets." Information and Control, vol. 8, no. 3, 1965, pp. 338-353.',
      'Zadeh, L.A.. "Fuzzy sets." Information and Control 8, no. 3 (1965): 338-353.',
    ],
    expectedDuplicateCount: 4,
    expectedUniqueCount: 2,
    expectedMergedTitle: 'Fuzzy sets',
    expectedMergedAuthors: ['Zadeh'],
    forbiddenOutputPatterns: [
      /\bVol,\b/i,
      /\bZadeh,\s*L,\s*A\b/i,
    ],
  },
  {
    id: 'unknown-placeholder-family',
    description: 'Placeholder Unknown records should still dedupe but must remain suspicious for health review.',
    references: [
      'Unknown,  (1990). Statistical power analysis for the behavioral sciences. Computers Environment and Urban Systems, 14(1), 71.',
      'Unknown, "Statistical power analysis for the behavioral sciences," Computers Environment and Urban Systems, vol. 14, no. 1, pp. 71, 1990.',
      'Unknown . Statistical power analysis for the behavioral sciences. Computers Environment and Urban Systems. 1990;14(1):71.',
      'Unknown, , 1990. Statistical power analysis for the behavioral sciences. Computers Environment and Urban Systems, 14(1), pp.71.',
      'Unknown, . "Statistical power analysis for the behavioral sciences." Computers Environment and Urban Systems, vol. 14, no. 1, 1990, pp. 71.',
      'Unknown, . "Statistical power analysis for the behavioral sciences." Computers Environment and Urban Systems 14, no. 1 (1990): 71.',
    ],
    expectedDuplicateCount: 3,
    expectedUniqueCount: 3,
    expectedMergedTitle: 'Statistical power analysis for the behavioral sciences',
    expectedMergedAuthors: ['Unknown'],
  },
  {
    id: 'mla-book-source-type-regression',
    description: 'MLA book references should stay MLA books instead of drifting into APA parsing.',
    references: [
      'Smith, John. The Craft of Testing. Routledge, 2019.',
    ],
    expectedDetectedStyle: 'mla',
    expectedReferenceType: 'book',
    expectedOutputIncludes: ['The Craft of Testing.', 'Routledge.'],
  },
  {
    id: 'mla-journal-style-regression',
    description: 'MLA journal references should not be mistaken for IEEE.',
    references: [
      'Baron, Reuben M., and David A. Kenny. "The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.." Journal of Personality and Social Psychology, vol. 51, no. 6, 1986, pp. 1173-1182.',
    ],
    expectedDetectedStyle: 'mla',
    expectedReferenceType: 'journal',
    expectedOutputIncludes: ['Journal of Personality and Social Psychology, 51(6), 1173-1182.'],
  },
  {
    id: 'mla-website-source-type-regression',
    description: 'MLA website references with bare www URLs should stay websites.',
    references: [
      'OpenAI. "GPT-5.1 system card." OpenAI Research, www.openai.com/research/gpt-5-1. Accessed 27 Mar. 2026.',
    ],
    expectedDetectedStyle: 'mla',
    expectedReferenceType: 'website',
    forbiddenOutputPatterns: [
      /Journal of/i,
      /OpenAI Research,\s*\d+\(\d+\)/i,
    ],
  },
  {
    id: 'mla-book-chapter-source-type-regression',
    description: 'MLA book chapters should retain chapter metadata instead of collapsing into journal or report types.',
    references: [
      'Doe, Jane. "Testing Chapters Well." The Handbook of Modern QA, edited by John Smith, Routledge, 2021, pp. 44-58.',
    ],
    expectedDetectedStyle: 'mla',
    expectedReferenceType: 'chapter',
    expectedOutputIncludes: ['In The Handbook of Modern QA (pp. 44-58).'],
  },
  {
    id: 'chicago-book-style-regression',
    description: 'Chicago books should not be misdetected as APA.',
    references: [
      'Smith, John. The Craft of Testing. Chicago: University of Chicago Press, 2019.',
    ],
    expectedDetectedStyle: 'chicago',
    expectedReferenceType: 'book',
    expectedOutputIncludes: ['University of Chicago Press.'],
  },
  {
    id: 'chicago-journal-style-regression',
    description: 'Chicago journal references should stay Chicago journals instead of drifting toward MLA.',
    references: [
      'Topol, Eric. "High-performance medicine: the convergence of human and artificial intelligence." Nature Medicine 25, no. 1 (2019): 44-56.',
    ],
    expectedDetectedStyle: 'chicago',
    expectedReferenceType: 'journal',
    expectedOutputIncludes: ['Nature Medicine, 25(1), 44-56.'],
  },
  {
    id: 'chicago-book-chapter-source-type-regression',
    description: 'Chicago book chapters should keep chapter container metadata.',
    references: [
      'Doe, Jane. "Testing Chapters Well." In The Handbook of Modern QA, edited by John Smith, 44-58. London: Routledge, 2021.',
    ],
    expectedDetectedStyle: 'chicago',
    expectedReferenceType: 'chapter',
    expectedOutputIncludes: ['In The Handbook of Modern QA (pp. 44-58).'],
  },
  {
    id: 'chicago-website-source-type-regression',
    description: 'Chicago notes website references should remain websites without promoting accessed dates into publication years.',
    references: [
      'Center for Translational Therapeutics. "Dose response ranking for translational pharmacology: case SDE-CNW-001." Drug Evidence Hub. Accessed 22 Mar 2026. https://stress.example.org/cnw/121.',
    ],
    expectedDetectedStyle: 'chicago',
    expectedReferenceType: 'website',
    expectedOutputIncludes: ['Dose response ranking for translational pharmacology: case SDE-CNW-001.'],
    forbiddenOutputPatterns: [
      /\(2026\)/,
      /Journal of/i,
    ],
  },
  {
    id: 'harvard-book-style-regression',
    description: 'Harvard book references should be detected as Harvard books rather than APA or other.',
    references: [
      'Smith, J 2019, The craft of testing, Routledge, London.',
    ],
    expectedDetectedStyle: 'harvard',
    expectedReferenceType: 'book',
    expectedOutputIncludes: ['The craft of testing.', 'Routledge.'],
  },
  {
    id: 'harvard-journal-style-regression',
    description: 'Harvard journal references should preserve journal metadata cleanly.',
    references: [
      "Smith, J 2021, 'Testing the system', Journal of Applied QA, vol. 12, no. 3, pp. 44-58.",
    ],
    expectedDetectedStyle: 'harvard',
    expectedReferenceType: 'journal',
    expectedOutputIncludes: ['Journal of Applied QA, 12(3), 44-58.'],
  },
  {
    id: 'harvard-website-source-type-regression',
    description: 'Harvard website references should remain websites instead of being promoted to journal articles.',
    references: [
      "World Health Organization 2023, 'Global testing guidance portal', World Health Organization, viewed 22 Mar 2026, https://www.who.int/testing-guidance.",
    ],
    expectedDetectedStyle: 'harvard',
    expectedReferenceType: 'website',
    forbiddenOutputPatterns: [
      /Journal of/i,
      /\bvol\.\b/i,
    ],
  },
  {
    id: 'ieee-book-source-type-regression',
    description: 'IEEE books should parse as books instead of journals or malformed author/title pairs.',
    references: [
      '[5] J. Smith, The Craft of Testing. New York: IEEE Press, 2019.',
    ],
    expectedDetectedStyle: 'ieee',
    expectedReferenceType: 'book',
    expectedOutputIncludes: ['The Craft of Testing.', 'IEEE Press.'],
  },
  {
    id: 'ieee-conference-style-regression',
    description: 'IEEE conference references should stay IEEE and avoid accidental style drift during extraction.',
    references: [
      '[12] A. Kumar and B. Lee, "Adaptive test orchestration for resilient pipelines," in Proc. International Conference on Software Quality, Berlin, Germany, pp. 44-52, 2022.',
    ],
    expectedDetectedStyle: 'ieee',
    expectedReferenceType: 'conference',
    expectedOutputIncludes: ['In Proceedings of the International Conference on Software Quality, Berlin, Germany (pp. 44-52).'],
  },
  {
    id: 'vancouver-report-source-type-regression',
    description: 'Institutional Vancouver-style reports should remain reports rather than falling back to generic journal guesses.',
    references: [
      'World Health Organization. Global tuberculosis report 2023. Geneva: World Health Organization; 2023.',
    ],
    expectedDetectedStyle: 'vancouver',
    expectedReferenceType: 'report',
    expectedOutputIncludes: ['Global tuberculosis report 2023.'],
  },
];
