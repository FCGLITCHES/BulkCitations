/**
 * Source adapters for building the stratified real-reference corpus.
 *
 * Each eval stratum maps to a real bibliographic source (Crossref, or OpenAlex
 * for language-filtered multilingual content) plus a degradation mode that
 * reproduces how that stratum's input actually arrives. Strata with no usable
 * API (webpages) are marked `manual` and reported, never faked.
 */
import {
  buildCandidateRow,
  degradeText,
  mapCrossrefItem,
  renderCitation,
  scopeFieldsForVariant,
  variantForType,
  type CandidateRow,
  type NormalizedReference,
} from './referenceCorpus.js';

export type DegradeMode = 'none' | 'pdf_wrap' | 'strip_punct';

export interface StratumPlan {
  source: 'crossref' | 'openalex' | 'wikipedia' | 'manual';
  crossrefType?: string | null;
  openAlexFilter?: string;
  degrade: DegradeMode;
  note?: string;
}

/** Real CSL styles for content-negotiated (publisher-formatted) citation strings. */
export const REAL_FORMAT_STYLES = [
  'apa',
  'vancouver',
  'harvard-cite-them-right',
  'modern-language-association',
  'chicago-author-date',
];

/** Canonical mapping from eval stratum → real source + degradation. */
export const STRATUM_PLAN: Record<string, StratumPlan> = {
  doi_heavy: { source: 'crossref', crossrefType: 'journal-article', degrade: 'none' },
  books: { source: 'crossref', crossrefType: 'book', degrade: 'none' },
  conference_papers: { source: 'crossref', crossrefType: 'proceedings-article', degrade: 'none' },
  gov_reports: { source: 'crossref', crossrefType: 'report', degrade: 'none' },
  theses: { source: 'crossref', crossrefType: 'dissertation', degrade: 'none' },
  pdf_paste: { source: 'crossref', crossrefType: 'journal-article', degrade: 'pdf_wrap' },
  missing_punctuation: { source: 'crossref', crossrefType: 'journal-article', degrade: 'strip_punct' },
  student_malformed: { source: 'crossref', crossrefType: 'journal-article', degrade: 'strip_punct' },
  google_scholar_export: {
    source: 'crossref',
    crossrefType: 'journal-article',
    degrade: 'none',
    note: 'Approximated from Crossref. For true Scholar export quirks, supplement with real .bib via ingest-bibliography.',
  },
  multilingual: {
    source: 'openalex',
    openAlexFilter: 'language:fr|de|es|pt|it|nl,type:article,has_doi:true',
    degrade: 'none',
  },
  webpages: {
    source: 'wikipedia',
    degrade: 'none',
    note: 'Real pages from the Wikipedia REST feed (title + canonical URL + accessed date). For other site types, supplement via ingest.',
  },
};

export async function fetchCrossref(type: string | null, count: number, mailto: string): Promise<Record<string, any>[]> {
  const select = 'author,editor,title,container-title,issued,published,volume,issue,page,DOI,publisher,publisher-location,type';
  const params = new URLSearchParams({ select, sample: String(Math.min(Math.max(count, 1), 100)) });
  if (type) params.set('filter', `type:${type},has-references:true`);
  if (mailto) params.set('mailto', mailto);
  const url = `https://api.crossref.org/works?${params.toString()}`;
  const response = await fetch(url, { headers: { 'User-Agent': `BulkReferences-corpus/1.0 (${mailto || 'mailto:unknown'})` } });
  if (!response.ok) throw new Error(`Crossref ${response.status}: ${await response.text().catch(() => '')}`);
  const payload = (await response.json()) as { message?: { items?: Record<string, any>[] } };
  return payload.message?.items ?? [];
}

export async function fetchOpenAlex(filter: string, count: number, mailto: string): Promise<Record<string, any>[]> {
  const perPage = Math.min(Math.max(count, 1), 200);
  const params = new URLSearchParams({ filter, 'per-page': String(perPage), sample: String(perPage), seed: '7' });
  if (mailto) params.set('mailto', mailto);
  const url = `https://api.openalex.org/works?${params.toString()}`;
  const response = await fetch(url, { headers: { 'User-Agent': `BulkReferences-corpus/1.0 (${mailto || 'mailto:unknown'})` } });
  if (!response.ok) throw new Error(`OpenAlex ${response.status}: ${await response.text().catch(() => '')}`);
  const payload = (await response.json()) as { results?: Record<string, any>[] };
  return payload.results ?? [];
}

function splitDisplayName(name: string): { family: string; given?: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { family: parts[0]! };
  const family = parts.pop()!;
  const person: { family: string; given?: string } = { family };
  const given = parts.join(' ');
  if (given) person.given = given;
  return person;
}

const OPENALEX_TYPE_MAP: Record<string, string> = {
  article: 'article-journal',
  'journal-article': 'article-journal',
  book: 'book',
  'book-chapter': 'chapter',
  dissertation: 'thesis',
  report: 'report',
  'proceedings-article': 'paper-conference',
};

