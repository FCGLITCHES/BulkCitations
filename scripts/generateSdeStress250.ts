import fs from 'node:fs';
import path from 'node:path';
import type { CanonicalReferenceType, CitationStyle } from '../shared/schema.js';

type PersonAuthor = {
  kind: 'person';
  first: string;
  last: string;
};

type LiteralAuthor = {
  kind: 'literal';
  literal: string;
};

type AuthorSpec = PersonAuthor | LiteralAuthor;

type LocatorSpec =
  | { kind: 'pages'; value: string }
  | { kind: 'article-number'; value: string };

type CitationSeed = {
  caseId: string;
  familyId: string;
  familyName: string;
  globalIndex: number;
  familyIndex: number;
  expectedStyle: CitationStyle;
  expectedReferenceType: CanonicalReferenceType;
  edgeTags: string[];
  authors: AuthorSpec[];
  editors?: AuthorSpec[];
  title: string;
  year: number;
  journal?: string;
  conferenceTitle?: string;
  bookTitle?: string;
  publisher?: string;
  institution?: string;
  siteName?: string;
  place?: string;
  volume?: string;
  issue?: string;
  locator?: LocatorSpec;
  doi?: string;
  url?: string;
  edition?: string;
  reportNumber?: string;
  accessed?: string;
  arxivId?: string;
};

type ManifestEntry = {
  caseId: string;
  familyId: string;
  familyName: string;
  expectedStyle: CitationStyle;
  expectedReferenceType: CanonicalReferenceType;
  edgeTags: string[];
  expectedFields: {
    authors: AuthorSpec[];
    editors: AuthorSpec[];
    title: string;
    year: string;
    journal?: string;
    conferenceTitle?: string;
    bookTitle?: string;
    publisher?: string;
    institution?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    articleNumber?: string;
    doi?: string;
    url?: string;
    edition?: string;
    reportNumber?: string;
  };
  raw: string;
};

type FamilyDefinition = {
  id: string;
  code: string;
  name: string;
  expectedStyle: CitationStyle;
  expectedReferenceType: CanonicalReferenceType;
  edgeTags: string[];
  buildSeed: (index: number, globalIndex: number) => CitationSeed;
  render: (seed: CitationSeed) => string;
};

const OUTPUT_DIR = path.resolve(process.cwd(), 'scripts/data');
const FIXTURE_PATH = path.join(OUTPUT_DIR, 'stress-batch-20260322-sde-250.txt');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'stress-batch-20260322-sde-250.manifest.json');

let familyLookup = {} as Record<string, FamilyDefinition>;

const PERSON_POOL: PersonAuthor[] = [
  { kind: 'person', first: 'Amina', last: 'Khan' },
  { kind: 'person', first: 'Luca', last: 'Rossi' },
  { kind: 'person', first: 'Marta', last: 'de Silva' },
  { kind: 'person', first: 'Nora', last: "O'Rourke" },
  { kind: 'person', first: 'Pieter', last: 'van Dalen' },
  { kind: 'person', first: 'Sara', last: 'Al-Harbi' },
  { kind: 'person', first: 'Jonas', last: 'Weber' },
  { kind: 'person', first: 'Clara', last: 'Mendes' },
  { kind: 'person', first: 'Ethan', last: 'Brooks' },
  { kind: 'person', first: 'Leila', last: 'Haddad' },
  { kind: 'person', first: 'Rina', last: 'Patel' },
  { kind: 'person', first: 'Tom', last: 'Nguyen' },
  { kind: 'person', first: 'Omar', last: 'Saeed' },
  { kind: 'person', first: 'Mira', last: 'Costa' },
  { kind: 'person', first: 'Elena', last: 'Kovacs' },
  { kind: 'person', first: 'Yara', last: 'Nasser' },
  { kind: 'person', first: 'Mason', last: 'Clark' },
  { kind: 'person', first: 'Iris', last: 'Navarro' },
  { kind: 'person', first: 'Tariq', last: 'Mahmoud' },
  { kind: 'person', first: 'Priya', last: 'Menon' },
  { kind: 'person', first: 'Hana', last: 'Suzuki' },
  { kind: 'person', first: 'Nils', last: 'Berg' },
  { kind: 'person', first: 'Rae', last: 'Thompson' },
  { kind: 'person', first: 'Dina', last: 'Farouk' },
  { kind: 'person', first: 'Pavel', last: 'Novak' },
  { kind: 'person', first: 'Ruth', last: 'Adams' },
  { kind: 'person', first: 'Mika', last: 'Tanaka' },
  { kind: 'person', first: 'Zoe', last: 'Ibrahim' },
  { kind: 'person', first: 'Ivan', last: 'Petrov' },
  { kind: 'person', first: 'Lena', last: 'Santos' },
];

