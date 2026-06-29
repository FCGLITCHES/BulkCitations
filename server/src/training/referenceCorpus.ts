/**
 * Real-reference corpus building.
 *
 * The content of every row here is REAL (fetched from Crossref/OpenAlex or
 * parsed from a user's BibTeX/RIS export) — only the surface formatting may be
 * rendered or degraded. That is categorically different from the synthetic
 * bootstrap, whose *content* was fabricated. Field values are projected onto the
 * rendered text through the same hardened aligner the export uses, so each row
 * arrives pre-labelled and a human only has to verify the flagged spans.
 */
import { projectExpectedFields } from './bioSupervisionExport.js';

export interface NormalizedReference {
  authors: Array<{ family: string; given?: string }>;
  editors?: Array<{ family: string; given?: string }>;
  year?: string;
  title?: string;
  journal?: string;
  bookTitle?: string;
  conferenceTitle?: string;
  publisher?: string;
  institution?: string;
  placeOfPublication?: string;
  siteName?: string;
  accessedDate?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  type?: string;
}

export interface CandidateRow {
  raw_text: string;
  stratum: string;
  expected_type: string | null;
  entity_fields: string[];
  entity_starts: number[];
  entity_ends: number[];
  entity_texts: string[];
  expected_fields: Record<string, unknown>;
  dataset_split: string;
  trust_level: string;
  provenance: string;
  needs_review: boolean;
  unprojected_fields: string[];
}

const CROSSREF_TYPE_MAP: Record<string, string> = {
  'journal-article': 'article-journal',
  'proceedings-article': 'paper-conference',
  'book': 'book',
  'monograph': 'book',
  'book-chapter': 'chapter',
  'report': 'report',
  'dissertation': 'thesis',
  'posted-content': 'article',
};

/** Map a raw Crossref `message.items[]` entry into a normalized reference. */
export function mapCrossrefItem(item: Record<string, any>): NormalizedReference {
  const toPerson = (raw: any, fallbackName = false): { family: string; given?: string } => {
    const person: { family: string; given?: string } = {
      family: String((fallbackName ? raw.family ?? raw.name : raw.family) ?? '').trim(),
    };
    if (raw.given) person.given = String(raw.given).trim();
    return person;
  };
  const authors = Array.isArray(item.author)
    ? item.author.filter((a: any) => a && (a.family || a.name)).map((a: any) => toPerson(a, true))
    : [];
  const editors = Array.isArray(item.editor)
    ? item.editor.filter((e: any) => e?.family).map((e: any) => toPerson(e))
    : undefined;

  const issued = item.issued?.['date-parts']?.[0]?.[0] ?? item.published?.['date-parts']?.[0]?.[0];
  const containerTitle = Array.isArray(item['container-title']) ? item['container-title'][0] : item['container-title'];
  const titleText = Array.isArray(item.title) ? item.title[0] : item.title;
  const type = String(item.type ?? '');
  const isBook = type === 'book' || type === 'monograph';
  const isConference = type === 'proceedings-article';

  const ref: NormalizedReference = {
    authors,
    type: CROSSREF_TYPE_MAP[type] ?? type ?? undefined,
  };
  if (editors && editors.length) ref.editors = editors;
  if (issued) ref.year = String(issued);
  if (titleText) ref.title = String(titleText).trim();
  if (containerTitle) {
    if (isBook) ref.bookTitle = String(containerTitle).trim();
    else if (isConference) ref.conferenceTitle = String(containerTitle).trim();
    else ref.journal = String(containerTitle).trim();
  }
  if (item.publisher) ref.publisher = String(item.publisher).trim();
  if (item['publisher-location']) ref.placeOfPublication = String(item['publisher-location']).trim();
  if (item.volume) ref.volume = String(item.volume).trim();
  if (item.issue) ref.issue = String(item.issue).trim();
  if (item.page) ref.pages = String(item.page).trim();
  if (item.DOI) ref.doi = String(item.DOI).trim();
  return ref;
}

function authorString(person: { family: string; given?: string }, style: 'initials' | 'full' | 'comma'): string {
  const initial = person.given ? `${person.given.trim().charAt(0)}.` : '';
  if (style === 'full' && person.given) return `${person.family}, ${person.given}`;
  if (style === 'comma') return initial ? `${person.family}, ${initial}` : person.family;
  return initial ? `${person.family} ${initial}` : person.family;
}

