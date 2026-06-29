/**
 * citeproc-js CSL rendering engine.
 * Provides standard CSL-based bibliography rendering as a complement
 * to the hand-rolled formatters in phase12Render.ts.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ReferenceCarrier } from '../../types/carrier.js';
import type { CitationStyle } from '../../types/citation.js';
import { isSupportedStyle } from '../../styleRegistry.js';

const require = createRequire(import.meta.url);

// Vendored CSL lives at <serverRoot>/vendor/csl (gitignored; `npm run csl:vendor`). This
// file sits 4 levels under serverRoot in both src/ and dist/, so the relative path is stable.
const VENDOR_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../vendor/csl');

const vendoredStyleCache = new Map<string, string | null>();
let vendoredLocaleCache: string | null | undefined;

function loadVendoredStyle(style: CitationStyle): string | null {
  if (!isSupportedStyle(style)) return null;
  if (vendoredStyleCache.has(style)) return vendoredStyleCache.get(style) ?? null;
  const path = resolve(VENDOR_DIR, 'styles', `${style}.csl`);
  const xml = existsSync(path) ? readFileSync(path, 'utf8') : null;
  vendoredStyleCache.set(style, xml);
  return xml;
}

function loadVendoredLocale(): string | null {
  if (vendoredLocaleCache !== undefined) return vendoredLocaleCache;
  const path = resolve(VENDOR_DIR, 'locales', 'locales-en-US.xml');
  vendoredLocaleCache = existsSync(path) ? readFileSync(path, 'utf8') : null;
  return vendoredLocaleCache;
}

/** Whether the real pinned CSL styles have been vendored (drives the CSL regression oracle). */
export function hasVendoredCsl(): boolean {
  return loadVendoredLocale() != null && loadVendoredStyle('apa7') != null;
}

// Map our internal style names to CSL style IDs (fallback path / provenance only — the
// vendored styles are keyed by engine style name).
const STYLE_MAP: Record<string, string> = {
  apa7: 'apa',
  mla9: 'modern-language-association',
  'chicago-author-date': 'chicago-author-date',
  vancouver: 'vancouver',
};

interface CslItem {
  id: string;
  type: string;
  title?: string;
  author?: Array<{ family?: string; given?: string; literal?: string }>;
  editor?: Array<{ family?: string; given?: string }>;
  issued?: { 'date-parts': number[][] };
  'container-title'?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  URL?: string;
  publisher?: string;
  'publisher-place'?: string;
  edition?: string;
  'collection-title'?: string;
  'event-title'?: string;
  accessed?: { 'date-parts': number[][] };
  PMID?: string;
  ISBN?: string;
  ISSN?: string;
  number?: string;
  note?: string;
  [key: string]: unknown;
}

// Map engine reference types to CSL types
const TYPE_MAP: Record<string, string> = {
  'article-journal': 'article-journal',
  book: 'book',
  'book-chapter': 'chapter',
  thesis: 'thesis',
  'conference-paper': 'paper-conference',
  report: 'report',
  patent: 'patent',
  webpage: 'webpage',
  dataset: 'dataset',
  preprint: 'article',
  unknown: 'article',
};

export function carrierToCslItem(carrier: ReferenceCarrier): CslItem {
  const f = carrier.fields;
  const item: CslItem = {
    id: carrier.id,
    type: TYPE_MAP[carrier.type.type] ?? 'article',
  };

  const title = f.title.value;
  if (title && typeof title === 'string') item.title = title;

  const authors = f.authors.value;
  if (Array.isArray(authors) && authors.length > 0) {
    item.author = authors.map((a) => {
      if (a.isCorporate && a.literal) return { literal: a.literal };
      const name: { family: string; given?: string } = { family: a.family };
      if (a.given != null) name.given = a.given;
      return name;
    });
  }

  const editors = f.editors.value;
  if (Array.isArray(editors) && editors.length > 0) {
    item.editor = editors.map((e) => {
      const ed: { family: string; given?: string } = { family: e.family };
      if (e.given != null) ed.given = e.given;
      return ed;
    });
  }

  const year = f.year.value;
  if (typeof year === 'number') {
    item.issued = { 'date-parts': [[year]] };
  }

  const journal = f.journal.value;
  if (journal && typeof journal === 'string') item['container-title'] = journal;

  const volume = f.volume.value;
  if (volume && typeof volume === 'string') item.volume = volume;

  const issue = f.issue.value;
  if (issue && typeof issue === 'string') item.issue = issue;

  const pages = f.pages.value;
  if (pages && typeof pages === 'string') item.page = pages;

  const doi = f.doi.value;
  if (doi && typeof doi === 'string') item.DOI = doi;

  const pmid = f.pmid.value;
  if (pmid && typeof pmid === 'string') item.PMID = pmid;

  const isbn = f.isbn.value;
  if (isbn && typeof isbn === 'string') item.ISBN = isbn;

  const issn = f.issn.value;
  if (issn && typeof issn === 'string') item.ISSN = issn;

  const url = f.url.value;
  if (url && typeof url === 'string') item.URL = url;

  const publisher = f.publisher.value;
  if (publisher && typeof publisher === 'string') item.publisher = publisher;

  const edition = f.edition.value;
  if (edition && typeof edition === 'string') item.edition = edition;

  const bookTitle = f.bookTitle.value;
  if (bookTitle && typeof bookTitle === 'string') item['container-title'] = bookTitle;

  const conferenceTitle = f.conferenceTitle.value;
  if (conferenceTitle && typeof conferenceTitle === 'string') item['event-title'] = conferenceTitle;

  const patent = f.patent.value;
  if (patent && typeof patent === 'string') item.number = patent;

  return item;
}