const CORPORATE_POOL = [
  'Adaptive Medicines Taskforce',
  'Clinical Design Observatory',
  'Global Trial Methods Unit',
  'Therapeutic Signals Lab',
  'Open Pharmacology Consortium',
  'National Dosing Review Office',
  'Precision Molecule Institute',
  'Center for Translational Therapeutics',
  'Digital Evidence Standards Board',
  'Applied Safety Monitoring Network',
];

const JOURNALS = [
  'Journal of Synthetic Pharmacology',
  'Computational Therapeutics',
  'Drug Discovery Systems',
  'Applied Bioinformatics Review',
  'Clinical Data Methods',
  'Molecular Design Letters',
  'Systems Pharmacology Reports',
  'Precision Therapy Analytics',
  'Biomedical Signal Engineering',
  'Translational Modeling Quarterly',
];

const BOOK_TITLES = [
  'Handbook of Adaptive Therapeutics',
  'Methods in Translational Drug Analytics',
  'Foundations of Computational Pharmacology',
  'Practical Evidence Design for Clinical AI',
  'Manual of Molecular Screening Pipelines',
  'Advanced Topics in Therapeutic Modeling',
];

const CONFERENCE_TITLES = [
  'Proceedings of the International Conference on Computational Therapeutics',
  'Proceedings of the Workshop on Drug Discovery Systems',
  'Proceedings of the Symposium on Clinical AI Infrastructure',
  'Proceedings of the Congress on Translational Pharmacology',
  'Proceedings of the Summit on Biomedical Decision Systems',
  'Proceedings of the Forum on Applied Cheminformatics',
];

const PUBLISHERS = [
  'North Coast Press',
  'Meridian Academic',
  'Atlas Scientific Publishing',
  'Blue Harbor Research',
  'Summit Knowledge House',
  'Open Metrics Press',
];

const INSTITUTIONS = [
  'Gulf Biomedical University',
  'North Coast University',
  'Meridian Institute of Health Data',
  'Open Therapeutics School of Pharmacy',
  'Atlas Center for Clinical Systems',
  'Redwood University',
];

const SITES = [
  'Therapeutic Signals Lab',
  'Drug Evidence Hub',
  'Clinical Design Observatory',
  'Adaptive Methods Portal',
  'Molecule Systems Archive',
  'Pharmacology Standards Network',
];

const PLACES = [
  'Riyadh',
  'London',
  'Boston',
  'Singapore',
  'Berlin',
  'Toronto',
  'Doha',
  'Amsterdam',
];

const TITLE_TOPICS = [
  'adaptive screening signals',
  'dose response ranking',
  'compound triage graphs',
  'trial design routing',
  'molecule scoring cascades',
  'biomarker evidence mapping',
  'protocol mining patterns',
  'safety review clustering',
  'assay prioritization pipelines',
  'response prediction benchmarks',
];

