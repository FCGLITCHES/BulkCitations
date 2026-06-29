export type TruthScalar = string | number | boolean | null;
export type TruthFieldValue = TruthScalar | TruthScalar[];

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function isTruthScalar(value: unknown): value is TruthScalar {
  return (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  );
}

function normalizeScalar(value: TruthScalar): TruthScalar {
  if (typeof value === 'string') {
    return normalizeWhitespace(value);
  }
  return value;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeAuthorLike(record: Record<string, unknown>): string | null {
  const literal = typeof record.literal === 'string' ? normalizeWhitespace(record.literal) : '';
  if (literal) {
    return literal;
  }

  const family = typeof record.family === 'string' ? normalizeWhitespace(record.family) : '';
  const given = typeof record.given === 'string' ? normalizeWhitespace(record.given) : '';

  if (family && given) {
    return `${family}, ${given}`;
  }
  if (family) {
    return family;
  }
  if (given) {
    return given;
  }

  return null;
}

function normalizeArrayItem(fieldName: string, value: unknown): TruthScalar {
  if (isTruthScalar(value)) {
    return normalizeScalar(value);
  }

  const record = recordFromUnknown(value);
  if (!record) {
    throw new TypeError(`expectedFields.${fieldName} contains an unsupported nested value.`);
  }

  if ('value' in record) {
    const nested = normalizeFieldValue(fieldName, record.value);
    if (Array.isArray(nested)) {
      throw new TypeError(`expectedFields.${fieldName} array items cannot expand to nested arrays.`);
    }
    return nested;
  }

  const author = normalizeAuthorLike(record);
  if (author != null) {
    return author;
  }

  throw new TypeError(`expectedFields.${fieldName} must use flat scalars or arrays of scalars.`);
}

export function normalizeFieldValue(fieldName: string, value: unknown): TruthFieldValue {
  if (isTruthScalar(value)) {
    return normalizeScalar(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeArrayItem(fieldName, item));
  }

  const record = recordFromUnknown(value);
  if (!record) {
    throw new TypeError(`expectedFields.${fieldName} must be a scalar or scalar array.`);
  }

  if ('value' in record) {
    return normalizeFieldValue(fieldName, record.value);
  }

  const author = normalizeAuthorLike(record);
  if (author != null) {
    return author;
  }

  throw new TypeError(`expectedFields.${fieldName} must be flat in training export v1.`);
}

export function normalizeExpectedTruthFields(
  input: Record<string, unknown>,
): Record<string, TruthFieldValue> {
  const normalized: Record<string, TruthFieldValue> = {};

  for (const [fieldName, rawValue] of Object.entries(input)) {
    normalized[fieldName] = normalizeFieldValue(fieldName, rawValue);
  }

  return normalized;
}
