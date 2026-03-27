import Cite from 'citation-js';
import * as fuzzball from 'fuzzball';

export type BenchmarkSourceType =
  | 'journal'
  | 'conference'
  | 'book'
  | 'chapter'
  | 'report'
  | 'thesis';

export type BenchmarkInputStyle =
  | 'apa'
  | 'ieee'
  | 'vancouver'
  | 'harvard'
  | 'mla'
  | 'chicago';

export type BenchmarkPerturbation =
  | 'base'
  | 'numbered-dot'
  | 'numbered-bracket'
  | 'padded-whitespace'
  | 'wrapped-newlines'
  | 'smart-punctuation'
  | 'doi-label'
  | 'line-break-before-tail';

export type BenchmarkQuota = {
  sourceType: BenchmarkSourceType;
  crossrefType: string;
  target: number;
  sampleRounds: number;
};

export type BenchmarkAuthor = {
  given: string | null;
  family: string | null;
  literal?: string;
};

export type BenchmarkExpectedFields = {
  referenceType: BenchmarkSourceType;
  title: string;
  year: number;
  authors: string[];
  journal?: string;
  conferenceTitle?: string;
  bookTitle?: string;
  publisher?: string;
  institution?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
};

export type BenchmarkRecord = {
  id: string;
  sourceProvider: 'crossref';
  sourceType: BenchmarkSourceType;
  crossrefType: string;
  retrievalDate: string;
  sourceUrl: string;
  doi: string;
  inputStyle: BenchmarkInputStyle;
  perturbation: BenchmarkPerturbation;
  rawInput: string;
  expectedApa: string;
  expected: BenchmarkExpectedFields;
};

type RenderableExpectedFields = BenchmarkExpectedFields & {
  authorsStructured: BenchmarkAuthor[];
};

export type BenchmarkCorpus = {
  generatedAt: string;
  methodologyVersion: string;
  totalRecords: number;
  quotas: BenchmarkQuota[];
  records: BenchmarkRecord[];
};

type CrossrefContributor = {
  given?: string;
  family?: string;
  name?: string;
};

export type CrossrefWork = {
  DOI?: string;
  type?: string;
  title?: string[];
  subtitle?: string[];
  author?: CrossrefContributor[];
  editor?: CrossrefContributor[];
  issued?: { 'date-parts'?: Array<Array<number | null>> };
  published?: { 'date-parts'?: Array<Array<number | null>> };
  'published-print'?: { 'date-parts'?: Array<Array<number | null>> };
  'published-online'?: { 'date-parts'?: Array<Array<number | null>> };
  created?: { 'date-parts'?: Array<Array<number | null>> };
  publisher?: string;
  'publisher-location'?: string;
  'container-title'?: string[];
  'short-container-title'?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  'article-number'?: string;
};

type CSLAuthor = {
  family?: string;
  given?: string;
  literal?: string;
};

type CSLData = {
  id: string;
  type: string;
  title: string;
  author?: CSLAuthor[];
  editor?: CSLAuthor[];
  issued?: { 'date-parts': number[][] };
  'container-title'?: string;
  publisher?: string;
  'publisher-place'?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  URL?: string;
  genre?: string;
};

export const BENCHMARK_QUOTAS: BenchmarkQuota[] = [
  { sourceType: 'journal', crossrefType: 'journal-article', target: 550, sampleRounds: 8 },
  { sourceType: 'conference', crossrefType: 'proceedings-article', target: 150, sampleRounds: 4 },
  { sourceType: 'book', crossrefType: 'book', target: 100, sampleRounds: 3 },
  { sourceType: 'chapter', crossrefType: 'book-chapter', target: 100, sampleRounds: 3 },
  { sourceType: 'report', crossrefType: 'report', target: 50, sampleRounds: 2 },
  { sourceType: 'thesis', crossrefType: 'dissertation', target: 50, sampleRounds: 3 },
];

