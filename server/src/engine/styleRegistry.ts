import type { CitationStyle, StyleFamily } from './types/citation.js';

/**
 * Single source of truth that maps each engine citation style to its CSL (Citation Style
 * Language) provenance. Everything that needs to stay current with upstream style
 * versions keys off this table: the per-style requirement schema
 * ({@link ./mandatory-fields.ts}), the custom renderers, and the CSL/citeproc regression
 * oracle ({@link ./phases/csl/engine.ts}).
 *
 * `cslStyleId` is the file id in the citation-style-language/styles repository. The
 * weekly CSL sync job validates these ids against the pinned CSL release and reports
 * drift; do NOT hand-edit `edition` without bumping the pinned CSL commit it reflects.
 */
export type SupportedStyle = Exclude<CitationStyle, 'auto' | 'unknown'>;

export interface StyleDefinition {
  /** Style id in the citation-style-language/styles repo (the vendored, pinned CSL XML). */
  cslStyleId: string;
  /** Human-facing edition label surfaced in audits/UI for provenance. */
  edition: string;
  family: StyleFamily;
}

export const STYLE_REGISTRY: Record<SupportedStyle, StyleDefinition> = {
  apa7: { cslStyleId: 'apa', edition: 'APA 7th', family: 'author_date' },
  mla9: { cslStyleId: 'modern-language-association', edition: 'MLA 9th', family: 'notes_bibliography' },
  'chicago-author-date': {
    cslStyleId: 'chicago-author-date',
    edition: 'Chicago 17th (author-date)',
    family: 'author_date',
  },
  'chicago-notes-bib': {
    cslStyleId: 'chicago-notes-bibliography',
    edition: 'Chicago 18th (notes-bibliography)',
    family: 'notes_bibliography',
  },
  // Upstream CSL has no plain `vancouver.csl`; `elsevier-vancouver` is the closest clean,
  // maintained numeric Vancouver style. Swap here if the team prefers another variant —
  // the vendor script validates the id and follows any independent-parent link.
  vancouver: { cslStyleId: 'elsevier-vancouver', edition: 'Vancouver (ICMJE/NLM)', family: 'numeric' },
  ieee: { cslStyleId: 'ieee', edition: 'IEEE', family: 'numeric' },
  'harvard-ctr': {
    cslStyleId: 'harvard-cite-them-right',
    edition: 'Harvard (Cite Them Right 12th)',
    family: 'author_date',
  },
  ama: { cslStyleId: 'american-medical-association', edition: 'AMA 11th', family: 'numeric' },
  acs: { cslStyleId: 'american-chemical-society', edition: 'ACS', family: 'numeric' },
};

export function isSupportedStyle(style: CitationStyle): style is SupportedStyle {
  return style !== 'auto' && style !== 'unknown' && style in STYLE_REGISTRY;
}

export function getStyleDefinition(style: CitationStyle): StyleDefinition | null {
  return isSupportedStyle(style) ? STYLE_REGISTRY[style] : null;
}
