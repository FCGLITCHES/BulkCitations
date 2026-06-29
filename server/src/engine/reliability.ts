import { fieldOf, type FieldOrigin, type FieldSource } from './types/field.js';
import type { FieldMoveLedgerEntry, ParseOutcome, ExtractedFields } from './types/citation.js';
import type {
  CandidateEnvelope,
  CandidateEnvelopeEntry,
  ReferenceCarrier,
  StickyInvariantSnapshot,
} from './types/carrier.js';
import {
  EXTRACTED_FIELD_KEYS,
  hasFieldValue,
  setExtractedField,
  type ExtractedFieldKey,
} from './utils/fields.js';

export interface FieldSnapshotEntry {
  value: unknown;
  confidence: number;
  source: FieldSource;
  origin: FieldOrigin;
  uncertain: boolean;
}

export type CarrierFieldSnapshot = Record<ExtractedFieldKey, FieldSnapshotEntry>;

const IDENTIFIER_FIELDS: ExtractedFieldKey[] = [
  'doi',
  'pmid',
  'arxiv',
  'isbn',
  'issn',
  'handle',
  'patent',
];

const ARTICLE_LOCATOR_FIELDS: ExtractedFieldKey[] = ['journal', 'volume', 'issue', 'pages', 'issn'];

export function deriveParseOutcome(
  input: Pick<ReferenceCarrier, 'status' | 'publicStatus' | 'health'>,
): ParseOutcome {
  if (input.status === 'error' || input.publicStatus === 'needs_action') {
    return 'needs_action';
  }

  const breakdown = input.health.breakdown;
  const hasAbstentions =
    input.publicStatus !== 'ready' ||
    breakdown.missingMandatory.length > 0 ||
    breakdown.invalidMandatory.length > 0 ||
    breakdown.lowConfidenceMandatory.length > 0;

  return hasAbstentions ? 'partial_parse_with_abstentions' : 'high_confidence_parse';
}

export function captureCarrierFieldSnapshot(fields: ExtractedFields): CarrierFieldSnapshot {
  return Object.fromEntries(
    EXTRACTED_FIELD_KEYS.map((field) => [
      field,
      {
        value: structuredClone(fields[field].value),
        confidence: fields[field].confidence,
        source: fields[field].source,
        origin: fields[field].origin,
        uncertain: fields[field].uncertain,
      },
    ]),
  ) as CarrierFieldSnapshot;
}

