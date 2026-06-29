import { describe, expect, it } from 'vitest';
import { createPipelineContext, runConvertPipeline } from '../../src/pipeline/orchestrator.js';

describe('weird unicode convert regression', () => {
  it('does not throw on weird unicode text input', async () => {
    const rng = createRng(0x5eeda11);
    const content = randomWeirdString(rng, 180);
    const ctx = createPipelineContext({ outputStyle: 'apa7' });

    await expect(runConvertPipeline({
      sourceType: 'text',
      content,
      outputStyle: 'apa7',
    }, ctx)).resolves.toBeDefined();
  });
});

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10_000) / 10_000;
  };
}

function randomWeirdString(rng: () => number, length: number): string {
  const alphabet = [
    'A',
    '9',
    ' ',
    '\n',
    '\r',
    '\t',
    '\u0000',
    '\u200b',
    '\u2028',
    '/',
    '\\',
    '%',
    '?',
    '&',
    '=',
    ';',
    ':',
    '<',
    '>',
    '"',
    "'",
    'Ω',
    'Ж',
    '中',
    '😀',
  ];

  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += alphabet[Math.floor(rng() * alphabet.length)] ?? 'X';
  }
  return output;
}
