/**
 * Stage 2: Structured Input Detection (Short-Circuit)
 * 
 * Detects when a raw citation string is already in a structured format
 * (DOI, PMID, BibTeX, RIS, CSL-JSON) and short-circuits the regex parser.
 * 
 * Detected types:
 *   - DOI     : "10.xxxx/..." — resolves via Crossref
 *   - PMID    : "PMID: 12345678" — resolves via PubMed Entrez
 *   - BibTeX  : "@article{...}" — parse directly
 *   - RIS     : "TY  - JOUR\n..." — parse fields
 *   - CSL-JSON: Valid JSON with "title" key — use directly
 *
 * Returns:
 *   - type: the detected input type
 *   - payload: the normalized form for the resolver
 *   - OR null if not a structured input (continue to regex parser)
 */

export type StructuredInputType = 'doi' | 'pmid' | 'bibtex' | 'ris' | 'csl-json';

export interface StructuredInputResult {
  type: StructuredInputType;
  /** The extracted/normalized identifier or content */
  payload: string;
}

// ── DOI ──

/** Bare DOI: 10.1000/xyz or full URL https://doi.org/10.1000/xyz */
const DOI_RE = /\b(10\.\d{4,}\/\S+)/;
const DOI_URL_RE = /https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,}\/\S+)/i;

function extractDOI(text: string): string | null {
  const urlMatch = text.match(DOI_URL_RE);
  if (urlMatch) {
    // Only treat as a DOI-only input if the non-URL parts are very short
    const withoutDOI = text.replace(DOI_URL_RE, '').trim();
    if (withoutDOI.length < 30) {
      return urlMatch[1];
    }
    return null; // it's a full citation with an embedded DOI URL
  }
  const bareMatch = text.match(DOI_RE);
  // Only treat as DOI if it's nearly the entire content (avoid matching DOIs embedded in full citations)
  if (bareMatch) {
    const doiPart = bareMatch[1];
    const rest = text.replace(doiPart, '').trim();
    if (rest.length < 20) return doiPart.replace(/[.)]+$/, ''); // strip trailing punctuation
  }
  return null;
}

// ── PMID ──

const PMID_RE = /^(?:PMID[:\s]+|PubMed\s+ID[:\s]+)(\d{5,8})\s*$/i;

function extractPMID(text: string): string | null {
  const m = text.trim().match(PMID_RE);
  return m ? m[1] : null;
}

// ── BibTeX ──

const BIBTEX_RE = /^@\s*\w+\s*\{/i;

function detectBibTeX(text: string): boolean {
  return BIBTEX_RE.test(text.trim());
}

// ── RIS ──

/** RIS files start with "TY  - " */
const RIS_RE = /^TY\s{2}-\s+\w+/m;

function detectRIS(text: string): boolean {
  return RIS_RE.test(text.trim());
}

// ── CSL-JSON ──

function detectCSLJSON(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    // CSL-JSON must have at minimum a "title" key
    return typeof obj === 'object' && obj !== null && 'title' in obj;
  } catch {
    return false;
  }
}

// ── Main detector ──

/**
 * Check if the input is a structured citation format that can bypass the regex parser.
 * 
 * @returns StructuredInputResult if structured, null if the input should go through
 *          the normal regex parsing pipeline.
 */
export function detectStructuredInput(text: string): StructuredInputResult | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 5) return null;

  // CSL-JSON first (starts with { or [)
  if (detectCSLJSON(trimmed)) {
    return { type: 'csl-json', payload: trimmed };
  }

  // BibTeX
  if (detectBibTeX(trimmed)) {
    return { type: 'bibtex', payload: trimmed };
  }

  // RIS
  if (detectRIS(trimmed)) {
    return { type: 'ris', payload: trimmed };
  }

  // PMID (very short string, before DOI to avoid confusion)
  const pmid = extractPMID(trimmed);
  if (pmid) {
    return { type: 'pmid', payload: pmid };
  }

  // DOI
  const doi = extractDOI(trimmed);
  if (doi) {
    return { type: 'doi', payload: doi };
  }

  return null;
}