/**
 * Render a normalized reference into a citation string in one of three real
 * styles, chosen deterministically by `variant`. Field values are emitted
 * verbatim so projection is clean.
 */
export function renderCitation(ref: NormalizedReference, variant = 0): string {
  if (ref.type === 'webpage' || ref.siteName) return renderWebpage(ref);
  const v = ((variant % 3) + 3) % 3;
  const title = ref.title ?? '';
  const container = ref.journal ?? ref.bookTitle ?? ref.conferenceTitle ?? '';
  const doi = ref.doi ? `https://doi.org/${ref.doi}` : '';

  if (v === 0) {
    // Vancouver-ish: Family I, Family I. Title. Container. Year;Vol(Issue):Pages. doi:..
    const authors = ref.authors.map((a) => authorString(a, 'initials')).join(', ');
    const volIssue = ref.volume ? `${ref.volume}${ref.issue ? `(${ref.issue})` : ''}` : '';
    const tail = [ref.year ? `${ref.year}` : '', volIssue ? `;${volIssue}` : '', ref.pages ? `:${ref.pages}` : ''].join('');
    return clean(`${authors}. ${title}. ${container}. ${tail}. ${ref.doi ? `doi:${ref.doi}` : ''}`);
  }
  if (v === 1) {
    // APA-ish: Family, I., & Family, I. (Year). Title. Container, Vol(Issue), Pages. https://doi..
    const authors = ref.authors.map((a) => authorString(a, 'comma')).join(', & ');
    const vp = [ref.volume ?? '', ref.issue ? `(${ref.issue})` : '', ref.pages ? `, ${ref.pages}` : ''].join('');
    return clean(`${authors} (${ref.year ?? 'n.d.'}). ${title}. ${container}${vp ? `, ${vp}` : ''}. ${doi}`);
  }
  // Book/report-ish: Family, Given. Title. Place: Publisher; Year.
  const authors = ref.authors.map((a) => authorString(a, 'full')).join('; ');
  const place = ref.placeOfPublication ? `${ref.placeOfPublication}: ` : '';
  return clean(`${authors}. ${title}. ${place}${ref.publisher ?? ''}${ref.year ? `; ${ref.year}` : ''}.`);
}

function clean(text: string): string {
  return text.replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').replace(/\.\.+/g, '.').trim();
}

/** Webpage citation style: [Author.] "Title." Site Name. [Year.] Accessed Date. URL */
function renderWebpage(ref: NormalizedReference): string {
  const authors = ref.authors.length ? `${ref.authors.map((a) => authorString(a, 'comma')).join(', ')}. ` : '';
  const title = ref.title ? `${ref.title}. ` : '';
  const site = ref.siteName ? `${ref.siteName}. ` : '';
  const year = ref.year ? `${ref.year}. ` : '';
  const accessed = ref.accessedDate ? `Accessed ${ref.accessedDate}. ` : '';
  const url = ref.url ?? '';
  return clean(`${authors}${title}${site}${year}${accessed}${url}`);
}

/** Choose a render variant appropriate to the reference type (0/1 = article, 2 = book/report). */
export function variantForType(type: string | undefined, index: number): number {
  if (type === 'book' || type === 'report' || type === 'thesis' || type === 'chapter') return 2;
  return index % 2; // alternate the two article styles for surface diversity
}

/**
 * Return only the fields a given render variant actually emits, so a field the
 * style legitimately omits (e.g. publisher in a journal citation) is never
 * mistaken for a missing label.
 */