/**
 * Attempt CSL rendering via citeproc-js.
 * Returns null if citeproc is unavailable or rendering fails,
 * allowing fallback to the hand-rolled renderer.
 */
export function renderWithCsl(carrier: ReferenceCarrier, style: CitationStyle): string | null {
  try {
    // Dynamic import to avoid hard failure if citeproc isn't available
    const CSL = requireCiteproc();
    if (!CSL) return null;

    // Prefer the real, pinned, vendored CSL; fall back to the minimal built-in styles so
    // rendering still degrades gracefully when vendoring has not been run.
    const vendoredStyle = loadVendoredStyle(style);
    const cslStyleId = STYLE_MAP[style];
    const styleXml = vendoredStyle ?? (cslStyleId ? getMinimalStyleXml(cslStyleId) : null);
    if (!styleXml) return null;

    const item = carrierToCslItem(carrier);
    const localeXml = loadVendoredLocale() ?? getMinimalLocaleXml();

    const sys = {
      retrieveLocale: () => localeXml,
      retrieveItem: (id: string) => (id === item.id ? item : null),
    };

    const engine = new CSL.Engine(sys, styleXml);
    engine.updateItems([item.id]);
    const result = engine.makeBibliography();

    if (!result || !result[1] || result[1].length === 0) return null;

    return decodeEntities(
      result[1]
        .join('')
        .replace(/<[^>]+>/g, ''),
    )
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return null;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

let cachedCSL: unknown = null;

function requireCiteproc(): any {
  if (cachedCSL) return cachedCSL;
  try {
    // citeproc is a CommonJS module
    cachedCSL = require('citeproc');
    return cachedCSL;
  } catch {
    return null;
  }
}

function getMinimalStyleXml(styleId: string): string {
  // Minimal CSL style XMLs for the 4 guaranteed styles
  // In production, these would be loaded from the CSL repository
  const macros = `
    <macro name="author">
      <names variable="author">
        <name and="symbol" delimiter=", " delimiter-precedes-last="always" initialize-with=". " name-as-sort-order="first"/>
        <substitute><names variable="editor"/></substitute>
      </names>
    </macro>
    <macro name="year">
      <date variable="issued"><date-part name="year"/></date>
    </macro>
    <macro name="title">
      <text variable="title"/>
    </macro>`;

  switch (styleId) {
    case 'apa':
      return `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info><title>APA 7th</title><id>apa</id></info>
  ${macros}
  <bibliography>
    <sort><key macro="author"/><key macro="year"/></sort>
    <layout suffix=".">
      <text macro="author" suffix=" "/>
      <text macro="year" prefix="(" suffix="). "/>
      <text macro="title" suffix=". "/>
      <text variable="container-title" font-style="italic" suffix=", "/>
      <text variable="volume" font-style="italic"/>
      <text variable="issue" prefix="(" suffix=")"/>
      <text variable="page" prefix=", "/>
      <text variable="DOI" prefix=". https://doi.org/"/>
    </layout>
  </bibliography>
</style>`;

    case 'vancouver':
      return `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info><title>Vancouver</title><id>vancouver</id></info>
  ${macros}
  <bibliography>
    <layout suffix=".">
      <text macro="author" suffix=". "/>
      <text macro="title" suffix=". "/>
      <text variable="container-title" suffix=". "/>
      <text macro="year" suffix=";"/>
      <text variable="volume"/>
      <text variable="issue" prefix="(" suffix=")"/>
      <text variable="page" prefix=":"/>
    </layout>
  </bibliography>
</style>`;

    default:
      return `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info><title>Generic</title><id>${styleId}</id></info>
  ${macros}
  <bibliography>
    <layout suffix=".">
      <text macro="author" suffix=". "/>
      <text macro="year" prefix="(" suffix="). "/>
      <text macro="title" suffix=". "/>
      <text variable="container-title" font-style="italic"/>
    </layout>
  </bibliography>
</style>`;
  }
}

function getMinimalLocaleXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<locale xmlns="http://purl.org/net/xbiblio/csl" xml:lang="en-US">
  <terms>
    <term name="and">and</term>
    <term name="et-al">et al.</term>
    <term name="editor" form="short">Ed.</term>
    <term name="edition" form="short">ed.</term>
    <term name="page" form="short">p.</term>
    <term name="volume" form="short">Vol.</term>
    <term name="issue" form="short">no.</term>
    <term name="retrieved">Retrieved</term>
    <term name="from">from</term>
    <term name="accessed">Accessed</term>
    <term name="no date" form="short">n.d.</term>
  </terms>
</locale>`;
}
