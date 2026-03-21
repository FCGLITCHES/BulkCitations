import { ParsedReference, ReferenceType, CitationStyle, type PatternHit } from "@shared/schema";
import { stripLeadingNumbering } from "@shared/stripNumbering";
import type { PreNormalizedText } from "@shared/types/textBrands";
import { expandJournalName, looksAbbreviated } from './stages/expandJournalAbbrev';
import {
  extractLocatorFields,
  isGroupAuthor,
  normalizeGroupAuthor,
  normalizeKnownContainerName,
  normalizeProtectedTokenValue,
} from './shared/citationSemantics.js';
import fs from "fs";
import path from "path";

interface DynamicPattern {
  id: string;
  regex: RegExp;
  fields: Record<string, number>;
  description?: string;
  category?: string;
  priority: number;
  styles?: string[];
}

const DEBUG_STRESS = process.env.DEBUG_STRESS === '1';

const NEXT_YEAR = new Date().getFullYear() + 1;

// Tokens that must never be split or lowercased during pre-normalization (IoT, MANET, IEEE, etc.)
const PROTECTED_TOKENS = new Set([
  'IoT',
  'MANET',
  'IEEE',
  'ACM',
  'DOI',
  'IIT',
  'PhD',
  'arXiv',
  'iJIM',
  'iJOE',
  'iJEP',
  'ICGCIoT',
  'ICIIBMS',
  'ICCIC',
  'JOIV',
  'NTMS',
  'SoSE',
  'PRISMA',
  'LHD',
  'BMJ',
  'PLoS',
  'U-Net',
  'G*Power',
  '2−ΔΔCT',
  'DESeq2'
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function protectTokens(input: string): { text: string; map: Map<string, string> } {
  const map = new Map<string, string>();
  let result = input;
  let idx = 0;
  for (const tok of [...PROTECTED_TOKENS].sort((left, right) => right.length - left.length)) {
    const re = new RegExp(`\\b${escapeRegex(tok)}\\b`, 'g');
    if (re.test(result)) {
      const placeholder = `__TOK${idx}__`;
      result = result.replace(re, placeholder);
      map.set(placeholder, tok);
      idx += 1;
    }
  }
  return { text: result, map };
}

function restoreTokens(input: string, map: Map<string, string>): string {
  let out = input;
  map.forEach((orig, placeholder) => {
    const re = new RegExp(placeholder, 'g');
    out = out.replace(re, orig);
  });
  return out;
}



// Token classifiers for author detection.
const SURNAME_INITIALS = /^[A-Z][a-záéíóú\-']{1,25}(?:,?\s+[A-Z]{1,3}\.?(\s+[A-Z]{1,3}\.?)*)\s*$/;
const FIRSTNAME_LASTNAME = /^[A-Z][a-záéíóú\-']+\s+[A-Z][a-záéíóú\-']+$/;
const PARTICLE_NAME = /^(de|van|von|del|da|di|le|la|dos|las|los)\s+[A-Z][a-z]+/i;
const INITIALS_ONLY = /^([A-Z]\.?\s*){1,3}$/;

// Hard author stop rule: the moment this returns false, we stop consuming authors.
function isPersonToken(token: string): boolean {
  const t = token.trim().replace(/^and\s+/i, '');
  if (!t) return false;
  if (isGroupAuthor(t)) return true;
  if (SURNAME_INITIALS.test(t)) return true;
  if (FIRSTNAME_LASTNAME.test(t)) return true;
  if (PARTICLE_NAME.test(t)) return true;
  if (INITIALS_ONLY.test(t)) return true;
  return false;
}

// Extract the author segment from a raw string, stopping at the first non-person token.
// Returns the raw author segment (to be passed to parseAuthorList) and the remaining tail.
function extractAuthorSegment(raw: string): { authorSegment: string; remaining: string } {
  if (!raw) return { authorSegment: '', remaining: '' };
  const normalized = raw.replace(/,?\s+and\s+/gi, ', ');
  const tokens = normalized.split(/,\s*/).filter(Boolean);
  const authorTokens: string[] = [];
  let consumed = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].trim();
    if (!tok) continue;
    const pairCandidate = [tok, tokens[i + 1]].filter(Boolean).join(', ');
    const tripleCandidate = [tok, tokens[i + 1], tokens[i + 2]].filter(Boolean).join(', ');
    if (isGroupAuthor(tok) || isGroupAuthor(pairCandidate) || isGroupAuthor(tripleCandidate)) {
      const normalizedGroup = normalizeGroupAuthor(
        isGroupAuthor(tripleCandidate)
          ? tripleCandidate
          : isGroupAuthor(pairCandidate)
            ? pairCandidate
            : tok,
      );
      authorTokens.push(normalizedGroup);
      consumed = i + (isGroupAuthor(tripleCandidate) ? 3 : isGroupAuthor(pairCandidate) ? 2 : 1);
      i = consumed - 1;
      continue;
    }
    if (!isPersonToken(tok)) {
      break;
    }
    authorTokens.push(tok);
    consumed = i + 1;
  }

  const authorSegment = authorTokens.join(', ');
  const remaining = tokens.slice(consumed).join(', ');
  return { authorSegment, remaining };
}

function isValidYear(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const n = parseInt(candidate, 10);
  return !isNaN(n) && n >= 1800 && n <= NEXT_YEAR;
}

type YearCandidate = { year: string; index: number; score: number };

function extractYearCandidates(rawInput: string): YearCandidate[] {
  const candidates: YearCandidate[] = [];
  const re = /\b((?:19|20)\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawInput)) !== null) {
    const year = m[1];
    if (!isValidYear(year)) continue;
    const idx = m.index;
    const before = rawInput.slice(Math.max(0, idx - 50), idx);
    const after = rawInput.slice(idx + 4, idx + 50);
    let score = 1;
    const inVenueVolume = /\d{2,}\s*[,.]?\s*$/.test(before) || /^\s*[,.:]\s*\d/.test(after);
    const inParens = /\(\s*$/.test(before) || /^\s*\)/.test(after);
    const commaBounded = /,\s*$/.test(before) || /^\s*[,.]/.test(after);
    const titleEmbedded = /\w\s+$/.test(before);
    const afterTitlePhrase = /\b(PRISMA|ROBINS-I|pROC|GLOBOCAN)\s+$/i.test(before);
    if (inVenueVolume || afterTitlePhrase) score = 0;
    else if (inParens) score = 3;
    else if (commaBounded) score = 2;
    else if (titleEmbedded) score = 0;
    candidates.push({ year, index: idx, score });
  }
  return candidates;
}

function resolveYearFromCandidates(
  parsed: ParsedReference,
  rawInput: string,
  candidates: YearCandidate[]
): string | undefined {
  if (parsed.year && isValidYear(parsed.year)) return parsed.year;
  if (candidates.length === 0) return undefined;
  const ranked = candidates.filter(c => c.score > 0).sort((a, b) => b.score - a.score);
  return ranked[0]?.year;
}

function recoverYear(badYear: string | undefined, rawInput: string): string | undefined {
  if (isValidYear(badYear)) return badYear;
  const candidates = extractYearCandidates(rawInput);
  return resolveYearFromCandidates({ year: badYear }, rawInput, candidates);
}

