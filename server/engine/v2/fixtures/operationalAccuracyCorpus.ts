import type { CanonicalReferenceType } from '@shared/schema';

export type OperationalMode = 'structured' | 'semi_structured' | 'raw_unstructured';

export type OperationalExpectedFields = Partial<{
  authors: string[];
  title: string;
  year: string;
  journal: string;
  conferenceTitle: string;
  bookTitle: string;
  publisher: string;
  institution: string;
  volume: string;
  issue: string;
  pages: string;
  articleNumber: string;
  doi: string;
  url: string;
  edition: string;
}>;

export interface OperationalAccuracyCase {
  id: string;
  mode: OperationalMode;
  input: string;
  expectedReferenceType: CanonicalReferenceType;
  expectedFields: OperationalExpectedFields;
}

export const OPERATIONAL_ACCURACY_THRESHOLDS = {
  overall: {
    styleAccuracyMin: 0.8,
    referenceTypeAccuracyMin: 0.8,
    fieldAccuracyMin: 0.8,
  },
  byMode: {
    structured: {
      styleAccuracyMin: 0.8,
      referenceTypeAccuracyMin: 0.8,
      fieldAccuracyMin: 0.8,
    },
    semi_structured: {
      styleAccuracyMin: 0.8,
      referenceTypeAccuracyMin: 0.8,
      fieldAccuracyMin: 0.8,
    },
    raw_unstructured: {
      styleAccuracyMin: 0.8,
      referenceTypeAccuracyMin: 0.8,
      fieldAccuracyMin: 0.8,
    },
  },
} as const;

