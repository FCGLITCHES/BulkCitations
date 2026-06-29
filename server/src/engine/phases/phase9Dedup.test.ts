import { describe, expect, it } from 'vitest';
import { fieldOf } from '../types/field.js';
import { buildReferenceCarrier } from '../utils/carriers.js';
import type { StyleDetectionResult } from '../types/carrier.js';
import { createPipelineContext } from '../../pipeline/orchestrator.js';
import { phase9Dedup } from './phase9Dedup.js';

function baseStyle(): StyleDetectionResult {
  return {
    primary: { style: 'apa7', confidence: 0.9 },
    secondary: null,
    family: 'author_date',
    familyConfidence: 0.9,
    styleConfidence: 0.9,
    familyMarginToRunnerUp: 0.5,
    styleMarginToRunnerUp: 0.5,
    certaintyTier: 'high',
    styleCandidates: [{ style: 'apa7', score: 0.9 }],
    familyCandidates: [{ family: 'author_date', score: 0.9 }],
    signals: [],
    conflictDampened: false,
    isUnknown: false,
    isMultiStyle: false,
  };
}

function makeCarrier(index: number, raw: string, title: string): ReturnType<typeof buildReferenceCarrier> {
  const carrier = buildReferenceCarrier({
    index,
    text: raw,
    splitMethod: 'numbered',
    splitConfidence: 1,
    isDoiResolved: false,
    flags: [],
  }, baseStyle(), undefined, 'apa7');

  carrier.fields.authors = fieldOf([{
    family: 'Smith',
    given: 'J.',
    initials: 'J',
    isCorporate: false,
  }], 'ingestion', 'phase9Dedup.test', 1);
  carrier.fields.title = fieldOf(title, 'ingestion', 'phase9Dedup.test', 1);
  carrier.fields.year = fieldOf(2020, 'ingestion', 'phase9Dedup.test', 1);
  carrier.scoring.rawScore = 80 - index;
  carrier.publicStatus = 'ready';
  return carrier;
}

describe('phase9 dedup strict controls', () => {
  it('flags exact duplicates via normalizedHash before fuzzy clustering', async () => {
    const carrierA = makeCarrier(
      0,
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
      'Example study',
    );
    const carrierB = makeCarrier(
      1,
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
      'Example study',
    );

    const ctx = createPipelineContext({ outputStyle: 'apa7', options: { dedup: true } });
    const result = await phase9Dedup.run([carrierA, carrierB], ctx);
    const duplicate = result.find((carrier) => carrier.duplicateOf);

    expect(duplicate?.duplicateReason).toBe('normalized_hash');
    expect(result.every((carrier) => typeof carrier.normalizedHash === 'string' && carrier.normalizedHash.length > 0)).toBe(true);
    expect(result.every((carrier) => typeof carrier.nearDupClusterId === 'string' && carrier.nearDupClusterId.length > 0)).toBe(true);
  });

  it('flags structured variants via canonicalWorkKey', async () => {
    const carrierA = makeCarrier(
      0,
      'Smith, J. (2020). Example study on AI reliability. Journal of Examples, 12(3), 44-50.',
      'Example study on AI reliability',
    );
    const carrierB = makeCarrier(
      1,
      'Smith J (2020) Example study on AI reliability Journal of Examples 12(3):44-50',
      'Example study on AI reliability',
    );

    const ctx = createPipelineContext({ outputStyle: 'apa7', options: { dedup: true } });
    const result = await phase9Dedup.run([carrierA, carrierB], ctx);
    const duplicate = result.find((carrier) => carrier.duplicateOf);

    expect(duplicate?.duplicateReason).toBe('canonical_work_key');
    expect(result.every((carrier) => typeof carrier.canonicalWorkKey === 'string' && carrier.canonicalWorkKey.length > 0)).toBe(true);
  });
});

