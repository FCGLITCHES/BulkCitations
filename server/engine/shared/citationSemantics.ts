function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const GROUP_AUTHOR_SUFFIXES = new Set([
  'group',
  'association',
  'federation',
  'society',
  'committee',
  'institute',
  'consortium',
  'collaboration',
  'network',
  'team',
  'working group',
  'task force',
  'experiment',
  'initiative',
  'project',
]);

const GROUP_AUTHOR_KEYWORD_PATTERN = /\b(?:organization|agency|administration|department|ministry|office|commission|council|library|bank|foundation|programme|program|centre|center|college|university|hospital|publisher|press|authority|academ(?:y|ies)|team|group|committee|collaboration|network|initiative|institute|society|association|union|research)\b/i;
const GROUP_AUTHOR_MARKER_PATTERN = /\b(?:nations|parliament|congress|senate|assembly|secretariat|directorate|forum|openai|openaire|matlab)\b/i;

function looksLikeInstitutionalAcronymToken(token: string): boolean {
  const normalized = normalizeWhitespace(token).replace(/[().,;:]+$/g, '');
  if (!normalized) return false;
  if (normalized.includes('.')) return false;
  if (/^[A-Z]{2,10}$/.test(normalized)) return true;
  if (!/^[A-Z0-9][A-Za-z0-9+-]*$/.test(normalized)) return false;
  const upperCount = Array.from(normalized).filter((char) => /[A-Z]/.test(char)).length;
  const lowerCount = Array.from(normalized).filter((char) => /[a-z]/.test(char)).length;
  return lowerCount > 0 && upperCount >= 3;
}