export const OPERATIONAL_ACCURACY_CASES: OperationalAccuracyCase[] = [
  {
    id: 'structured-smith-journal',
    mode: 'structured',
    input: 'Smith, J. A., & Doe, R. B. (2023). Neural network optimization in low-resource environments. Journal of Artificial Intelligence Research, 45(2), 112-128.',
    expectedReferenceType: 'journal',
    expectedFields: {
      authors: ['Smith, J. A.', 'Doe, R. B.'],
      title: 'Neural network optimization in low-resource environments',
      year: '2023',
      journal: 'Journal of Artificial Intelligence Research',
      volume: '45',
      issue: '2',
      pages: '112-128',
    },
  },
  {
    id: 'structured-chen-journal',
    mode: 'structured',
    input: 'Chen, L., Wang, X., & Liu, Y. (2022). Impact of urban green spaces on mental health: A longitudinal study. Environmental Health Perspectives, 130(4), 047005.',
    expectedReferenceType: 'journal',
    expectedFields: {
      authors: ['Chen, L.', 'Wang, X.', 'Liu, Y.'],
      title: 'Impact of urban green spaces on mental health: A longitudinal study',
      year: '2022',
      journal: 'Environmental Health Perspectives',
      volume: '130',
      issue: '4',
      articleNumber: '047005',
    },
  },
  {
    id: 'structured-aljohani-conference',
    mode: 'structured',
    input: 'Aljohani, Mohammed, and Tanweer Alam. "An algorithm for accessing traffic database using wireless technologies." In Computational Intelligence and Computing Research (ICCIC), 2015 IEEE International Conference on, pp. 1-4. IEEE, 2015. DOI: https://doi.org/10.1109/iccic.2015.7435818',
    expectedReferenceType: 'conference',
    expectedFields: {
      authors: ['Aljohani, M.', 'Alam, T.'],
      title: 'An algorithm for accessing traffic database using wireless technologies',
      year: '2015',
      conferenceTitle: '2015 IEEE International Conference on Computational Intelligence and Computing Research (ICCIC)',
      pages: '1-4',
      publisher: 'IEEE',
      doi: '10.1109/iccic.2015.7435818',
    },
  },
  {
    id: 'structured-shapiro-chapter',
    mode: 'structured',
    input: 'Shapiro, Jonathan. "Genetic algorithms in machine learning." In Advanced Course on Artificial Intelligence, pp. 146-168. Springer, Berlin, Heidelberg, 1999.',
    expectedReferenceType: 'chapter',
    expectedFields: {
      authors: ['Shapiro, J.'],
      title: 'Genetic algorithms in machine learning',
      year: '1999',
      bookTitle: 'Advanced Course on Artificial Intelligence',
      pages: '146-168',
      publisher: 'Berlin, Heidelberg: Springer Berlin Heidelberg',
    },
  },
  {
    id: 'structured-kennedy-book',
    mode: 'structured',
    input: 'Kennedy, David. New Relations: The Refashioning of British Poetry 1980-1994. Bridgend: Seren, 1996.',
    expectedReferenceType: 'book',
    expectedFields: {
      authors: ['Kennedy, D.'],
      title: 'New Relations: The Refashioning of British Poetry 1980-1994',
      year: '1996',
      publisher: 'Seren',
    },
  },
  {
    id: 'structured-gamma-book',
    mode: 'structured',
    input: 'Gamma, E., Helm, R., Johnson, R., & Vlissides, J. (1994). Design Patterns: Elements of Reusable Object-Oriented Software. Reading, MA: Addison-Wesley.',
    expectedReferenceType: 'book',
    expectedFields: {
      authors: ['Gamma, E.', 'Helm, R.', 'Johnson, R.', 'Vlissides, J.'],
      title: 'Design Patterns: Elements of Reusable Object-Oriented Software',
      year: '1994',
      publisher: 'Addison-Wesley',
    },
  },
  {
    id: 'structured-who-report',
    mode: 'structured',
    input: 'World Health Organization. Global tuberculosis report 2023. Geneva: World Health Organization; 2023.',
    expectedReferenceType: 'report',
    expectedFields: {
      authors: ['World Health Organization'],
      title: 'Global tuberculosis report 2023',
      year: '2023',
      publisher: 'World Health Organization',
      institution: 'World Health Organization',
    },
  },
  {
    id: 'structured-ema-report',
    mode: 'structured',
    input: 'European Medicines Agency. Guideline on medical literature monitoring. Amsterdam: EMA; 2020.',
    expectedReferenceType: 'report',
    expectedFields: {
      authors: ['European Medicines Agency'],
      title: 'Guideline on medical literature monitoring',
      year: '2020',
      publisher: 'EMA',
      institution: 'European Medicines Agency',
    },
  },
  {
    id: 'semi-smith-journal',
    mode: 'semi_structured',
    input: '1. Smith, J. A., & Doe, R. B. (2023). Neural network optimization in low-resource environments. Journal of Artificial Intelligence Research,\n45(2), 112-128.',
    expectedReferenceType: 'journal',
    expectedFields: {
      authors: ['Smith, J. A.', 'Doe, R. B.'],
      title: 'Neural network optimization in low-resource environments',
      year: '2023',
      journal: 'Journal of Artificial Intelligence Research',
      volume: '45',
      issue: '2',
      pages: '112-128',
    },
  },
  {
    id: 'semi-aljohani-conference',
    mode: 'semi_structured',
    input: '9. Aljohani, Mohammed, and Tanweer Alam. "An algorithm for accessing traffic database using wireless technologies."\nIn Computational Intelligence and Computing Research (ICCIC), 2015 IEEE International Conference on, pp. 1-4. IEEE, 2015.\nDOI: https://doi.org/10.1109/iccic.2015.7435818',
    expectedReferenceType: 'conference',
    expectedFields: {
      authors: ['Aljohani, M.', 'Alam, T.'],
      title: 'An algorithm for accessing traffic database using wireless technologies',
      year: '2015',
      conferenceTitle: '2015 IEEE International Conference on Computational Intelligence and Computing Research (ICCIC)',
      pages: '1-4',
      publisher: 'IEEE',
      doi: '10.1109/iccic.2015.7435818',
    },
  },
  {
    id: 'semi-shapiro-chapter',
    mode: 'semi_structured',
    input: '10. Shapiro, Jonathan. "Genetic algorithms in machine learning."\nIn Advanced Course on Artificial Intelligence, pp. 146-168. Springer, Berlin, Heidelberg, 1999.',
    expectedReferenceType: 'chapter',
    expectedFields: {
      authors: ['Shapiro, J.'],
      title: 'Genetic algorithms in machine learning',
      year: '1999',
      bookTitle: 'Advanced Course on Artificial Intelligence',
      pages: '146-168',
      publisher: 'Berlin, Heidelberg: Springer Berlin Heidelberg',
    },
  },
  {
    id: 'semi-kennedy-book',
    mode: 'semi_structured',
    input: '11. Kennedy, David. New Relations: The Refashioning of British Poetry 1980-1994.\nBridgend: Seren, 1996.',
    expectedReferenceType: 'book',
    expectedFields: {
      authors: ['Kennedy, D.'],
      title: 'New Relations: The Refashioning of British Poetry 1980-1994',
      year: '1996',
      publisher: 'Seren',
    },
  },
  {
    id: 'semi-who-report',
    mode: 'semi_structured',
    input: '15. World Health Organization. Global tuberculosis report 2023.\nGeneva: World Health Organization; 2023.',
    expectedReferenceType: 'report',
    expectedFields: {
      authors: ['World Health Organization'],
      title: 'Global tuberculosis report 2023',
      year: '2023',
      publisher: 'World Health Organization',
      institution: 'World Health Organization',
    },
  },
  {
    id: 'semi-ema-report',
    mode: 'semi_structured',
    input: '16. European Medicines Agency. Guideline on medical literature monitoring.\nAmsterdam: EMA; 2020.',
    expectedReferenceType: 'report',
    expectedFields: {
      authors: ['European Medicines Agency'],
      title: 'Guideline on medical literature monitoring',
      year: '2020',
      publisher: 'EMA',
      institution: 'European Medicines Agency',
    },
  },
  {
    id: 'semi-nature-website',
    mode: 'semi_structured',
    input: '19. Tapping into the drug discovery potential of AI. (2021).\nhttps://www.nature.com/articles/d43747-021-00045-7.',
    expectedReferenceType: 'website',
    expectedFields: {
      title: 'Tapping into the drug discovery potential of AI',
      year: '2021',
      url: 'https://www.nature.com/articles/d43747-021-00045-7',
      doi: '10.1038/d43747-021-00045-7',
    },
  },
  {
    id: 'semi-openai-website',
    mode: 'semi_structured',
    input: '20. OpenAI. GPT-5 system card. (2025).\nAvailable from: https://openai.com/research/gpt-5-system-card.',
    expectedReferenceType: 'website',
    expectedFields: {
      authors: ['OpenAI'],
      title: 'GPT-5 system card',
      year: '2025',
      url: 'https://openai.com/research/gpt-5-system-card',
    },
  },
  {
    id: 'raw-skalic-journal',
    mode: 'raw_unstructured',
    input: 'Skalic M, Jimenez J, Sabbadin D, De Fabritiis G: Shape-based generative modeling for de novo drug design. J Chem Inf Model. 2019, 59:1205-14. 10.1021/acs.jcim.8b00706',
    expectedReferenceType: 'journal',
    expectedFields: {
      authors: ['Skalic, M.', 'Jimenez, J.', 'Sabbadin, D.', 'De Fabritiis, G.'],
      title: 'Shape-based generative modeling for de novo drug design',
      year: '2019',
      journal: 'J Chem Inf Model',
      volume: '59',
      pages: '1205-14',
      doi: '10.1021/acs.jcim.8b00706',
    },
  },
  {
    id: 'raw-page-journal',
    mode: 'raw_unstructured',
    input: 'Page, Matthew J, Joanne E McKenzie, Patrick M Bossuyt. "The PRISMA 2020 statement: an updated guideline for reporting systematic reviews." BMJ 372 (2021): n71.',
    expectedReferenceType: 'journal',
    expectedFields: {
      authors: ['Page, M. J.', 'McKenzie, J. E.', 'Bossuyt, P. M.'],
      title: 'The PRISMA 2020 statement: an updated guideline for reporting systematic reviews',
      year: '2021',
      journal: 'BMJ',
      volume: '372',
      articleNumber: 'n71',
    },
  },
  {
    id: 'raw-aljohani-conference',
    mode: 'raw_unstructured',
    input: 'Aljohani, Mohammed, and Tanweer Alam. "An algorithm for accessing traffic database using wireless technologies." In Computational Intelligence and Computing Research (ICCIC), 2015 IEEE International Conference on, pp. 1-4. IEEE, 2015. DOI: https://doi.org/10.1109/iccic.2015.7435818',
    expectedReferenceType: 'conference',
    expectedFields: {
      authors: ['Aljohani, M.', 'Alam, T.'],
      title: 'An algorithm for accessing traffic database using wireless technologies',
      year: '2015',
      conferenceTitle: '2015 IEEE International Conference on Computational Intelligence and Computing Research (ICCIC)',
      pages: '1-4',
      publisher: 'IEEE',
      doi: '10.1109/iccic.2015.7435818',
    },
  },
  {
    id: 'raw-shapiro-chapter',
    mode: 'raw_unstructured',
    input: 'Shapiro, Jonathan. "Genetic algorithms in machine learning." In Advanced Course on Arti- ficial Intelligence, pp. 146-168. Springer, Berlin, Heidelberg, 1999.',
    expectedReferenceType: 'chapter',
    expectedFields: {
      authors: ['Shapiro, J.'],
      title: 'Genetic algorithms in machine learning',
      year: '1999',
      bookTitle: 'Advanced Course on Artificial Intelligence',
      pages: '146-168',
      publisher: 'Berlin, Heidelberg: Springer Berlin Heidelberg',
    },
  },
  {
    id: 'raw-who-report',
    mode: 'raw_unstructured',
    input: 'World Health Organization. Global tuberculosis report 2023. Geneva: World Health Organization; 2023.',
    expectedReferenceType: 'report',
    expectedFields: {
      authors: ['World Health Organization'],
      title: 'Global tuberculosis report 2023',
      year: '2023',
      publisher: 'World Health Organization',
      institution: 'World Health Organization',
    },
  },
  {
    id: 'raw-ema-report',
    mode: 'raw_unstructured',
    input: 'European Medicines Agency. Guideline on medical literature monitoring. Amsterdam: EMA; 2020.',
    expectedReferenceType: 'report',
    expectedFields: {
      authors: ['European Medicines Agency'],
      title: 'Guideline on medical literature monitoring',
      year: '2020',
      publisher: 'EMA',
      institution: 'European Medicines Agency',
    },
  },
  {
    id: 'raw-tabassum-journal',
    mode: 'raw_unstructured',
    input: '[10] Tabassum M, Mathew K, A genetic algorithm analysis towards optimization solutions, International Journal of Digital Information and Wireless Communications (IJDIWC), 2014 Jan 1, 4(1), 124-42.',
    expectedReferenceType: 'journal',
    expectedFields: {
      authors: ['Tabassum, M.', 'Mathew, K.'],
      title: 'A genetic algorithm analysis towards optimization solutions',
      year: '2014',
      journal: 'International Journal of Digital Information and Wireless Communications (IJDIWC)',
      volume: '4',
      issue: '1',
      pages: '124-42',
    },
  },
  {
    id: 'raw-nature-website',
    mode: 'raw_unstructured',
    input: 'Tapping into the drug discovery potential of AI . (2021). https://www.nature.com/articles/d43747-021-\n00045-7.',
    expectedReferenceType: 'website',
    expectedFields: {
      title: 'Tapping into the drug discovery potential of AI',
      year: '2021',
      url: 'https://www.nature.com/articles/d43747-021-00045-7',
      doi: '10.1038/d43747-021-00045-7',
    },
  },
  {
    id: 'raw-openai-website',
    mode: 'raw_unstructured',
    input: 'OpenAI. GPT-5 system card. 2025. Available from: https://openai.com/research/gpt-5-system-card.',
    expectedReferenceType: 'website',
    expectedFields: {
      authors: ['OpenAI'],
      title: 'GPT-5 system card',
      year: '2025',
      url: 'https://openai.com/research/gpt-5-system-card',
    },
  },
];

export function getOperationalAccuracyCases(mode?: OperationalMode): OperationalAccuracyCase[] {
  return mode
    ? OPERATIONAL_ACCURACY_CASES.filter((entry) => entry.mode === mode)
    : [...OPERATIONAL_ACCURACY_CASES];
}
