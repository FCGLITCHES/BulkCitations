import { describe, expect, it } from 'vitest';
import { phase9Dedup } from '../../../../src/engine/phases/phase9Dedup.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';
import { runThroughPhase6 } from '../../../helpers/runSprint2Core.js';

describe('Phase9Dedup', () => {
  it('clusters exact DOI duplicates without dropping either citation', async () => {
    const ctx = createTestPipelineContext();
    const first = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. doi:10.1000/example-study',
    );
    const second = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. doi:10.1000/example-study',
    );

    second.carrier.index = 1;
    await phase9Dedup.run([first.carrier, second.carrier], ctx);

    expect(first.carrier.duplicateOf).toBeUndefined();
    expect(first.carrier.isDuplicateCandidate).toBe(true);
    expect(second.carrier.duplicateOf).toBe(first.carrier.id);
    expect(second.carrier.duplicateReason).toBe('doi_exact');
  });
});