function looksLikeInstitutionalAcronymPhrase(value: string): boolean {
  const tokens = normalizeWhitespace(value).split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return false;
  if (!tokens.some((token) => looksLikeInstitutionalAcronymToken(token))) return false;
  if (!looksLikeInstitutionalAcronymToken(tokens[0] ?? '') && !GROUP_AUTHOR_MARKER_PATTERN.test(value) && !GROUP_AUTHOR_KEYWORD_PATTERN.test(value)) {
    return false;
  }
  return tokens.every((token) => /^[\p{L}\p{N}.+'’()-]+$/u.test(token));
}

const GROUP_AUTHOR_EXACT_NORMALIZED = new Map<string, string>([
  ['the prisma group', 'The PRISMA Group'],
  ['prisma group', 'The PRISMA Group'],
  ['for the prisma group', 'The PRISMA Group'],
  ['for the prisma', 'The PRISMA Group'],
  ['the prisma', 'The PRISMA Group'],
  ['prisma', 'The PRISMA Group'],
  ['lhd experiment group', 'LHD Experiment Group'],
  ['group lhd experiment', 'LHD Experiment Group'],
  ['lhd experiment', 'LHD Experiment Group'],
  ['lhdexperiment', 'LHD Experiment Group'],
]);

export function normalizeKnownContainerName(value: string): string {
  let normalized = normalizeWhitespace(value);
  if (!normalized) return normalized;

  normalized = normalized
    .replace(/\bBritish Medical Journal\b/gi, 'BMJ')
    .replace(/\bB\.?\s*M\.?\s*J\.?\b/g, 'BMJ')
    .replace(/\bPlo\s*S\b/gi, 'PLoS')
    .replace(/\bPloS\b/g, 'PLoS')
    .replace(/\bPLOS\b/g, 'PLoS')
    .replace(/\bPlo\s+S\b/gi, 'PLoS')
    .replace(/\bPlo\s+Medicine\b/gi, 'PLoS Medicine')
    .replace(/\bDROPS\b/gi, 'DROPS');

  return normalized;
}

export function normalizeProtectedTokenValue(value: string): string {
  return normalizeKnownContainerName(value)
    .replace(/\bPRISMA\b/gi, 'PRISMA')
    .replace(/\bLHD\b/gi, 'LHD')
    .replace(/\bU[\s-]?Net\b/gi, 'U-Net')
    .replace(/\bG\s*\*?\s*Power\b/gi, 'G*Power')
    .replace(/\bDESeq\s*2\b/gi, 'DESeq2')
    .replace(/2\s*[-−]\s*ΔΔCT/gi, '2−ΔΔCT');
}

function normalizeGroupComparisonValue(value: string): string {
  return normalizeWhitespace(
    value
      .toLowerCase()
      .replace(/[.,]/g, ' ')
      .replace(/\bl\.?\s*h\.?\s*d\.?\b/g, 'lhd')
      .replace(/\bprisma\b/g, 'prisma')
      .replace(/\s+/g, ' '),
  );
}

export function normalizeGroupAuthor(value: string): string {
  let normalized = normalizeWhitespace(value);
  if (!normalized) return normalized;

  normalized = normalizeProtectedTokenValue(normalized)
    .replace(/^group\s*,\s*(.+)$/i, '$1 Group')
    .replace(/^(.+?)\s*,\s*group$/i, '$1 Group')
    .replace(/^for the\s+(.+?)\s+group$/i, 'The $1 Group')
    .replace(/^for the\s+(.+)$/i, 'The $1 Group')
    .replace(/^group\s+for the\s+(.+)$/i, 'The $1 Group')
    .replace(/^group\s+(.+)$/i, '$1 Group')
    .replace(/\bl\.?\s*h\.?\s*d\.?\b/gi, 'LHD')
    .replace(/\bprisma\b/gi, 'PRISMA');

  const comparable = normalizeGroupComparisonValue(normalized);
  const exactMatch = GROUP_AUTHOR_EXACT_NORMALIZED.get(comparable);
  if (exactMatch) return exactMatch;

  return normalizeWhitespace(normalized);
}

export function isGroupAuthor(value: string): boolean {
  const normalized = normalizeGroupAuthor(value);
  if (!normalized) return false;

  const comparable = normalizeGroupComparisonValue(normalized);
  if (GROUP_AUTHOR_EXACT_NORMALIZED.has(comparable)) return true;

  if (looksLikeInstitutionalAcronymPhrase(normalized)) return true;
  if (GROUP_AUTHOR_MARKER_PATTERN.test(normalized)) return true;
  if (!normalized.includes(' ') && looksLikeInstitutionalAcronymToken(normalized)) return true;
  if (GROUP_AUTHOR_KEYWORD_PATTERN.test(normalized) && normalized.split(/\s+/).length >= 2) {
    return true;
  }

  return [...GROUP_AUTHOR_SUFFIXES].some((suffix) => {
    if (comparable === suffix) return false;
    const pattern = new RegExp(`(?:^|\\s)${escapeRegex(suffix)}(?:$|\\s)`, 'i');
    return pattern.test(normalized) || normalized.toLowerCase().endsWith(` ${suffix}`);
  });
}

export function repairGroupAuthorFragments(parts: string[]): string[] {
  const cleaned = parts.map((part) => normalizeWhitespace(part)).filter(Boolean);
  const repaired: string[] = [];

  for (let index = 0; index < cleaned.length; index += 1) {
    const current = cleaned[index];
    const next = cleaned[index + 1];
    const nextNext = cleaned[index + 2];

    const candidateTriples = [
      current,
      next ? `${current} ${next}` : '',
      next ? `${next} ${current}` : '',
      next && nextNext ? `${current} ${next} ${nextNext}` : '',
      next && nextNext ? `${next} ${nextNext} ${current}` : '',
      next && nextNext ? `${current} ${nextNext} ${next}` : '',
    ].filter(Boolean);

    const repairedCandidate = candidateTriples
      .map((candidate) => normalizeGroupAuthor(candidate))
      .find((candidate) => isGroupAuthor(candidate));

    if (repairedCandidate) {
      repaired.push(repairedCandidate);
      if (next && nextNext && isGroupAuthor(`${current} ${next} ${nextNext}`)) {
        index += 2;
      } else if (next && (isGroupAuthor(`${current} ${next}`) || isGroupAuthor(`${next} ${current}`))) {
        index += 1;
      }
      continue;
    }

    repaired.push(normalizeGroupAuthor(current));
  }

  return repaired;
}

export type LocatorKind = 'pages' | 'article-number' | 'title_fragment';

export function classifyLocatorToken(token: string): { kind: LocatorKind; value: string | null } {
  const normalized = normalizeWhitespace(token)
    .replace(/^pp?\.?\s*/i, '')
    .replace(/^pages?\s+/i, '')
    .replace(/[;,.:]+$/g, '')
    .trim();

  if (!normalized) {
    return { kind: 'title_fragment', value: null };
  }

  const explicitArticle = normalized.match(/^Art(?:\.|icle)?\s*(?:no\.?)?\s*([A-Za-z]?\d+[A-Za-z]?\d*)$/i);
  if (explicitArticle) {
    return { kind: 'article-number', value: explicitArticle[1] };
  }

  if (/^[A-Za-z]?\d+\s*[-–]\s*[A-Za-z]?\d+$/.test(normalized)) {
    return { kind: 'pages', value: normalized.replace(/–/g, '-') };
  }

  if (/^[A-Za-z]\d{2,}$/i.test(normalized)) {
    return { kind: 'article-number', value: normalized };
  }

  if (/^[A-Z]\d+[a-z]\d*$/i.test(normalized)) {
    return { kind: 'article-number', value: normalized };
  }

  if (/^\d{6,}$/.test(normalized)) {
    return { kind: 'article-number', value: normalized };
  }

  if (/^\d+$/.test(normalized)) {
    return { kind: 'pages', value: normalized };
  }

  return { kind: /\d/.test(normalized) ? 'pages' : 'title_fragment', value: normalized };
}

export function extractLocatorFields(token: string): { pages?: string; 'article-number'?: string } | null {
  const classified = classifyLocatorToken(token);
  if (!classified.value) return null;

  if (classified.kind === 'article-number') {
    return { 'article-number': classified.value };
  }

  if (classified.kind === 'pages') {
    return { pages: classified.value };
  }

  return null;
}