export function synthesizeCandidateEnvelope(carrier: ReferenceCarrier): CandidateEnvelope {
  const envelope: CandidateEnvelope = {
    titleCoreCandidates: [],
    titleTailCandidates: [],
    journalCandidates: [],
    conferenceCandidates: [],
    bookTitleCandidates: [],
    publisherCandidates: [],
    institutionCandidates: [],
    authorBlockCandidates: [],
    editorCandidates: [],
    identifierCandidates: [],
  };

  addFieldCandidate(
    envelope.titleCoreCandidates,
    'title',
    carrier.fields.title.value,
    carrier.fields.title.confidence,
    carrier.fields.title.source,
  );
  addFieldCandidate(
    envelope.journalCandidates,
    'journal',
    carrier.fields.journal.value,
    carrier.fields.journal.confidence,
    carrier.fields.journal.source,
  );
  addFieldCandidate(
    envelope.conferenceCandidates,
    'conferenceTitle',
    carrier.fields.conferenceTitle.value,
    carrier.fields.conferenceTitle.confidence,
    carrier.fields.conferenceTitle.source,
  );
  addFieldCandidate(
    envelope.bookTitleCandidates,
    'bookTitle',
    carrier.fields.bookTitle.value,
    carrier.fields.bookTitle.confidence,
    carrier.fields.bookTitle.source,
  );
  addFieldCandidate(
    envelope.publisherCandidates,
    'publisher',
    carrier.fields.publisher.value,
    carrier.fields.publisher.confidence,
    carrier.fields.publisher.source,
  );
  addFieldCandidate(
    envelope.institutionCandidates,
    'institution',
    carrier.fields.institution.value,
    carrier.fields.institution.confidence,
    carrier.fields.institution.source,
  );
  addFieldCandidate(
    envelope.identifierCandidates,
    'doi',
    carrier.fields.doi.value,
    carrier.fields.doi.confidence,
    carrier.fields.doi.source,
  );
  addFieldCandidate(
    envelope.identifierCandidates,
    'url',
    carrier.fields.url.value,
    carrier.fields.url.confidence,
    carrier.fields.url.source,
  );
  addFieldCandidate(
    envelope.identifierCandidates,
    'isbn',
    carrier.fields.isbn.value,
    carrier.fields.isbn.confidence,
    carrier.fields.isbn.source,
  );
  addFieldCandidate(
    envelope.identifierCandidates,
    'issn',
    carrier.fields.issn.value,
    carrier.fields.issn.confidence,
    carrier.fields.issn.source,
  );

  if (carrier.fields.authors.value.length > 0) {
    envelope.authorBlockCandidates.push({
      field: 'authors',
      text: carrier.fields.authors.value
        .map((author) => author.literal ?? [author.family, author.given].filter(Boolean).join(', '))
        .filter(Boolean)
        .join('; '),
      score: carrier.fields.authors.confidence,
      provenance: carrier.fields.authors.source,
      conflictFlags: [],
    });
  }

  if (carrier.fields.editors.value.length > 0) {
    envelope.editorCandidates.push({
      field: 'editors',
      text: carrier.fields.editors.value
        .map((editor) => editor.literal ?? [editor.family, editor.given].filter(Boolean).join(', '))
        .filter(Boolean)
        .join('; '),
      score: carrier.fields.editors.confidence,
      provenance: carrier.fields.editors.source,
      conflictFlags: [],
    });
  }

  for (const entity of carrier.extractionMeta?.entities ?? []) {
    const entry: CandidateEnvelopeEntry = {
      field: entity.field,
      text: entity.text,
      score: entity.confidence,
      provenance: `extraction_entity:${carrier.extractionMeta?.runMode ?? 'heuristic'}`,
      conflictFlags: entity.valid ? [] : ['invalid_entity'],
    };
    pushEntityCandidate(envelope, entry);
  }

  for (const span of carrier.healthEvidence.spans) {
    const entry: CandidateEnvelopeEntry = {
      field: span.field,
      text: span.text,
      score: span.confidence,
      provenance: 'health_span',
      conflictFlags: span.valid ? [] : ['invalid_span'],
    };
    if (span.field === 'title') {
      envelope.titleCoreCandidates.push(entry);
    } else if (span.field === 'journal') {
      envelope.journalCandidates.push(entry);
    } else if (span.field === 'conferenceTitle') {
      envelope.conferenceCandidates.push(entry);
    } else if (span.field === 'bookTitle') {
      envelope.bookTitleCandidates.push(entry);
    } else if (span.field === 'publisher') {
      envelope.publisherCandidates.push(entry);
    } else if (span.field === 'institution') {
      envelope.institutionCandidates.push(entry);
    }
  }

  const titleTail = extractTitleTailCandidate(carrier.fields.title.value);
  if (titleTail) {
    envelope.titleTailCandidates.push({
      field: 'titleTail',
      text: titleTail,
      score: carrier.fields.title.confidence,
      provenance: 'title_tail_split',
      conflictFlags: [],
    });
  }

  return envelope;
}

