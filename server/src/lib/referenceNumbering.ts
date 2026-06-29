const BRACKETED_REFERENCE_MARKER =
  /^\s*[\[(]\s*(?:no\.?\s*)?(\d{1,4}[a-z]?)\s*[\])]\s*/iu;
const DELIMITED_REFERENCE_MARKER =
  /^\s*(?:no\.?\s*)?(\d{1,4}[a-z]?)(?:\s*[):\-–]\s*|\.\s+)/iu;
const BARE_REFERENCE_MARKER =
  /^\s*(?:no\.?\s*)?(\d{1,3}[a-z]?)\s+(?=[A-Z])/u;

function isLikelyYearMarker(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length !== 4) {
    return false;
  }
  const year = Number(digits);
  return Number.isFinite(year) && year >= 1900 && year <= 2099;
}

function stripOneLeadingReferenceMarker(value: string): string {
  const bracketedMatch = value.match(BRACKETED_REFERENCE_MARKER);
  if (bracketedMatch && !isLikelyYearMarker(bracketedMatch[1])) {
    return value.slice(bracketedMatch[0].length);
  }

  const delimitedMatch = value.match(DELIMITED_REFERENCE_MARKER);
  if (delimitedMatch && !isLikelyYearMarker(delimitedMatch[1])) {
    return value.slice(delimitedMatch[0].length);
  }

  const bareMatch = value.match(BARE_REFERENCE_MARKER);
  if (bareMatch) {
    return value.slice(bareMatch[0].length);
  }

  return value;
}

export function stripLeadingReferenceNumbering(value: string): string {
  let normalized = value.trimStart();

  while (normalized.length > 0) {
    const next = stripOneLeadingReferenceMarker(normalized).trimStart();
    if (next === normalized) {
      break;
    }
    normalized = next;
  }

  return normalized.trim();
}
