import { stdin as input } from 'node:process';
import { createDefaultAdapters } from '../server/engine/v2/adapters.ts';
import { CitationParser } from '../server/engine/citationParser.js';
import { fixUnicodeText } from '../server/engine/v2/utils.js';

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

async function main(): Promise<void> {
  const rawInput = parseArg('--input') ?? await readStdin();
  if (!rawInput) {
    throw new Error('Pass --input "<citation>" or pipe a citation into stdin.');
  }

  const inputStyle = parseArg('--style') ?? 'auto';
  const detectionConfidenceArg = parseArg('--confidence');
  const detectionConfidence = detectionConfidenceArg ? Number.parseFloat(detectionConfidenceArg) : undefined;
  const debugEnabled = /^(1|true|yes|on)$/i.test(parseArg('--debug') ?? 'true');
  const parser = new CitationParser();
  const preparedInput = parser.preNormalize(fixUnicodeText(rawInput));

  const { extractor } = createDefaultAdapters();
  const result = await extractor.extract(rawInput, inputStyle, {
    debugEnabled,
    detectionConfidence,
  });

  console.log(JSON.stringify({
    rawInput,
    preparedInput,
    inputStyle,
    detectionConfidence,
    detectedStyle: result.detectedStyle,
    selectedBranch: result.selectedBranch,
    selectionReason: result.selectionReason,
    selectorMode: result.selectorMode,
    selectionMode: result.selectionMode,
    winnerAdapterId: result.winnerAdapterId,
    winnerCandidateId: result.winnerCandidateId,
    typeResolutionReason: result.typeResolutionReason,
    extractorPath: result.extractorPath,
    referenceType: result.referenceType,
    parsed: result.parsed,
    warnings: result.warnings,
    fieldConfidence: result.fieldConfidence,
    canonicalAuthors: result.canonicalAuthors,
    debug: result.debug,
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