export class CitationParser {
  private dynamicPatterns: DynamicPattern[] = [];
  private patternsPath: string;
  private watchDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.patternsPath = path.resolve(process.cwd(), 'server', 'data', 'patterns.json');
    this.loadDynamicPatterns();
    this.watchPatternsFile();
  }

  /** Dangerous regex constructs that risk catastrophic backtracking (ReDoS) */
  private static readonly DANGEROUS_REGEX = /(\.\+\)\+|\.\*\)\*|\.\+\)\*|\.\*\)\+|\(\?=.*\(\?=)/;

  /**
   * Validate and compile a single pattern definition.
   * Returns null if invalid (schema or regex safety failure).
   */
  private compilePattern(p: any, idx: number): DynamicPattern | null {
    if (!p || typeof p.regex !== 'string' || typeof p.fields !== 'object') {
      console.warn(`Pattern ${idx}: invalid schema — skipped`);
      return null;
    }
    // Reject dangerous regex constructs
    if (CitationParser.DANGEROUS_REGEX.test(p.regex)) {
      console.warn(`Pattern ${p.id ?? idx}: rejected — contains dangerous backtracking construct`);
      return null;
    }
    // Validate optional metadata
    const priority = typeof p.priority === 'number' ? p.priority : 100;
    const styles = Array.isArray(p.styles) && p.styles.every((s: any) => typeof s === 'string')
      ? p.styles as string[]
      : undefined;

    try {
      return {
        id: p.id ?? `pattern_${idx}`,
        regex: new RegExp(p.regex, 'i'),
        fields: p.fields,
        description: typeof p.description === 'string' ? p.description : undefined,
        category: typeof p.category === 'string' ? p.category : undefined,
        priority,
        styles,
      };
    } catch (e) {
      console.warn(`Pattern ${p.id ?? idx}: regex compile failed — skipped`, e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  private loadDynamicPatterns() {
    try {
      if (fs.existsSync(this.patternsPath)) {
        const rawData = fs.readFileSync(this.patternsPath, 'utf8');
        const jsonPatterns = JSON.parse(rawData);
        if (!Array.isArray(jsonPatterns)) {
          console.warn("patterns.json: expected array — keeping last-known-good");
          return;
        }
        const compiled: DynamicPattern[] = [];
        for (let i = 0; i < jsonPatterns.length; i++) {
          const p = this.compilePattern(jsonPatterns[i], i);
          if (p) compiled.push(p);
        }
        if (compiled.length === 0 && this.dynamicPatterns.length > 0) {
          console.warn("patterns.json: all patterns failed validation — keeping last-known-good");
          return;
        }
        compiled.sort((a, b) => a.priority - b.priority);
        this.dynamicPatterns = compiled;
        console.log(`Loaded ${compiled.length} dynamic patterns`);
      }
    } catch (e) {
      console.warn("Failed to load dynamic patterns map — keeping last-known-good", e instanceof Error ? e.message : String(e));
    }
  }

  /** Watch patterns.json for changes and hot-reload with debounce */
  private watchPatternsFile() {
    try {
      if (!fs.existsSync(this.patternsPath)) return;
      fs.watch(this.patternsPath, (eventType) => {
        if (eventType !== 'change') return;
        // Debounce: editors often fire multiple change events
        if (this.watchDebounce) clearTimeout(this.watchDebounce);
        this.watchDebounce = setTimeout(() => {
          console.log("patterns.json changed — reloading...");
          this.loadDynamicPatterns();
        }, 500);
      });
    } catch (e) {
      // fs.watch may not be supported on all platforms; non-fatal
      console.warn("Could not watch patterns.json for hot-reload", e);
    }
  }


  /**
   * Pre-normalize raw reference text once before detection and parsing.
   * All numbering/quote cleanup here so parsing operates on clean text; no post-parse author mutation.
   * Returns a branded PreNormalizedText — the only type accepted by detectStyle and parseReference.
   */
  preNormalize(raw: string): PreNormalizedText {
    let { text: s, map } = protectTokens(raw.trim());
    if (!s) return s as PreNormalizedText;
    // Per-line: strip leading numbering (1. / 2) / 3 - / [4] etc.)
    s = s.split(/\n/).map((line) => {
      return stripLeadingNumbering(line.trim());
    }).join('\n').trim();
    // Strip leading list number at start of whole string (again for single-line refs)
    s = stripLeadingNumbering(s);
    // Strip trailing (YYYY) appended to Vancouver/IEEE hybrids
    s = s.replace(/\s+\(\d{4}\)\.?$/, '');
    // Smart quotes → plain quotes
    s = s.replace(/[\u201C\u201D\u201E\u201F]/g, '"').replace(/[\u2018\u2019\u201A\u201B]/g, "'");
    // Strip HTML tags and replace with space so "of <i>SHELX</i>." → "of SHELX." (preserve spacing)
    s = s.replace(/<[^>]+>/g, ' ');
    // En-dash/em-dash → hyphen
    s = s.replace(/[\u2013\u2014]/g, '-');
    // Re-space camelCase fused names (e.g., "OliverH", "NiraJ.") before author parsing
    // We look for a lowercase char followed by an uppercase char, but only if it's the start
    // of an initial or abbreviation (end of word or followed by dot/comma/space) to avoid "McDonald"
    s = s.replace(/([a-z])([A-Z])(?=[\s.,;]|$)/g, '$1 $2');
    // Normalize missing space in conference markers
    s = s.replace(/\bIn(?=\d{4}\b)/g, 'In ');
    s = s.replace(/\bIn(?=[A-Z][a-z])/g, 'In ');
    // Collapse whitespace
    s = s.replace(/\s+/g, ' ').trim();
    s = restoreTokens(s, map);
    return s as PreNormalizedText;
  }

  /**
   * Detect citation style from reference text using scoring-based approach.
   * Each style gets scored based on how many characteristic patterns match.
   * The style with the highest score wins. This is far more reliable than
   * a waterfall of regex checks.
   * Call with preNormalize(text) for consistent results with parseReference.
   */
  detectStyle(text: PreNormalizedText): CitationStyle | null {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 15) return null;

    // Vancouver structural pre-check: ". 2015;47(3):123" or "2015;47(3):123" style tails
    // This compact "Year;Volume(Issue):Pages" tail is unique to Vancouver and should win before scoring.
    if (/\.\s*(19|20)\d{2};[\d?]+[\(:]/.test(trimmed) || /\b(19|20)\d{2};\s*[\d?]+[\(:]/.test(trimmed)) {
      return 'vancouver';
    }

    let scrubbedForDetection = trimmed;
    // Remove leading list number — uses shared helper for consistency
    scrubbedForDetection = stripLeadingNumbering(scrubbedForDetection);
    // Remove trailing year in parentheses (e.g., "... (2023)." -> "...")
    scrubbedForDetection = scrubbedForDetection.replace(/\s+\(\d{4}\)\.?$/, '');

    const scores: Record<CitationStyle, number> = {
      apa: 0,
      mla: 0,
      harvard: 0,
      chicago: 0,
      'harvard-ctr': 0,
      'chicago-ad': 0,
      'chicago-nb': 0,
      ieee: 0,
      vancouver: 0,
      auto: 0,
    };

    // === IEEE: starts with [number] ===
    if (/^\[\d+\]/.test(trimmed)) {
      scores.ieee += 10;
    }
    if (/vol\.\s*\d+/i.test(trimmed)) scores.ieee += 2;
    if (/no\.\s*\d+/i.test(trimmed)) scores.ieee += 1;
    if (/pp\.\s*\d+/i.test(trimmed)) scores.ieee += 1;
    // IEEE uses quoted title followed by comma: "Title,"
    if (/\"[^\"]+,\"/.test(trimmed)) scores.ieee += 2;
    // Force IEEE markers (tightened to avoid over-classifying quoted Chicago/MLA lines)
    if (/^(?:[A-Z](?:\.-[A-Z]\.|\.)(?:\s+|$)){1,4}[A-Z\u00c0-\u017e][a-z\u00c0-\u024f'’-]+/.test(scrubbedForDetection)) {
      scores.ieee += 50;
    } else if (/\"[^\"]+\"/.test(scrubbedForDetection)
      && (/\bin\s+Proc\b|\bArt\.\s*no\./i.test(scrubbedForDetection)
        || (/pp\.\s*\d+/i.test(scrubbedForDetection) && /^(?:[A-Z](?:\.-[A-Z]\.|\.)(?:\s+|$)){1,4}[A-Z\u00c0-\u017e][a-z\u00c0-\u024f'’-]+/.test(scrubbedForDetection)))) {
      scores.ieee += 8;
    }
    // Full first names + "and" + quoted title (e.g. "Ronneberger, Philipp Fischer, and Thomas Brox, \"U-Net...\"")
    // Lightly prefer IEEE/Chicago without de-boosting Harvard.
    if (/\band\s+[A-Z][a-z]+,\s*"/.test(scrubbedForDetection)) {
      scores.ieee += 5;
      scores.chicago += 5;
    }

    // === Vancouver: "N. Author(s). Title. Journal. Year;Vol(Issue):Pages." ===
    if (/^\d+\.\s+[A-Z][a-z]+\s+[A-Z]{1,3}/.test(trimmed)) scores.vancouver += 3;
    if (/\d{4};\d+/.test(trimmed)) scores.vancouver += 5;
    if (/\d{4};\d+\(\d+\):\d+/.test(trimmed)) scores.vancouver += 3;
    if (/\b\d{4}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2};\d+/i.test(trimmed)) scores.vancouver += 8;
    if (/\d{4};\s*Vol\.?\s*\d+/i.test(trimmed)) scores.vancouver += 7;
    if (/\d{4};\s*Vol\.?\s*\d+,\s*No\.?\s*\d+\s*:\s*[A-Z]?\d+/i.test(trimmed)) scores.vancouver += 4;
    if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+[A-Z]{1,4}(?:,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+[A-Z]{1,4})+\./.test(scrubbedForDetection)) scores.vancouver += 6;
    if (/^[A-Z][a-z'’-]+(?:\s+(?:da|de|del|der|di|du|la|le|van|von))?(?:\s+[A-Z][a-z'’-]+)?\s+[A-Z]{1,4}(?:,\s*(?:[A-Z][a-z'’-]+(?:\s+(?:da|de|del|der|di|du|la|le|van|von))?(?:\s+[A-Z][a-z'’-]+)?\s+[A-Z]{1,4}|(?:da|de|del|der|di|du|la|le|van|von)\s+[A-Z][a-z'’-]+\s+[A-Z]{1,4}))+\./.test(scrubbedForDetection)) scores.vancouver += 6;
    if (/^(?:(?:[A-Z][A-Za-z'’-]+|d'[A-Za-z'’-]+)(?:\s+(?:da|de|del|der|di|du|van|von)\s+[A-Z][A-Za-z'’-]+)*(?:\s+[A-Z][A-Za-z'’-]+)*\s+[A-Z]{1,4},\s*){2,}.+\.\s+\d{4}(?:\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2})?;/.test(scrubbedForDetection)) scores.vancouver += 10;
    if (/^(?:(?:[A-Z][A-Za-z'’-]+|d'[A-Za-z'’-]+)(?:\s+(?:da|de|del|der|di|du|van|von)\s+[A-Z][A-Za-z'’-]+)*(?:\s+[A-Z][A-Za-z'’-]+)*\s+[A-Z]{1,4},\s*){2,}.+\.\s+In\s+.+\b\d{4}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\s+\(pp\.?\s*\d+/i.test(scrubbedForDetection)) scores.vancouver += 12;
    // Vancouver: "Author AB. Title. Publisher. YYYY;?:" (OpenAlex placeholder) — decisive so Vancouver wins over APA
    if (/\d{4}\s*;\s*\??\s*:?/.test(trimmed) || /\d{4}\s*;\s*[^;]*$/.test(trimmed)) scores.vancouver += 60;
    // Compact-initial author (no comma before year) + semicolon: "Holland JH. Title. Publisher. 1992;"
    if (/^[A-Z][a-z]+\s+[A-Z]{1,3}\.\s+.+\.\s+.+\.\s+\d{4}\s*;/.test(scrubbedForDetection)) scores.vancouver += 8;
    // Vancouver/NLM Style Compact Author List Detection: "Vaswani A, Shazeer N, Parmar N..."
    // Surnames followed by 1-3 initials WITHOUT commas before the initials, joined by commas.
    // Extremely strong signal that differs uniquely from APA ("Vaswani, A.,")
    if (/^(?:[A-Z][a-z]+(?:-[A-Z][a-z]+)?\s+[A-Z]{1,3}(?:,\s*|$)){2,}/.test(scrubbedForDetection)) scores.vancouver += 20;
    // Vancouver removed DOI check

    // === APA: "Author, I. (Year)." or "Author, I., & Author, B. (Year)." ===
    // Strong APA pattern: "Surname, I. (2023)."
    if (/^[A-Z][a-zÀ-ÿ]+,\s*[A-Z]\./.test(scrubbedForDetection)) scores.apa += 2;
    // Year in parentheses right after authors
    if (/^[^.]+\(\d{4}[a-z]?\)\./.test(scrubbedForDetection)) scores.apa += 5;
    // Ampersand between authors (common in APA)
    if (/&\s+[A-Z][a-zÀ-ÿ]+,\s*[A-Z]\./.test(scrubbedForDetection)) scores.apa += 2;
    // Italic journal pattern: Journal, Volume(Issue), pages.
    if (/\.\s+[A-Z][^.]+,\s*\d+\(\d+\),?\s*\d+/.test(scrubbedForDetection)) scores.apa += 2;
    // APA year without parens: "Author, I. 2017." (less common but valid)
    if (/^[A-Z][a-zÀ-ÿ]+,\s*[A-Z]\..+\b\d{4}\.\.?\s+[A-Z]/.test(scrubbedForDetection)) scores.apa += 3;
    // Group/organization author with year in parens: "Organization. (Year)."
    if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\.\s*\(\d{4}\)\./.test(scrubbedForDetection)) scores.apa += 5;
    // APA Article number pattern
    if (/Article\s+\w+\d+/i.test(trimmed)) scores.apa += 2;

    // === MLA: Author. "Title." Journal, vol. X, no. Y, Year, pp. Z. ===
    // MLA uses "vol." and "no." with period abbreviations
    if (/vol\.\s*\d+/i.test(trimmed) && /no\.\s*\d+/i.test(trimmed) && /pp\.\s*\d+/i.test(trimmed)) {
      scores.mla += 4;
    }
    if (/^\s*[A-Z\u00c0-\u017e][A-Za-z\u00c0-\u024f'’-]+,\s*(?:[A-Z](?:\.\s*)+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:,\s*(?:and\s+)?(?:[A-Z][^."]+|[A-Z]\.\s*[A-Z][^."]+))*\.\s*\"[^\"]+\.\"\s+.+,\s*vol\.\s*\d+(?:,\s*no\.\s*[^,]+)?,\s*\d{4},\s*(?:pp\.\s*\d+|Article\s+\S+)/i.test(scrubbedForDetection)) {
      scores.mla += 12;
    }
    // MLA has quoted title followed by period inside quotes: "Title."
    if (/\"[^\"]+\.\"/.test(scrubbedForDetection)) {
      scores.mla += 2;
      scores.chicago += 2; // Chicago also uses this
    }
    // MLA conference pattern: quoted title, no explicit "In", publisher before trailing year
    if (/^[^"]+\.\s*"[^"]+\."\s+(?!In\b).+\.\s*(?:IEEE|ACM|Springer|Elsevier),\s*(?:19|20)\d{2}\.?$/i.test(scrubbedForDetection)) {
      scores.mla += 8;
    }
    // MLA volume.issue format like "47.3" without "vol." prefix
    if (/\"[^\"]+\"\s+[A-Z][^\"]*\s+\d+\.\d+\s*\(\d{4}\)/.test(scrubbedForDetection)) scores.mla += 3;
    // MLA "Year, pp." pattern
    if (/\d{4},\s*pp\.\s*\d+/.test(trimmed)) scores.mla += 3;

    // === Chicago/MLA before Harvard: post-title remainder Journal, vol... (Year): or Journal, vol..., Year, pp... ===
    // If quoted title + journal+volume+(year) pattern, prefer Chicago/MLA over Harvard (BMJ/PRISMA-style)
    const chicagoMlaRemainder =
      /\bvol\.?\s*\d+.*\(\d{4}\)\s*:/i.test(scrubbedForDetection) ||
      /\bvol\.?\s*\d+.*,\s*\d{4}\s*,?\s*pp\./i.test(scrubbedForDetection) ||
      /,\s*\d+\s*\(\d{4}\)\s*:/i.test(scrubbedForDetection) ||
      /,\s*\d+\s*,\s*(?:Article\s+)?[A-Za-z]?\d+/i.test(scrubbedForDetection);
    if (chicagoMlaRemainder && /"[^"]+"/.test(scrubbedForDetection)) {
      scores.chicago += 8;
      scores.mla += 6;
    }

    // === Chicago: Author. "Title." Journal Volume, no. Issue (Year): Pages. ===
    // Chicago distinctively uses "no." for issue and ": pages" pattern
    if (/\d+,\s*no\.\s*\d+\s*\((?:[A-Za-z]+\s+)?\d{4}\):\s*\d+/.test(scrubbedForDetection)) scores.chicago += 6;
    // Chicago colon before pages with year in parens
    if (/\((?:[A-Za-z]+\s+)?\d{4}\):\s*\d+[-–]\d+/.test(scrubbedForDetection)) scores.chicago += 3;
    if (/\"[^\"]+\.\"\s+[A-Z].+\s+\d+(?:,\s*no\.\s*[^,]+)?\s*\((?:[A-Za-z]+\s+)?\d{4}\):\s*(?:[A-Z]?\d+[-–][A-Z]?\d+|Article\s+\S+)/i.test(scrubbedForDetection)) scores.chicago += 10;
    // Chicago uses "and" not "&" for multiple authors
    if (/,\s+and\s+[A-Z][a-z]+\s+[A-Z]/.test(scrubbedForDetection)) scores.chicago += 1;
    if (/\"[^\"]+\"\.\s*(?:In\s+)?(?:19|20)\d{2}\s+.*\bConference\b/i.test(scrubbedForDetection)) scores.chicago += 7;
    if (/\"[^\"]+\.\"\s+In\s+.+,\s*pp\.\s*\d+[-–]\d+\.\s*(?:IEEE|ACM|Springer|Elsevier),\s*(?:19|20)\d{2}\.?$/i.test(scrubbedForDetection)) scores.chicago += 8;
    if (/\"[^\"]+\.\"\s+In\s+.+\.\s*(?:IEEE|ACM|Springer|Elsevier),\s*(?:19|20)\d{2}\.?$/i.test(scrubbedForDetection)) scores.chicago += 8;

    // === Harvard: Author, I. (Year) 'Title', Journal, vol(issue), pp. pages. ===
    // Harvard uses year after author but NOT followed by period before title
    // Support both straight ' and curly '' quotes
    if (/^[A-Z\u00c0-\u017e][a-z\u00c0-\u00ff']+,\s*(?:[A-Z](?:\.[A-Z])*\.?).*\(\d{4}\)\.\s*['\u2018]/.test(scrubbedForDetection)) scores.harvard += 8;
    if (/^[A-Z\u00c0-\u017e][a-z\u00c0-\u00ff']+,\s*(?:[A-Z](?:\.[A-Z])*\.?).*\(\d{4}\)\s+['\u2018]/.test(scrubbedForDetection)) scores.harvard += 6;
    if (/^[A-Z\u00c0-\u017e][A-Za-z\u00c0-\u024f'’-]+,\s*(?:[A-Z](?:\.[A-Z])*\.?)(?:,\s*[A-Z\u00c0-\u017e][A-Za-z\u00c0-\u024f'’-]+,\s*(?:[A-Z](?:\.[A-Z])*\.?))*\s+and\s+(?:da|de|del|der|di|du|la|le|van|von\s+)?[A-Z\u00c0-\u017e][A-Za-z\u00c0-\u024f'’-]+,\s*(?:[A-Z](?:\.[A-Z])*\.?),\s*\d{4}\.\s+/i.test(scrubbedForDetection)) scores.harvard += 10;
    // "Available at:" is a strong Harvard marker
    if (/Available at:/i.test(trimmed)) scores.harvard += 5;
    // Harvard uses "pp." for pages (strong indicator when combined with year-in-parens)
    if (/,\s*pp\.\s*\d+[-–]\d+/i.test(trimmed)) scores.harvard += 4;
    // Single-quoted title is uniquely Harvard (straight or curly)
    if (/['\u2018][^'\u2019]+['\u2019],\s*[A-Z]/.test(trimmed)) scores.harvard += 5;
    // Harvard: "Publisher, City" pattern for books
    if (/\.\s+[A-Z][a-z]+\s+Publishers?,\s*[A-Z]/.test(scrubbedForDetection)) scores.harvard += 2;
    // Harvard uses "and" (not "&") between authors with surname-initial format
    if (/^[A-Z\u00c0-\u017e][a-z\u00c0-\u00ff']+,\s*(?:[A-Z](?:\.[A-Z])*\.?).+\band\b.+\(\d{4}\)/.test(scrubbedForDetection)) scores.harvard += 4;
    if (/^[A-Z\u00c0-\u017e][a-z\u00c0-\u00ff']+,\s*[A-Z].+\band\b.+,\s*\d{4},\s*[A-Za-z]+\.?\s+[A-Z]/.test(scrubbedForDetection)) scores.harvard += 6;
    if (/\band\b.+,\s*\d{4}\.\s+.+,\s*\d+\(\d+\),\s*pp\.?\s*\d+/i.test(scrubbedForDetection)) scores.harvard += 8;
    if (/^[A-Z\u00c0-\u017e][A-Za-z\u00c0-\u024f'’-]+,\s*(?:[A-Z](?:\.[A-Z])*\.?)(?:,\s*(?:[A-Z\u00c0-\u017e][A-Za-z\u00c0-\u024f'’-]+|(?:da|de|del|der|di|du|la|le|van|von)\s+[A-Z\u00c0-\u017e][A-Za-z\u00c0-\u024f'’-]+),\s*(?:[A-Z](?:\.[A-Z])*\.?))*(?:\s+and\s+(?:[A-Z\u00c0-\u017e][A-Za-z\u00c0-\u024f'’-]+|(?:da|de|del|der|di|du|la|le|van|von)\s+[A-Z\u00c0-\u017e][A-Za-z\u00c0-\u024f'’-]+),\s*(?:[A-Z](?:\.[A-Z])*\.?))?,\s*\d{4}\.\s+.+\.\s+[A-Z].+,\s*\d+(?:\([^)]+\))?,\s*(?:pp\.?\s*\d+|Article\s+\S+)/i.test(scrubbedForDetection)) scores.harvard += 10;
    if (/^[A-Z\u00c0-\u017e][A-Za-z\u00c0-\u024f'’-]+,\s*(?:[A-Z](?:\.[A-Z])*\.?),\s*\d{4}\.\s+.+\.\s+[A-Z].+,\s*\d+(?:\([^)]+\))?,\s*(?:pp\.?\s*\d+|Article\s+\S+)/i.test(scrubbedForDetection)) scores.harvard += 10;
    // Harvard removed DOI check

    // ---- Disambiguation tiebreakers ----

    // APA vs Harvard: Both have year in parens after author. 
    // Key difference: APA has "(Year)." (period after parens), Harvard has "(Year) Title" (no period)
    if (/\(\d{4}[a-z]?\)\./.test(scrubbedForDetection)) {
      scores.apa += 1;
    }

    // Strong Harvard pre-checks: distinguish from Chicago/MLA
    // 1) Single-quoted title immediately after year-in-parens: Author, I. (Year) 'Title', Journal...
    if (/^[A-Z\u00c0-\u017e][A-Za-z\u00c0-\u024f'’-]+,\s*(?:[A-Z](?:\.[A-Z])*\.?).*\((?:19|20)\d{2}[a-z]?\)\s+['\u2018][^'\u2019]+['\u2019],\s*[A-Z]/.test(trimmed)) {
      return 'harvard';
    }
    // 2) "Available at:" plus "(Accessed: ...)" is effectively unique to Harvard web refs
    if (/Available at:/i.test(trimmed) && /\(Accessed:/i.test(trimmed)) {
      return 'harvard';
    }

    // MLA vs Chicago with quoted titles: 
    // MLA uses "vol. X, no. Y" OR "Volume.Issue (Year): pages"
    // Chicago uses "Volume, no. Issue (Year): pages"
    if (/\"[^\"]+\"/.test(scrubbedForDetection)) {
      // Check for MLA's "vol." pattern
      if (/,\s*vol\.\s*\d+/.test(trimmed)) {
        scores.mla += 2;
      }
    }

    // Find the style with the highest score
    let bestStyle: CitationStyle | null = null;
    let bestScore = 0;

    for (const [style, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestStyle = style as CitationStyle;
      }
    }

    if (DEBUG_STRESS) {
      const top3 = (Object.entries(scores) as [CitationStyle, number][])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s, n]) => `${s}:${n}`)
        .join(', ');
      console.debug('[DS1] top-3 scores:', top3, 'winner:', bestStyle);
    }

    // Require a minimum confidence score of 2
    if (bestScore < 2) {
      // Last resort: try generic patterns
      if (/\(\d{4}\)/.test(trimmed)) return 'apa';
      // Year without parens but with comma-initial author pattern
      if (/^[A-Z][a-zÀ-ÿ]+,.+\d{4}/.test(trimmed)) return 'apa';
      return null;
    }

    return bestStyle;
  }

  /**
   * Parse reference text into structured data based on the detected style.
   * Returns parsed fields plus patternHits for debugging/analytics.
   */
  parseReference(text: PreNormalizedText, style: CitationStyle | string): { parsed: ParsedReference; patternHits: PatternHit[] } {
    let parsed: ParsedReference = {};

    // Normalize style to lowercase
    const normalizedStyle = (typeof style === 'string' ? style.toLowerCase() : style) as CitationStyle;

    // Clean the text
    let cleanText = text.trim();

    try {
      switch (normalizedStyle) {
        case 'apa':
          parsed = this.parseAPA(cleanText); break;
        case 'mla':
          parsed = this.parseMLA(cleanText); break;
        case 'harvard':
        case 'harvard-ctr':
          parsed = this.parseHarvard(cleanText); break;
        case 'chicago':
        case 'chicago-ad':
        case 'chicago-nb':
          parsed = this.parseChicago(cleanText); break;
        case 'ieee':
          parsed = this.parseIEEE(cleanText); break;
        case 'vancouver':
          parsed = this.parseVancouver(cleanText); break;
        default:
          parsed = this.parseGeneric(cleanText); break;
      }
    } catch (error) {
      console.error('Error parsing reference:', error);
      parsed = this.parseGeneric(cleanText);
    }

    if (!parsed.year) {
      const trailingMatch = cleanText.match(/,\s*((?:19|20)\d{2}|n\.d\.)\.$/i);
      if (trailingMatch) {
        parsed.year = trailingMatch[1];
      } else {
        const globalYearMatch = cleanText.match(/(?:^|\s|\(|\[)((?:19|20)\d{2}|n\.d\.)(?:\)|\]|[.,]|$)/gi);
        if (globalYearMatch && globalYearMatch.length > 0) {
          // Take the last reasonable year match, extract digits or n.d.
          const lastMatch = globalYearMatch[globalYearMatch.length - 1];
          const yearToken = lastMatch.match(/(?:\d{4}|n\.d\.)/i);
          if (yearToken) {
            parsed.year = yearToken[0];
          }
        }
      }
    }

    // Chapter extraction: at most one "In:" extractor fires per reference.
    let chapterExtracted = false;

    // Vancouver: "In: Editor (Ed.), Book Title" or "In: Editor, Editor. Book Title."
    if (/ In: /i.test(cleanText) && /Editor|Ed\.|editors|\(Ed\.?\)/i.test(cleanText)) {
      const inMatch = cleanText.match(/ In: ([^.]+?)(?:\.|,)\s*(?:Editors?|editors?|\(?Eds?\.?\)?)\s*\.?\s*,?\s*([^.]+)?/i);
      if (inMatch) {
        if (!parsed.editor) parsed.editor = inMatch[1].trim();
        if (inMatch[2] && !parsed.bookTitle) parsed.bookTitle = inMatch[2].trim();
        chapterExtracted = true;
      }
    }

    // APA: "In E. Brown & K. White (Eds.), Book Title (pp. N–N). Publisher."
    if (!chapterExtracted && / In /.test(cleanText) && /\(Eds?\.\)/.test(cleanText)) {
      const apaChapterMatch = cleanText.match(/ In (.+?)\(Eds?\.\),?\s*([^(]+?)(?:\((?:pp?\.\s*)?([\d\-–]+)\))?\.?\s*([^.]+)?\.?\s*$/i);
      if (apaChapterMatch) {
        if (!parsed.editor) parsed.editor = apaChapterMatch[1].trim().replace(/[&,]\s*$/, '').trim();
        if (apaChapterMatch[2] && !parsed.bookTitle) {
          let bt = apaChapterMatch[2].trim();
          bt = bt.replace(/\(\d+(?:st|nd|rd|th)\s*ed\.?,?\s*/, '(').replace(/^\(/, '').replace(/\)\s*$/, '').trim();
          if (bt) parsed.bookTitle = bt;
        }
        if (apaChapterMatch[3] && !parsed.pages) parsed.pages = apaChapterMatch[3].replace(/–/g, '-');
        if (apaChapterMatch[4] && !parsed.publisher) parsed.publisher = apaChapterMatch[4].trim();
        chapterExtracted = true;
      }
    }

    // IEEE-like / generic: "In Book Title Year (pp. X–Y)." or "In Book Title (pp. X–Y)."
    if (!chapterExtracted && /\b In\s+.+?\s*\((?:pp?\.\s*)?[\d\-–]+\)\s*\./i.test(cleanText)) {
      const inBookMatch = cleanText.match(/\b In\s+([^.]+?)\s+\((?:(?:pp?\.\s*)?([\d\-–]+))\)\s*\./i);
      if (inBookMatch) {
        let bookPart = inBookMatch[1].trim();
        const pagesPart = inBookMatch[2].replace(/–/g, '-');
        const yearAtEnd = bookPart.match(/\s+((?:19|20)\d{2})\s*$/);
        if (yearAtEnd && !parsed.year) {
          parsed.year = yearAtEnd[1];
          bookPart = bookPart.replace(/\s+(?:19|20)\d{2}\s*$/, '').trim();
        }
        if (!parsed.bookTitle && bookPart) parsed.bookTitle = bookPart;
        if (!parsed.pages) parsed.pages = pagesPart;
        chapterExtracted = true;
      }
    }

    // Direct pre-pass for complex Supplements hiding outside normalized loops
    const suppFullMatch = cleanText.match(/(\d+)\s*Suppl\.?\s*(\d+)?:\s*([SP]?\d+(?:[-–][SP]?\d+)?)/i);
    if (suppFullMatch) {
      parsed.volume = suppFullMatch[1];
      if (suppFullMatch[2]) parsed.issue = `Suppl. ${suppFullMatch[2]}`;
      parsed.pages = suppFullMatch[3];
    }

    this.filterPublisherFromAuthors(parsed);
    const patternHits = this.applyDynamicPatterns(cleanText, parsed, normalizedStyle);
    const normalizedParsed = this.normalizeParsedReference(parsed, normalizedStyle, cleanText);

    if (normalizedParsed.year !== undefined) {
      const recovered = recoverYear(normalizedParsed.year, cleanText);
      if (recovered !== normalizedParsed.year) {
        normalizedParsed.year = recovered;
        normalizedParsed.parseWarnings = [...(normalizedParsed.parseWarnings ?? []), 'invalid-year-recovered'];
      }
    }

    return { parsed: normalizedParsed, patternHits };
  }

  /**
   * Apply dynamic patterns (guarded: only fill missing fields).
   * Returns which patterns fired for debugging and analytics.
   */
  private applyDynamicPatterns(raw: string, fields: ParsedReference, style?: string): PatternHit[] {
    const hits: PatternHit[] = [];
    for (const pattern of this.dynamicPatterns) {
      if (pattern.styles && (!style || !pattern.styles.includes(style))) continue;
      const match = raw.match(pattern.regex);
      if (match) {
        const filledFields: string[] = [];
        let matchedSlice = match[0]?.substring(0, 80) ?? '';
        for (const [key, index] of Object.entries(pattern.fields)) {
          const idx = typeof index === 'number' ? index : parseInt(index, 10);
          const current = (fields as any)[key];
          const isEmpty = current === undefined || current === '' || (key === 'year' && /^n\.d\.$/i.test(String(current)));
          // GUARD: Never overwrite a populated field with a dynamic pattern match (treat n.d. as empty for year recovery)
          if (match[idx] !== undefined && isEmpty) {
            (fields as any)[key] = match[idx];
            filledFields.push(key);
          }
        }
        if (filledFields.length > 0) {
          hits.push({ id: pattern.id, fields: filledFields, matched: matchedSlice, category: pattern.category });
        }
      }
    }
    return hits;
  }

  /** Split merged volume+issue (e.g. 5217553 → vol 521, issue 7553; 5416 → vol 54, issue 16). Returns null if not applicable. */
  private splitMergedVolumeIssue(token: string): { volume: string; issue: string } | null {
    const m = token.match(/^(\d{2,4})(\d{2,4})$/);
    if (!m) return null;
    const vol = m[1];
    const issue = m[2];
    if (issue.length < 2) return null;
    return { volume: vol, issue };
  }

  /** Extract locator: preserve pages, e-locators (n71, b2535, e1000097), article numbers. Never discard. */
  private extractLocator(input: string): { pages?: string; 'article-number'?: string } | null {
    return extractLocatorFields(input);
  }

  /**
   * Pre-CSL Normalization of parsed references.
   * Strips out placeholders and extracts tricky fields (e.g. article-numbers)
   * so they pass into the Strict Renderer properly without dumping text to CSL.
   */
  private normalizeParsedReference(parsed: ParsedReference, style: CitationStyle, rawText?: string): ParsedReference {
    const clean = { ...parsed };

    // 1. Strip dummy fallbacks so strict validation catches missing data
    if (clean.title === 'Unknown Title') delete clean.title;
    if (clean.authors && clean.authors.length === 1 && clean.authors[0] === 'Unknown Author') {
      delete clean.authors;
    }

    // 1b. Journal abbreviation expansion
    if (clean.journal && looksAbbreviated(clean.journal)) {
      const expanded = expandJournalName(clean.journal);
      if (expanded !== clean.journal) clean.journal = expanded;
    }


    // 2b. Compact physics/Vancouver form: "Journal. 128(4):040501" — N(N):N embedded in container fields
    //     Must run before the article-number check so extracted pages can be promoted.
    const compactVolIssuePagesRe = /[\s.](\d+)\((\d+)\)\s*:\s*(\d+(?:[-–]\d+)?)\s*\.?\s*$/;
    for (const field of ['journal', 'publisher', 'bookTitle'] as const) {
      const val = clean[field];
      if (val && typeof val === 'string') {
        const match = val.match(compactVolIssuePagesRe);
        if (match) {
          if (!clean.volume) clean.volume = match[1];
          if (!clean.issue) clean.issue = match[2];
          if (!clean.pages) clean.pages = match[3].replace(/–/g, '-').trim();
          (clean as any)[field] = val.replace(compactVolIssuePagesRe, '').replace(/\.\s*$/, '').trim();
        }
      }
    }

    // 2c. Split merged volume/issue (e.g. 5217553, 5416, 7718) — first-class reusable pass
    if (clean.volume && /^\d{4,7}$/.test(clean.volume) && !isValidYear(clean.volume)) {
      const split = this.splitMergedVolumeIssue(clean.volume);
      if (split) {
        clean.volume = split.volume;
        if (split.issue && !clean.issue) clean.issue = split.issue;
        clean.parseWarnings = [...(clean.parseWarnings ?? []), 'merged-volume-issue'];
      }
    }

    // 3. Extract Article Numbers / e-locators (040501, e10293, n71, b2535, Art. no. 6, L12345)
    if (clean.pages) {
      const loc = this.extractLocator(clean.pages);
      if (loc) {
        if (loc['article-number']) {
          clean['article-number'] = loc['article-number'];
          delete clean.pages;
        } else if (loc.pages) {
          clean.pages = loc.pages;
        }
      }
    }

    // 3b. Validator: bar article-locator from pages — if pages holds n71, R137, 2402039, promote to article-number
    if (clean.pages && !clean['article-number']) {
      const loc = this.extractLocator(clean.pages);
      if (loc?.['article-number']) {
        clean['article-number'] = loc['article-number'];
        delete clean.pages;
      }
    }

    // 4. Structural hacks per style
    if (clean.title) {
      clean.title = normalizeProtectedTokenValue(clean.title);
      // Strip any residual bounding quotes that leaked from the string parser
      clean.title = clean.title.replace(/^["'‘“](.*?)["'’”]$/, '$1').trim();
      // Strip any residual Vol./No./Pages fragments that leaked into the title
      clean.title = clean.title.replace(/\s*Vol\.?\s*\d+(?:,\s*No\.?\s*\d+)?\s*[:;]?\s*\d*[-–]?\d*\s*\.?\s*$/i, '').trim();
      // Strip trailing "(YYYY)." pattern leaked from preNormalize
      clean.title = clean.title.replace(/\s*\(\d{4}\)\.\s*$/, '').trim();

      // Strip trailing "author as tagline" from titles like
      // "Developing ... via AHP: M. Benaida." where the last segment
      // redundantly repeats the primary author name.
      if (clean.authors && clean.authors.length > 0) {
        const firstAuthor = clean.authors[0];
        const surname = firstAuthor.split(',')[0]?.trim();
        const initialsMatch = firstAuthor.match(/,\s*([A-Z](?:\.\s*)?(?:[A-Z](?:\.\s*)?)*)/);
        const initialsRaw = initialsMatch?.[1]?.trim();
        const candidates: string[] = [];
        const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        if (surname) {
          candidates.push(surname);
        }
        if (initialsRaw) {
          const initialsNormalized = initialsRaw.replace(/\s+/g, ' ').trim();
          const initialsCompact = initialsNormalized.replace(/\s+/g, '');
          candidates.push(initialsNormalized, initialsCompact);
          if (surname) {
            candidates.push(`${initialsNormalized} ${surname}`, `${initialsCompact} ${surname}`);
          }
        }

        for (const cand of candidates) {
          if (!cand) continue;
          const re = new RegExp(`[:\\-]\\s*${escape(cand)}\\.?$`, 'i');
          if (re.test(clean.title)) {
            clean.title = clean.title.replace(re, '').trim().replace(/[.:]\s*$/, '').trim();
            break;
          }
        }
      }

      if (style === 'apa') {
        // APA sentence casing normalization
        clean.title = clean.title.charAt(0).toUpperCase() + clean.title.slice(1);
      }

      clean.title = normalizeProtectedTokenValue(clean.title);
      if (rawText && /\bU-Net\b/i.test(rawText) && !/\bU-Net\b/i.test(clean.title)) {
        clean.title = clean.title.replace(/^U[-\s]+Convolutional\b/i, 'U-Net: Convolutional');
      }
    }

    if (clean.pages) {
      // Strip residual "pp. " or "p. " prefixes since the CSL engine handles locator labels natively
      clean.pages = clean.pages.replace(/^p?p\.?\s*/i, '').trim();
    }

    // Normalization logic for Vol/No format mapped by Vancouver or APA fallbacks
    if (clean.volume) {
      const volNoMatch = clean.volume.match(/^Vol\.?\s*(\d+)(?:,\s*No\.?\s*(\d+))?$/i);
      if (volNoMatch) {
        clean.volume = volNoMatch[1];
        if (volNoMatch[2] && !clean.issue) clean.issue = volNoMatch[2];
      }
    }

    // Chicago eBook Author token fix
    // "Witten, Ian H. 1947-" where author absorbed the birth year from the library record
    if (clean.authors?.length) {
      for (let i = 0; i < clean.authors.length; i++) {
        const authorStr = clean.authors[i];
        let authorCleaned = authorStr.trim();
        // Remove trailing commas/dates/years from author strings (e.g. ", 1947-" or ", 1955")
        // Check if author string ends with a 4-digit year optionally followed by a hyphen or question mark
        const trailingYearMatch = authorCleaned.match(/(?:,\s*|\s+)(\b(?:19|20)\d{2}\b)[-?]?\s*\.?$/);
        if (trailingYearMatch) {
          authorCleaned = authorCleaned.slice(0, trailingYearMatch.index).replace(/,\s*$/, '').trim();
          clean.authors[i] = authorCleaned;
          // Only pull to global year if year is missing
          if (!clean.year) {
            clean.year = trailingYearMatch[1];
          }
        }
      }
    }

    // Extract and strip "Vol. N, No. N:pages" from journal/publisher so CSL gets clean data; populate volume/issue/pages if missing
    const volNoPagesRe = /(?:[;,]?\s*)(Vol\.?\s*\d+)(?:,\s*No\.?\s*(\d+))?\s*:?\s*([\d\-–]+)\s*\.?\s*$/i;
    for (const field of ['journal', 'publisher', 'bookTitle'] as const) {
      const val = clean[field];
      if (val && typeof val === 'string') {
        const match = val.match(volNoPagesRe);
        if (match) {
          if (!clean.volume) clean.volume = match[1].replace(/\D/g, '');
          if (match[2] && !clean.issue) clean.issue = match[2];
          if (match[3] && !clean.pages) clean.pages = match[3].replace(/–/g, '-').trim();
          (clean as any)[field] = val.replace(volNoPagesRe, '').trim();
        } else {
          (clean as any)[field] = val
            .replace(/\s*[;,]?\s*Vol\.?\s*\d+(?:,\s*No\.?\s*\d+)?\s*:?\s*[\d\-–]+\s*\.?\s*$/i, '')
            .trim();
        }
      }
    }

    // Deduplication of redundant trailing years appended to pages, book titles, publishers or journals
    // Skip when input has year twice — keep both (e.g. "Author (2021). Title. Journal 82 (2021): pp.")
    const shouldDedupYear =
      clean.year &&
      (!rawText || (rawText.match(new RegExp(`\\b${clean.year.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) || []).length < 2);
    if (shouldDedupYear) {
      const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedYear = escapeRegExp(clean.year!);
      const trailingYearRegex = new RegExp(`[\\s,;\\.]*\\(?${escapedYear}\\)?\\.?$`, 'i');

      ['pages', 'publisher', 'journal', 'bookTitle'].forEach(field => {
        const val = (clean as any)[field];
        if (val && typeof val === 'string') {
          (clean as any)[field] = val.replace(trailingYearRegex, '').trim();
        }
      });
    }

    if (clean.journal) clean.journal = normalizeKnownContainerName(clean.journal);
    if (clean.conferenceTitle) clean.conferenceTitle = normalizeKnownContainerName(clean.conferenceTitle);
    if (clean.bookTitle) clean.bookTitle = normalizeKnownContainerName(clean.bookTitle);
    if (clean.publisher) clean.publisher = normalizeKnownContainerName(clean.publisher);

    // Authors: only safe normalization (whitespace, trailing punctuation) — no numbering strip; done in preNormalize

    // Edge Case: Mixed Author List with isolated initials
    if (clean.authors) {
      for (const author of clean.authors) {
        // Flags when an author looks like "S. N." or "J.-F." incorrectly set as full name
        if (/^[A-Z](?:\.\s*[A-Z])*\.?$/i.test(author) || /^[A-Z]\.-[A-Z]\.?$/i.test(author)) {
          // We flag it on the parsed structure using a fake field so validators can catch it
          (clean as any)['_author_warning'] = 'warning: initials_formatted_as_surname';
        }
      }
    }

    // 5. Normalization for Supplements (e.g., Supplement_2 -> Suppl. 2)
    // Search both issue and pages spaces for supplement declarations
    const suppRegex = /^(?:Supplement_|Suppl?[.\s]*)(\d+)$/i;

    if (clean.issue) {
      const suppMatch = clean.issue.match(suppRegex);
      if (suppMatch) clean.issue = `Suppl. ${suppMatch[1]}`;
    }

    // Sometimes it leaks into pages or is a raw string in the parser fallbacks
    if (clean.pages && suppRegex.test(clean.pages)) {
      const suppMatch = clean.pages.match(suppRegex);
      if (suppMatch) {
        clean.issue = `Suppl. ${suppMatch[1]}`;
        delete clean.pages; // clear it from pages if it was just a supplement
      }
    }

    // 6. Extraction from raw text (runs for all styles)
    if (rawText) {
      // 6.0 Vol/No extraction: "Vol. N, No. N:pages" (rare format, handled universally)
      if (!clean.volume) {
        const volNoMatch = rawText.match(/Vol\.?\s*(\d+)(?:,\s*No\.?\s*(\d+))?\s*[:;]\s*([Pp]{0,2}\.?\s*\d+(?:[-–]\d+)?)/i);
        if (volNoMatch) {
          clean.volume = volNoMatch[1];
          if (volNoMatch[2] && !clean.issue) clean.issue = volNoMatch[2];
          if (volNoMatch[3] && !clean.pages) {
            clean.pages = volNoMatch[3].replace(/^[Pp]{1,2}\.?\s*/, '').trim();
          }
        }
      }

      // 6a. Extract "In: Editor, editor." — only if parser-level chapter extraction didn't already fire.
      //     This is a universal fallback; the style-specific "In:" blocks in parseReference take priority.
      if (!clean.editor && !clean.bookTitle) {
        if (/\bIn:\s/.test(rawText) && (/\b(?:editor|editors|Ed\.|Eds\.)/i.test(rawText) || /\bp{1,2}\.\s*\d/.test(rawText))) {
          const inEditorMatch = rawText.match(/In:\s*(.+?)\s*,?\s*(?:editor|editors|Ed\.|Eds\.)\.?\s*(.*)/i);
          if (inEditorMatch) {
            clean.editor = inEditorMatch[1].trim().replace(/,\s*$/, '');
            const afterEditor = inEditorMatch[2].trim();
            const bookTitleMatch = afterEditor.match(/^([^.]+)/);
            if (bookTitleMatch) {
              let bt = bookTitleMatch[1].trim();
              bt = bt.replace(/\d+(?:st|nd|rd|th)\s*ed\.?/i, '').trim();
              if (bt) clean.bookTitle = bt;
            }
          }
        }
      }

      // 6b. Extract publisher info: "City: Publisher; Year" or "City: Publisher, Year" or "City: Publisher."
      // Anchor on the colon between city and publisher — the only universal separator.
      // City must have 3+ lowercase chars (excludes "In:", "Vol:", "No:" etc.)
      // Publisher must start with a capital letter.
      // Year delimiter can be ; , or . (varies by style: Vancouver ;, Harvard/Chicago ,, APA .)
      if (!clean.publisher) {
        const pubRe = /((?:[A-Z][a-z]{2,}\s*){1,3}(?:,\s*[A-Z]{2})?)\s*:\s*([A-Z][a-z][^;,]*?)[;,.]\s*(\d{4})/g;
        for (const pubMatch of rawText.matchAll(pubRe)) {
          const city = pubMatch[1].trim();
          // Skip false positives: "In:", "Vol:", etc.
          if (/^(In|Vol|No)$/i.test(city)) continue;
          if (!clean.placeOfPublication) clean.placeOfPublication = city;
          clean.publisher = pubMatch[2].trim();
          if (!clean.year) clean.year = pubMatch[3];
          break;
        }
      }

      // 6c. Extract chapter pages: "p. NNN-NNN" or "pp. NNN-NNN"
      const chapterPages = rawText.match(/p{1,2}\.\s*(\d+[\-–]\d+)/);
      if (chapterPages && !clean.pages) {
        clean.pages = chapterPages[1];
      }

      // 6d. Extract edition: "3rd ed." / "2nd edition" / "1st ed."
      const edMatch = rawText.match(/(\d+)(?:st|nd|rd|th)\s*(?:ed(?:ition)?\.?)/i);
      if (edMatch && !clean.edition) {
        clean.edition = edMatch[1];
      }
    }

    // 4. Resolve fallback year to raw year search if available and required
    if ((!clean.year || clean.year === 'n.d.') && rawText) {
      // Look for a realistic 4-digit year in the original text since structured fields missed it.
      const rawYearMatch = rawText.match(/\b((?:19|20)\d{2})\b/);
      if (rawYearMatch) {
        clean.year = rawYearMatch[1];
      }
    }

    return clean;
  }

  // ==========================================
  // APA PARSER
  // Format: Author, I., & Author, B. (Year). Title. Journal, Volume(Issue), Pages.
  // ==========================================
  private parseAPA(text: string): ParsedReference {
    const quotedConference = this.parseQuotedConferenceCitation(text, 'chicago');
    if (quotedConference) {
      return quotedConference;
    }

    const parsed: ParsedReference = {};

    // Remove leading number if present — shared helper handles all formats
    let cleanText = stripLeadingNumbering(text);

    // 1) Extract authors and year
    // Pattern: everything before "(YYYY)" is authors
    const authorYearMatch = cleanText.match(/^(.+?)\s*\((\d{4}[a-z]?)(?:,\s*[^)]+)?\)\.\s*/);
    if (authorYearMatch) {
      parsed.authors = this.parseAuthorList(authorYearMatch[1].trim(), 'apa');
      parsed.year = authorYearMatch[2];

      // Everything after "(Year). "
      const remainder = cleanText.substring(authorYearMatch[0].length);

      // 2) Extract title: text up to the first period that is followed by a space and capital letter
      //    (indicating the start of the journal name), or followed by end of string
      const titleRemainder = this.extractTitleAndRemainder(remainder);
      parsed.title = titleRemainder.title;

      if (titleRemainder.remainder) {
        // Temporarily strip DOI/URL from remainder before journal parsing
        let journalContext = titleRemainder.remainder;
        const urlMatch = journalContext.match(/(https?:\/\/\S+)/);
        if (urlMatch) {
          journalContext = journalContext.replace(urlMatch[0], '').trim();
        }
        this.parseJournalInfoAPA(journalContext, parsed);
      }
    } else {
      // Fallback: APA-like with year without parentheses: "Author, I. 2017. Title. Journal..."
      const yearNoParen = cleanText.match(/^(.+?)\s+(\d{4})\.\s*(.+)$/);
      if (yearNoParen) {
        const beforeYear = yearNoParen[1].trim();
        // Heuristic: if the chunk before the year clearly contains non-person tokens (title-like),
        // treat the whole line as non-APA and delegate to generic/IEEE-style parsing instead.
        const tokens = beforeYear.split(',').map((s) => s.trim()).filter(Boolean);
        const isPersonLike = (s: string): boolean =>
          /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+[A-Z]{1,3}\.?$/.test(s) ||
          /^[A-Z][a-z]+,\s*[A-Z]{1,3}\.?$/.test(s);
        const personCount = tokens.filter(isPersonLike).length;
        if (tokens.length >= 2 && personCount < tokens.length) {
          // Mixed person + non-person → this is likely an IEEE/Vancouver style "Author, Author, Title, Year."
          return this.parseGeneric(cleanText);
        }

        parsed.authors = this.parseAuthorList(beforeYear.replace(/[,&]\s*$/, '').trim(), 'apa');
        parsed.year = yearNoParen[2];
        const remainder = yearNoParen[3];
        const titleRemainder = this.extractTitleAndRemainder(remainder);
        parsed.title = titleRemainder.title;
        if (titleRemainder.remainder) {
          this.parseJournalInfoAPA(titleRemainder.remainder, parsed);
        }
      } else {
        // Last fallback: try generic
        return this.parseGeneric(cleanText);
      }
    }

    // DOI extraction removed

    // Extract URL
    this.extractURL(cleanText, parsed);
    return parsed;
  }

  /**
   * Extract title from text where title ends with ". " or "? " or "! " followed by a capital letter
   * or at end of string.
   */
  private extractTitleAndRemainder(text: string): { title: string; remainder: string } {
    // Try to find where the title ends and journal begins
    // The title typically ends with a period, followed by a space and the journal name (capitalized)
    // But title itself might contain periods (e.g., "U.S." or abbreviations)

    // Strategy: look for ". " or "? " or "! " followed by a word that starts with a capital letter,
    // and the next segment looks like a journal (contains a comma followed by a number)

    // First, try splitting on "? " or "! " if the next part looks like journal info
    // This handles titles like "What Is Personality Disorder? Philosophy, Psychiatry, ..."
    const qMarkSplit = text.match(/^(.+?[?!])\s+([A-Z].+)$/);
    if (qMarkSplit) {
      const potentialRemainder = qMarkSplit[2];
      // Check if it looks like journal info (contains volume/issue pattern)
      if (/,\s*\d+/.test(potentialRemainder) || /,\s*\*?\d+/.test(potentialRemainder)) {
        const out = { title: qMarkSplit[1], remainder: potentialRemainder };
        if (DEBUG_STRESS) console.debug('[ETR1] branch:qMark', '[ETR2] title:', (out.title).slice(0, 80), '[ETR3] remainder:', (out.remainder).slice(0, 80));
        return out;
      }
    }

    // Standard splitting on ". "
    const parts = text.split(/\.\s+/);

    if (parts.length <= 1) {
      const out = { title: text.replace(/\.$/, ''), remainder: '' };
      if (DEBUG_STRESS) console.debug('[ETR1] parts:', parts.length, '[ETR2] title:', (out.title).slice(0, 80), '[ETR3] remainder:', out.remainder);
      return out;
    }

    // Generalized "subtitle vs journal": only treat as remainder when segment looks like journal
    // (contains comma followed by digits). Don't split on bare Roman numerals or "Vol."
    const ROMAN = /^(I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|Vol\.?)$/i;
    const looksLikeJournal = (s: string) => /,\s*\d+/.test(s) || /,\s*\*?\d+/.test(s);

    for (let i = 1; i < parts.length; i++) {
      const potentialTitle = parts.slice(0, i).join('. ');
      const potentialRemainder = parts.slice(i).join('. ');
      const firstSegment = parts[i].trim();
      const firstWord = firstSegment.split(/\s+/)[0];
      const CONTINUATION = /^(I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|Vol\.?|A|An|The|Part|Section|Series|And|Or|In|On|Of|For|With)$/i;
      // Don't treat continuation words, roman numerals, or lowercase words as start of journal
      // keep in title (e.g. "III. The role...", "A Laboratory Manual", "of exact exchange")
      if (CONTINUATION.test(firstWord) || /^[a-z]/.test(firstWord)) continue;
      // Only treat segment i as journal-start when this segment itself contains ,\s*\d (not the whole remainder)
      if (/^[A-Z]/.test(potentialRemainder) && looksLikeJournal(potentialRemainder)) {
        const out = { title: potentialTitle, remainder: potentialRemainder };
        if (DEBUG_STRESS) console.debug('[ETR1] parts:', parts.length, 'i:', i, '[ETR2] title:', (out.title).slice(0, 80), '[ETR3] remainder:', (out.remainder).slice(0, 80));
        return out;
      }
    }

    // If we can't clearly separate, take first part as title
    const fallback = { title: parts[0], remainder: parts.slice(1).join('. ') };
    if (DEBUG_STRESS) console.debug('[ETR1] parts:', parts.length, 'branch:fallback', '[ETR2] title:', (fallback.title).slice(0, 80), '[ETR3] remainder:', (fallback.remainder).slice(0, 80));
    return fallback;
  }

  private parseConferenceRemainder(text: string, parsed: ParsedReference): boolean {
    if (!text || !text.trim()) return false;

    if (DEBUG_STRESS) console.debug('[CR1] input:', text.slice(0, 100));

    let clean = text.replace(/\.\s*(https?:\/\/\S+|doi:\s*\S+)?\s*\.?\s*$/, '').trim();
    if (!/\b(?:proc(?:eedings)?\.?|conference|symposium|workshop|ICECA|CVPR)\b/i.test(clean)) {
      if (DEBUG_STRESS) console.debug('[CR2] no match (proc pattern), set: none');
      return false;
    }

    const pagesMatch =
      clean.match(/\bpp?\.?\s*([A-Z]?\d+(?:[-–][A-Z]?\d+)?)/i) ||
      clean.match(/\((?:pp?\.?\s*)?([A-Z]?\d+(?:[-–][A-Z]?\d+)?)\)/i);
    if (pagesMatch && !parsed.pages) {
      parsed.pages = pagesMatch[1].replace(/–/g, '-');
    }

    const yearMatches = clean.match(/\b((?:19|20)\d{2})\b/g);
    if (yearMatches?.length && !parsed.year) {
      parsed.year = yearMatches[yearMatches.length - 1];
    }

    const publisherMatch = clean.match(/(?:^|[).,]\s*)(IEEE|ACM|Springer|Elsevier)\.?(?:\s*,?\s*(?:19|20)\d{2})?$/i);
    if (publisherMatch && !parsed.publisher) {
      parsed.publisher = publisherMatch[1];
    }

    let conf = clean
      .replace(/^In:?\s*/i, '')
      .replace(/\((?:pp?\.?\s*)?[A-Z]?\d+(?:[-–][A-Z]?\d+)?\)/ig, '')
      .replace(/\bpp?\.?\s*[A-Z]?\d+(?:[-–][A-Z]?\d+)?/ig, '')
      .replace(/\b(?:19|20)\d{2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/ig, '')
      .replace(/(?:^|[).,]\s*)(IEEE|ACM|Springer|Elsevier)\.?(?:\s*,?\s*(?:19|20)\d{2})?$/i, '')
      .replace(/[.,]\s*(?:19|20)\d{2}\s*$/i, '')
      .replace(/\(\s*pp?\.?\s*$/i, '')
      .replace(/\s+\(\s*\)\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/[,\s.]+$/, '')
      .trim();

    if (conf && !parsed.conferenceTitle) {
      parsed.conferenceTitle = conf;
      if (DEBUG_STRESS) console.debug('[CR2] set:', { year: parsed.year, pages: parsed.pages, conferenceTitle: parsed.conferenceTitle, publisher: parsed.publisher });
      return true;
    }

    if (DEBUG_STRESS) console.debug('[CR2] set:', { year: parsed.year, pages: parsed.pages, conferenceTitle: parsed.conferenceTitle, publisher: parsed.publisher }, 'matchedPages:', !!pagesMatch);
    return !!pagesMatch;
  }

  private parseQuotedConferenceCitation(text: string, authorStyle: CitationStyle = 'chicago'): ParsedReference | null {
    const titleMatch = text.match(/"([^"]+)"/);
    if (!titleMatch) return null;

    const afterTitleStart = text.indexOf('"', text.indexOf('"') + 1) + 1;
    const afterTitle = text.substring(afterTitleStart).replace(/^\s*[\.,]?\s*/, '').trim();
    if (!/\b(?:proc(?:eedings)?\.?|conference|symposium|workshop|ICECA|CVPR)\b/i.test(afterTitle)) {
      return null;
    }

    const beforeTitle = text.substring(0, text.indexOf('"')).replace(/[.,]\s*$/, '').trim();
    const parsed: ParsedReference = {
      title: titleMatch[1].replace(/\.$/, '').trim(),
    };

    if (beforeTitle) {
      parsed.authors = this.parseAuthorList(beforeTitle, authorStyle);
    }

    this.parseConferenceRemainder(afterTitle, parsed);
    if (!parsed.year) {
      const yearMatches = afterTitle.match(/\b((?:19|20)\d{2})\b/g);
      if (yearMatches?.length) parsed.year = yearMatches[yearMatches.length - 1];
    }
    this.extractURL(text, parsed);

    return parsed.conferenceTitle ? parsed : null;
  }

  private parseJournalInfoAPA(text: string, parsed: ParsedReference): void {
    // Remove trailing period and DOI/URL
    let clean = text.replace(/\.\s*(https?:\/\/\S+|doi:\s*\S+)?\s*\.?\s*$/, '').trim();

    if (this.parseConferenceRemainder(clean, parsed)) {
      return;
    }

    // Conference-like remainder in APA can appear as:
    // "In Proceedings of ...", "In 2016 IEEE Conference ...", "Proceedings of ..."
    // Prefer conferenceTitle over journal to preserve correct reference typing and rendering.
    if (/^(?:In\s+)?(?:\d{4}\s+)?(?:Proc(?:eedings)?\.?|Proceedings|.*\bConference\b|.*\bSymposium\b|.*\bWorkshop\b)/i.test(clean)
      && !/,\s*\d+\s*(?:\(|,|$)/.test(clean)) {
      parsed.conferenceTitle = clean.replace(/^In\s+/i, '').trim();
      return;
    }

    // Pattern: Journal Name, Volume(Issue), Pages
    // Try specific pattern with issue first (anchors the volume correctly)
    // Then fall back to volume-only pattern
    let journalMatch = clean.match(/^(.+?),\s*(\d+)\((\d+(?:\s*Suppl\.\s*\d+)?)\),?\s*(.*)$/i);
    if (!journalMatch) {
      // Also check standard pattern without Suppl inside parenthesis
      journalMatch = clean.match(/^(.+?),\s*(\d+)\(([^)]+)\),?\s*(.*)$/);
    }

    if (!journalMatch) {
      // Volume-only pattern: validate volume is reasonable (< 1000)
      const volOnly = clean.match(/^(.+?),\s*(\d+),?\s*(.*)$/);
      if (volOnly && parseInt(volOnly[2], 10) < 1000) {
        journalMatch = [volOnly[0], volOnly[1], volOnly[2], '', volOnly[3]] as any;
      }
    }

    if (journalMatch) {
      // Remove any markdown italic markers
      parsed.journal = journalMatch[1].replace(/\*/g, '').trim();
      parsed.volume = journalMatch[2];
      if (journalMatch[3]) parsed.issue = journalMatch[3];

      if (journalMatch[4]) {
        const pagesText = journalMatch[4].replace(/\.\s*$/, '').trim();
        // Check for Article number: "Article e10293" or "Article 12345"
        const articleMatch = pagesText.match(/Article\s+(\S+)/i);
        if (articleMatch) {
          parsed.pages = `Article ${articleMatch[1]}`;
        } else {
          // Allow alphanumeric pages "e402", "S10-S20", etc.
          const pageMatch = pagesText.match(/^([a-zA-Z]?\d+[–-][a-zA-Z]?\d+|[a-zA-Z]?\d+)/);
          if (pageMatch) {
            parsed.pages = pageMatch[1];
          } else {
            parsed.pages = pagesText; // fallback just take it
          }
        }
      }
    } else {
      // Try match: "Journal, Volume" without further info
      const simpleJournal = clean.match(/^([^,]+?),\s*(\d+)$/);
      if (simpleJournal) {
        parsed.journal = simpleJournal[1].replace(/\*/g, '').trim();
        parsed.volume = simpleJournal[2];
        return;
      }

      // Look for a trailing Supplement block disjointed from volume
      const journalSupplement = clean.match(/^(.+?),\s*(Supplement_\d+|Suppl\.?\s*\d+)/i);
      if (journalSupplement) {
        parsed.journal = journalSupplement[1].replace(/\*/g, '').trim();
        parsed.issue = journalSupplement[2];
        return;
      }

      // Might just be a journal name or publisher
      parsed.journal = clean.replace(/\.\s*$/, '').replace(/\*/g, '').trim();
    }
  }

  // ==========================================
  // MLA PARSER
  // Format: Author. "Title." Journal, vol. X, no. Y, Year, pp. Pages.
  // Or: Author. "Title." Journal Volume.Issue (Year): Pages.
  // ==========================================
  private parseMLA(text: string): ParsedReference {
    const parsed: ParsedReference = {};
    let cleanText = stripLeadingNumbering(text);

    // 1) Extract quoted title
    const titleMatch = cleanText.match(/"([^"]+)"/);
    if (!titleMatch) {
      return this.parseGeneric(cleanText);
    }

    const title = titleMatch[1].replace(/\.$/, '').trim();
    parsed.title = title;

    // 2) Text before the quoted title = authors
    const beforeTitle = cleanText.substring(0, cleanText.indexOf('"')).trim();
    if (beforeTitle) {
      const authorStr = beforeTitle.replace(/\.\s*$/, '').trim();
      // Prefer a direct MLA pattern when present: "Surname, Initials, and Initials Surname"
      const mlaAuthorMatch = authorStr.match(/^([^,]+,\s*[^,]+),\s+and\s+(.+)$/);
      if (mlaAuthorMatch) {
        const first = mlaAuthorMatch[1].trim();
        const second = mlaAuthorMatch[2].trim();
        parsed.authors = [first, second];
      } else {
        parsed.authors = this.parseAuthorList(authorStr, 'mla');
      }
    }

    // 3) Text after the closing quote = journal info
    const afterTitleStart = cleanText.indexOf('"', cleanText.indexOf('"') + 1) + 1;
    let afterTitle = cleanText.substring(afterTitleStart).replace(/^\s*\.?\s*/, '').trim();

    if (afterTitle) {
      if (this.parseConferenceRemainder(afterTitle, parsed)) {
        this.extractURL(cleanText, parsed);
        return parsed;
      }
      // Try MLA 9th ed with "vol." and "nos. Y–Z" (issue range):
      // "Journal, vol. X, nos. Y–Z, Year, pp. Pages."
      const mlaVolNos = afterTitle.match(/^(.+?),\s*vol\.\s*(\d+),\s*nos?\.\s*(\d+)[–-](\d+),\s*(\d{4}),\s*pp\.\s*([\d–-]+)/i);
      if (mlaVolNos) {
        parsed.journal = mlaVolNos[1].replace(/\*/g, '').trim();
        parsed.volume = mlaVolNos[2];
        parsed.issue = `${mlaVolNos[3]}-${mlaVolNos[4]}`;
        parsed.year = mlaVolNos[5];
        parsed.pages = mlaVolNos[6];
        return parsed;
      }

      // Try MLA 9th ed with "vol." and "no." pattern:
      // "Journal, vol. X, no. Y, Year, pp. Pages."
      const mlaVol = afterTitle.match(/^(.+?),\s*vol\.\s*(\d+),\s*no\.\s*(\d+),\s*(\d{4}),\s*pp\.\s*([\d–-]+)/i);
      if (mlaVol) {
        parsed.journal = mlaVol[1].replace(/\*/g, '').trim();
        parsed.volume = mlaVol[2];
        parsed.issue = mlaVol[3];
        parsed.year = mlaVol[4];
        parsed.pages = mlaVol[5];
        return parsed;
      }

      const mlaArticle = afterTitle.match(/^(.+?),\s*vol\.\s*(\d+)(?:,\s*no\.\s*([^,]+))?,\s*(\d{4}),\s*(?:Article|Art\.?\s*no\.?)\s*([A-Za-z]?\d+)/i);
      if (mlaArticle) {
        parsed.journal = mlaArticle[1].replace(/\*/g, '').trim();
        parsed.volume = mlaArticle[2];
        if (mlaArticle[3]) parsed.issue = mlaArticle[3];
        parsed.year = mlaArticle[4];
        parsed['article-number'] = mlaArticle[5];
        return parsed;
      }

      // Try alternative MLA format: "Journal Volume.Issue (Year): Pages"
      const mlaAlt = afterTitle.match(/^(.+?)\s+(\d+)\.(\d+)\s*\((\d{4})\):\s*([\d–-]+)/);
      if (mlaAlt) {
        parsed.journal = mlaAlt[1].replace(/\*/g, '').trim();
        parsed.volume = mlaAlt[2];
        parsed.issue = mlaAlt[3];
        parsed.year = mlaAlt[4];
        parsed.pages = mlaAlt[5];
        return parsed;
      }

      // Try: "Journal Volume (Year): Pages"
      const mlaSimple = afterTitle.match(/^(.+?)\s+(\d+)\s*\((\d{4})\):\s*([\d–-]+)/);
      if (mlaSimple) {
        parsed.journal = mlaSimple[1].replace(/\*/g, '').trim();
        parsed.volume = mlaSimple[2];
        parsed.year = mlaSimple[3];
        parsed.pages = mlaSimple[4];
        return parsed;
      }

      // Fallback: just extract what we can
      const yearMatch = afterTitle.match(/\((\d{4})\)/);
      if (yearMatch) parsed.year = yearMatch[1];
      // Year when "vol. ?" etc.: e.g. "Journal, vol. ?, no. ?, 2013, pp. ?."
      if (!parsed.year) {
        const yearComma = afterTitle.match(/,\s*((?:19|20)\d{2})\s*(?:,|\s*,\s*pp\.|\.)/);
        if (yearComma) parsed.year = yearComma[1];
      }
      if (!parsed.year) {
        const yearCommaAlt = afterTitle.match(/,\s*((?:19|20)\d{2})\s*[,.]/);
        if (yearCommaAlt) parsed.year = yearCommaAlt[1];
      }

      const pagesMatch = afterTitle.match(/(?:pp\.\s*|:\s*)([\d–-]+)/);
      if (pagesMatch) parsed.pages = pagesMatch[1];

      // Journal name is typically the first part before any numbers or year
      const journalPart = afterTitle.split(/\s+\d|\(\d/)[0].replace(/[,.]$/, '').replace(/\*/g, '').trim();
      if (journalPart) parsed.journal = journalPart;
    }

    // Strip OpenAlex placeholder trailing " ?" from venue (e.g. "American Psychiatric Association eBooks ?")
    if (parsed.journal) parsed.journal = parsed.journal.replace(/\s*\?+\s*$/, '').trim();

    this.extractURL(cleanText, parsed);

    return parsed;
  }

  // ==========================================
  // HARVARD PARSER
  // Format: Author, I. (Year) Title. Journal, Volume(Issue), pp. Pages.
  // Or: Author, I. Year. Title. Publisher, Place.
  // ==========================================
  private parseHarvard(text: string): ParsedReference {
    const parsed: ParsedReference = {};
    let cleanText = stripLeadingNumbering(text);

    // Normalize curly single quotes to straight quotes for uniform parsing
    cleanText = cleanText.replace(/\u2018/g, "'").replace(/\u2019/g, "'");

    // Strip "Available at:" and "(Accessed: ...)" before parsing
    cleanText = cleanText.replace(/\s*Available at:\s*/gi, ' ').replace(/\s*\(Accessed:[^)]+\)\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim();

    // INTERCEPT VOL/ISSUE/PAGES AT END BEFORE YEAR EXTRACTION
    // Harvard pages are often 'pp.XXX-YYY'. Intercepting them immediately stops year-matching rules from misidentifying issue numbers.
    const trailingLocator = cleanText.match(/(?:,\s*|\.\s*|\s+)(?:(?:vol\.?\s*)?(\d+)\s*\(\s*(\d+)\s*\)\s*[,:]?\s*(?:pp\.?\s*)?(\d+(?:[-–]\d+)?)|(?:vol\.?\s*)?(\d+)[,:]\s*(?:pp\.?\s*)?(\d+(?:[-–]\d+)?)|(?:pp\.?|p\.)\s*(\d+(?:[-–]\d+)?))\s*\.?\s*$/i);
    let locatorStr = '';
    if (trailingLocator) {
      if (trailingLocator[1]) { parsed.volume = trailingLocator[1]; parsed.issue = trailingLocator[2]; parsed.pages = trailingLocator[3]; }
      else if (trailingLocator[4]) { parsed.volume = trailingLocator[4]; parsed.pages = trailingLocator[5]; }
      else if (trailingLocator[6]) { parsed.pages = trailingLocator[6]; }
      locatorStr = trailingLocator[0];
      cleanText = cleanText.substring(0, cleanText.length - locatorStr.length).trim();
    }

    // Pattern 1: Author, I. (Year) 'Title'... or Author, I. (Year) Title...
    // Year must be (19|20)xx so issue numbers like 7553 are never captured as year.
    const harvardWithParens = cleanText.match(/^(.+?)\s*\(((19|20)\d{2}[a-z]?)(?:,\s*[^)]+)?\)\s*\.?\s*(.+)$/);
    if (harvardWithParens) {
      let authorStr = harvardWithParens[1].trim();
      let remainder = harvardWithParens[4] + locatorStr;

      // Author/title boundary: "Author, \"Title\"" — split before quote so title is not parsed as author
      const authorQuotedTitle = authorStr.match(/^(.+?),\s*\\?["\u201C]([^"\\\u201D]+)[\"\u201D]\s*\.?\s*$/);
      if (authorQuotedTitle) {
        authorStr = authorQuotedTitle[1].trim();
        parsed.title = authorQuotedTitle[2].trim();
      }

      parsed.authors = this.parseAuthorList(authorStr, 'harvard');
      parsed.year = harvardWithParens[2];

      // Extract URL before parsing remainder
      this.extractURL(cleanText + locatorStr, parsed);
      if (parsed.url) {
        remainder = remainder.replace(parsed.url, '').trim();
      }
      // Strip trailing/leading dots and commas
      remainder = remainder.replace(/^[.,\s]+|[.,\s]+$/g, '').trim();

      // Check for quoted title (single or double quotes)
      const quotedTitle = remainder.match(/^["'‘“]([^"'’”]+)["'’”]\s*[,.]?\s*(.*)$/);
      if (parsed.title) {
        this.parseHarvardJournalInfo(remainder, parsed);
      } else if (quotedTitle) {
        parsed.title = quotedTitle[1].replace(/\.$/, '').trim();
        this.parseHarvardJournalInfo(quotedTitle[2], parsed);
      } else {
        // Title ends at first period followed by journal info
        const titleEnd = this.extractTitleAndRemainder(remainder);
        parsed.title = titleEnd.title.replace(/^"/, '').replace(/"$/, ''); // Strip explicit bounding quotes if present
        this.parseHarvardJournalInfo(titleEnd.remainder, parsed);
      }
      if (DEBUG_STRESS) this.logHarvardTrace(parsed);
      return parsed;
    }

    // Pattern 2: Author, I. Year. Title. Journal/Publisher, Place.
    // Year group must be (19|20)xx so we never capture issue numbers (7553, 5696, etc.) as year.
    const harvardNoParens = cleanText.match(/^(.+?)[,\s]+((19|20)\d{2})[a-z]?(?:,\s*[A-Za-z]+)?\.\s*(.+)$/);
    if (harvardNoParens) {
      parsed.authors = this.parseAuthorList(harvardNoParens[1].replace(/,\s*$/, '').trim(), 'harvard');
      parsed.year = harvardNoParens[2];

      const remainder = harvardNoParens[4] + locatorStr;
      const titleEnd = this.extractTitleAndRemainder(remainder);
      parsed.title = titleEnd.title;

      if (titleEnd.remainder) {
        this.parseHarvardJournalInfo(titleEnd.remainder, parsed);
      }
      if (DEBUG_STRESS) this.logHarvardTrace(parsed);
      return parsed;
    }

    // Always extract DOI and URL
    this.extractURL(cleanText + locatorStr, parsed);

    const generic = this.parseGeneric(cleanText + locatorStr);
    if (DEBUG_STRESS) this.logHarvardTrace(generic);
    return generic;
  }

  private logHarvardTrace(parsed: ParsedReference): void {
    const refType = this.determineReferenceType(parsed);
    console.debug('[H1] year:', parsed.year ?? '');
    console.debug('[H2] title:', (parsed.title ?? '').slice(0, 120));
    console.debug('[H3] journal:', parsed.journal ?? '');
    console.debug('[H4] volume:', parsed.volume ?? '');
    console.debug('[H5] issue:', parsed.issue ?? '', 'referenceType:', refType);
  }

  private parseHarvardJournalInfo(text: string, parsed: ParsedReference): void {
    if (!text || !text.trim()) return;

    // Strip DOI and URL fragments before parsing. This helper never writes parsed.year (invariant).
    let clean = text.replace(/\bdoi:\s*\S+/i, '').replace(/https?:\/\/\S+/g, '').replace(/\.\s*$/, '').trim();

    if (this.parseConferenceRemainder(clean, parsed)) {
      return;
    }

    // FIRST: "Journal, Volume. (Issue). pp.Pages" — dot-separated so issue number is not consumed as year elsewhere
    const dotIssuePP = clean.match(/^(.+?),\s*(\d+)\.\s*\((\d+)\)\.\s*pp\.?\s*([\d–\-]+(?:–[\d]+)?)/);
    if (dotIssuePP) {
      parsed.journal = dotIssuePP[1].replace(/\*/g, '').trim();
      parsed.volume = dotIssuePP[2];
      parsed.issue = dotIssuePP[3];
      parsed.pages = dotIssuePP[4];
      return;
    }

    // Pattern: "Journal, Volume(Issue), pp. Pages"
    const withPP = clean.match(/^(.+?),\s*(\d+)(?:\((\d+)\))?,?\s*pp\.?\s*([\d–-]+)/);
    if (withPP) {
      parsed.journal = withPP[1].replace(/\*/g, '').trim();
      parsed.volume = withPP[2];
      if (withPP[3]) parsed.issue = withPP[3];
      parsed.pages = withPP[4];
      return;
    }

    // Pattern: "Journal, Volume(Issue), Article 040501" / "Art. no. 104512"
    const withArticle = clean.match(/^(.+?),\s*(\d+)(?:\(([^)]+)\))?,?\s*(?:Article|Art\.?\s*no\.?)\s*([A-Za-z]?\d+)/i);
    if (withArticle) {
      parsed.journal = withArticle[1].replace(/\*/g, '').trim();
      parsed.volume = withArticle[2];
      if (withArticle[3]) parsed.issue = withArticle[3];
      parsed['article-number'] = withArticle[4];
      return;
    }

    // Pattern: "Journal, Volume(Issue)"
    const withVol = clean.match(/^(.+?),\s*(\d+)(?:\((\d+)\))?/);
    if (withVol) {
      parsed.journal = withVol[1].replace(/\*/g, '').trim();
      parsed.volume = withVol[2];
      if (withVol[3]) parsed.issue = withVol[3];
      return;
    }

    // Pattern: "Publisher, Place" for books
    const publisherPlace = clean.match(/^(.+?),\s*([A-Z][a-z]+)\.?$/);
    if (publisherPlace) {
      parsed.publisher = publisherPlace[1].trim();
      parsed.placeOfPublication = publisherPlace[2].trim();
      return;
    }

    // Might just be a publisher
    parsed.publisher = clean.replace(/\*/g, '').trim();
  }

  // ==========================================
  // CHICAGO PARSER
  // Format: Author. "Title." Journal Volume, no. Issue (Year): Pages.
  // ==========================================
  private parseChicago(text: string): ParsedReference {
    const parsed: ParsedReference = {};
    let cleanText = stripLeadingNumbering(text);

    // Extract quoted title
    const titleMatch = cleanText.match(/"([^"]+)"/);
    if (!titleMatch) {
      return this.parseGeneric(cleanText);
    }

    parsed.title = titleMatch[1].replace(/\.$/, '').trim();

    // Authors: everything before the quoted title
    const beforeTitle = cleanText.substring(0, cleanText.indexOf('"')).trim();
    if (beforeTitle) {
      const authorStr = beforeTitle.replace(/\.\s*$/, '').trim();
      parsed.authors = this.parseAuthorList(authorStr, 'chicago');
    }

    // After title: journal info
    const afterTitleStart = cleanText.indexOf('"', cleanText.indexOf('"') + 1) + 1;
    let afterTitle = cleanText.substring(afterTitleStart).replace(/^\s*\.?\s*/, '').trim();

    if (afterTitle) {
      if (this.parseConferenceRemainder(afterTitle, parsed)) {
        this.extractURL(cleanText, parsed);
        return parsed;
      }
      // Chicago pattern: "Journal, vol. X, no. Y, Year, pp. Z" (comma-separated)
      const chicagoVolNo = afterTitle.match(/^(.+?),\s*vol\.\s*(\d+)\s*,?\s*no\.\s*([^,]+)\s*,\s*((?:19|20)\d{2})\s*,?\s*pp\.\s*([A-Z]?\d+[–-][A-Z]?\d+|[A-Z]?\d+)/i);
      if (chicagoVolNo) {
        parsed.journal = chicagoVolNo[1].replace(/\*/g, '').trim();
        parsed.volume = chicagoVolNo[2];
        parsed.issue = chicagoVolNo[3].trim();
        parsed.year = chicagoVolNo[4];
        parsed.pages = chicagoVolNo[5];
        this.extractURL(cleanText, parsed);
        return parsed;
      }

      // Chicago pattern: "Journal Volume, no. Issue (Month? Year): Pages."
      const chicagoFull = afterTitle.match(/^(.+?)\s+(\d+),\s*no\.\s*([^),:]+)\s*\((?:[A-Za-z]+\s+)?(\d{4})\):\s*([A-Z]?\d+[–-][A-Z]?\d+|[A-Z]?\d+)/);
      if (chicagoFull) {
        parsed.journal = chicagoFull[1].replace(/\*/g, '').trim();
        parsed.volume = chicagoFull[2];
        parsed.issue = chicagoFull[3].trim();
        parsed.year = chicagoFull[4];
        parsed.pages = chicagoFull[5];
        this.extractURL(cleanText, parsed);
        return parsed;
      }

      const chicagoFullArticle = afterTitle.match(/^(.+?)\s+(\d+),\s*no\.\s*([^),:]+)\s*\((?:[A-Za-z]+\s+)?(\d{4})\):\s*(?:Article|Art\.?\s*no\.?)\s*([A-Za-z]?\d+)/i);
      if (chicagoFullArticle) {
        parsed.journal = chicagoFullArticle[1].replace(/\*/g, '').trim();
        parsed.volume = chicagoFullArticle[2];
        parsed.issue = chicagoFullArticle[3].trim();
        parsed.year = chicagoFullArticle[4];
        parsed['article-number'] = chicagoFullArticle[5];
        this.extractURL(cleanText, parsed);
        return parsed;
      }

      // Simpler: "Journal Volume (Month? Year): Pages."
      const chicagoSimple = afterTitle.match(/^(.+?)\s+(\d+)\s*\((?:[A-Za-z]+\s+)?(\d{4})\):\s*([A-Z]?\d+[–-][A-Z]?\d+|[A-Z]?\d+)/);
      if (chicagoSimple) {
        parsed.journal = chicagoSimple[1].replace(/\*/g, '').trim();
        parsed.volume = chicagoSimple[2];
        parsed.year = chicagoSimple[3];
        parsed.pages = chicagoSimple[4];
        this.extractURL(cleanText, parsed);
        return parsed;
      }

      const chicagoSimpleArticle = afterTitle.match(/^(.+?)\s+(\d+)\s*\((?:[A-Za-z]+\s+)?(\d{4})\):\s*(?:Article|Art\.?\s*no\.?)\s*([A-Za-z]?\d+)/i);
      if (chicagoSimpleArticle) {
        parsed.journal = chicagoSimpleArticle[1].replace(/\*/g, '').trim();
        parsed.volume = chicagoSimpleArticle[2];
        parsed.year = chicagoSimpleArticle[3];
        parsed['article-number'] = chicagoSimpleArticle[4];
        this.extractURL(cleanText, parsed);
        return parsed;
      }

      // Fallback: year — parenthetical (YYYY) first; then safe bare-year only (avoid page ranges like 1995–2000)
      const yearMatch = afterTitle.match(/\((?:[A-Za-z]+\s+)?((?:19|20)\d{2})\)/);
      if (yearMatch) parsed.year = yearMatch[1];
      if (!parsed.year) {
        const safeBareYear = afterTitle.match(/(?:^|,\s*|\s)((?:19|20)\d{2})(?:\s*[,.]|$|\s)/);
        if (safeBareYear) parsed.year = safeBareYear[1].trim();
      }
      if (!parsed.year) {
        const yearCommaAlt = afterTitle.match(/,\s*((?:19|20)\d{2})\s*[,.]/);
        if (yearCommaAlt) parsed.year = yearCommaAlt[1];
      }

      const pagesMatch = afterTitle.match(/:\s*([a-zA-Z]?\d+(?:[-–][a-zA-Z]?\d+)?)/);
      if (pagesMatch) parsed.pages = pagesMatch[1];

      const journalPart = afterTitle.split(/\s+\d|\(\d|\([A-Z]/)[0].replace(/[,.]$/, '').replace(/\*/g, '').trim();
      if (journalPart) parsed.journal = journalPart;
    }

    this.extractURL(cleanText, parsed);

    return parsed;
  }

  // ==========================================
  // IEEE PARSER  
  // Format: [N] I. Author and I. Author, "Title," Journal, vol. V, no. I, pp. P, Year.
  // ==========================================
  private parseIEEE(text: string): ParsedReference {
    const parsed: ParsedReference = {};

    // Remove [N] prefix — shared helper handles all numbering formats
    let cleanText = stripLeadingNumbering(text).trim();

    // Some quoted-title conference citations get over-classified as IEEE even though
    // their authors are not IEEE-style initials-first. Recover them before IEEE parsing.
    const beforeQuote = cleanText.substring(0, cleanText.indexOf('"')).trim();
    if (beforeQuote && /,/.test(beforeQuote) && !/^[A-Z](?:\.[-\sA-Z]*)\s+[A-Z]/.test(beforeQuote)) {
      const quotedConference = this.parseQuotedConferenceCitation(cleanText, 'chicago');
      if (quotedConference) {
        return quotedConference;
      }
    }

    // Split at quoted title (optional — do not require quotes; support comma-separated journal format)
    const titleMatch = cleanText.match(/"([^"]+)"/);
    if (titleMatch) {
      // Remove trailing comma from title
      parsed.title = titleMatch[1].replace(/,\s*$/, '').trim();
    }

    let afterTitle: string;
    if (titleMatch) {
      // Authors: everything before the quoted title
      const beforeTitle = cleanText.substring(0, cleanText.indexOf('"')).replace(/,\s*$/, '').trim();
      if (beforeTitle) {
        parsed.authors = this.parseAuthorList(beforeTitle, 'ieee');
      }
      afterTitle = cleanText.substring(cleanText.indexOf('"', cleanText.indexOf('"') + 1) + 1).replace(/^\s*,?\s*/, '').trim();
    } else {
      // No quoted title: try comma-separated format "Author, Title, Journal, Year;Vol(Issue):Pages" or "Author, Title, Journal, Year."
      const commaJournalParsed = this.parseIEEECommaSeparated(cleanText);
      if (commaJournalParsed) {
        return commaJournalParsed;
      }
      return this.parseGeneric(cleanText);
    }

    if (afterTitle) {
      // Extract year - use the LAST standalone 4-digit number in 19xx/20xx range
      // This avoids picking up page numbers like "1123" as years
      const yearMatches = afterTitle.match(/\b((?:19|20)\d{2})\b/g);
      if (yearMatches && yearMatches.length > 0) {
        parsed.year = yearMatches[yearMatches.length - 1]; // last match is typically the year
      }

      // Extract vol. and no. together first (e.g. "vol. 45, no. 1") so both are reliably set
      const volNoMatch = afterTitle.match(/vol\.\s*(\d+)\s*,?\s*no\.\s*(\w+)/i);
      if (volNoMatch) {
        parsed.volume = volNoMatch[1];
        parsed.issue = volNoMatch[2];
      } else {
        const volMatch = afterTitle.match(/vol\.\s*(\d+)/i);
        if (volMatch) parsed.volume = volMatch[1];
        const noMatch = afterTitle.match(/no\.\s*(\w+)/i);
        if (noMatch) parsed.issue = noMatch[1];
      }

      // Extract Art. no. (must come before pp. since both can coexist)
      const artNoMatch = afterTitle.match(/Art\.\s*no\.\s*(\d+)/i);
      if (artNoMatch) parsed['article-number'] = artNoMatch[1];

      // Extract pp. (allow S-prefixed supplement pages like S45–S67)
      const ppMatch = afterTitle.match(/pp\.\s*([A-Z]?\d+[–-][A-Z]?\d+|[A-Z]?\d+)/i);
      if (ppMatch) parsed.pages = ppMatch[1];

      // Extract Suppl. as issue
      const supplMatch = afterTitle.match(/Suppl\.?\s*(\d+)/i);
      if (supplMatch && !parsed.issue) parsed.issue = `Suppl. ${supplMatch[1]}`;

      // Proceedings pattern: "in Proc. Conference Name" or "in Proceedings of the Conference"
      const procMatch = afterTitle.match(/\bin\s+Proc(?:eedings)?\.?\s+(?:of\s+(?:the\s+)?)?(.+)/i);
      if (procMatch) {
        let confTitle = procMatch[1]
          .split(/,\s*(?:vol\.|no\.|pp\.)/i)[0]
          .replace(/,\s*(?:19|20)\d{2}[.,]?\s*$/, '')
          .replace(/[,.\s]+$/, '')
          .trim();
        if (confTitle) {
          if (!/^(?:proc(?:eedings)?\.?|proceedings)\b/i.test(confTitle)) {
            confTitle = `Proceedings of the ${confTitle}`;
          }
          parsed.conferenceTitle = confTitle;
        }
      } else {
        // Regular journal extraction: text before "vol." or "no." or "pp."
        const journalPart = afterTitle.split(/,?\s*(?:vol\.|no\.|pp\.)/i)[0].replace(/[,.]$/, '').trim();
        if (journalPart && journalPart.length > 1) {
          parsed.journal = journalPart.replace(/\*/g, '');
        }
      }
    }

    // Always extract URL
    this.extractURL(cleanText, parsed);

    return parsed;
  }

  /**
   * Parse IEEE-style comma-separated line when there is no quoted title:
   * "Author, Title, Journal, Year;Vol(Issue):Pages" or "Author, Title, Journal, Year."
   */
  private parseIEEECommaSeparated(cleanText: string): ParsedReference | null {
    // Tail: year optionally with month/day, then ;Vol(Issue):Pages or ;Vol(Issue), Pages or just year at end
    const tailWithVol = cleanText.match(/,\s*((?:19|20)\d{2})(?:\s+[A-Za-z]+\s+\d{1,2})?\s*;\s*(\d+)\s*\(([^)]+)\)\s*:\s*([\d\-–]+)\s*\.?\s*$/);
    const tailWithVolComma = cleanText.match(/,\s*((?:19|20)\d{2})(?:\s+[A-Za-z]+\s+\d{1,2})?\s*;\s*(\d+)\s*\(([^)]+)\)\s*,\s*([\d\-–]+)\s*\.?\s*$/);
    const tailYearOnly = cleanText.match(/,\s*((?:19|20)\d{2})\s*\.?\s*$/);
    let year: string | undefined;
    let volume: string | undefined;
    let issue: string | undefined;
    let pages: string | undefined;
    let beforeTail: string;

    const tailMatch = tailWithVol ?? tailWithVolComma;
    if (tailMatch) {
      year = tailMatch[1];
      volume = tailMatch[2];
      issue = tailMatch[3];
      pages = tailMatch[4].replace(/\.$/, '').trim();
      beforeTail = cleanText.substring(0, cleanText.indexOf(tailMatch[0])).replace(/,\s*$/, '').trim();
    } else if (tailYearOnly) {
      year = tailYearOnly[1];
      beforeTail = cleanText.substring(0, cleanText.indexOf(tailYearOnly[0])).replace(/,\s*$/, '').trim();
    } else {
      return null;
    }

    const segments = beforeTail.split(',').map((s) => s.trim()).filter(Boolean);
    if (segments.length < 2) return null;

    const parsed: ParsedReference = { year };
    if (volume) parsed.volume = volume;
    if (issue) parsed.issue = issue;
    if (pages) parsed.pages = pages;

    const looksLikeVenue = (s: string) =>
      /\b(?:Journal|Transactions|Proceedings|Conference|Symposium|Review|Letters|International|IEEE|ACM|Science|Nature|Communications|Bulletin|Magazine|Scientific\s+American|American)\b/i.test(s) ||
      /\b(?:vol\.?|no\.?|pp\.?)\s*\d/i.test(s);

    if (segments.length === 2) {
      parsed.authors = this.parseAuthorList(segments[0], 'ieee');
      parsed.title = segments[1];
    } else if (segments.length >= 3) {
      const last = segments[segments.length - 1];
      const secondLast = segments[segments.length - 2];
      if (segments.length >= 4 || looksLikeVenue(last)) {
        parsed.journal = last;
        parsed.title = secondLast;
        parsed.authors = this.parseAuthorList(segments.slice(0, -2).join(', '), 'ieee');
      } else {
        parsed.authors = this.parseAuthorList(segments.slice(0, -1).join(', '), 'ieee');
        parsed.title = last;
      }
    }
    if (parsed.authors?.length === 0) delete parsed.authors;
    this.filterPublisherFromAuthors(parsed);
    this.extractURL(cleanText, parsed);
    return parsed;
  }

  /** Remove known publisher/place tokens and journal-name-as-author; move journal names to parsed.journal. */
  private filterPublisherFromAuthors(parsed: ParsedReference): void {
    const publisherLike = /\b(Springer|Elsevier|Wiley|Cambridge|Oxford|Cham|Heidelberg|Academic\s+Press|IEEE|ACM|pp?\.\s*\d)\b/i;
    const journalLike = /^(Journal\s+of|International\s+Journal\s+of|.*\s+Journal\s+of)\s+.+$/i;
    if (parsed.authors?.length) {
      const filtered: string[] = [];
      for (const a of parsed.authors) {
        const t = a.trim();
        if (publisherLike.test(t) || /^[A-Z]\.?\s*$/.test(t)) continue;
        if (journalLike.test(t) && !parsed.journal) {
          parsed.journal = t;
          continue;
        }
        filtered.push(a);
      }
      parsed.authors = filtered.length ? filtered : undefined;
      if (parsed.authors?.length === 0) delete parsed.authors;
    }
  }

  // ==========================================
  // VANCOUVER PARSER
  // Format: N. Author AB. Title. Journal. Year;Vol(Issue):Pages.
  // ==========================================
  private parseVancouver(text: string): ParsedReference {
    const parsed: ParsedReference = {};

    // Remove leading number
    let cleanText = stripLeadingNumbering(text).trim();

    // Special-case "Author, Author, Title, YYYY." shapes that were misclassified as Vancouver.
    // Example: "Goldberg DE, Holland JH, Genetic algorithms and machine learning, 1988."
    if (!/;/.test(cleanText)) {
      const authorTitleYear = cleanText.match(/^(.*),\s*((?:19|20)\d{2})\s*\.?\s*$/);
      if (authorTitleYear) {
        const beforeYear = authorTitleYear[1].trim();
        const { authorSegment, remaining } = extractAuthorSegment(beforeYear);
        if (authorSegment && remaining) {
          parsed.year = authorTitleYear[2];
          parsed.authors = this.parseAuthorList(authorSegment, 'vancouver');
          parsed.title = remaining;
          this.extractURL(cleanText, parsed);
          return parsed;
        }
      }
    }

    // Strip OpenAlex placeholder ";?:" / ";?" so ? is not treated as volume (treat as no volume data)
    cleanText = cleanText.replace(/;\s*\?+\s*:?/g, ';');

    // Pre-pass: "Vol. N, No. N:pages" in raw text (before yearVolMatch splits them)
    const volNoRawMatch = cleanText.match(/Vol\.?\s*(\d+)(?:,\s*No\.?\s*(\d+))?\s*[:;]\s*([Pp]{0,2}\.?\s*\d+(?:[-–]\d+)?)/i);
    if (volNoRawMatch) {
      parsed.volume = volNoRawMatch[1];
      if (volNoRawMatch[2]) parsed.issue = volNoRawMatch[2];
      parsed.pages = volNoRawMatch[3].replace(/^[Pp]{1,2}\.?\s*/, '').trim();
      // Remove the matched segment so downstream parsing doesn't re-extract it
      cleanText = cleanText.replace(volNoRawMatch[0], '').replace(/\s+/g, ' ').trim();
      // Also extract year from "YYYY;" that typically precedes Vol. in Vancouver format
      const precedingYearMatch = cleanText.match(/(\d{4})\s*;\s*\.?\s*$/);
      if (precedingYearMatch) {
        if (!parsed.year) parsed.year = precedingYearMatch[1];
        // Strip the residual "YYYY; ." so the period-split parser gets clean text
        cleanText = cleanText.replace(/\d{4}\s*;\s*\.?\s*$/, '').trim();
      }
    }

    // Vancouver key pattern: Year;Volume(Issue):Pages  (or slight comma variants)
    // E.g., "2011;42(2):167-176" or "2011;42(2),167-176"
    const yearVolMatch = cleanText.match(/(\d{4})(?:\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2})?;([^(:]+)(?:\(([^)]+)\))?(?::|,)(.*?)(?=\s*$|\s+[^a-z])/i);

    if (yearVolMatch) {
      parsed.year = yearVolMatch[1];
      parsed.volume = yearVolMatch[2];
      if (yearVolMatch[3]) parsed.issue = yearVolMatch[3];
      if (yearVolMatch[4]) parsed.pages = yearVolMatch[4].replace(/\.$/, ''); // clean trailing period from pages

      // Everything before "Year;" needs to be split into author(s), title, journal
      const beforeYearStr = cleanText.substring(0, cleanText.indexOf(yearVolMatch[0])).trim().replace(/\.\s*$/, '');

      // Prefer period-split (Author. Title. Journal); if that yields too few segments, try comma-split for search inputs
      let segments = beforeYearStr.split(/\.\s+/);
      if (segments.length < 3 && beforeYearStr.includes(',')) {
        const commaSegs = beforeYearStr.split(',').map((s) => s.trim()).filter(Boolean);
        if (commaSegs.length >= 3) {
          parsed.authors = this.parseAuthorList(commaSegs.slice(0, -2).join(', '), 'vancouver');
          parsed.title = commaSegs[commaSegs.length - 2];
          parsed.journal = commaSegs[commaSegs.length - 1];
        } else if (commaSegs.length === 2) {
          parsed.authors = this.parseAuthorList(commaSegs[0], 'vancouver');
          parsed.title = commaSegs[1];
        } else if (commaSegs.length === 1) {
          parsed.title = commaSegs[0];
        }
      } else if (segments.length >= 3) {
        parsed.authors = this.parseAuthorList(segments[0].trim(), 'vancouver');
        parsed.title = segments[1].trim();
        parsed.journal = segments.slice(2).join('. ').trim();
      } else if (segments.length === 2) {
        parsed.authors = this.parseAuthorList(segments[0].trim(), 'vancouver');
        parsed.title = segments[1].trim();
      } else if (segments.length === 1) {
        parsed.title = segments[0].trim();
      }
    } else {
      // Fallback: "Author. Title. Journal. YYYY;" or "Author. Title. Journal. YYYY;?:" (no volume after semicolon)
      const yyyySemicolonEnd = cleanText.match(/(\d{4})\s*;\s*$/);
      if (yyyySemicolonEnd) {
        parsed.year = yyyySemicolonEnd[1];
        const beforeYearStr = cleanText.substring(0, cleanText.indexOf(yyyySemicolonEnd[0])).trim().replace(/\.\s*$/, '');
        const segments = beforeYearStr.split(/\.\s+/);
        if (segments.length >= 3) {
          parsed.authors = this.parseAuthorList(segments[0].trim(), 'vancouver');
          parsed.title = segments[1].trim();
          parsed.journal = segments.slice(2).join('. ').trim();
        } else if (segments.length === 2) {
          parsed.authors = this.parseAuthorList(segments[0].trim(), 'vancouver');
          parsed.title = segments[1].trim();
        } else if (segments.length === 1) {
          parsed.title = segments[0].trim();
        }
      } else {
        // Fallback: split by periods
        const segments = cleanText.replace(/\.\s*$/, '').split(/\.\s+/);
        if (segments.length >= 2) {
          parsed.authors = this.parseAuthorList(segments[0].trim(), 'vancouver');
          parsed.title = segments[1].trim();
          if (segments.length >= 3) {
            parsed.journal = segments[2].trim();
          }
          const yearMatch = cleanText.match(/\b((?:19|20)\d{2}|n\.d\.)\b/i);
          if (yearMatch) parsed.year = yearMatch[1];
        }
      }
    }

    if (parsed.journal && this.parseConferenceRemainder(parsed.journal, parsed)) {
      delete parsed.journal;
    }

    // Always extract URL for Vancouver
    this.extractURL(cleanText, parsed);

    return parsed;
  }

  // ==========================================
  // GENERIC FALLBACK PARSER
  // ==========================================
  private parseGeneric(text: string): ParsedReference {
    const parsed: ParsedReference = {};

    // Heuristic: "Author, Author, Title, YYYY." or "Author, Title, YYYY."
    // Handles IEEE/Vancouver-ish inputs that fell through style detection.
    // Skip when the string clearly looks like a report/thesis so those branches can handle it.
    if (!/report|thesis|diss\./i.test(text)) {
      const authorTitleYear = text.match(/^(.*),\s*((?:19|20)\d{2})\.\s*$/);
      if (authorTitleYear) {
        const beforeYear = authorTitleYear[1].trim();
        const year = authorTitleYear[2];
        const tokens = beforeYear.split(',').map((s) => s.trim()).filter(Boolean);
        if (tokens.length >= 2) {
          const isPersonLike = (s: string): boolean =>
            /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+[A-Z]{1,3}\.?$/.test(s) || // "Goldberg DE"
            /^[A-Z][a-z]+,\s*[A-Z]{1,3}\.?$/.test(s); // "Goldberg, D."

          const authorTokens: string[] = [];
          let i = 0;
          for (; i < tokens.length; i++) {
            if (isPersonLike(tokens[i])) {
              authorTokens.push(tokens[i]);
            } else {
              break;
            }
          }

          if (authorTokens.length > 0 && i < tokens.length) {
            parsed.year = year;
            parsed.authors = authorTokens;
            parsed.title = tokens.slice(i).join(', ');
            // URL / article-number extraction still applies below
          }
        }
      }
    }

    // Report / thesis institution: "Report submitted at Institution" or "Report Institution, Year" or "PhD diss., Institution, Year"
    const reportAtMatch = text.match(/(?:Report\s+submitted\s+at|report\s+at)\s+([^.,]+?)(?:\.|,|$)/i);
    if (reportAtMatch) {
      parsed.institution = reportAtMatch[1].trim();
      if (!parsed.publisher) parsed.publisher = parsed.institution;
    }
    const phdDissMatch = text.match(/(?:PhD\s+diss\.?|Master'?s?\s+thesis|M\.?A\.?\s+thesis|M\.?Sc\.?\s+thesis)[.,]\s*([^,]+?)(?:,\s*(?:19|20)\d{2})?[.,]?\s*$/i);
    if (phdDissMatch && !parsed.institution) {
      parsed.institution = phdDissMatch[1].trim();
      if (!parsed.publisher) parsed.publisher = parsed.institution;
    }
    // "Report Institution" or "Report X University, Year" (e.g. "Report Stanford University, Department of...")
    const reportLabelMatch = text.match(/\bReport\s+([^.,]+(?:University|Institute|College|IIT\s+Bombay|Stanford|MIT)[^.,]*?)(?:\.|,|\s+\d{4})/i);
    if (reportLabelMatch && !parsed.institution) {
      parsed.institution = reportLabelMatch[1].trim();
      if (!parsed.publisher) parsed.publisher = parsed.institution;
    }

    // Extract year (if not already set)
    if (!parsed.year) {
      const yearMatch = text.match(/\b((?:19|20)\d{2}|n\.d\.)\b/i);
      if (yearMatch) {
        parsed.year = yearMatch[1];
      }
    }

    // Extract potential title (text in quotes)
    const titleMatch = text.match(/"([^"]+)"/);
    if (titleMatch) {
      parsed.title = titleMatch[1].replace(/\.$/, '').trim();
    }

    // Try to extract authors from the beginning if still unknown
    if (!parsed.authors) {
      const authorPart = text.split(/\(\d{4}\)|"\s/)[0].trim();
      if (authorPart && authorPart.length > 3) {
        parsed.authors = [authorPart.replace(/[,.]$/, '').trim()];
      }
    }


    // Extract Article Number directly since generic parser misses it (Angelopoulos bug)
    const artMatch = text.match(/(?:Article|Art\.|e-?locator:)\s*(?:no\.?\s*)?([A-Za-z0-9]+)\b/i);
    if (artMatch) {
      parsed.pages = `Article ${artMatch[1]}`;
    }

    // Extract URL
    this.extractURL(text, parsed);

    return parsed;
  }

  // ==========================================
  // HELPER: Parse author list
  // ==========================================
  private parseAuthorList(authorString: string, style: CitationStyle): string[] {
    if (!authorString) return [];

    // Clean up the string
    let clean = authorString.replace(/[.]$/, '').trim();
    // Scrubber for Dangling '&.' matching
    clean = clean.replace(/(?:,\s*)?(?:&|and)\.?\s*$/i, '').trim();

    // Handle "et al." — keep the first author + literal "et al." marker for CSL
    const etAlMatch = clean.match(/^(.+?),?\s*et\s+al\.?$/i);
    if (etAlMatch) {
      return [etAlMatch[1].trim(), 'et al.'];
    }

    const normalizedGroup = normalizeGroupAuthor(clean);
    const commaParts = clean.split(/,\s*/).filter(Boolean);
    const looksLikeMixedAuthors = commaParts.length >= 4 || /,\s*[A-Z](?:[.\s]|$)/.test(clean);
    if (isGroupAuthor(normalizedGroup) && !looksLikeMixedAuthors) {
      return [normalizedGroup];
    }

    const trailingGroupAuthors = Array.from(new Set(
      clean
        .split(/,\s*/)
        .map((part) => normalizeGroupAuthor(part.trim()))
        .filter((part) => isGroupAuthor(part)),
    ));
    const appendGroupAuthors = (authors: string[]) => {
      const normalizedAuthors = authors
        .map((author) => normalizeProtectedTokenValue(author.trim()))
        .filter(Boolean);
      for (const groupAuthor of trailingGroupAuthors) {
        if (!normalizedAuthors.some((author) => author.toLowerCase() === groupAuthor.toLowerCase())) {
          normalizedAuthors.push(groupAuthor);
        }
      }
      return normalizedAuthors;
    };

    if (trailingGroupAuthors.length > 0 && commaParts.length === 4) {
      const leadingAuthor = commaParts.slice(0, 2).join(', ').trim();
      if (leadingAuthor) {
        return appendGroupAuthors([leadingAuthor]);
      }
    }

    // Corporate author: no comma + organization keyword → treat as single corporate author
    const orgKeywords = /\b(?:Federation|Association|Inc\.|Ltd\.|Committee|Group|Press|University|Institute|Department|Ministry|Agency|Foundation|Society|Board|Bureau|Council)\b/i;
    if (!clean.includes(',') && orgKeywords.test(clean)) {
      return [normalizeGroupAuthor(clean)];
    }

    // Corporate author with commas: "Expert Panel on X, Y, and Z" — do not split on internal commas
    if (/Expert\s+Panel\s+on\s+/i.test(clean)) {
      return [normalizeGroupAuthor(clean)];
    }

    // Corporate list: "Org1., Org2., Org3 and Org4., Org5" → split on "., " then "," so we don't parse "Federation., W" as Surname, Given (oa-39)
    if (clean.includes('., ')) {
      const byAnd = clean.split(/,?\s+and\s+/);
      const result: string[] = [];
      let invalid = false;
      for (const block of byAnd) {
        const parts = block.split(/\.,\s*/).map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
          if (p.includes(',')) {
            const sub = p.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
            const looksLikeInitials = (s: string) => /^[A-Z]\.?$/.test(s) || (s.length <= 2 && /^[A-Z][a-z]?$/.test(s));
            if (sub.some(looksLikeInitials)) {
              invalid = true;
              break;
            }
            result.push(...sub);
          } else {
            result.push(p);
          }
        }
        if (invalid) break;
      }
      if (!invalid && result.length > 0) {
        return appendGroupAuthors(result);
      }
    }

    // Jammed-token normalization: "LastName, FirstNameNoSpace" → "LastName, First Name" (e.g. Watts, DuncanJ. → Watts, Duncan J.).
    // Only split when the right-hand side is clearly initial-like (1–3 caps + optional dot), never inside long names (e.g. "Matheww").
    clean = clean.replace(/(,\s*[^,]*?)([a-z])([A-Z][A-Za-z.]*)/g, (_: string, pre: string, low: string, capPart: string) => {
      const initialLike = /^[A-Z]{1,3}\.?$/.test(capPart.replace(/\./g, ''));
      return initialLike ? `${pre}${low} ${capPart}` : `${pre}${low}${capPart}`;
    });

    switch (style) {
      case 'apa':
      case 'harvard': {
        // Helper: split "Surname, I." / "García-López, J.-F." / "Jakubův, J." — family uses Unicode letters (ů, č, š etc.)
        const splitAuthors = (text: string): string[] => {
          const re = /((?:(?:[a-z\u00e0-\u024f]+\s+)+|d')?[A-Z\u00c0-\u017e][a-zA-Z\u00c0-\u024f']*(?:\s*-\s*[A-Z]?[a-z\u00c0-\u024f]+)?),\s*([A-Z](?:\.\s*)?(?:[A-Z.\-](?:\.\s*)?)*)/g;
          let match;
          const results: string[] = [];
          while ((match = re.exec(text)) !== null) {
            const family = match[1].trim();
            const given = match[2].trim();
            // Accept short surnames (e.g., He, Li) while still rejecting pure initial fragments.
            if (/[a-z\u00c0-\u024f]/.test(family) && !/^[A-Z](?:[.\-][A-Z])*\.*$/.test(family.replace(/\s+/g, ''))) {
              results.push(`${family}, ${given}`);
            }
          }
          if (results.length > 1) return results;
          return [text.trim()];
        };

        // Split on " & " or " and " first
        let ampParts: string[] | null = null;
        if (clean.includes(' & ')) {
          ampParts = clean.split(/,?\s*&\s*/);
        } else if (/\band\b/.test(clean)) {
          ampParts = clean.split(/,?\s+and\s+/);
        }

        if (ampParts) {
          const all: string[] = [];
          for (const part of ampParts) {
            all.push(...splitAuthors(part.trim()));
          }
          return appendGroupAuthors(all.filter(Boolean));
        }

        // No separator — try direct multi-author split
        const direct = splitAuthors(clean);
        if (direct.length > 1) return appendGroupAuthors(direct);

        // Single author
        return appendGroupAuthors([clean]);
      }

      case 'mla': {
        // MLA: "Surname, Initials, and Initials Surname"
        // e.g. "Adams, K. L., and R. Chen."
        const base = clean.replace(/\.\s*$/, '').trim();

        if (base.includes(' and ')) {
          const rawParts = base.split(/\s+and\s+/).map(p => p.trim()).filter(Boolean);
          const authors: string[] = [];

          for (let i = 0; i < rawParts.length; i++) {
            let part = rawParts[i];
            // Strip trailing comma from first segment ("Adams, K. L.,")
            part = part.replace(/,+\s*$/, '').trim();

            // If already in "Surname, Given" form, keep as-is
            if (/^[^,]+,\s*[^,]+$/.test(part)) {
              authors.push(part);
              continue;
            }

            // Match "R. Chen" → "Chen, R."
            const m = part.match(/^([A-Z](?:\.\s*){1,3})\s+([A-Z][a-z]+)$/);
            if (m) {
              const initials = m[1].trim();
              const surname = m[2].trim();
              authors.push(`${surname}, ${initials}`);
              continue;
            }

            authors.push(part);
          }

          return appendGroupAuthors(authors.filter(Boolean));
        }

        return appendGroupAuthors([clean]);
      }

      case 'chicago': {
        // Chicago: "First Last, First Last, and First Last"
        if (clean.includes(', and ')) {
          const andIndex = clean.lastIndexOf(', and ');
          const beforeAnd = clean.substring(0, andIndex).trim();
          const afterAnd = clean.substring(andIndex + 6).trim();
          const authors: string[] = [];

          // First author may be inverted: "Surname, Given, Next Author"
          const firstAuthorMatch = beforeAnd.match(/^([^,]+,\s*[^,]+),\s*(.+)$/);
          if (firstAuthorMatch) {
            authors.push(firstAuthorMatch[1].trim());
            if (firstAuthorMatch[2].trim()) authors.push(firstAuthorMatch[2].trim());
          } else if (beforeAnd) {
            authors.push(beforeAnd);
          }

          if (afterAnd) authors.push(afterAnd);
          return appendGroupAuthors(authors.filter(Boolean));
        }
        return appendGroupAuthors([clean]);
      }

      case 'ieee': {
        // IEEE: prefer regex extraction of complete "initials + surname" chunks.
        // This avoids orphan tokens like "A." that can drop first authors in CSL.
        const ieeeClean = clean.replace(/\s*&\s*/g, ' and ').trim();
        const ieeeAuthorRe = /(?:^|,\s*|\s+and\s+)([A-Z](?:\.-[A-Z]\.|\.)(?:\s*[A-Z](?:\.-[A-Z]\.|\.))*\s+(?:(?:d'|de|del|der|van|von)\s+)?[A-Z\u00c0-\u017e][a-zA-Z\u00c0-\u024f'’-]*(?:\s+[A-Z\u00c0-\u017e][a-zA-Z\u00c0-\u024f'’-]*)*)/g;
        const extracted: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = ieeeAuthorRe.exec(ieeeClean)) !== null) {
          const candidate = m[1]?.trim();
          if (candidate) extracted.push(candidate);
        }
        if (extracted.length > 0) return appendGroupAuthors(extracted);

        // Fallback: split on connectors and recombine orphan initials with following surname.
        const rawParts = ieeeClean
          .split(/,?\s+and\s+|,\s*/)
          .map(p => p.trim())
          .filter(Boolean);
        const combined: string[] = [];
        for (let i = 0; i < rawParts.length; i++) {
          const cur = rawParts[i];
          const next = rawParts[i + 1];
          if (/^[A-Z](?:\.-[A-Z]\.|\.)(?:\s*[A-Z](?:\.-[A-Z]\.|\.))*$/.test(cur) && next && /^[A-Z\u00c0-\u017e][a-zA-Z\u00c0-\u024f'’-]+/.test(next)) {
            combined.push(`${cur} ${next}`.trim());
            i++;
          } else {
            combined.push(cur);
          }
        }
        return appendGroupAuthors(combined.filter(Boolean));
      }

      case 'vancouver': {
        // Vancouver: "Last AB, Last CD, Last EF" or "van Houten P, d'Silva K"
        // Simply split on commas (safest since there are no internal commas in Vancouver names)
        const parts = clean.split(/,\s*/);
        return appendGroupAuthors(parts.map(p => p.trim()).filter(Boolean));
      }

      default:
        return appendGroupAuthors([clean]);
    }
  }

  // ==========================================
  // HELPER: Extract DOI
  // ==========================================
  // Completely removed per plan to strictly enforce no DOI mapping.

  // ==========================================
  // HELPER: Extract URL
  // ==========================================
  private extractURL(text: string, parsed: ParsedReference): void {
    // Don't extract DOI URLs as generic URLs
    const urlMatch = text.match(/(https?:\/\/(?!doi\.org)\S+)/);
    if (urlMatch) {
      parsed.url = urlMatch[1].replace(/\.$/, '');
    }
  }

  // ==========================================
  // Determine reference type from parsed data (soft scorer over noisy evidence)
  // ==========================================
  determineReferenceType(parsed: ParsedReference): ReferenceType {
    type TypeScore = Record<ReferenceType, number>;
    const score: TypeScore = {
      journal: 0,
      conference: 0,
      book: 0,
      bookChapter: 0,
      thesis: 0,
      report: 0,
      website: 0,
      preprint: 0,
      other: 0,
    };

    const venue = (parsed.journal ?? parsed.conferenceTitle ?? '').toLowerCase();
    const publisher = (parsed.publisher ?? '').toLowerCase();
    const raw = ((parsed as { rawInput?: string }).rawInput ?? '').toLowerCase();
    const combined = venue + ' ' + raw;

    if (parsed.journal) score.journal += 4;
    if (parsed.volume) score.journal += 2;
    if (parsed.issue) score.journal += 1;
    if (parsed.pages || (parsed as { startPage?: string }).startPage || parsed['article-number']) score.journal += 2;

    // POSITIVE JOURNAL SIGNAL: Venue looks like journal and has volume/pages
    if (!/proceedings|conference|symposium|workshop|press|publisher|springer|elsevier/i.test(venue)) {
      if (venue && (parsed.volume || parsed.issue) && parsed.pages) score.journal += 10;
    }

    if (/ieee\s+transactions/.test(combined) && (parsed.volume || parsed.issue || parsed.pages)) score.journal += 4;

    if (/proceedings|conference|symposium|workshop|in proc\b/.test(combined)) score.conference += 4;
    if (/\b(cvpr|iccv|eccv|neurips|nips|icml|iclr|acl|emnlp|naacl|aaai|ijcai)\b/.test(combined)) score.conference += 3;
    if (parsed.conferenceTitle) score.conference += 4;

    if (parsed.bookTitle) score.bookChapter += 4;
    if (parsed.editor) score.bookChapter += 2;

    if (/press|publisher|springer|elsevier|wiley|cambridge|oxford/.test(publisher)) score.book += 3;
    if (!parsed.volume && !parsed.issue && !parsed.pages && parsed.publisher) score.book += 2;
    // Author + title + year only (no venue) → treat as book rather than other
    if (
      parsed.authors?.length &&
      parsed.title &&
      parsed.year &&
      !parsed.journal &&
      !parsed.conferenceTitle &&
      !parsed.bookTitle &&
      !parsed.publisher
    )
      score.book += 2;

    if (/thesis|dissertation|doctoral|phd|master/.test(combined + ' ' + publisher)) score.thesis += 4;
    if (/technical report|working paper|nber|oecd|world bank|who/.test(combined + ' ' + publisher)) score.report += 4;
    if (/arxiv|biorxiv|medrxiv|ssrn|preprint/.test(combined)) score.preprint += 4;

    if (parsed.url && !parsed.volume && !parsed.issue && !parsed.journal) score.website += 3;

    const ranked = (Object.entries(score) as [ReferenceType, number][]).filter(([k]) => k !== 'other').sort((a, b) => b[1] - a[1]);
    const [bestType, bestScore] = ranked[0];
    const secondScore = ranked[1]?.[1] ?? 0;

    if (bestScore < 3 || bestScore - secondScore < 2) return 'other';
    return bestType;
  }

  /**
   * Year-anchored fallback parser (Stage 5 Attempt 2).
   * 
   * When style-based parsing fails or yields low confidence (≤ 0.80),
   * this method pivots on the first confident year to extract fields
   * without requiring a known style.
   * 
   * Strategy:
   *   1. Find the best year candidate using scoring (parenthesized > semicolon > bare)
   *   2. Before the year → author block
   *   3. After the year → title (first sentence/chunk), then venue/pages
   * 
   * Returns null if no year can be found.
   */
  parseYearAnchored(text: string): ParsedReference | null {
    const yearRe = /\b((?:19|20)\d{2}|n\.d\.)\b/gi;
    type YCand = { year: string; index: number; score: number };
    const candidates: YCand[] = [];

    let m: RegExpExecArray | null;
    // Reset lastIndex before exec loop
    yearRe.lastIndex = 0;
    while ((m = yearRe.exec(text)) !== null) {
      const yr = m[1];
      const idx = m.index;
      const before = text.slice(Math.max(0, idx - 40), idx);
      const after = text.slice(idx + yr.length, idx + yr.length + 10);

      let score = 1;
      const inParens = /\(\s*$/.test(before) && /^\s*\)/.test(after);
      const afterSemicolon = /;\s*$/.test(before);
      const commaBounded = /,\s*$/.test(before);

      if (yr === 'n.d.') score = 5; // always highly reliable
      else if (inParens) score = 4;
      else if (commaBounded) score = 2;
      else if (afterSemicolon) score = 2;

      // Penalise years embedded in long numeric context (volume-like)
      if (/\d{2,}\s*$/.test(before) || /^\s*[,;]\s*\d/.test(after)) score = 0;

      if (score > 0) candidates.push({ year: yr, index: idx, score });
    }

    if (candidates.length === 0) return null;

    // Pick best candidate
    candidates.sort((a, b) => b.score - a.score || a.index - b.index);
    const best = candidates[0];
    const yearIdx = best.index;
    const yearEnd = yearIdx + best.year.length;

    const parsed: ParsedReference = { year: best.year };

    // ── Authors: everything before the year ──
    let authorBlock = text.slice(0, yearIdx).trim();
    // Strip surrounding parentheses around year block (e.g. " (2021).")
    authorBlock = authorBlock.replace(/\s*\(?\s*$/, '').trim();
    // Strip trailing punctuation
    authorBlock = authorBlock.replace(/[.,;:]\s*$/, '').trim();

    if (authorBlock.length > 0) {
      // Split on " and " or " & " or ", " patterns for multiple authors
      const authorParts = authorBlock
        .split(/,\s*(?=and\s)|(?:\s+and\s+|\s*&\s*)/)
        .map(a => a.trim().replace(/[.,;]+$/, '').trim())
        .filter(a => a.length > 0);
      if (authorParts.length > 0) {
        parsed.authors = authorParts;
      }
    }

    // ── After year: title and venue ──
    let afterYear = text.slice(yearEnd).trim();
    // Strip leading punctuation (").", ".", ",", ":")
    afterYear = afterYear.replace(/^\s*[).,;:]+\s*/, '').trim();

    if (afterYear.length === 0) return parsed;

    // Title: find the first sentence boundary before a venue-like token
    // Heuristic: title ends at ". " followed by something that looks like a journal name (Title Case)
    // Or at the first comma after ≥ 20 chars
    const titleEnd = findTitleBoundary(afterYear);
    const titleBlock = titleEnd > 0 ? afterYear.slice(0, titleEnd).trim() : afterYear;
    const venueBlock = titleEnd > 0 ? afterYear.slice(titleEnd).replace(/^[.,\s]+/, '').trim() : '';

    if (titleBlock) {
      parsed.title = titleBlock.replace(/^["'"'"]|["'"'"]\s*$/, '').trim();
    }

    // ── Venue/pages extraction from venueBlock ──
    if (venueBlock) {
      // Try to extract volume(issue):pages pattern
      const volIssuePages = venueBlock.match(/(\d+)\s*\((\d+)\)\s*[:,]?\s*(\d+(?:[-–]\d+)?)/);
      if (volIssuePages) {
        parsed.volume = volIssuePages[1];
        parsed.issue = volIssuePages[2];
        parsed.pages = volIssuePages[3].replace(/–/g, '-');
      }
      // Try volume:pages (no issue)
      else {
        const volPages = venueBlock.match(/(\d+)\s*[:,]\s*(\d+(?:[-–]\d+)?)/);
        if (volPages) {
          parsed.volume = volPages[1];
          parsed.pages = volPages[2].replace(/–/g, '-');
        }
      }

      // Journal: everything before the first number segment
      const journalMatch = venueBlock.match(/^([A-Z][^,.\d]+?)(?:[,.]?\s*\d|$)/);
      if (journalMatch) {
        const candidate = journalMatch[1].trim().replace(/[,.]$/, '');
        if (candidate.length >= 3) parsed.journal = candidate;
      }
    }

    parsed.parseWarnings = [...(parsed.parseWarnings ?? []), 'year-anchored-fallback'];
    return parsed;
  }
}

/** Find the boundary between title and venue in an "after-year" fragment. */
function findTitleBoundary(text: string): number {
  // Boundary 1: ". " followed by a word starting with uppercase (likely journal/publisher)
  const sentenceEnd = text.search(/\.\s+[A-Z]/);
  if (sentenceEnd >= 15 && sentenceEnd < text.length - 5) return sentenceEnd + 1;

  // Boundary 2: comma after a reasonable title length
  const commaIdx = text.indexOf(',', 20);
  if (commaIdx > 20) return commaIdx;

  return 0; // couldn't find a good boundary
}
