import OpenAI from 'openai';
import { env } from '../config.js';
import { isLlmFallbackEnabled } from '../engine/confidenceCalibration.js';

export interface LLMRepairResult {
  referenceConfidence: number;
  fields: Record<string, unknown>;
  tokensUsed: number;
}

export interface LLMService {
  repair(
    raw: string,
    type: string,
    style: string,
    missingFields: string[],
  ): Promise<LLMRepairResult>;
}

let clientInstance: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!isLlmFallbackEnabled()) return null;
  if (!env.OPENAI_API_KEY) return null;
  if (!clientInstance) {
    clientInstance = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: env.OPENAI_TIMEOUT_MS,
    });
  }
  return clientInstance;
}

const EMPTY_RESULT: LLMRepairResult = {
  referenceConfidence: 0,
  fields: {},
  tokensUsed: 0,
};

function buildPrompt(
  raw: string,
  type: string,
  style: string,
  missingFields: string[],
): string {
  return [
    `Given this citation: "${raw}"`,
    `Detected type: ${type}, Style: ${style}`,
    '',
    'Return a JSON object with ALL bibliographic fields you can identify:',
    '{"referenceConfidence": 0.0-1.0, "authors": [...], "title": "...", "year": ..., ...}',
    '',
    'If you are very confident (>0.85) you have identified the exact reference, fill ALL fields.',
    `If unsure, only fill: ${missingFields.join(', ')}`,
    'Return ONLY valid JSON, no explanation.',
  ].join('\n');
}

class OpenAILLMService implements LLMService {
  async repair(
    raw: string,
    type: string,
    style: string,
    missingFields: string[],
  ): Promise<LLMRepairResult> {
    const client = getClient();
    if (!client) return EMPTY_RESULT;

    try {
      const response = await client.chat.completions.create({
        model: env.OPENAI_MODEL,
        temperature: 0,
        max_tokens: 400,
        messages: [
          {
            role: 'system',
            content:
              'You are a bibliographic reference parser. Return only valid JSON.',
          },
          { role: 'user', content: buildPrompt(raw, type, style, missingFields) },
        ],
      });

      const tokensUsed = response.usage?.total_tokens ?? 0;
      const text = response.choices[0]?.message?.content?.trim();
      if (!text) return { ...EMPTY_RESULT, tokensUsed };

      const parsed = JSON.parse(text) as Record<string, unknown>;
      const referenceConfidence =
        typeof parsed.referenceConfidence === 'number'
          ? parsed.referenceConfidence
          : 0;

      const { referenceConfidence: _, ...fields } = parsed;

      return { referenceConfidence, fields, tokensUsed };
    } catch (err: unknown) {
      process.stderr.write(
        `[openai] repair failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return EMPTY_RESULT;
    }
  }
}

export const llmService: LLMService = new OpenAILLMService();
