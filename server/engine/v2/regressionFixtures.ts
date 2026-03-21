export interface RegressionFixture {
  id: string;
  description: string;
  expectedToFail?: boolean;
  references: string[];
  expectedDuplicateCount?: number;
  expectedUniqueCount?: number;
  expectedMergedTitle?: string;
  expectedMergedAuthors?: string[];
  expectedOutputText?: string;
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
    expectedDuplicateCount: 5,
    expectedUniqueCount: 1,
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
    expectedDuplicateCount: 5,
    expectedUniqueCount: 1,
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
    expectedDuplicateCount: 5,
    expectedUniqueCount: 1,
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
    expectedDuplicateCount: 5,
    expectedUniqueCount: 1,
    expectedMergedTitle: 'Statistical power analysis for the behavioral sciences',
    expectedMergedAuthors: ['Unknown'],
  },
];
