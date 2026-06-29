import { describe, expect, it } from 'vitest';
import { synthesizeCandidateEnvelope } from '../../../src/engine/reliability.js';
import { buildReferenceCarrier } from '../../../src/engine/utils/carriers.js';
import { fieldOf } from '../../../src/engine/types/field.js';
import type { StyleDetectionResult } from '../../../src/engine/types/carrier.js';

const STYLE_RESULT: StyleDetectionResult = {
  primary: { style: 'apa7', confidence: 0.99 },
  secondary: null,
  family: 'author_date',
  familyConfidence: 0.99,
  styleConfidence: 0.99,
  familyMarginToRunnerUp: 0.99,
  styleMarginToRunnerUp: 0.99,
  certaintyTier: 'high',
  familyCandidates: [{ family: 'author_date', score: 0.99 }],
  styleCandidates: [{ style: 'apa7', score: 0.99 }],
  signals: [],
  conflictDampened: false,
  isUnknown: false,
  isMultiStyle: false,
};

describe('reliability candidate envelope', () => {
  it('includes extraction entities as candidate-envelope inputs', () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      STYLE_RESULT,
      undefined,
      'apa7',
    );

    carrier.fields.title = fieldOf('Example study', 'regex_fallback', 'phase4_extraction', 0.92);
    carrier.extractionMeta = {
      modelVersion: 'heuristic',
      featureVersion: 'phase4-test',
      styleUsed: 'apa7',
      overallConfidence: 0.92,
      fieldConfidences: { conferenceTitle: 0.91, doi: 0.95 },
      uncertainFields: [],
      runMode: 'heuristic',
      timestamp: new Date().toISOString(),
      entities: [
        {
          field: 'conferenceTitle',
          tokenStart: 6,
          tokenEnd: 10,
          text: 'Proceedings of ExampleConf 2024',
          confidence: 0.91,
          valid: true,
        },
        {
          field: 'doi',
          tokenStart: 11,
          tokenEnd: 12,
          text: '10.1000/example',
          confidence: 0.95,
          valid: true,
        },
      ],
    };

    const envelope = synthesizeCandidateEnvelope(carrier);

    expect(envelope.conferenceCandidates.some((candidate) =>
      candidate.text === 'Proceedings of ExampleConf 2024'
      && candidate.provenance === 'extraction_entity:heuristic'
    )).toBe(true);
    expect(envelope.identifierCandidates.some((candidate) =>
      candidate.text === '10.1000/example'
      && candidate.provenance === 'extraction_entity:heuristic'
    )).toBe(true);
  });
});