export function buildCandidateEnvelopeFromExtractionArtifacts(input: {
  fields: ExtractedFields;
  fieldConfidences?: Partial<Record<ExtractedFieldKey, number>>;
  entities?: Array<{
    field: ExtractedFieldKey;
    tokenStart: number;
    tokenEnd: number;
    text: string;
    confidence: number;
    valid: boolean;
  }>;
  healthSpans?: Array<{
    field: keyof ExtractedFields;
    tokenStart: number;
    tokenEnd: number;
    text: string;
    confidence: number;
    valid: boolean;
  }>;
  runMode: string;
}): CandidateEnvelope {
  const envelope: CandidateEnvelope = {
    titleCoreCandidates: [],
    titleTailCandidates: [],
    journalCandidates: [],
    conferenceCandidates: [],
    bookTitleCandidates: [],
    publisherCandidates: [],
    institutionCandidates: [],
    authorBlockCandidates: [],
    editorCandidates: [],
    identifierCandidates: [],
  };

  for (const field of EXTRACTED_FIELD_KEYS) {
    const value = input.fields[field].value;
    if (!hasComparableFieldValue(value)) {
      continue;
    }
    const score = input.fieldConfidences?.[field] ?? input.fields[field].confidence;
    pushEntityCandidate(envelope, {
      field,
      text: stringifyCandidateValue(value),
      score,
      provenance: `phase4_field:${input.runMode}`,
      conflictFlags: [],
    });
  }

  for (const entity of input.entities ?? []) {
    pushEntityCandidate(envelope, {
      field: entity.field,
      text: entity.text,
      score: entity.confidence,
      provenance: `phase4_entity:${input.runMode}`,
      conflictFlags: entity.valid ? [] : ['invalid_entity'],
    });
  }

  for (const span of input.healthSpans ?? []) {
    pushEntityCandidate(envelope, {
      field: span.field,
      text: span.text,
      score: span.confidence,
      provenance: `phase4_span:${input.runMode}`,
      conflictFlags: span.valid ? [] : ['invalid_span'],
    });
  }

  const titleValue = typeof input.fields.title.value === 'string' ? input.fields.title.value : null;
  const titleTail = extractTitleTailCandidate(titleValue);
  if (titleTail) {
    envelope.titleTailCandidates.push({
      field: 'titleTail',
      text: titleTail,
      score: input.fieldConfidences?.title ?? input.fields.title.confidence,
      provenance: `phase4_title_tail:${input.runMode}`,
      conflictFlags: [],
    });
  }

  return envelope;
}

function pushEntityCandidate(envelope: CandidateEnvelope, entry: CandidateEnvelopeEntry): void {
  switch (entry.field) {
    case 'title':
      envelope.titleCoreCandidates.push(entry);
      break;
    case 'journal':
      envelope.journalCandidates.push(entry);
      break;
    case 'conferenceTitle':
      envelope.conferenceCandidates.push(entry);
      break;
    case 'bookTitle':
      envelope.bookTitleCandidates.push(entry);
      break;
    case 'publisher':
      envelope.publisherCandidates.push(entry);
      break;
    case 'institution':
      envelope.institutionCandidates.push(entry);
      break;
    case 'authors':
      envelope.authorBlockCandidates.push(entry);
      break;
    case 'editors':
      envelope.editorCandidates.push(entry);
      break;
    case 'doi':
    case 'pmid':
    case 'arxiv':
    case 'isbn':
    case 'issn':
    case 'handle':
    case 'patent':
    case 'url':
    case 'reportNumber':
      envelope.identifierCandidates.push(entry);
      break;
    default:
      break;
  }
}

export function captureStickyInvariantSnapshot(fields: ExtractedFields): StickyInvariantSnapshot {
  const lockedFields = IDENTIFIER_FIELDS.filter(
    (field) => hasFieldValue(fields[field]) && fields[field].confidence >= 0.85,
  );
  const articleLocatorFields = ARTICLE_LOCATOR_FIELDS.filter(
    (field) => hasFieldValue(fields[field]) && fields[field].confidence >= 0.75,
  );

  return {
    lockedFields,
    articleLocatorFields,
    establishedArticleProfile:
      hasFieldValue(fields.journal) &&
      (hasFieldValue(fields.volume) || hasFieldValue(fields.issue) || hasFieldValue(fields.issn)),
  };
}

export function recordFieldMoves(
  carrier: ReferenceCarrier,
  before: CarrierFieldSnapshot,
  phaseId: string,
  reasonCode: string,
): void {
  for (const field of EXTRACTED_FIELD_KEYS) {
    const previous = before[field];
    const next = carrier.fields[field];
    if (valuesEqual(previous?.value, next.value)) {
      continue;
    }

    carrier.fieldMoveLedger.push({
      phaseId,
      reasonCode,
      sourceField: field,
      destinationField: field,
      action: classifyMoveAction(previous?.value, next.value),
      previousValue: previous?.value ?? null,
      nextValue: structuredClone(next.value),
      beforeConfidence: previous?.confidence ?? null,
      afterConfidence: next.confidence,
    });
  }
}

