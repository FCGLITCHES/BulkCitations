import { representativeStyleForFamily } from './styleDetection.js';
import { validateMandatoryField } from './healthRules.js';
import type {
  CitationStyle,
  ExtractedFields,
  ReferenceType,
  StyleFamily,
} from './types/citation.js';
import { hasFieldValue } from './utils/fields.js';

type SupportedSchemaStyle = Exclude<CitationStyle, 'auto' | 'unknown'>;
type ExtractedFieldKey = keyof ExtractedFields;
type RequirementSeverity = 'mandatory' | 'preferred';
type SchemaRuleId = 'journal_online_first_with_doi';

export interface FieldRequirementGroup {
  id: string;
  label: string;
  fields: ExtractedFieldKey[];
  precedence?: ExtractedFieldKey[];
  severity: RequirementSeverity;
  completenessOnly?: boolean;
}

export interface ConditionalSchemaRule {
  id: SchemaRuleId;
  when: (fields: ExtractedFields) => boolean;
  waiveMandatory?: ExtractedFieldKey[];
  addMandatory?: ExtractedFieldKey[];
  disableRequirementGroupIds?: string[];
}

export interface FieldSchema {
  mandatory: ExtractedFieldKey[];
  preferred: ExtractedFieldKey[];
  optional: ExtractedFieldKey[];
  requireOneOf: FieldRequirementGroup[];
  conditionalRules: ConditionalSchemaRule[];
}

export interface EffectiveFieldSchema extends FieldSchema {}

export interface RequirementGroupResult {
  id: string;
  label: string;
  severity: RequirementSeverity;
  completenessOnly: boolean;
  satisfied: boolean;
  resolvedField: ExtractedFieldKey | null;
}

export interface SchemaEvaluation {
  effectiveSchema: EffectiveFieldSchema;
  missingMandatory: string[];
  missingPreferred: string[];
  presentMandatory: string[];
  presentPreferred: string[];
  groupResults: RequirementGroupResult[];
}

export interface MandatoryFieldAudit {
  referenceType: ReferenceType;
  schemaStyle: CitationStyle;
  mandatory: string[];
  preferred: string[];
  optional: ExtractedFieldKey[];
  presentMandatory: string[];
  missingMandatory: string[];
  presentPreferred: string[];
  missingPreferred: string[];
}

const SUPPORTED_SCHEMA_STYLES = [
  'apa7',
  'mla9',
  'chicago-author-date',
  'chicago-notes-bib',
  'vancouver',
  'ieee',
  'harvard-ctr',
  'ama',
  'acs',
] as const satisfies readonly SupportedSchemaStyle[];

const JOURNAL_ONLINE_FIRST_RULE: ConditionalSchemaRule = {
  id: 'journal_online_first_with_doi',
  when: (fields) => hasPresentValidValue(fields, 'doi') && !hasFieldValue(fields.volume),
  waiveMandatory: ['volume'],
  addMandatory: ['doi'],
  disableRequirementGroupIds: ['journal_locator'],
};

