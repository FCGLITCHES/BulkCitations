import { describe, expect, it } from 'vitest';
import { phase7Normalize } from '../../../../src/engine/phases/phase7Normalize.js';
import { phase10Score } from '../../../../src/engine/phases/phase10Score.js';
import { Phase11Authority } from '../../../../src/engine/phases/phase11Authority.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';
import { runThroughPhase6 } from '../../../helpers/runSprint2Core.js';

describe('Phase11Authority', () => {
  it('isolates checker failures to the affected reference', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const first = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
    );
    const second = await runThroughPhase6(
      'Doe, A. (2021). Second study. Example Review, 9(1), 1-10.',
    );
    second.carrier.index = 1;

    await phase7Normalize.run([first.carrier, second.carrier], ctx);
    await phase10Score.run([first.carrier, second.carrier], ctx);

    const phase = new Phase11Authority({
      check: async (carrier) => {
        if (carrier.raw.includes('Second study')) {
          throw new Error('authority service unavailable');
        }
        return {
          checked: true,
          flags: [],
          scoreAdjustment: 0,
        };
      },
    });

    await phase.run([first.carrier, second.carrier], ctx);

    expect(first.carrier.authority.checked).toBe(true);
    expect(second.carrier.authority.checked).toBe(false);
    expect(second.carrier.publicStatus).not.toBe('failed');
  });

  it('stops remote authority checks when the phase budget is exhausted', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';
    ctx.performanceBudgets.authority_validation = 1;

    const first = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
    );

    await phase7Normalize.run([first.carrier], ctx);
    await phase10Score.run([first.carrier], ctx);

    const phase = new Phase11Authority({
      check: async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        return {
          checked: true,
          flags: [],
          scoreAdjustment: 0,
        };
      },
    });

    await phase.run([first.carrier], ctx);

    expect(first.carrier.authority.checked).toBe(false);
    expect(ctx.stageLog.at(-1)?.message).toContain('latency budget');
  });
});