const STYLE_ROTATION: Record<BenchmarkSourceType, BenchmarkInputStyle[]> = {
  journal: ['apa', 'ieee', 'vancouver', 'harvard', 'mla', 'chicago'],
  conference: ['apa', 'ieee', 'vancouver', 'harvard', 'mla', 'chicago'],
  book: ['apa', 'harvard', 'mla', 'chicago', 'ieee', 'vancouver'],
  chapter: ['apa', 'mla', 'chicago', 'harvard', 'ieee', 'vancouver'],
  report: ['apa', 'harvard', 'mla', 'chicago', 'ieee', 'vancouver'],
  thesis: ['apa', 'harvard', 'mla', 'chicago'],
};

const PERTURBATION_ROTATION: BenchmarkPerturbation[] = [
  'base',
  'numbered-dot',
  'numbered-bracket',
  'padded-whitespace',
  'wrapped-newlines',
  'smart-punctuation',
  'doi-label',
  'line-break-before-tail',
];

export function stripHtml(value: string | undefined): string {
  return decodeEntities((value ?? '').replace(/<[^>]+>/g, ' '));
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function cleanText(value: string | undefined): string {
  return stripHtml(value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeComparisonText(value: string | undefined | null): string {
  return cleanText(value ?? '')
    .toLowerCase()
    .replace(/https?:\/\/doi\.org\//g, '')
    .replace(/\bdoi:\s*/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePages(value: string | undefined | null): string {
  return cleanText(value ?? '').replace(/[–—]/g, '-');
}

export function similarityPercent(left: string | undefined | null, right: string | undefined | null): number {
  const a = normalizeComparisonText(left);
  const b = normalizeComparisonText(right);
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  return fuzzball.ratio(a, b);
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + substitutionCost,
      );
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index]!;
    }
  }

  return previous[right.length] ?? 0;
}

export function normalizedLevenshteinRatio(left: string | undefined | null, right: string | undefined | null): number {
  const a = normalizeComparisonText(left);
  const b = normalizeComparisonText(right);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const denominator = Math.max(a.length, b.length, 1);
  return Number((1 - (levenshteinDistance(a, b) / denominator)).toFixed(4));
}

export function exactNormalizedMatch(left: string | undefined | null, right: string | undefined | null): boolean {
  return normalizeComparisonText(left) === normalizeComparisonText(right);
}

export function toPercent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function mean(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number((((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2).toFixed(2));
  }
  return Number((sorted[mid] ?? 0).toFixed(2));
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number((sorted[position] ?? 0).toFixed(2));
}

export function pickStyle(sourceType: BenchmarkSourceType, index: number): BenchmarkInputStyle {
  const pool = STYLE_ROTATION[sourceType];
  return pool[index % pool.length] ?? pool[0];
}

export function pickPerturbation(index: number): BenchmarkPerturbation {
  return PERTURBATION_ROTATION[index % PERTURBATION_ROTATION.length] ?? 'base';
}

export function sanitizeIdFragment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function extractYear(item: CrossrefWork): number | null {
  const candidates = [
    item.issued?.['date-parts']?.[0]?.[0],
    item['published-print']?.['date-parts']?.[0]?.[0],
    item['published-online']?.['date-parts']?.[0]?.[0],
    item.published?.['date-parts']?.[0]?.[0],
    item.created?.['date-parts']?.[0]?.[0],
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return null;
}

export function mapContributors(contributors: CrossrefContributor[] | undefined): BenchmarkAuthor[] {
  const mapped = (contributors ?? [])
    .map<BenchmarkAuthor | null>((contributor) => {
      const literal = cleanText(contributor.name);
      const family = cleanText(contributor.family);
      const given = cleanText(contributor.given);
      if (literal && !family && !given) {
        return { given: null, family: null, literal };
      }
      if (!literal && !family && !given) return null;
      return {
        given: given || null,
        family: family || null,
        literal: literal && !family ? literal : undefined,
      };
    });

  return mapped.filter((author): author is BenchmarkAuthor => author !== null);
}

function authorToCsl(author: BenchmarkAuthor): CSLAuthor {
  if (author.literal && !author.family) {
    return { literal: author.literal };
  }
  return {
    family: author.family ?? undefined,
    given: author.given ?? undefined,
  };
}

function authorDisplayName(author: BenchmarkAuthor): string {
  if (author.literal && !author.family) return author.literal;
  if (author.family && author.given) return `${author.family}, ${author.given}`;
  return author.family ?? author.given ?? author.literal ?? 'Unknown';
}

function familyOrLiteral(author: BenchmarkAuthor): string {
  return cleanText(author.family ?? author.literal ?? author.given ?? '');
}

function compactInitials(given: string | null): string {
  return cleanText(given ?? '')
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}

function invertName(author: BenchmarkAuthor): string {
  if (author.literal && !author.family) return author.literal;
  const family = author.family ?? '';
  const given = author.given ?? '';
  return cleanText(`${family}, ${given}`.replace(/,\s*$/, ''));
}

function firstLast(author: BenchmarkAuthor): string {
  if (author.literal && !author.family) return author.literal;
  return cleanText(`${author.given ?? ''} ${author.family ?? ''}`);
}

function harvardName(author: BenchmarkAuthor): string {
  if (author.literal && !author.family) return author.literal;
  return cleanText(`${author.family ?? ''}, ${compactInitials(author.given)}`);
}

function vancouverName(author: BenchmarkAuthor): string {
  if (author.literal && !author.family) return author.literal;
  return cleanText(`${author.family ?? ''} ${compactInitials(author.given)}`);
}

function joinAuthors(authors: BenchmarkAuthor[], formatter: (author: BenchmarkAuthor) => string, finalJoiner: string): string {
  const rendered = authors.map(formatter).filter(Boolean);
  if (rendered.length <= 1) return rendered[0] ?? '';
  if (rendered.length === 2) return `${rendered[0]}${finalJoiner}${rendered[1]}`;
  return `${rendered.slice(0, -1).join(', ')},${finalJoiner}${rendered[rendered.length - 1]}`;
}

function renderApaAuthors(authors: BenchmarkAuthor[]): string {
  return joinAuthors(authors, invertName, ' & ');
}

function renderHarvardAuthors(authors: BenchmarkAuthor[]): string {
  return joinAuthors(authors, harvardName, ' and ');
}

function renderIeeeAuthors(authors: BenchmarkAuthor[]): string {
  return joinAuthors(authors, firstLast, ' and ');
}

function renderVancouverAuthors(authors: BenchmarkAuthor[]): string {
  return `${authors.map(vancouverName).join(', ')}.`;
}

function renderMlaAuthors(authors: BenchmarkAuthor[]): string {
  const first = authors[0];
  if (!first) return '';
  if (authors.length === 1) return `${invertName(first)}.`;
  const rest = authors.slice(1).map(firstLast);
  if (rest.length === 1) return `${invertName(first)}, and ${rest[0]}.`;
  return `${invertName(first)}, ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1]}.`;
}

function renderChicagoAuthors(authors: BenchmarkAuthor[]): string {
  return renderMlaAuthors(authors);
}

function renderJournalCitation(record: RenderableExpectedFields, style: BenchmarkInputStyle): string {
  const authors = record.authorsStructured;
  const pages = record.pages ?? '';
  switch (style) {
    case 'apa':
      return `${renderApaAuthors(authors)} (${record.year}). ${record.title}. ${record.journal}, ${record.volume ?? ''}${record.issue ? `(${record.issue})` : ''}${pages ? `, ${pages}` : ''}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'ieee':
      return `${renderIeeeAuthors(authors)}, "${record.title}," ${record.journal}, vol. ${record.volume ?? ''}${record.issue ? `, no. ${record.issue}` : ''}${pages ? `, pp. ${pages}` : ''}, ${record.year}.${record.doi ? ` doi: ${record.doi}` : ''}`;
    case 'vancouver':
      return `${renderVancouverAuthors(authors)} ${record.title}. ${record.journal}. ${record.year};${record.volume ?? ''}${record.issue ? `(${record.issue})` : ''}${pages ? `:${pages}` : ''}.${record.doi ? ` doi:${record.doi}` : ''}`;
    case 'harvard':
      return `${renderHarvardAuthors(authors)}, ${record.year}. ${record.title}. ${record.journal}, ${record.volume ?? ''}${record.issue ? `(${record.issue})` : ''}${pages ? `, pp.${pages}` : ''}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'mla':
      return `${renderMlaAuthors(authors)} "${record.title}." ${record.journal}, vol. ${record.volume ?? ''}${record.issue ? `, no. ${record.issue}` : ''}, ${record.year}${pages ? `, pp. ${pages}` : ''}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'chicago':
      return `${renderChicagoAuthors(authors)} "${record.title}." ${record.journal} ${record.volume ?? ''}${record.issue ? `, no. ${record.issue}` : ''} (${record.year})${pages ? `: ${pages}` : ''}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
  }
}

function renderConferenceCitation(record: RenderableExpectedFields, style: BenchmarkInputStyle): string {
  const authors = record.authorsStructured;
  const pages = record.pages ?? '';
  switch (style) {
    case 'apa':
      return `${renderApaAuthors(authors)} (${record.year}). ${record.title}. In ${record.conferenceTitle}${pages ? ` (pp. ${pages})` : ''}.${record.publisher ? ` ${record.publisher}.` : ''}${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'ieee':
      return `${renderIeeeAuthors(authors)}, "${record.title}," in ${record.conferenceTitle}${pages ? `, pp. ${pages}` : ''}, ${record.year}.${record.doi ? ` doi: ${record.doi}` : ''}`;
    case 'vancouver':
      return `${renderVancouverAuthors(authors)} ${record.title}. In: ${record.conferenceTitle}. ${record.year}${pages ? `;${pages}` : ''}.${record.doi ? ` doi:${record.doi}` : ''}`;
    case 'harvard':
      return `${renderHarvardAuthors(authors)}, ${record.year}. ${record.title}. In ${record.conferenceTitle}${pages ? ` (pp.${pages})` : ''}.${record.publisher ? ` ${record.publisher}.` : ''}${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'mla':
      return `${renderMlaAuthors(authors)} "${record.title}." ${record.conferenceTitle}, ${record.year}${pages ? `, pp. ${pages}` : ''}.${record.publisher ? ` ${record.publisher}.` : ''}${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'chicago':
      return `${renderChicagoAuthors(authors)} "${record.title}." In ${record.conferenceTitle}${pages ? `, ${pages}` : ''}. ${record.publisher ? `${record.publisher}, ` : ''}${record.year}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
  }
}

function renderBookCitation(record: RenderableExpectedFields, style: BenchmarkInputStyle): string {
  const authors = record.authorsStructured;
  switch (style) {
    case 'apa':
      return `${renderApaAuthors(authors)} (${record.year}). ${record.title}.${record.publisher ? ` ${record.publisher}.` : ''}${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'ieee':
      return `${renderIeeeAuthors(authors)}, ${record.title}. ${record.publisher ?? 'Unknown publisher'}, ${record.year}.${record.doi ? ` doi: ${record.doi}` : ''}`;
    case 'vancouver':
      return `${renderVancouverAuthors(authors)} ${record.title}. ${record.publisher ?? 'Unknown publisher'}; ${record.year}.${record.doi ? ` doi:${record.doi}` : ''}`;
    case 'harvard':
      return `${renderHarvardAuthors(authors)}, ${record.year}. ${record.title}. ${record.publisher ?? 'Unknown publisher'}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'mla':
      return `${renderMlaAuthors(authors)} ${record.title}. ${record.publisher ?? 'Unknown publisher'}, ${record.year}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'chicago':
      return `${renderChicagoAuthors(authors)} ${record.title}. ${record.publisher ?? 'Unknown publisher'}, ${record.year}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
  }
}

function renderChapterCitation(record: RenderableExpectedFields, style: BenchmarkInputStyle): string {
  const authors = record.authorsStructured;
  const pages = record.pages ?? '';
  switch (style) {
    case 'apa':
      return `${renderApaAuthors(authors)} (${record.year}). ${record.title}. In ${record.bookTitle}${pages ? ` (pp. ${pages})` : ''}.${record.publisher ? ` ${record.publisher}.` : ''}${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'ieee':
      return `${renderIeeeAuthors(authors)}, "${record.title}," in ${record.bookTitle}${pages ? `, pp. ${pages}` : ''}. ${record.publisher ?? 'Unknown publisher'}, ${record.year}.${record.doi ? ` doi: ${record.doi}` : ''}`;
    case 'vancouver':
      return `${renderVancouverAuthors(authors)} ${record.title}. In: ${record.bookTitle}${pages ? `. p. ${pages}` : ''}. ${record.publisher ?? 'Unknown publisher'}; ${record.year}.${record.doi ? ` doi:${record.doi}` : ''}`;
    case 'harvard':
      return `${renderHarvardAuthors(authors)}, ${record.year}. ${record.title}. In ${record.bookTitle}${pages ? `, pp.${pages}` : ''}. ${record.publisher ?? 'Unknown publisher'}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'mla':
      return `${renderMlaAuthors(authors)} "${record.title}." ${record.bookTitle}${pages ? `, pp. ${pages}` : ''}. ${record.publisher ?? 'Unknown publisher'}, ${record.year}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'chicago':
      return `${renderChicagoAuthors(authors)} "${record.title}." In ${record.bookTitle}${pages ? `, ${pages}` : ''}. ${record.publisher ?? 'Unknown publisher'}, ${record.year}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
  }
}

function renderReportCitation(record: RenderableExpectedFields, style: BenchmarkInputStyle): string {
  const authors = record.authorsStructured;
  const organization = record.publisher ?? record.institution ?? 'Unknown organization';
  switch (style) {
    case 'apa':
      return `${renderApaAuthors(authors)} (${record.year}). ${record.title}. ${organization}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'ieee':
      return `${renderIeeeAuthors(authors)}, ${record.title}. ${organization}, ${record.year}.${record.doi ? ` doi: ${record.doi}` : ''}`;
    case 'vancouver':
      return `${renderVancouverAuthors(authors)} ${record.title}. ${organization}; ${record.year}.${record.doi ? ` doi:${record.doi}` : ''}`;
    case 'harvard':
      return `${renderHarvardAuthors(authors)}, ${record.year}. ${record.title}. ${organization}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'mla':
      return `${renderMlaAuthors(authors)} ${record.title}. ${organization}, ${record.year}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'chicago':
      return `${renderChicagoAuthors(authors)} ${record.title}. ${organization}, ${record.year}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
  }
}

function renderThesisCitation(record: RenderableExpectedFields, style: BenchmarkInputStyle): string {
  const authors = record.authorsStructured;
  const institution = record.institution ?? record.publisher ?? 'Unknown institution';
  switch (style) {
    case 'apa':
      return `${renderApaAuthors(authors)} (${record.year}). ${record.title} [Doctoral dissertation, ${institution}].${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'ieee':
      return `${renderIeeeAuthors(authors)}, ${record.title}, doctoral dissertation, ${institution}, ${record.year}.${record.doi ? ` doi: ${record.doi}` : ''}`;
    case 'vancouver':
      return `${renderVancouverAuthors(authors)} ${record.title} [dissertation]. ${institution}; ${record.year}.${record.doi ? ` doi:${record.doi}` : ''}`;
    case 'harvard':
      return `${renderHarvardAuthors(authors)}, ${record.year}. ${record.title}. Doctoral dissertation. ${institution}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'mla':
      return `${renderMlaAuthors(authors)} ${record.title}. ${institution}, ${record.year}. Dissertation.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
    case 'chicago':
      return `${renderChicagoAuthors(authors)} ${record.title}. Doctoral dissertation, ${institution}, ${record.year}.${record.doi ? ` https://doi.org/${record.doi}` : ''}`;
  }
}

export function renderInputCitation(record: RenderableExpectedFields, style: BenchmarkInputStyle): string {
  switch (record.referenceType) {
    case 'journal':
      return renderJournalCitation(record, style);
    case 'conference':
      return renderConferenceCitation(record, style);
    case 'book':
      return renderBookCitation(record, style);
    case 'chapter':
      return renderChapterCitation(record, style);
    case 'report':
      return renderReportCitation(record, style);
    case 'thesis':
      return renderThesisCitation(record, style);
  }
}

export function applyPerturbation(input: string, perturbation: BenchmarkPerturbation, index: number): string {
  switch (perturbation) {
    case 'base':
      return input;
    case 'numbered-dot':
      return `${index + 1}. ${input}`;
    case 'numbered-bracket':
      return `[${index + 1}] ${input}`;
    case 'padded-whitespace':
      return `  ${input}  `;
    case 'wrapped-newlines':
      return `\n${input}\n`;
    case 'smart-punctuation':
      return input
        .replace(/"([^"]+)"/g, '“$1”')
        .replace(/(\d)-(\d)/g, '$1–$2');
    case 'doi-label':
      return input.replace(/https?:\/\/doi\.org\//i, 'doi: ');
    case 'line-break-before-tail': {
      const lastPeriod = input.lastIndexOf('. ');
      if (lastPeriod > -1) {
        return `${input.slice(0, lastPeriod + 1)}\n${input.slice(lastPeriod + 2)}`;
      }
      return input;
    }
  }
}

export function makeMulberry32(seed: number): () => number {
  return () => {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deterministicShuffle<T>(values: readonly T[], seed = 947_563): T[] {
  const next = makeMulberry32(seed);
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(next() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swapIndex] as T;
    copy[swapIndex] = current as T;
  }
  return copy;
}

function toCslData(item: CrossrefWork, sourceType: BenchmarkSourceType, authors: BenchmarkAuthor[], year: number, title: string): CSLData {
  const doi = cleanText(item.DOI);
  const publisher = cleanText(item.publisher);
  const containerTitle = cleanText(item['container-title']?.[0]);
  const csl: CSLData = {
    id: doi || sanitizeIdFragment(title),
    type:
      sourceType === 'journal' ? 'article-journal'
        : sourceType === 'conference' ? 'paper-conference'
          : sourceType === 'book' ? 'book'
            : sourceType === 'chapter' ? 'chapter'
              : sourceType === 'report' ? 'report'
                : 'thesis',
    title,
    author: authors.map(authorToCsl),
    issued: { 'date-parts': [[year]] },
    DOI: doi || undefined,
    URL: doi ? `https://doi.org/${doi}` : undefined,
  };

  if (containerTitle) {
    csl['container-title'] = containerTitle;
  }
  if (publisher) {
    csl.publisher = publisher;
  }
  if (cleanText(item['publisher-location'])) {
    csl['publisher-place'] = cleanText(item['publisher-location']);
  }
  if (cleanText(item.volume)) {
    csl.volume = cleanText(item.volume);
  }
  if (cleanText(item.issue)) {
    csl.issue = cleanText(item.issue);
  }
  if (cleanText(item.page ?? item['article-number'])) {
    csl.page = cleanText(item.page ?? item['article-number']);
  }
  if (sourceType === 'thesis') {
    csl.genre = 'Doctoral dissertation';
  }

  return csl;
}

export function renderApaGroundTruth(csl: CSLData): string {
  const cite = new Cite([csl as unknown as Record<string, unknown>]);
  return cleanText(cite.format('bibliography', {
    template: 'apa',
    format: 'text',
  }));
}

function canUseRecord(sourceType: BenchmarkSourceType, item: CrossrefWork, authors: BenchmarkAuthor[], year: number | null, title: string): boolean {
  if (!cleanText(item.DOI) || !year || !title || !authors.length) return false;
  const containerTitle = cleanText(item['container-title']?.[0]);
  const publisher = cleanText(item.publisher);

  switch (sourceType) {
    case 'journal':
      return Boolean(containerTitle);
    case 'conference':
      return Boolean(containerTitle);
    case 'book':
      return Boolean(publisher);
    case 'chapter':
      return Boolean(containerTitle && publisher);
    case 'report':
      return Boolean(publisher);
    case 'thesis':
      return Boolean(publisher);
  }
}

export function crossrefToBenchmarkRecord(
  item: CrossrefWork,
  sourceType: BenchmarkSourceType,
  retrievalDate: string,
  index: number,
): BenchmarkRecord | null {
  const authors = mapContributors(item.author?.length ? item.author : item.editor);
  const year = extractYear(item);
  const title = cleanText([...(item.title ?? []), ...(item.subtitle ?? [])].filter(Boolean).join(': '));
  if (!canUseRecord(sourceType, item, authors, year, title)) return null;

  const expected: BenchmarkExpectedFields & { authorsStructured: BenchmarkAuthor[] } = {
    referenceType: sourceType,
    title,
    year: year as number,
    authors: authors.map(familyOrLiteral).filter(Boolean),
    authorsStructured: authors,
    journal: sourceType === 'journal' ? cleanText(item['container-title']?.[0]) : undefined,
    conferenceTitle: sourceType === 'conference' ? cleanText(item['container-title']?.[0]) : undefined,
    bookTitle: sourceType === 'chapter' ? cleanText(item['container-title']?.[0]) : undefined,
    publisher: cleanText(item.publisher) || undefined,
    institution: sourceType === 'thesis' ? cleanText(item.publisher) || undefined : undefined,
    volume: cleanText(item.volume) || undefined,
    issue: cleanText(item.issue) || undefined,
    pages: normalizePages(cleanText(item.page ?? item['article-number'])) || undefined,
    doi: cleanText(item.DOI) || undefined,
  };

  const inputStyle = pickStyle(sourceType, index);
  const perturbation = pickPerturbation(index);
  const rawBase = renderInputCitation(expected, inputStyle);
  const rawInput = applyPerturbation(rawBase, perturbation, index);
  const csl = toCslData(item, sourceType, authors, year as number, title);
  const expectedApa = renderApaGroundTruth(csl);
  const doi = cleanText(item.DOI);

  return {
    id: `${sourceType}-${String(index + 1).padStart(4, '0')}-${sanitizeIdFragment(doi)}`,
    sourceProvider: 'crossref',
    sourceType,
    crossrefType: cleanText(item.type) || sourceType,
    retrievalDate,
    sourceUrl: `https://doi.org/${doi}`,
    doi,
    inputStyle,
    perturbation,
    rawInput,
    expectedApa,
    expected: {
      referenceType: expected.referenceType,
      title: expected.title,
      year: expected.year,
      authors: expected.authors,
      journal: expected.journal,
      conferenceTitle: expected.conferenceTitle,
      bookTitle: expected.bookTitle,
      publisher: expected.publisher,
      institution: expected.institution,
      volume: expected.volume,
      issue: expected.issue,
      pages: expected.pages,
      doi: expected.doi,
    },
  };
}

export function chunkRecords<T>(records: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < records.length; index += chunkSize) {
    chunks.push(records.slice(index, index + chunkSize));
  }
  return chunks;
}

export function buildBatchContent(records: readonly BenchmarkRecord[]): string {
  return records.map((record) => record.rawInput).join('\n\n');
}

export function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function formatMs(value: number): string {
  return `${value.toFixed(2)} ms`;
}

export function normalizeOutputForIdentity(value: string | undefined | null): string {
  return cleanText(value ?? '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function bestVenue(expected: BenchmarkExpectedFields): string {
  return expected.journal
    ?? expected.conferenceTitle
    ?? expected.bookTitle
    ?? expected.publisher
    ?? expected.institution
    ?? '';
}

export function firstAuthor(expected: BenchmarkExpectedFields): string {
  return expected.authors[0] ?? '';
}
