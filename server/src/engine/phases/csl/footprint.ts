/**
 * CSL "field footprint" extraction. Parses a CSL style XML and reports which CSL variables
 * it references (anywhere — `<text variable>`, `<names variable>`, `<if variable>`,
 * `is-numeric`, etc.). Mapped to engine field keys, this auto-derives which fields a style
 * actually USES, so the weekly CSL sync can flag when a style starts/stops using a field
 * (informing the editorial preferred/optional tiers). Regex-based on purpose — robust to
 * CSL structure without a full XML parser.
 */

/** Every CSL variable name referenced anywhere in the style. */
export function extractCslVariables(styleXml: string): Set<string> {
  const variables = new Set<string>();
  for (const match of styleXml.matchAll(/\b(?:variable|is-numeric)="([^"]+)"/g)) {
    for (const token of match[1]!.split(/\s+/u).filter(Boolean)) {
      variables.add(token);
    }
  }
  return variables;
}

/** CSL variable -> engine ExtractedFields key (the reverse of carrierToCslItem). */
export const CSL_VARIABLE_TO_FIELD: Readonly<Record<string, string>> = {
  author: 'authors',
  editor: 'editors',
  title: 'title',
  'container-title': 'journal',
  'collection-title': 'bookTitle',
  'event-title': 'conferenceTitle',
  issued: 'year',
  volume: 'volume',
  issue: 'issue',
  page: 'pages',
  'page-first': 'pages',
  DOI: 'doi',
  URL: 'url',
  ISBN: 'isbn',
  ISSN: 'issn',
  PMID: 'pmid',
  PMCID: 'pmcid',
  publisher: 'publisher',
  'publisher-place': 'placeOfPublication',
  edition: 'edition',
  number: 'patent',
  accessed: 'accessedDate',
  archive: 'repository',
  'archive-place': 'repository',
  'collection-number': 'reportNumber',
  genre: 'thesisType',
};

/** The engine field keys a style references (via its CSL variable footprint). */
export function footprintFields(styleXml: string): Set<string> {
  const fields = new Set<string>();
  for (const variable of extractCslVariables(styleXml)) {
    const field = CSL_VARIABLE_TO_FIELD[variable];
    if (field) {
      fields.add(field);
    }
  }
  return fields;
}