const BASE_TYPE_SCHEMAS: Record<ReferenceType, FieldSchema> = {
  'article-journal': {
    mandatory: ['authors', 'title', 'journal', 'year', 'volume'],
    preferred: ['issue', 'doi', 'pmid', 'pmcid', 'issn', 'url'],
    optional: ['articleNumber', 'database'],
    requireOneOf: [
      {
        id: 'journal_locator',
        label: 'pages or articleNumber',
        fields: ['pages', 'articleNumber'],
        precedence: ['pages', 'articleNumber'],
        severity: 'preferred',
        completenessOnly: true,
      },
    ],
    conditionalRules: [JOURNAL_ONLINE_FIRST_RULE],
  },
  book: {
    mandatory: ['title', 'year', 'publisher'],
    preferred: ['edition', 'placeOfPublication', 'doi', 'isbn', 'url'],
    optional: [],
    requireOneOf: [
      {
        id: 'book_authorship',
        label: 'authors or editors',
        fields: ['authors', 'editors'],
        precedence: ['authors', 'editors'],
        severity: 'mandatory',
      },
    ],
    conditionalRules: [],
  },
  'book-chapter': {
    mandatory: ['authors', 'title', 'bookTitle', 'year', 'publisher'],
    preferred: ['editors', 'pages', 'edition', 'doi', 'isbn'],
    optional: ['placeOfPublication', 'url'],
    requireOneOf: [],
    conditionalRules: [],
  },
  thesis: {
    mandatory: ['authors', 'title', 'institution', 'year', 'thesisType'],
    preferred: ['url', 'handle'],
    optional: ['doi', 'database', 'isbn'],
    requireOneOf: [],
    conditionalRules: [],
  },
  'conference-paper': {
    mandatory: ['authors', 'title', 'conferenceTitle', 'year'],
    preferred: ['pages', 'articleNumber', 'placeOfPublication', 'publisher', 'doi', 'isbn'],
    optional: ['url'],
    requireOneOf: [
      {
        id: 'conference_locator_support',
        label: 'pages or articleNumber or placeOfPublication',
        fields: ['pages', 'articleNumber', 'placeOfPublication'],
        precedence: ['pages', 'articleNumber', 'placeOfPublication'],
        severity: 'preferred',
        completenessOnly: true,
      },
    ],
    conditionalRules: [],
  },
  webpage: {
    mandatory: ['title', 'url'],
    preferred: ['authors', 'siteName', 'year', 'accessedDate'],
    optional: [],
    requireOneOf: [],
    conditionalRules: [],
  },
  report: {
    mandatory: ['title', 'year'],
    preferred: ['reportNumber', 'institution', 'publisher', 'placeOfPublication', 'url', 'doi', 'isbn', 'issn'],
    optional: [],
    requireOneOf: [
      {
        id: 'report_authorship',
        label: 'authors or institution',
        fields: ['authors', 'institution'],
        precedence: ['authors', 'institution'],
        severity: 'mandatory',
      },
    ],
    conditionalRules: [],
  },
  patent: {
    mandatory: ['title', 'year', 'patent'],
    preferred: ['authors', 'institution', 'url'],
    optional: [],
    requireOneOf: [],
    conditionalRules: [],
  },
  dataset: {
    mandatory: ['authors', 'title', 'year', 'repository'],
    preferred: ['doi', 'url', 'edition', 'handle'],
    optional: [],
    requireOneOf: [],
    conditionalRules: [],
  },
  preprint: {
    mandatory: ['authors', 'title', 'year', 'repository'],
    preferred: ['doi', 'arxiv', 'url'],
    optional: [],
    requireOneOf: [],
    conditionalRules: [],
  },
  unknown: {
    mandatory: ['title'],
    preferred: [
      'authors',
      'year',
      'doi',
      'pmid',
      'pmcid',
      'arxiv',
      'isbn',
      'issn',
      'handle',
      'patent',
      'url',
    ],
    optional: [],
    requireOneOf: [],
    conditionalRules: [],
  },
};

export const FIELD_SCHEMAS: Record<string, FieldSchema> = buildFieldSchemas();

export const FIELD_CONFIDENCE_THRESHOLDS: Partial<Record<ExtractedFieldKey, number>> = {
  authors: 0.75,
  title: 0.8,
  year: 0.9,
  doi: 0.95,
  pmid: 0.95,
  pmcid: 0.95,
  arxiv: 0.95,
  isbn: 0.92,
  issn: 0.92,
  handle: 0.9,
  patent: 0.92,
  url: 0.8,
  journal: 0.7,
  volume: 0.65,
  issue: 0.65,
  pages: 0.65,
  publisher: 0.7,
  placeOfPublication: 0.7,
  conferenceTitle: 0.7,
  bookTitle: 0.7,
  institution: 0.7,
  edition: 0.7,
  editors: 0.72,
  thesisType: 0.8,
  repository: 0.72,
  articleNumber: 0.7,
  accessedDate: 0.75,
  siteName: 0.72,
  database: 0.72,
  reportNumber: 0.72,
};

