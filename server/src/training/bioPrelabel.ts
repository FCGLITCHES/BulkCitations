/**
 * LLM pre-label leg of the BIO consensus loop.
 *
 * GPT-5.4 nano proposes the bibliographic fields for a raw reference as EXACT
 * substrings of the input. We deliberately do not trust the model to emit
 * character offsets — instead its field strings flow through the same hardened
 * aligner the export uses, so the LLM, model, and truth legs are all measured on
 * one consistent span representation.
 */
import OpenAI from 'openai';
import { env } from '../config.js';
import { spansFromExpectedFields, type ConsensusSpan } from './bioConsensus.js';

const PRELABEL_FIELDS = [
  'authors', 'editors', 'year', 'title', 'journal', 'conferenceTitle', 'bookTitle',
  'publisher', 'institution', 'edition', 'thesisType', 'repository', 'articleNumber',
  'accessedDate', 'siteName', 'database', 'reportNumber', 'placeOfPublication',
  'volume', 'issue', 'pages', 'doi', 'url',
] as const;

export interface PrelabelResult {
  fields: Record<string, unknown>;
  confidence: number;
  tokensUsed: number;
  ok: boolean;
}

const EMPTY: PrelabelResult = { fields: {}, confidence: 0, tokensUsed: 0, ok: false };

let clientInstance: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!env.OPENAI_API_KEY) return null;
  if (!clientInstance) {
    clientInstance = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.OPENAI_TIMEOUT_MS });
  }
  return clientInstance;
}

function buildPrompt(raw: string): string {
  return [
    'Extract bibliographic fields from this reference.',
    'CRITICAL: every value must be an EXACT, verbatim substring copied from the reference —',
    'do not normalize, reorder, expand abbreviations, or add punctuation. If a field is not',
    'present, omit it. authors and editors must be arrays of exact name substrings.',
    '',
    `Reference: "${raw}"`,
    '',
    `Allowed fields: ${PRELABEL_FIELDS.join(', ')}.`,
    'Return ONLY JSON: {"confidence": 0.0-1.0, "fields": { ... }}. No prose.',
  ].join('\n');
}

/** Pure parser — validates the model payload and keeps only schema fields. Unit-tested. */
export function parsePrelabelResponse(text: string | null | undefined): PrelabelResult {
  if (!text) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return EMPTY;
  }
  if (!parsed || typeof parsed !== 'object') return EMPTY;
  const record = parsed as Record<string, unknown>;

  const rawFields = (record.fields && typeof record.fields === 'object' && !Array.isArray(record.fields))
    ? record.fields as Record<string, unknown>
    : record; // tolerate a flat object that omits the `fields` wrapper

  const allowed = new Set<string>(PRELABEL_FIELDS);
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawFields)) {
    if (!allowed.has(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    fields[key] = value;
  }

  const confidence = typeof record.confidence === 'number'
    ? Math.max(0, Math.min(1, record.confidence))
    : 0;

  return { fields, confidence, tokensUsed: 0, ok: Object.keys(fields).length > 0 };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  return trimmed;
}

/** Call GPT-5.4 nano to pre-label one reference. Returns EMPTY on any failure. */
export async function prelabelReference(raw: string): Promise<PrelabelResult> {
  const client = getClient();
  if (!client) return EMPTY;
  try {
    const response = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      temperature: 0,
      max_tokens: 600,
      messages: [
        { role: 'system', content: 'You are a precise bibliographic reference parser. Return only valid JSON.' },
        { role: 'user', content: buildPrompt(raw) },
      ],
    });
    const tokensUsed = response.usage?.total_tokens ?? 0;
    const result = parsePrelabelResponse(response.choices[0]?.message?.content);
    return { ...result, tokensUsed };
  } catch (error: unknown) {
    process.stderr.write(`[bio-prelabel] failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return EMPTY;
  }
}

/** Pre-label a reference and project the LLM's fields to consensus spans. */
export async function prelabelSpans(raw: string): Promise<{ spans: ConsensusSpan[]; result: PrelabelResult }> {
  const result = await prelabelReference(raw);
  if (!result.ok) return { spans: [], result };
  return { spans: spansFromExpectedFields(raw, result.fields), result };
}
