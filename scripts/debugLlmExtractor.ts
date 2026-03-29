import 'dotenv/config';
import fs from 'node:fs';
import { stdin as input } from 'node:process';
import { createDefaultAdapters } from '../server/engine/v2/adapters.js';

function parseArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function splitCitations(raw: string): string[] {
  return raw
    .split(/\r?\n\s*\r?\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const rawInput = parseArg('--input') ?? await readStdin();
  if (!rawInput) {
    throw new Error('Pass --input "<citations>" or pipe blank-line separated citations into stdin.');
  }

  const replayPath = parseArg('--replay');
  const temperature = parseArg('--temperature') ?? '0';
  const outputStyle = parseArg('--output-style') ?? 'apa';
  const forcedStyle = parseArg('--style');

  process.env.ENABLE_LLM_EXTRACTOR = 'true';
  process.env.V2_LLM_EXTRACT_TEMPERATURE = temperature;
  if (replayPath) {
    if (!fs.existsSync(replayPath)) {
      throw new Error(`Replay file not found: ${replayPath}`);
    }
    process.env.V2_LLM_EXTRACT_REPLAY_FILE = replayPath;
  } else {
    delete process.env.V2_LLM_EXTRACT_REPLAY_FILE;
  }

  const citations = splitCitations(rawInput);
  const { extractor, classifier } = createDefaultAdapters();

  const entries = [];
  for (const [index, citation] of citations.entries()) {
    const detected = forcedStyle
      ? { style: forcedStyle, confidence: 1 }
      : await classifier.detectStyle(citation);
    const result = await extractor.extract(citation, detected.style ?? 'auto', {
      detectionConfidence: detected.confidence,
      batchSize: citations.length,
      executionMode: 'sync',
      debugEnabled: true,
      outputStyle,
      originalRawText: citation,
      engineVersion: 'v2',
    });

    entries.push({
      index: index + 1,
      raw: citation,
      detectedStyle: detected.style,
      detectedConfidence: detected.confidence,
      extractorPath: result.extractorPath,
      referenceType: result.referenceType,
      llm: {
        attempted: Boolean(result.llmFallbackAttempted),
        accepted: Boolean(result.llmFallbackAccepted),
        skippedByBudget: Boolean(result.llmFallbackSkippedByBudget),
        reusedFromCluster: Boolean(result.llmFallbackReusedFromCluster),
        skippedForTruth: Boolean(result.llmFallbackSkippedForTruth),
        verificationNeeded: Boolean(result.llmFallbackVerificationNeeded),
        reason: result.llmFallbackReason ?? null,
        cacheKey: result.llmFallbackCacheKey ?? null,
        clusterKey: result.llmFallbackClusterKey ?? null,
        queuePriority: result.llmFallbackQueuePriority ?? null,
        attemptErrorType: result.llmFallbackAttemptErrorType ?? null,
        fieldsImproved: result.llmFallbackFieldsImproved ?? [],
      },
      parsed: result.parsed,
      debug: result.debug ?? {},
    });
  }

  console.log(JSON.stringify({
    mode: 'extractor_debug',
    replayMode: replayPath ? 'file' : 'live',
    replayPath: replayPath ?? null,
    temperature: Number.parseFloat(temperature),
    outputStyle,
    citationCount: citations.length,
    entries,
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
