/** Labels, colors, and copy for admin "citations by publicStatus" doughnut charts. */

export const CITATION_STATUS_ORDER = [
  'ready',
  'needs_review',
  'needs_action',
  'error',
] as const;

const LABEL: Record<string, string> = {
  ready: 'Ready',
  needs_review: 'Needs review',
  needs_action: 'Needs action',
  error: 'Error',
};

/** Muted green / lavender / orange / red — aligned with dashboard semantics */
const FILL: Record<string, string> = {
  ready: 'hsl(142 35% 42%)',
  needs_review: 'hsl(258 42% 58%)',
  needs_action: 'hsl(28 88% 52%)',
  error: 'hsl(0 62% 52%)',
};

const DESCRIPTION: Record<string, string> = {
  ready: 'Passed checks; safe to use as-is.',
  needs_review: 'Flagged for a quick human look.',
  needs_action: 'Missing or conflicting fields need fixing.',
  error: 'Pipeline or system error while processing.',
};

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function citationStatusLabel(key: string): string {
  return LABEL[key] ?? humanizeKey(key);
}

export function citationStatusFill(key: string): string {
  return FILL[key] ?? 'hsl(215 14% 45%)';
}

export function citationStatusDescription(key: string): string {
  return DESCRIPTION[key] ?? 'Citation count for this status.';
}

export type CitationPieRow = {
  /** Stable key for React / debugging */
  statusKey: string;
  /** Legend + tooltip title */
  name: string;
  value: number;
  fill: string;
  percentOfTotal: number;
  description: string;
};

export function buildCitationStatusPieRows(
  citationsByStatus: Record<string, number> | null | undefined,
): CitationPieRow[] {
  const src = citationsByStatus ?? {};
  const ordered: { key: string; value: number }[] = [];

  for (const k of CITATION_STATUS_ORDER) {
    const v = src[k];
    if (v != null && v > 0) ordered.push({ key: k, value: v });
  }

  const orderedSet = new Set(CITATION_STATUS_ORDER as readonly string[]);
  for (const [key, value] of Object.entries(src)) {
    if (value > 0 && !orderedSet.has(key)) {
      ordered.push({ key, value });
    }
  }

  const total = ordered.reduce((s, x) => s + x.value, 0);

  if (total === 0) {
    return [
      {
        statusKey: 'empty',
        name: 'No citations',
        value: 1,
        fill: 'hsl(215 14% 34%)',
        percentOfTotal: 100,
        description: 'No citations in this window yet.',
      },
    ];
  }

  return ordered.map(({ key, value }) => ({
    statusKey: key,
    name: citationStatusLabel(key),
    value,
    fill: citationStatusFill(key),
    percentOfTotal: (value / total) * 100,
    description: citationStatusDescription(key),
  }));
}
