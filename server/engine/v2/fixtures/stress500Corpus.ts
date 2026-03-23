export type StressCaseKind =
  | 'clean_apa'
  | 'clean_ieee'
  | 'doi_line'
  | 'header_bleed_pdf'
  | 'multiline_continuation'
  | 'biomedical_colon'
  | 'abbrev_journal'
  | 'conference'
  | 'url_tail'
  | 'report';

export interface StressCase {
  id: string;
  kind: StressCaseKind;
  expectedDoi?: string;
  reference: string;
}

export const TOTAL_STRESS_CASES = 500;

export const EXPLICIT_STRESS_CASES: StressCase[] = [
  {
    id: 'manual-conference-in-source',
    kind: 'conference',
    expectedDoi: '10.1109/iccic.2015.7435818',
    reference: 'Aljohani, Mohammed, and Tanweer Alam. "An algorithm for accessing traffic database using wireless technologies." In Computational Intelligence and Computing Research (ICCIC), 2015 IEEE International Conference on, pp. 1-4. IEEE, 2015. DOI: https://doi.org/10.1109/iccic.2015.7435818',
  },
  {
    id: 'manual-chapter-in-source',
    kind: 'conference',
    reference: 'Shapiro, Jonathan. "Genetic algorithms in machine learning." In Advanced Course on Arti- ficial Intelligence, pp. 146-168. Springer, Berlin, Heidelberg, 1999.',
  },
  {
    id: 'manual-compact-journal-tail',
    kind: 'abbrev_journal',
    reference: '[10] Tabassum M, Mathew K, A genetic algorithm analysis towards optimization solutions, International Journal of Digital Information and Wireless Communications (IJDIWC), 2014 Jan 1, 4(1), 124-42.',
  },
];

const STRESS_KINDS: StressCaseKind[] = [
  'clean_apa',
  'clean_ieee',
  'doi_line',
  'header_bleed_pdf',
  'multiline_continuation',
  'biomedical_colon',
  'abbrev_journal',
  'conference',
  'url_tail',
  'report',
];

function padded(index: number) {
  return String(index + 1).padStart(3, '0');
}

function makeDoi(index: number) {
  return `10.5555/stress-${padded(index)}`;
}

function makeTitle(kind: StressCaseKind, index: number) {
  return `Stress corpus ${kind.replace(/_/g, ' ')} scenario ${padded(index)}`;
}

export function buildStressCase(index: number): StressCase {
  const kind = STRESS_KINDS[index % STRESS_KINDS.length];
  const year = 2015 + (index % 10);
  const volume = 10 + (index % 12);
  const issue = 1 + (index % 4);
  const startPage = 10 + (index * 2);
  const endPage = startPage + 8;
  const doi = makeDoi(index);
  const title = makeTitle(kind, index);
  const authorA = `Author${padded(index)}, A.`;
  const authorB = `Builder${padded(index)}, B.`;
  const journal = `Journal of Stress Quality ${1 + (index % 7)}`;
  const baseApa = `${authorA}, & ${authorB} (${year}). ${title}. ${journal}, ${volume}(${issue}), ${startPage}-${endPage}.`;

  switch (kind) {
    case 'clean_apa':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: `${baseApa} https://doi.org/${doi}`,
      };
    case 'clean_ieee':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: `${authorA} and ${authorB}, "${title}," ${journal}, vol. ${volume}, no. ${issue}, pp. ${startPage}-${endPage}, ${year}. doi: ${doi}.`,
      };
    case 'doi_line':
      return {
        id: `stress-${padded(index)}`,
        kind,
        expectedDoi: doi,
        reference: [
          `${index + 1}. ${authorA}, & ${authorB} (${year}). ${title}. ${journal}, ${volume}(${issue}), ${startPage}-${endPage}.`,
          doi,
        ].join('\n'),
      };
    case 'header_bleed_pdf':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: [
          `${year} Stress Proceedings Header DOI ${doi} ${1 + (index % 17)} of 17`,
          `${index + 1}. ${authorA}, & ${authorB} (${year}). ${title}. ${journal}, ${volume}(${issue}), ${startPage}-${endPage}.`,
        ].join('\n'),
      };
    case 'multiline_continuation':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: [
          `${index + 1}. ${authorA}, & ${authorB} (${year}). ${title}:`,
          'continuing evidence from split line repair and artifact-aware processing.',
          `${journal}, ${volume}(${issue}), ${startPage}-${endPage}. https://doi.org/${doi}`,
        ].join('\n'),
      };
    case 'biomedical_colon':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: `${index + 1}. ${authorA} ${authorB}: ${title}. Biomed Res Notes. ${year};${volume}(${issue}):${startPage}-${endPage}. doi:${doi}`,
      };
    case 'abbrev_journal':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: `${authorA}, ${authorB} (${year}). ${title}. J. Stress Qual. ${volume}(${issue}), ${startPage}-${endPage}. doi: ${doi}`,
      };
    case 'conference':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: `${authorA}, & ${authorB} (${year}). ${title}. In Proceedings of the Stress Systems Conference ${year} (pp. ${startPage}-${endPage}). IEEE.`,
      };
    case 'url_tail':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: [
          `${authorA}, & ${authorB} (${year}). ${title}. ${journal}, ${volume}(${issue}), ${startPage}-${endPage}.`,
          `Available from: https://example.test/${padded(index)}/${kind}`,
        ].join('\n'),
      };
    case 'report':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: `${authorA}, & ${authorB} (${year}). ${title}. Stress Research Institute Report No. ${100 + index}. Riyadh: Reliability Press.`,
      };
  }
}

export function buildStressCorpus(): StressCase[] {
  return [
    ...EXPLICIT_STRESS_CASES,
    ...Array.from({ length: TOTAL_STRESS_CASES - EXPLICIT_STRESS_CASES.length }, (_, index) => buildStressCase(index)),
  ];
}
