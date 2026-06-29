import { describe, expect, it } from 'vitest';
import { phase3StyleDetect } from '../../../src/engine/phases/phase3StyleDetect.js';
import { phase4Extract } from '../../../src/engine/phases/phase4Extract.js';
import { createTestPipelineContext } from '../../helpers/createPipelineContext.js';
import { makeRawBlock } from '../../helpers/makeRawBlock.js';

describe('carrier.style immutability', () => {
  it('freezes carrier.style after phase 3 and preserves it through downstream phases', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [makeRawBlock('Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.')],
      ctx,
    );

    const carrier = carriers[0]!;
    const originalStyle = carrier.style;

    expect(() => {
      (carrier as { style: unknown }).style = {
        primary: { style: 'mla9', confidence: 1 },
        secondary: null,
        isUnknown: false,
        isMultiStyle: false,
      };
    }).toThrow();

    carriers = await phase4Extract.run(carriers, ctx);
    expect(carriers[0]!.style).toEqual(originalStyle);
  });
});