/** Reduced Phase 10 gates when {@link validateMandatoryField} already passed for the value. */
export const FIELD_CONFIDENCE_THRESHOLDS_VALIDATED: Partial<Record<ExtractedFieldKey, number>> = {
  year: 0.7,
  doi: 0.8,
  isbn: 0.8,
  url: 0.65,
};

export function getFieldSchema(type: ReferenceType, style: CitationStyle): FieldSchema {
  const key = `${type}:${style}`;
  const fallbackSchema = FIELD_SCHEMAS['unknown:apa7'];
  if (!fallbackSchema) {
    throw new Error('Mandatory field schema fallback "unknown:apa7" is missing.');
  }

  const schema = FIELD_SCHEMAS[key] ?? FIELD_SCHEMAS[`unknown:${style}`] ?? fallbackSchema;
  return cloneSchema(schema);
}

export function getEffectiveFieldSchema(
  fields: ExtractedFields,
  schema: FieldSchema,
): EffectiveFieldSchema {
  let mandatory = [...schema.mandatory];
  let preferred = [...schema.preferred];
  let requireOneOf = schema.requireOneOf.map(cloneRequirementGroup);

  for (const rule of schema.conditionalRules) {
    if (!rule.when(fields)) {
      continue;
    }

    if (rule.waiveMandatory) {
      mandatory = mandatory.filter((field) => !rule.waiveMandatory!.includes(field));
    }
    if (rule.addMandatory) {
      mandatory = uniqueKeys([...mandatory, ...rule.addMandatory]);
      preferred = preferred.filter((field) => !rule.addMandatory!.includes(field));
    }
    if (rule.disableRequirementGroupIds) {
      requireOneOf = requireOneOf.filter(
        (group) => !rule.disableRequirementGroupIds!.includes(group.id),
      );
    }
  }

  return {
    mandatory,
    preferred,
    optional: [...schema.optional],
    requireOneOf,
    conditionalRules: [...schema.conditionalRules],
  };
}

export function resolveSchemaStyle(
  requested: CitationStyle,
  detected: CitationStyle,
  detectedFamily: StyleFamily = 'unknown',
): CitationStyle {
  if (requested !== 'auto' && requested !== 'unknown') return requested;
  return detected !== 'auto' && detected !== 'unknown'
    ? detected
    : representativeStyleForFamily(detectedFamily);
}

export function evaluateFieldSchema(
  fields: ExtractedFields,
  schema: FieldSchema,
): SchemaEvaluation {
  const effectiveSchema = getEffectiveFieldSchema(fields, schema);
  const presentMandatory: string[] = effectiveSchema.mandatory
    .filter((field) => hasFieldValue(fields[field]))
    .map(String);
  const missingMandatory = effectiveSchema.mandatory
    .filter((field) => !hasFieldValue(fields[field]))
    .map(String);
  const presentPreferred: string[] = effectiveSchema.preferred
    .filter((field) => hasFieldValue(fields[field]))
    .map(String);
  const missingPreferred = effectiveSchema.preferred
    .filter((field) => !hasFieldValue(fields[field]))
    .map(String);
  const groupResults = effectiveSchema.requireOneOf.map((group) =>
    evaluateRequirementGroup(fields, group),
  );

  for (const result of groupResults) {
    if (result.satisfied) {
      const label = result.resolvedField ? String(result.resolvedField) : result.label;
      if (result.severity === 'mandatory') {
        presentMandatory.push(label);
      } else {
        presentPreferred.push(label);
      }
      continue;
    }

    if (result.severity === 'mandatory') {
      missingMandatory.push(result.label);
    } else {
      missingPreferred.push(result.label);
    }
  }

  return {
    effectiveSchema,
    missingMandatory,
    missingPreferred,
    presentMandatory: uniqueStrings(presentMandatory.map(String)),
    presentPreferred: uniqueStrings(presentPreferred.map(String)),
    groupResults,
  };
}