const TITLE_CONTEXTS = [
  'drug discovery',
  'clinical dosing',
  'safety monitoring',
  'evidence review',
  'translational pharmacology',
  'molecular design',
  'preclinical analytics',
  'therapeutic forecasting',
  'pharmacovigilance triage',
  'compound optimization',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

function pick<T>(items: T[], seed: number): T {
  return items[((seed % items.length) + items.length) % items.length];
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function sanitizeDoiSuffix(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
}

function personAuthors(seed: number, count: number): PersonAuthor[] {
  const authors: PersonAuthor[] = [];
  for (let index = 0; index < count; index += 1) {
    authors.push(pick(PERSON_POOL, seed + (index * 4)));
  }
  return authors;
}

function editorAuthors(seed: number): PersonAuthor[] {
  return personAuthors(seed + 9, 2);
}

function initials(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}.`)
    .join(' ');
}

function compactInitials(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function apaAuthor(author: AuthorSpec): string {
  if (author.kind === 'literal') return author.literal;
  return `${author.last}, ${initials(author.first)}`;
}

function harvardAuthor(author: AuthorSpec): string {
  if (author.kind === 'literal') return author.literal;
  return `${author.last} ${compactInitials(author.first)}`;
}

function chicagoAuthor(author: AuthorSpec, invertFirst = true): string {
  if (author.kind === 'literal') return author.literal;
  return invertFirst ? `${author.last}, ${author.first}` : `${author.first} ${author.last}`;
}

function mlaAuthor(author: AuthorSpec, invertFirst = true): string {
  if (author.kind === 'literal') return author.literal;
  return invertFirst ? `${author.last}, ${author.first}` : `${author.first} ${author.last}`;
}

function ieeeAuthor(author: AuthorSpec): string {
  if (author.kind === 'literal') return author.literal;
  return `${initials(author.first)} ${author.last}`;
}

function vancouverAuthor(author: AuthorSpec): string {
  if (author.kind === 'literal') return author.literal;
  return `${author.last} ${compactInitials(author.first)}`;
}

function joinWithOxfordComma(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} & ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, & ${items[items.length - 1]}`;
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function joinWithAndComma(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function formatApaAuthors(authors: AuthorSpec[]): string {
  return joinWithOxfordComma(authors.map(apaAuthor));
}

function formatHarvardAuthors(authors: AuthorSpec[]): string {
  return joinWithAnd(authors.map(harvardAuthor));
}

function formatChicagoAuthors(authors: AuthorSpec[]): string {
  if (authors.length === 0) return '';
  const [first, ...rest] = authors;
  const values = [
    chicagoAuthor(first, true),
    ...rest.map((author) => chicagoAuthor(author, false)),
  ].filter(Boolean);
  return joinWithAndComma(values);
}

function formatMlaAuthors(authors: AuthorSpec[]): string {
  if (authors.length === 0) return '';
  if (authors.length === 1) return mlaAuthor(authors[0], true);
  if (authors.length === 2) return `${mlaAuthor(authors[0], true)}, and ${mlaAuthor(authors[1], false)}`;
  return `${mlaAuthor(authors[0], true)}, et al.`;
}

function formatIeeeAuthors(authors: AuthorSpec[]): string {
  return joinWithAndComma(authors.map(ieeeAuthor));
}

function formatVancouverAuthors(authors: AuthorSpec[]): string {
  return authors.map(vancouverAuthor).join(', ');
}

function formatEditorList(authors: AuthorSpec[]): string {
  if (authors.length === 0) return '';
  if (authors.length === 1) return chicagoAuthor(authors[0], true);
  return joinWithAndComma(authors.map((author, index) => chicagoAuthor(author, index === 0)));
}

function makeTitle(caseId: string, seed: number): string {
  return `${titleCase(pick(TITLE_TOPICS, seed))} for ${pick(TITLE_CONTEXTS, seed + 3)}: case ${caseId}`;
}

function makeDoi(code: string, globalIndex: number): string {
  return `10.7001/${sanitizeDoiSuffix(code)}.${pad3(globalIndex)}`;
}

function makeUrl(code: string, globalIndex: number): string {
  return `https://stress.example.org/${sanitizeDoiSuffix(code)}/${pad3(globalIndex)}`;
}

function makePages(globalIndex: number): string {
  const start = 90 + (globalIndex * 7);
  const end = start + 16 + (globalIndex % 8);
  return `${start}-${end}`;
}

function makeShortPages(globalIndex: number): string {
  const start = 140 + (globalIndex * 5);
  const end = start + 11 + (globalIndex % 6);
  return `${start}-${String(end).slice(-2)}`;
}

function makeArticleNumber(globalIndex: number): string {
  return `e${5000 + globalIndex}`;
}

function makeSeedBase(
  family: FamilyDefinition,
  index: number,
  globalIndex: number,
  overrides: Partial<CitationSeed>,
): CitationSeed {
  const caseId = `SDE-${family.code}-${pad3(index + 1)}`;
  return {
    caseId,
    familyId: family.id,
    familyName: family.name,
    globalIndex,
    familyIndex: index,
    expectedStyle: family.expectedStyle,
    expectedReferenceType: family.expectedReferenceType,
    edgeTags: family.edgeTags,
    authors: overrides.authors ?? personAuthors(globalIndex + index, 3),
    editors: overrides.editors ?? [],
    title: overrides.title ?? makeTitle(caseId, globalIndex + index),
    year: overrides.year ?? (2012 + ((globalIndex + index) % 12)),
    journal: overrides.journal ?? pick(JOURNALS, globalIndex + index),
    conferenceTitle: overrides.conferenceTitle ?? pick(CONFERENCE_TITLES, globalIndex + index),
    bookTitle: overrides.bookTitle ?? pick(BOOK_TITLES, globalIndex + index),
    publisher: overrides.publisher ?? pick(PUBLISHERS, globalIndex + index),
    institution: overrides.institution ?? pick(INSTITUTIONS, globalIndex + index),
    siteName: overrides.siteName ?? pick(SITES, globalIndex + index),
    place: overrides.place ?? pick(PLACES, globalIndex + index),
    volume: overrides.volume ?? String(8 + ((globalIndex + index) % 15)),
    issue: overrides.issue ?? String(1 + ((globalIndex + index) % 4)),
    locator: overrides.locator ?? { kind: 'pages', value: makePages(globalIndex) },
    doi: overrides.doi ?? makeDoi(family.code, globalIndex),
    url: overrides.url ?? makeUrl(family.code, globalIndex),
    edition: overrides.edition ?? `${2 + ((globalIndex + index) % 3)}nd ed.`,
    reportNumber: overrides.reportNumber ?? `${family.code}-RPT-${pad3(index + 1)}`,
    accessed: overrides.accessed ?? '22 Mar 2026',
    arxivId: overrides.arxivId ?? `arXiv:${24 + ((globalIndex + index) % 2)}03.${String(1000 + globalIndex).padStart(4, '0')}`,
    ...overrides,
  };
}

function manifestEntry(seed: CitationSeed, raw: string): ManifestEntry {
  return {
    caseId: seed.caseId,
    familyId: seed.familyId,
    familyName: seed.familyName,
    expectedStyle: seed.expectedStyle,
    expectedReferenceType: seed.expectedReferenceType,
    edgeTags: seed.edgeTags,
    expectedFields: {
      authors: seed.authors,
      editors: seed.editors ?? [],
      title: seed.title,
      year: String(seed.year),
      journal: seed.journal,
      conferenceTitle: seed.conferenceTitle,
      bookTitle: seed.bookTitle,
      publisher: seed.publisher,
      institution: seed.institution,
      volume: seed.volume,
      issue: seed.issue,
      pages: seed.locator?.kind === 'pages' ? seed.locator.value : undefined,
      articleNumber: seed.locator?.kind === 'article-number' ? seed.locator.value : undefined,
      doi: seed.doi,
      url: seed.url,
      edition: seed.edition,
      reportNumber: seed.reportNumber,
    },
    raw,
  };
}

const FAMILIES: FamilyDefinition[] = [
  {
    id: 'apa_journal_single',
    code: 'APAJ',
    name: 'APA journal single-line',
    expectedStyle: 'apa',
    expectedReferenceType: 'journal',
    edgeTags: ['single_line', 'apa', 'journal', 'doi_inline'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.apa_journal_single, index, globalIndex, {
      locator: { kind: 'pages', value: makePages(globalIndex) },
    }),
    render: (seed) => `${formatApaAuthors(seed.authors)} (${seed.year}). ${seed.title}. ${seed.journal}, ${seed.volume}(${seed.issue}), ${seed.locator?.value}. https://doi.org/${seed.doi}`,
  },
  {
    id: 'apa_journal_multiline_doi',
    code: 'APAM',
    name: 'APA journal multiline DOI continuation',
    expectedStyle: 'apa',
    expectedReferenceType: 'journal',
    edgeTags: ['multiline', 'apa', 'journal', 'doi_continuation'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.apa_journal_multiline_doi, index, globalIndex, {
      locator: { kind: 'pages', value: makeShortPages(globalIndex) },
    }),
    render: (seed) => [
      `${formatApaAuthors(seed.authors)} (${seed.year}). ${seed.title}.`,
      `${seed.journal}, ${seed.volume}(${seed.issue}), ${seed.locator?.value}.`,
      `https://doi.org/${seed.doi}`,
    ].join('\n'),
  },
  {
    id: 'apa_report_corporate',
    code: 'APAR',
    name: 'APA report corporate author',
    expectedStyle: 'apa',
    expectedReferenceType: 'report',
    edgeTags: ['apa', 'report', 'corporate_author', 'report_number'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.apa_report_corporate, index, globalIndex, {
      authors: [{ kind: 'literal', literal: pick(CORPORATE_POOL, globalIndex) }],
      locator: undefined,
      volume: undefined,
      issue: undefined,
      journal: undefined,
      conferenceTitle: undefined,
      bookTitle: undefined,
      doi: undefined,
    }),
    render: (seed) => `${seed.authors[0].kind === 'literal' ? seed.authors[0].literal : formatApaAuthors(seed.authors)} (${seed.year}). ${seed.title} (Report No. ${seed.reportNumber}). ${seed.place}: ${seed.publisher}. ${seed.url}`,
  },
  {
    id: 'apa_thesis',
    code: 'APAT',
    name: 'APA thesis dissertation',
    expectedStyle: 'apa',
    expectedReferenceType: 'thesis',
    edgeTags: ['apa', 'thesis', 'institution'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.apa_thesis, index, globalIndex, {
      authors: personAuthors(globalIndex + 2, 1),
      locator: undefined,
      volume: undefined,
      issue: undefined,
      journal: undefined,
      conferenceTitle: undefined,
      bookTitle: undefined,
      publisher: undefined,
      doi: undefined,
    }),
    render: (seed) => `${formatApaAuthors(seed.authors)} (${seed.year}). ${seed.title} (Doctoral dissertation, ${seed.institution}). ${seed.url}`,
  },
  {
    id: 'apa_book_chapter',
    code: 'APAC',
    name: 'APA book chapter',
    expectedStyle: 'apa',
    expectedReferenceType: 'chapter',
    edgeTags: ['apa', 'chapter', 'editors', 'book_title'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.apa_book_chapter, index, globalIndex, {
      authors: personAuthors(globalIndex + 1, 2),
      editors: editorAuthors(globalIndex + 4),
      locator: { kind: 'pages', value: `${25 + (index * 6)}-${40 + (index * 6)}` },
      volume: undefined,
      issue: undefined,
      journal: undefined,
      conferenceTitle: undefined,
      doi: undefined,
      url: undefined,
    }),
    render: (seed) => `${formatApaAuthors(seed.authors)} (${seed.year}). ${seed.title}. In ${formatApaAuthors(seed.editors ?? [])} (Eds.), ${seed.bookTitle} (pp. ${seed.locator?.value}). ${seed.publisher}.`,
  },
  {
    id: 'harvard_journal_pp',
    code: 'HVJ',
    name: 'Harvard journal with vol/no/pp',
    expectedStyle: 'harvard-ctr',
    expectedReferenceType: 'journal',
    edgeTags: ['harvard', 'journal', 'pp_locator'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.harvard_journal_pp, index, globalIndex, {
      locator: { kind: 'pages', value: makePages(globalIndex + 5) },
    }),
    render: (seed) => `${formatHarvardAuthors(seed.authors)} ${seed.year}, '${seed.title}', ${seed.journal}, vol. ${seed.volume}, no. ${seed.issue}, pp. ${seed.locator?.value}, doi: ${seed.doi}.`,
  },
  {
    id: 'harvard_book',
    code: 'HVB',
    name: 'Harvard book',
    expectedStyle: 'harvard-ctr',
    expectedReferenceType: 'book',
    edgeTags: ['harvard', 'book', 'edition', 'publisher'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.harvard_book, index, globalIndex, {
      authors: personAuthors(globalIndex + 3, 2),
      locator: undefined,
      volume: undefined,
      issue: undefined,
      journal: undefined,
      conferenceTitle: undefined,
      doi: undefined,
      url: undefined,
    }),
    render: (seed) => `${formatHarvardAuthors(seed.authors)} ${seed.year}, ${seed.title}, ${seed.edition}, ${seed.publisher}, ${seed.place}.`,
  },
  {
    id: 'harvard_website_accessed',
    code: 'HVW',
    name: 'Harvard website with accessed date',
    expectedStyle: 'harvard-ctr',
    expectedReferenceType: 'website',
    edgeTags: ['harvard', 'website', 'accessed', 'url_continuation'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.harvard_website_accessed, index, globalIndex, {
      authors: [{ kind: 'literal', literal: pick(CORPORATE_POOL, globalIndex + 2) }],
      locator: undefined,
      volume: undefined,
      issue: undefined,
      journal: undefined,
      conferenceTitle: undefined,
      bookTitle: undefined,
      publisher: undefined,
      doi: undefined,
    }),
    render: (seed) => [
      `${seed.authors[0].kind === 'literal' ? seed.authors[0].literal : formatHarvardAuthors(seed.authors)} ${seed.year}, '${seed.title}', ${seed.siteName}, viewed ${seed.accessed}.`,
      `Available at: ${seed.url}.`,
    ].join('\n'),
  },
  {
    id: 'harvard_conference',
    code: 'HVC',
    name: 'Harvard conference proceedings',
    expectedStyle: 'harvard-ctr',
    expectedReferenceType: 'conference',
    edgeTags: ['harvard', 'conference', 'proceedings'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.harvard_conference, index, globalIndex, {
      locator: { kind: 'pages', value: `${55 + (index * 7)}-${68 + (index * 7)}` },
      journal: undefined,
      doi: undefined,
      url: undefined,
    }),
    render: (seed) => `${formatHarvardAuthors(seed.authors)} ${seed.year}, '${seed.title}', in ${seed.conferenceTitle}, ${seed.place}, pp. ${seed.locator?.value}, ${seed.publisher}.`,
  },
  {
    id: 'chicago_ad_journal',
    code: 'CDA',
    name: 'Chicago author-date journal',
    expectedStyle: 'chicago-ad',
    expectedReferenceType: 'journal',
    edgeTags: ['chicago_ad', 'journal'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.chicago_ad_journal, index, globalIndex, {}),
    render: (seed) => `${formatChicagoAuthors(seed.authors)}. ${seed.year}. "${seed.title}." ${seed.journal} ${seed.volume}, no. ${seed.issue}: ${seed.locator?.value}. https://doi.org/${seed.doi}.`,
  },
  {
    id: 'chicago_ad_report',
    code: 'CDR',
    name: 'Chicago author-date report',
    expectedStyle: 'chicago-ad',
    expectedReferenceType: 'report',
    edgeTags: ['chicago_ad', 'report', 'corporate_author'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.chicago_ad_report, index, globalIndex, {
      authors: [{ kind: 'literal', literal: pick(CORPORATE_POOL, globalIndex + 5) }],
      locator: undefined,
      volume: undefined,
      issue: undefined,
      journal: undefined,
      conferenceTitle: undefined,
      bookTitle: undefined,
      doi: undefined,
    }),
    render: (seed) => `${seed.authors[0].kind === 'literal' ? seed.authors[0].literal : formatChicagoAuthors(seed.authors)}. ${seed.year}. ${seed.title}. ${seed.place}: ${seed.publisher}. ${seed.url}.`,
  },
  {
    id: 'chicago_nb_chapter',
    code: 'CNB',
    name: 'Chicago notes-bibliography chapter',
    expectedStyle: 'chicago-nb',
    expectedReferenceType: 'chapter',
    edgeTags: ['chicago_nb', 'chapter', 'edited_book'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.chicago_nb_chapter, index, globalIndex, {
      authors: personAuthors(globalIndex + 2, 2),
      editors: editorAuthors(globalIndex + 7),
      locator: { kind: 'pages', value: `${33 + (index * 8)}-${48 + (index * 8)}` },
      volume: undefined,
      issue: undefined,
      journal: undefined,
      conferenceTitle: undefined,
      doi: undefined,
      url: undefined,
    }),
    render: (seed) => `${formatChicagoAuthors(seed.authors)}. "${seed.title}." In ${seed.bookTitle}, edited by ${formatEditorList(seed.editors ?? [])}, ${seed.locator?.value}. ${seed.place}: ${seed.publisher}, ${seed.year}.`,
  },
  {
    id: 'chicago_nb_website',
    code: 'CNW',
    name: 'Chicago notes-bibliography website',
    expectedStyle: 'chicago-nb',
    expectedReferenceType: 'website',
    edgeTags: ['chicago_nb', 'website', 'quoted_title'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.chicago_nb_website, index, globalIndex, {
      authors: [{ kind: 'literal', literal: pick(CORPORATE_POOL, globalIndex + 6) }],
      locator: undefined,
      volume: undefined,
      issue: undefined,
      journal: undefined,
      conferenceTitle: undefined,
      bookTitle: undefined,
      publisher: undefined,
      doi: undefined,
    }),
    render: (seed) => `${seed.authors[0].kind === 'literal' ? seed.authors[0].literal : formatChicagoAuthors(seed.authors)}. "${seed.title}." ${seed.siteName}. Accessed ${seed.accessed}. ${seed.url}.`,
  },
  {
    id: 'mla_journal',
    code: 'MLJ',
    name: 'MLA journal',
    expectedStyle: 'mla',
    expectedReferenceType: 'journal',
    edgeTags: ['mla', 'journal', 'quoted_title'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.mla_journal, index, globalIndex, {
      authors: personAuthors(globalIndex + 1, 3),
    }),
    render: (seed) => `${formatMlaAuthors(seed.authors)}. "${seed.title}." ${seed.journal}, vol. ${seed.volume}, no. ${seed.issue}, ${seed.year}, pp. ${seed.locator?.value}, doi:${seed.doi}.`,
  },
  {
    id: 'mla_book',
    code: 'MLB',
    name: 'MLA book',
    expectedStyle: 'mla',
    expectedReferenceType: 'book',
    edgeTags: ['mla', 'book', 'publisher'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.mla_book, index, globalIndex, {
      authors: personAuthors(globalIndex + 3, 1),
      locator: undefined,
      volume: undefined,
      issue: undefined,
      journal: undefined,
      conferenceTitle: undefined,
      doi: undefined,
      url: undefined,
    }),
    render: (seed) => `${formatMlaAuthors(seed.authors)}. ${seed.title}. ${seed.publisher}, ${seed.year}.`,
  },
  {
    id: 'mla_thesis',
    code: 'MLT',
    name: 'MLA thesis',
    expectedStyle: 'mla',
    expectedReferenceType: 'thesis',
    edgeTags: ['mla', 'thesis', 'institution'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.mla_thesis, index, globalIndex, {
      authors: personAuthors(globalIndex + 5, 1),
      locator: undefined,
      volume: undefined,
      issue: undefined,
      journal: undefined,
      conferenceTitle: undefined,
      bookTitle: undefined,
      publisher: undefined,
      doi: undefined,
    }),
    render: (seed) => `${formatMlaAuthors(seed.authors)}. "${seed.title}." ${seed.institution}, ${seed.year}. PhD dissertation.`,
  },
  {
    id: 'ieee_journal',
    code: 'IEJ',
    name: 'IEEE journal with bracket numbering',
    expectedStyle: 'ieee',
    expectedReferenceType: 'journal',
    edgeTags: ['ieee', 'journal', 'numbered'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.ieee_journal, index, globalIndex, {
      authors: personAuthors(globalIndex + 2, 3),
    }),
    render: (seed) => `[${seed.globalIndex}] ${formatIeeeAuthors(seed.authors)}, "${seed.title}," ${seed.journal}, vol. ${seed.volume}, no. ${seed.issue}, pp. ${seed.locator?.value}, ${seed.year}, doi: ${seed.doi}.`,
  },
  {
    id: 'ieee_conference',
    code: 'IEC',
    name: 'IEEE conference proceedings',
    expectedStyle: 'ieee',
    expectedReferenceType: 'conference',
    edgeTags: ['ieee', 'conference', 'numbered', 'multiline'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.ieee_conference, index, globalIndex, {
      locator: { kind: 'pages', value: `${70 + (index * 6)}-${82 + (index * 6)}` },
      journal: undefined,
      doi: makeDoi('iec', globalIndex),
      url: undefined,
    }),
    render: (seed) => [
      `[${seed.globalIndex}] ${formatIeeeAuthors(seed.authors)}, "${seed.title},"`,
      `in ${seed.conferenceTitle}, ${seed.place}, ${seed.year}, pp. ${seed.locator?.value}, doi: ${seed.doi}.`,
    ].join('\n'),
  },
  {
    id: 'ieee_website_manual',
    code: 'IEW',
    name: 'IEEE website manual',
    expectedStyle: 'ieee',
    expectedReferenceType: 'website',
    edgeTags: ['ieee', 'website', 'manual', 'versioned'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.ieee_website_manual, index, globalIndex, {
      authors: [{ kind: 'literal', literal: pick(CORPORATE_POOL, globalIndex + 4) }],
      locator: undefined,
      volume: undefined,
      issue: undefined,
      journal: undefined,
      conferenceTitle: undefined,
      bookTitle: undefined,
      publisher: undefined,
      doi: undefined,
    }),
    render: (seed) => `[${seed.globalIndex}] ${seed.authors[0].kind === 'literal' ? seed.authors[0].literal : formatIeeeAuthors(seed.authors)}, "${seed.title}," ${seed.siteName}, ver. ${2 + (seed.familyIndex % 4)}.${seed.familyIndex}, ${seed.year}. [Online]. Available: ${seed.url}`,
  },
  {
    id: 'vancouver_compact_journal',
    code: 'VJC',
    name: 'Vancouver compact journal',
    expectedStyle: 'vancouver',
    expectedReferenceType: 'journal',
    edgeTags: ['vancouver', 'journal', 'compact_authors'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.vancouver_compact_journal, index, globalIndex, {
      authors: personAuthors(globalIndex + 1, 4),
      locator: { kind: 'pages', value: makeShortPages(globalIndex + 3) },
    }),
    render: (seed) => `${seed.globalIndex}. ${formatVancouverAuthors(seed.authors)}. ${seed.title}. ${seed.journal}. ${seed.year};${seed.volume}(${seed.issue}):${seed.locator?.value}. doi:${seed.doi}`,
  },
  {
    id: 'vancouver_colon_multiline',
    code: 'VJM',
    name: 'Vancouver colon-led multiline journal',
    expectedStyle: 'vancouver',
    expectedReferenceType: 'journal',
    edgeTags: ['vancouver', 'journal', 'colon_led', 'multiline'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.vancouver_colon_multiline, index, globalIndex, {
      authors: personAuthors(globalIndex + 2, 4),
      locator: { kind: 'pages', value: makeShortPages(globalIndex + 8) },
    }),
    render: (seed) => [
      `${seed.globalIndex}. ${formatVancouverAuthors(seed.authors)}: ${seed.title}.`,
      `${seed.journal}. ${seed.year}, ${seed.volume}:${seed.locator?.value}`,
      `${seed.doi}`,
    ].join('\n'),
  },
  {
    id: 'vancouver_report_corporate',
    code: 'VPR',
    name: 'Vancouver report corporate author',
    expectedStyle: 'vancouver',
    expectedReferenceType: 'report',
    edgeTags: ['vancouver', 'report', 'corporate_author'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.vancouver_report_corporate, index, globalIndex, {
      authors: [{ kind: 'literal', literal: pick(CORPORATE_POOL, globalIndex + 3) }],
      locator: undefined,
      volume: undefined,
      issue: undefined,
      journal: undefined,
      conferenceTitle: undefined,
      bookTitle: undefined,
      doi: undefined,
    }),
    render: (seed) => `${seed.globalIndex}. ${seed.authors[0].kind === 'literal' ? seed.authors[0].literal : formatVancouverAuthors(seed.authors)}. ${seed.title}. ${seed.place}: ${seed.publisher}; ${seed.year}. Report No.: ${seed.reportNumber}. Available from: ${seed.url}`,
  },
  {
    id: 'vancouver_preprint_arxiv',
    code: 'VPP',
    name: 'Vancouver preprint arXiv',
    expectedStyle: 'vancouver',
    expectedReferenceType: 'preprint',
    edgeTags: ['vancouver', 'preprint', 'arxiv'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.vancouver_preprint_arxiv, index, globalIndex, {
      authors: personAuthors(globalIndex + 2, 3),
      locator: undefined,
      volume: undefined,
      issue: undefined,
      journal: undefined,
      conferenceTitle: undefined,
      bookTitle: undefined,
      publisher: undefined,
      doi: undefined,
      url: `https://arxiv.org/abs/${String(2403000 + globalIndex).padStart(7, '0')}`,
    }),
    render: (seed) => `${seed.globalIndex}. ${formatVancouverAuthors(seed.authors)}. ${seed.title}. arXiv [Preprint]. ${seed.year}. Available from: ${seed.url}`,
  },
  {
    id: 'vancouver_website_guideline',
    code: 'VWW',
    name: 'Vancouver website guideline',
    expectedStyle: 'vancouver',
    expectedReferenceType: 'website',
    edgeTags: ['vancouver', 'website', 'guideline', 'available_from'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.vancouver_website_guideline, index, globalIndex, {
      authors: [{ kind: 'literal', literal: pick(CORPORATE_POOL, globalIndex + 8) }],
      locator: undefined,
      volume: undefined,
      issue: undefined,
      journal: undefined,
      conferenceTitle: undefined,
      bookTitle: undefined,
      publisher: undefined,
      doi: undefined,
    }),
    render: (seed) => [
      `${seed.globalIndex}. ${seed.authors[0].kind === 'literal' ? seed.authors[0].literal : formatVancouverAuthors(seed.authors)}. ${seed.title}. ${seed.siteName}. ${seed.year}.`,
      `Available from: ${seed.url}`,
    ].join('\n'),
  },
  {
    id: 'vancouver_article_number_journal',
    code: 'VJA',
    name: 'Vancouver article-number journal with et al.',
    expectedStyle: 'vancouver',
    expectedReferenceType: 'journal',
    edgeTags: ['vancouver', 'journal', 'article_number', 'et_al'],
    buildSeed: (index, globalIndex) => makeSeedBase(familyLookup.vancouver_article_number_journal, index, globalIndex, {
      authors: personAuthors(globalIndex + 1, 3),
      locator: { kind: 'article-number', value: makeArticleNumber(globalIndex) },
      issue: undefined,
    }),
    render: (seed) => `${seed.globalIndex}. ${formatVancouverAuthors(seed.authors)}, et al. ${seed.title}. ${seed.journal}. ${seed.year} ${pick(MONTHS, seed.familyIndex)};${seed.volume}:${seed.locator?.value}. doi:${seed.doi}`,
  },
];

familyLookup = Object.fromEntries(FAMILIES.map((family) => [family.id, family]));

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const citations: string[] = [];
  const manifest: Record<string, ManifestEntry> = {};
  let globalIndex = 1;

  for (const family of FAMILIES) {
    for (let familyIndex = 0; familyIndex < 10; familyIndex += 1) {
      const seed = family.buildSeed(familyIndex, globalIndex);
      const raw = family.render(seed).trim();
      citations.push(raw);
      manifest[seed.caseId] = manifestEntry(seed, raw);
      globalIndex += 1;
    }
  }

  fs.writeFileSync(FIXTURE_PATH, citations.join('\n\n'), 'utf8');
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(JSON.stringify({
    fixturePath: FIXTURE_PATH,
    manifestPath: MANIFEST_PATH,
    familyCount: FAMILIES.length,
    citationCount: citations.length,
    sourceTypes: [...new Set(FAMILIES.map((family) => family.expectedReferenceType))],
    styles: [...new Set(FAMILIES.map((family) => family.expectedStyle))],
  }, null, 2));
}

main();
