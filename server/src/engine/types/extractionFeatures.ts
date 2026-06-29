import type { StyleFamily } from './citation.js';

export interface CitationFeatureYearMatch {
  matchText: string;
  index: number;
  year: number;
}

export interface CitationFeatureQuotedTitle {
  title: string;
  start: number;
  end: number;
}

export interface CitationFeatureValue<TValue> {
  raw: string | null;
  normalized: TValue | null;
}

export interface CitationIdentifierFeatures {
  // `recovered` marks a DOI that the strict patterns could not read and that came from the
  // OCR-tolerant fallback (folded registrant digits). Such DOIs are lower-confidence: the
  // suffix is kept verbatim and may still carry OCR damage, so downstream confidence is
  // reduced and enrichment is allowed to override them.
  doi: CitationFeatureValue<string> & { recovered?: boolean };
  url: CitationFeatureValue<string>;
  pmid: CitationFeatureValue<string>;
  arxiv: CitationFeatureValue<string>;
  isbn: CitationFeatureValue<string>;
  issn: CitationFeatureValue<string>;
  handle: CitationFeatureValue<string>;
  patent: CitationFeatureValue<string>;
}

export interface CitationFeatures {
  raw: string;
  family: StyleFamily;
  normalizedRaw: string;
  parseableRaw: string;
  yearMatch: CitationFeatureYearMatch | null;
  quotedTitle: CitationFeatureQuotedTitle | null;
  identifiers: CitationIdentifierFeatures;
}

export interface CitationFeatureRecallEntry {
  legacy: string | number | null;
  feature: string | number | null;
  matches: boolean;
}

export interface CitationFeatureRecallShadow {
  allMatch: boolean;
  fields: {
    doi: CitationFeatureRecallEntry;
    url: CitationFeatureRecallEntry;
    pmid: CitationFeatureRecallEntry;
    arxiv: CitationFeatureRecallEntry;
    isbn: CitationFeatureRecallEntry;
    issn: CitationFeatureRecallEntry;
    handle: CitationFeatureRecallEntry;
    patent: CitationFeatureRecallEntry;
    year: CitationFeatureRecallEntry;
    quotedTitle: CitationFeatureRecallEntry;
  };
}