export function pickRequirementGroupField(
  fields: ExtractedFields,
  group: FieldRequirementGroup,
): ExtractedFieldKey | null {
  return evaluateRequirementGroup(fields, group).resolvedField;
}

export function auditMandatoryFields(input: {
  fields: ExtractedFields;
  referenceType: ReferenceType;
  requestedStyle: CitationStyle;
  detectedStyle: CitationStyle;
  detectedStyleFamily?: StyleFamily;
}): MandatoryFieldAudit {
  const schemaStyle = resolveSchemaStyle(
    input.requestedStyle,
    input.detectedStyle,
    input.detectedStyleFamily ?? 'unknown',
  );
  const schema = getFieldSchema(input.referenceType, schemaStyle);
  const evaluation = evaluateFieldSchema(input.fields, schema);

  return {
    referenceType: input.referenceType,
    schemaStyle,
    mandatory: [
      ...evaluation.effectiveSchema.mandatory.map(String),
      ...evaluation.effectiveSchema.requireOneOf
        .filter((group) => group.severity === 'mandatory')
        .map((group) => group.label),
    ],
    preferred: [
      ...evaluation.effectiveSchema.preferred.map(String),
      ...evaluation.effectiveSchema.requireOneOf
        .filter((group) => group.severity === 'preferred')
        .map((group) => group.label),
    ],
    optional: [...evaluation.effectiveSchema.optional],
    presentMandatory: evaluation.presentMandatory,
    missingMandatory: evaluation.missingMandatory,
    presentPreferred: evaluation.presentPreferred,
    missingPreferred: evaluation.missingPreferred,
  };
}

function buildFieldSchemas(): Record<string, FieldSchema> {
  const schemas: Record<string, FieldSchema> = {};

  for (const style of SUPPORTED_SCHEMA_STYLES) {
    for (const [type, schema] of Object.entries(BASE_TYPE_SCHEMAS) as Array<
      [ReferenceType, FieldSchema]
    >) {
      schemas[`${type}:${style}`] = cloneSchema(schema);
    }
  }

  return schemas;
}

function cloneSchema(schema: FieldSchema): FieldSchema {
  return {
    mandatory: [...schema.mandatory],
    preferred: [...schema.preferred],
    optional: [...schema.optional],
    requireOneOf: schema.requireOneOf.map(cloneRequirementGroup),
    conditionalRules: [...schema.conditionalRules],
  };
}

function cloneRequirementGroup(group: FieldRequirementGroup): FieldRequirementGroup {
  return {
    ...group,
    fields: [...group.fields],
    ...(group.precedence ? { precedence: [...group.precedence] } : {}),
  };
}

function evaluateRequirementGroup(
  fields: ExtractedFields,
  group: FieldRequirementGroup,
): RequirementGroupResult {
  const orderedFields = group.precedence ?? group.fields;
  const resolvedField =
    orderedFields.find((field) => hasPresentValidValue(fields, field)) ??
    group.fields.find((field) => hasPresentValidValue(fields, field)) ??
    null;

  return {
    id: group.id,
    label: group.label,
    severity: group.severity,
    completenessOnly: Boolean(group.completenessOnly),
    satisfied: resolvedField != null,
    resolvedField,
  };
}

function hasPresentValidValue(fields: ExtractedFields, field: ExtractedFieldKey): boolean {
  const fieldValue = fields[field];
  if (!hasFieldValue(fieldValue)) {
    return false;
  }
  return validateMandatoryField(field, fieldValue.value).valid;
}

function uniqueKeys(values: ExtractedFieldKey[]): ExtractedFieldKey[] {
  return [...new Set(values)];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
