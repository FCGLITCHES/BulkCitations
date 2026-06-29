import { describe, expect, it } from 'vitest';
import { buildReferenceCarrier } from '../../../../src/engine/utils/carriers.js';
import { phase10Health } from '../../../../src/engine/phases/phase10Health.js';
import { phase3StyleDetect } from '../../../../src/engine/phases/phase3StyleDetect.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';
import { makeRawBlock } from '../../../helpers/makeRawBlock.js';

describe('uncertainty cascade', () => {
  it('Phase 10 adds low_split_quality warning when splitQualityFlag is low', async () => {
    const ctx = createTestPipelineContext();
    const block = makeRawBlock(
      'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. doi:10.1000/xyz123',
    );
    let carriers = await phase3StyleDetect.run([block], ctx);
    const carrier = carriers[0]!;

    (carrier as any).detection = {
      confidence: 0.80,
      splitQualityFlag: 'low',
      sampled: false,
    };

    carriers = await phase10Health.run(carriers, ctx);

    const warningCodes = carrier.health.warnings.map((w) => w.code);
    expect(warningCodes).toContain('low_split_quality');
  });

  it('Phase 10 adds uncertain_detection warning when confidence is below 0.60', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'auto';
    const block = makeRawBlock(
      'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. doi:10.1000/xyz123',
    );
    const carrier = buildReferenceCarrier(
      block,
      {
        primary: { style: 'unknown', confidence: 0.45, method: 'heuristic' },
        isMultiStyle: false,
        isUnknown: true,
      },
      {
        confidence: 0.45,
        splitQualityFlag: 'ok',
        sampled: false,
      },
      'auto',
    );

    let carriers = [carrier];
    (carrier as any).detection = {
      confidence: 0.45,
      splitQualityFlag: 'ok',
      sampled: false,
    };

    carriers = await phase10Health.run(carriers, ctx);

    const warningCodes = carrier.health.warnings.map((w) => w.code);
    expect(warningCodes).toContain('uncertain_detection');
  });

  it('Phase 10 adds sampled_detection info when detection was sampled', async () => {
    const ctx = createTestPipelineContext();
    const block = makeRawBlock(
      'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. doi:10.1000/xyz123',
    );
    let carriers = await phase3StyleDetect.run([block], ctx);
    const carrier = carriers[0]!;

    (carrier as any).detection = {
      confidence: 0.90,
      splitQualityFlag: 'ok',
      sampled: true,
    };

    carriers = await phase10Health.run(carriers, ctx);

    const warningCodes = carrier.health.warnings.map((w) => w.code);
    expect(warningCodes).toContain('sampled_detection');
  });

  it('Phase 10 does not add uncertain_detection warning when confidence is high', async () => {
    const ctx = createTestPipelineContext();
    const block = makeRawBlock(
      'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. doi:10.1000/xyz123',
    );
    let carriers = await phase3StyleDetect.run([block], ctx);
    const carrier = carriers[0]!;

    (carrier as any).detection = {
      confidence: 0.95,
      splitQualityFlag: 'ok',
      sampled: false,
    };

    carriers = await phase10Health.run(carriers, ctx);

    const detectionWarnings = carrier.health.warnings.filter(
      (w) => ['uncertain_detection', 'low_split_quality'].includes(w.code),
    );
    expect(detectionWarnings).toHaveLength(0);
  });

  it('carrier with low detection confidence is flagged for render fallback check', () => {
    const block = makeRawBlock(
      'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. doi:10.1000/xyz123',
    );
    const style = {
      primary: { style: 'apa7' as const, confidence: 0.9, method: 'heuristic' as const },
      isMultiStyle: false,
      isUnknown: false,
    };
    const carrier = buildReferenceCarrier(block, style, {
      confidence: 0.40,
      splitQualityFlag: 'ok',
      sampled: false,
    });

    const detectionUncertain = carrier.detection
      && (carrier.detection.confidence < 0.60 || carrier.detection.splitQualityFlag !== 'ok');
    expect(detectionUncertain).toBe(true);
  });

  it('carrier with low split quality is flagged for render fallback check', () => {
    const block = makeRawBlock(
      'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. doi:10.1000/xyz123',
    );
    const style = {
      primary: { style: 'apa7' as const, confidence: 0.9, method: 'heuristic' as const },
      isMultiStyle: false,
      isUnknown: false,
    };
    const carrier = buildReferenceCarrier(block, style, {
      confidence: 0.90,
      splitQualityFlag: 'low',
      sampled: false,
    });

    const detectionUncertain = carrier.detection
      && (carrier.detection.confidence < 0.60 || carrier.detection.splitQualityFlag !== 'ok');
    expect(detectionUncertain).toBe(true);
  });

  it('carrier with high confidence and ok split is not flagged for render fallback', () => {
    const block = makeRawBlock(
      'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. doi:10.1000/xyz123',
    );
    const style = {
      primary: { style: 'apa7' as const, confidence: 0.9, method: 'heuristic' as const },
      isMultiStyle: false,
      isUnknown: false,
    };
    const carrier = buildReferenceCarrier(block, style, {
      confidence: 0.90,
      splitQualityFlag: 'ok',
      sampled: false,
    });

    const detectionUncertain = carrier.detection
      && (carrier.detection.confidence < 0.60 || carrier.detection.splitQualityFlag !== 'ok');
    expect(detectionUncertain).toBe(false);
  });

  it('carrier.detection is populated when detectionMeta is provided to buildReferenceCarrier', () => {
    const block = makeRawBlock(
      'Smith, J. (2020). Example article. Journal of Examples.',
    );
    const style = {
      primary: { style: 'apa7' as const, confidence: 0.9, method: 'heuristic' as const },
      isMultiStyle: false,
      isUnknown: false,
    };
    const carrier = buildReferenceCarrier(block, style, {
      confidence: 0.85,
      sampled: false,
      splitQualityFlag: 'ok',
    });

    expect(carrier.detection).toBeDefined();
    expect(carrier.detection!.confidence).toBe(0.85);
    expect(carrier.detection!.splitQualityFlag).toBe('ok');
    expect(carrier.detection!.sampled).toBe(false);
  });

  it('carrier.detection uses style fallback when detectionMeta is not provided', () => {
    const block = makeRawBlock(
      'Smith, J. (2020). Example article. Journal of Examples.',
    );
    const style = {
      primary: { style: 'apa7' as const, confidence: 0.9, method: 'heuristic' as const },
      isMultiStyle: false,
      isUnknown: false,
    };
    const carrier = buildReferenceCarrier(block, style);

    expect(carrier.detection).toBeDefined();
    expect(carrier.detection!.confidence).toBe(0.9);
    expect(carrier.detection!.sampled).toBe(true);
  });
});