export function mapOpenAlexItem(work: Record<string, any>): NormalizedReference {
  const authors = Array.isArray(work.authorships)
    ? work.authorships
        .map((a: any) => a?.author?.display_name ?? a?.raw_author_name)
        .filter((n: any): n is string => typeof n === 'string' && n.trim().length > 0)
        .map((n: string) => splitDisplayName(n))
    : [];

  const ref: NormalizedReference = { authors };
  const type = String(work.type ?? '');
  ref.type = OPENALEX_TYPE_MAP[type] ?? type ?? undefined;
  const title = work.title ?? work.display_name;
  if (title) ref.title = String(title).trim();
  if (work.publication_year) ref.year = String(work.publication_year);
  const journal = work.primary_location?.source?.display_name;
  if (journal) ref.journal = String(journal).trim();
  const biblio = work.biblio ?? {};
  if (biblio.volume) ref.volume = String(biblio.volume).trim();
  if (biblio.issue) ref.issue = String(biblio.issue).trim();
  if (biblio.first_page) {
    ref.pages = biblio.last_page ? `${biblio.first_page}-${biblio.last_page}` : String(biblio.first_page);
  }
  if (typeof work.doi === 'string') ref.doi = work.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
  return ref;
}

/** Fetch real pages from the Wikipedia REST "featured" feed (no key, public). */
export async function fetchWikipedia(count: number, lang = 'en', feedDate = '2024/01/15'): Promise<Record<string, any>[]> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/feed/featured/${feedDate}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'BulkReferences-corpus/1.0 (mailto:unknown)', accept: 'application/json' } });
  if (!response.ok) throw new Error(`Wikipedia ${response.status}: ${await response.text().catch(() => '')}`);
  const payload = (await response.json()) as { mostread?: { articles?: Record<string, any>[] }; tfa?: Record<string, any> };
  const articles = [...(payload.mostread?.articles ?? [])];
  if (payload.tfa) articles.unshift(payload.tfa);
  return articles.slice(0, Math.max(1, count));
}

export function mapWikipediaArticle(article: Record<string, any>, accessedDate: string, lang = 'en'): NormalizedReference {
  const title = article.normalizedtitle ?? article.titles?.normalized ?? article.title ?? '';
  const url = article.content_urls?.desktop?.page ?? article.content_urls?.mobile?.page ?? '';
  const ref: NormalizedReference = { authors: [], type: 'webpage' };
  if (title) ref.title = String(title).replace(/_/g, ' ').trim();
  ref.siteName = lang === 'en' ? 'Wikipedia' : `Wikipedia (${lang})`;
  ref.accessedDate = accessedDate;
  if (url) ref.url = String(url);
  return ref;
}

/** Content-negotiate a REAL publisher-formatted citation string for a DOI. */
export async function fetchFormattedCitation(doi: string, style: string, mailto: string): Promise<string | null> {
  try {
    const response = await fetch(`https://doi.org/${doi}`, {
      headers: {
        accept: `text/x-bibliography; style=${style}`,
        'User-Agent': `BulkReferences-corpus/1.0 (${mailto || 'mailto:unknown'})`,
      },
    });
    if (!response.ok) return null;
    const text = (await response.text()).replace(/\s+/g, ' ').trim();
    return text || null;
  } catch {
    return null;
  }
}

export interface StratumBuildResult {
  stratum: string;
  source: string;
  fetched: number;
  rows: CandidateRow[];
  note?: string;
}

export interface BuildStratumOptions {
  mailto: string;
  split: string;
  applyDegrade?: boolean;
  /** Use content-negotiated publisher formatting (real strings) instead of rendering. */
  realFormat?: boolean;
  /** Accessed date stamped on webpage rows (caller supplies; keeps this module Date-free). */
  accessedDate?: string;
}

/** Fetch + render/format + degrade + auto-project one stratum into candidate rows. */
export async function buildStratumRows(
  stratum: string,
  count: number,
  opts: BuildStratumOptions,
): Promise<StratumBuildResult> {
  const plan = STRATUM_PLAN[stratum] ?? { source: 'crossref' as const, crossrefType: 'journal-article', degrade: 'none' as const };
  if (plan.source === 'manual') {
    const manual: StratumBuildResult = { stratum, source: 'manual', fetched: 0, rows: [] };
    if (plan.note) manual.note = plan.note;
    return manual;
  }

  let items: Record<string, any>[];
  if (plan.source === 'wikipedia') items = await fetchWikipedia(count);
  else if (plan.source === 'openalex') items = await fetchOpenAlex(plan.openAlexFilter ?? '', count, opts.mailto);
  else items = await fetchCrossref(plan.crossrefType ?? null, count, opts.mailto);

  const degradeMode: DegradeMode = opts.applyDegrade === false ? 'none' : plan.degrade;
  const accessedDate = opts.accessedDate ?? 'the access date';
  const rows: CandidateRow[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const ref =
      plan.source === 'wikipedia' ? mapWikipediaArticle(item, accessedDate)
      : plan.source === 'openalex' ? mapOpenAlexItem(item)
      : mapCrossrefItem(item);

    if (!ref.title) continue;
    const isWeb = ref.type === 'webpage' || Boolean(ref.siteName);
    if (ref.authors.length === 0 && !isWeb) continue; // articles/books need an author; webpages may not

    const variant = variantForType(ref.type, index);
    const scoped = scopeFieldsForVariant(ref, variant);

    let raw: string;
    if (opts.realFormat && ref.doi) {
      const style = REAL_FORMAT_STYLES[index % REAL_FORMAT_STYLES.length]!;
      const formatted = await fetchFormattedCitation(ref.doi, style, opts.mailto);
      raw = formatted ?? renderCitation(ref, variant);
    } else {
      raw = degradeText(renderCitation(ref, variant), degradeMode, index);
    }

    rows.push(buildCandidateRow(raw, scoped, {
      stratum,
      split: opts.split,
      provenance: `${plan.source}${opts.realFormat ? '/realfmt' : ''}:${ref.doi ?? `idx${index}`}`,
    }));
  }

  const result: StratumBuildResult = { stratum, source: plan.source, fetched: items.length, rows };
  if (plan.note) result.note = plan.note;
  return result;
}