export function scopeFieldsForVariant(ref: NormalizedReference, variant: number): NormalizedReference {
  const scoped: NormalizedReference = { authors: ref.authors };
  if (ref.type) scoped.type = ref.type;
  if (ref.year) scoped.year = ref.year;
  if (ref.title) scoped.title = ref.title;

  if (ref.type === 'webpage' || ref.siteName) {
    if (ref.siteName) scoped.siteName = ref.siteName;
    if (ref.accessedDate) scoped.accessedDate = ref.accessedDate;
    if (ref.url) scoped.url = ref.url;
    return scoped;
  }

  const v = ((variant % 3) + 3) % 3;
  if (v === 2) {
    // Book/report style.
    if (ref.editors?.length) scoped.editors = ref.editors;
    if (ref.bookTitle) scoped.bookTitle = ref.bookTitle;
    if (ref.placeOfPublication) scoped.placeOfPublication = ref.placeOfPublication;
    if (ref.publisher) scoped.publisher = ref.publisher;
    return scoped;
  }
  // Article / conference style.
  if (ref.journal) scoped.journal = ref.journal;
  if (ref.bookTitle) scoped.bookTitle = ref.bookTitle;
  if (ref.conferenceTitle) scoped.conferenceTitle = ref.conferenceTitle;
  if (ref.volume) scoped.volume = ref.volume;
  if (ref.issue) scoped.issue = ref.issue;
  if (ref.pages) scoped.pages = ref.pages;
  if (ref.doi) scoped.doi = ref.doi;
  return scoped;
}

/**
 * Realistically degrade a clean citation string to mimic messy user input:
 * broken line wraps, stripped punctuation, or collapsed spacing. The field
 * values still occur (possibly punctuation-stripped), so the aligner's
 * normalized/fuzzy passes recover most spans and flag the rest.
 */
export function degradeText(text: string, mode: 'pdf_wrap' | 'strip_punct' | 'none', seed = 0): string {
  if (mode === 'none') return text;
  if (mode === 'strip_punct') {
    return text.replace(/[,.;:]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }
  // pdf_wrap: insert a hard line break roughly mid-string at a space boundary.
  const target = Math.floor(text.length * (0.4 + ((seed % 5) * 0.05)));
  const breakAt = text.indexOf(' ', target);
  if (breakAt < 0) return text;
  return `${text.slice(0, breakAt)}\n${text.slice(breakAt + 1)}`;
}

function toExpectedFields(ref: NormalizedReference): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (ref.authors.length) fields.authors = ref.authors;
  if (ref.editors?.length) fields.editors = ref.editors;
  if (ref.year) fields.year = ref.year;
  if (ref.title) fields.title = ref.title;
  if (ref.journal) fields.journal = ref.journal;
  if (ref.bookTitle) fields.bookTitle = ref.bookTitle;
  if (ref.conferenceTitle) fields.conferenceTitle = ref.conferenceTitle;
  if (ref.publisher) fields.publisher = ref.publisher;
  if (ref.institution) fields.institution = ref.institution;
  if (ref.placeOfPublication) fields.placeOfPublication = ref.placeOfPublication;
  if (ref.siteName) fields.siteName = ref.siteName;
  if (ref.accessedDate) fields.accessedDate = ref.accessedDate;
  if (ref.volume) fields.volume = ref.volume;
  if (ref.issue) fields.issue = ref.issue;
  if (ref.pages) fields.pages = ref.pages;
  if (ref.doi) fields.doi = ref.doi;
  if (ref.url) fields.url = ref.url;
  return fields;
}

/**
 * Build a pre-labelled candidate row from a normalized reference and a raw
 * citation string (rendered or supplied). Projects every field; unmatched ones
 * are flagged for review rather than dropped.
 */
export function buildCandidateRow(
  rawText: string,
  ref: NormalizedReference,
  options: { stratum: string; split: string; provenance: string },
): CandidateRow {
  const expectedFields = toExpectedFields(ref);
  const projections = projectExpectedFields(rawText, expectedFields);
  const matched = projections.filter((p) => p.method !== 'unmatched');
  const unmatched = projections.filter((p) => p.method === 'unmatched').map((p) => baseField(p.field));

  return {
    raw_text: rawText,
    stratum: options.stratum,
    expected_type: ref.type ?? null,
    entity_fields: matched.map((p) => p.label),
    entity_starts: matched.map((p) => p.start),
    entity_ends: matched.map((p) => p.end),
    entity_texts: matched.map((p) => rawText.slice(p.start, p.end)),
    expected_fields: expectedFields,
    dataset_split: options.split,
    trust_level: 'candidate',
    provenance: options.provenance,
    needs_review: unmatched.length > 0,
    unprojected_fields: [...new Set(unmatched)],
  };
}

function baseField(field: string): string {
  const bracket = field.indexOf('[');
  return bracket >= 0 ? field.slice(0, bracket) : field;
}