export function enforceStickyInvariants(
  carrier: ReferenceCarrier,
  before: CarrierFieldSnapshot,
  phaseId: string,
): number {
  let restored = 0;
  const stickyFields = new Set<ExtractedFieldKey>([
    ...(carrier.stickyInvariantSnapshot?.lockedFields ?? []),
    ...(carrier.stickyInvariantSnapshot?.establishedArticleProfile
      ? carrier.stickyInvariantSnapshot.articleLocatorFields
      : []),
  ]);

  for (const field of stickyFields) {
    const previous = before[field];
    const current = carrier.fields[field];
    if (!previous || !hasComparableFieldValue(previous.value) || hasFieldValue(current)) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      field,
      fieldOf(previous.value, previous.source, phaseId, previous.confidence, {
        origin: previous.origin,
        uncertain: previous.uncertain,
        previousValue: current.value,
        previousSource: current.source,
        previousOrigin: current.origin,
      }) as ExtractedFields[typeof field],
    );
    carrier.fieldMoveLedger.push({
      phaseId,
      reasonCode: 'sticky_invariant_restore',
      sourceField: field,
      destinationField: field,
      action: 'restore',
      previousValue: current.value,
      nextValue: structuredClone(previous.value),
      beforeConfidence: current.confidence,
      afterConfidence: previous.confidence,
    });
    restored += 1;
  }

  return restored;
}

function addFieldCandidate(
  bucket: CandidateEnvelopeEntry[],
  field: keyof ExtractedFields,
  value: unknown,
  score: number,
  provenance: string,
): void {
  const text = stringifyCandidateValue(value);
  if (!text) {
    return;
  }
  bucket.push({
    field,
    text,
    score,
    provenance,
    conflictFlags: [],
  });
}

function extractTitleTailCandidate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const title = value.trim();
  const urlTail = title.match(/(?:https?:\/\/|doi:\s*10\.)\S.*$/iu)?.[0]?.trim();
  if (urlTail) {
    return urlTail;
  }

  const splitMatch = title.match(/(?:,\s+|:\s+)(vol\.?\s+\d.*|no\.?\s+\d.*|pp\.?\s+\d.*)$/iu);
  return splitMatch?.[1]?.trim() ?? null;
}

function stringifyCandidateValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'object' && entry != null) {
          const author = entry as { literal?: string; family?: string; given?: string | null };
          return author.literal ?? [author.family, author.given].filter(Boolean).join(', ');
        }
        return String(entry ?? '').trim();
      })
      .filter(Boolean)
      .join('; ');
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return '';
}

function hasComparableFieldValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return value != null;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    return (
      JSON.stringify(value, (_key, nestedValue: unknown) => {
        if (typeof nestedValue !== 'object' || nestedValue === null) {
          return nestedValue;
        }

        if (seen.has(nestedValue)) {
          return '[Circular]';
        }
        seen.add(nestedValue);

        if (Array.isArray(nestedValue)) {
          return nestedValue;
        }

        return Object.keys(nestedValue)
          .sort()
          .reduce<Record<string, unknown>>((record, key) => {
            record[key] = (nestedValue as Record<string, unknown>)[key];
            return record;
          }, {});
      }) ?? ''
    );
  } catch {
    return String(value);
  }
}

function classifyMoveAction(
  previousValue: unknown,
  nextValue: unknown,
): FieldMoveLedgerEntry['action'] {
  const hadPrevious = hasComparableFieldValue(previousValue);
  const hasNext = hasComparableFieldValue(nextValue);
  if (!hadPrevious && hasNext) {
    return 'set';
  }
  if (hadPrevious && !hasNext) {
    return 'clear';
  }
  return 'mutate';
}
