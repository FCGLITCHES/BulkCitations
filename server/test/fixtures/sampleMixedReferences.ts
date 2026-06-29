export const SAMPLE_MIXED_REFERENCES_INPUT = `Gomes, M.A.S., Kovaleski, J.L., Pagani, R.N. and da Silva, V.L., 2022. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology, 46(7), pp.608-616.

Gomes MA, Kovaleski JL, Pagani RN, da Silva VL. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology. 2022 Oct 3;46(7):608-16.

Adams, K. L., and R. Chen. "A survey of graph neural networks in medicine." Journal of Medical Informatics, vol. 51, no. 2, 2022, pp. 101-119.

McCoy, L. G., Banja, J. D., Ghassemi, M., & Celi, L. A. (2020). Ensuring machine learning for healthcare works for all. BMJ Health & Care Informatics, 27(3), e100237.

Shailaja K, Seetharamulu B, Jabbar MA. Machine learning in healthcare: A review. In 2018 Second International Conference on Electronics, Communication and Aerospace Technology (ICECA) 2018 Mar 29 (pp. 910-914). IEEE.

Rajkomar A, Dean J, Kohane I. Machine learning in medicine. New England Journal of Medicine. 2019;380(14):1347-1358.

Topol, Eric. "High-performance medicine: the convergence of human and artificial intelligence." Nature Medicine 25, no. 1 (2019): 44-56.

Esteva A, Kuprel B, Novoa RA, Ko J, Swetter SM, Blau HM, Thrun S. Dermatologist-level classification of skin cancer with deep neural networks. Nature. 2017 Feb 2;542(7639):115-118.

Obermeyer, Ziad, and Ezekiel J. Emanuel. "Predicting the future-big data, machine learning, and clinical medicine." The New England Journal of Medicine 375, no. 13 (2016): 1216-1219.

C. J. Kelly, A. Karthikesalingam, M. Suleyman, G. Corrado, and D. King, "Key challenges for delivering clinical impact with artificial intelligence," BMC Medicine, vol. 17, no. 1, p. 195, 2019.`;

export interface SampleReferenceExpectation {
  title: string;
  type: string;
  authorCount: number;
  year: number;
  journal?: string;
  conferenceTitle?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  renderedIncludes: string[];
}

export const SAMPLE_MIXED_REFERENCES_EXPECTATIONS: SampleReferenceExpectation[] = [
  {
    title: 'Machine learning applied to healthcare: a conceptual review',
    type: 'article-journal',
    authorCount: 4,
    year: 2022,
    journal: 'Journal of Medical Engineering & Technology',
    volume: '46',
    issue: '7',
    pages: '608-616',
    renderedIncludes: ['Machine learning applied to healthcare', 'Journal of Medical Engineering & Technology'],
  },
  {
    title: 'Machine learning applied to healthcare: a conceptual review',
    type: 'article-journal',
    authorCount: 4,
    year: 2022,
    journal: 'Journal of Medical Engineering & Technology',
    volume: '46',
    issue: '7',
    pages: '608-616',
    renderedIncludes: ['Machine learning applied to healthcare', 'Journal of Medical Engineering & Technology'],
  },
  {
    title: 'A survey of graph neural networks in medicine',
    type: 'article-journal',
    authorCount: 2,
    year: 2022,
    journal: 'Journal of Medical Informatics',
    volume: '51',
    issue: '2',
    pages: '101-119',
    renderedIncludes: ['A survey of graph neural networks in medicine', 'Journal of Medical Informatics'],
  },
  {
    title: 'Ensuring machine learning for healthcare works for all',
    type: 'article-journal',
    authorCount: 4,
    year: 2020,
    journal: 'BMJ Health & Care Informatics',
    volume: '27',
    issue: '3',
    pages: 'e100237',
    renderedIncludes: ['Ensuring machine learning for healthcare works for all', 'BMJ Health & Care Informatics'],
  },
  {
    title: 'Machine learning in healthcare: A review',
    type: 'conference-paper',
    authorCount: 3,
    year: 2018,
    conferenceTitle: 'Second International Conference on Electronics, Communication and Aerospace Technology',
    pages: '910-914',
    renderedIncludes: ['Machine learning in healthcare', 'Electronics, Communication and Aerospace Technology'],
  },
  {
    title: 'Machine learning in medicine',
    type: 'article-journal',
    authorCount: 3,
    year: 2019,
    journal: 'New England Journal of Medicine',
    volume: '380',
    issue: '14',
    pages: '1347-1358',
    renderedIncludes: ['Machine learning in medicine', 'New England Journal of Medicine'],
  },
  {
    title: 'High-performance medicine: the convergence of human and artificial intelligence',
    type: 'article-journal',
    authorCount: 1,
    year: 2019,
    journal: 'Nature Medicine',
    volume: '25',
    issue: '1',
    pages: '44-56',
    renderedIncludes: ['High-performance medicine', 'Nature Medicine'],
  },
  {
    title: 'Dermatologist-level classification of skin cancer with deep neural networks',
    type: 'article-journal',
    authorCount: 7,
    year: 2017,
    journal: 'Nature',
    volume: '542',
    issue: '7639',
    pages: '115-118',
    renderedIncludes: ['Dermatologist-level classification of skin cancer', 'Nature'],
  },
  {
    title: 'Predicting the future-big data, machine learning, and clinical medicine',
    type: 'article-journal',
    authorCount: 2,
    year: 2016,
    journal: 'The New England Journal of Medicine',
    volume: '375',
    issue: '13',
    pages: '1216-1219',
    renderedIncludes: ['Predicting the future-big data', 'The New England Journal of Medicine'],
  },
  {
    title: 'Key challenges for delivering clinical impact with artificial intelligence',
    type: 'article-journal',
    authorCount: 5,
    year: 2019,
    journal: 'BMC Medicine',
    volume: '17',
    issue: '1',
    pages: '195',
    renderedIncludes: ['Key challenges for delivering clinical impact', 'BMC Medicine'],
  },
];
