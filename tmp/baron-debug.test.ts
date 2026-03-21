import { describe, it } from 'vitest';
import { processV2Conversion } from '../server/engine/v2/pipeline.js';

describe('baron debug', () => {
  it('logs rendered outputs for mixed Baron/Kenny variants', async () => {
    const references = [
      'Baron, ReubenM. and Kenny, DavidA., 1986. The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.. Journal of Personality and Social Psychology, 51(6), pp.1173-1182.',
      'Baron, Reuben M., and David A. Kenny. "The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.." Journal of Personality and Social Psychology, vol. 51, no. 6, 1986, pp. 1173-1182.',
      'Baron, Reuben M., and David A. Kenny. "The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.." Journal of Personality and Social Psychology 51, no. 6 (1986): 1173-1182.',
      'Baron, Reuben M., & Kenny, David A. (1986). The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.. Journal of Personality and Social Psychology, 51(6), 1173-1182.',
      'Reuben M. Baron and David A. Kenny, "The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.," Journal of Personality and Social Psychology, vol. 51, no. 6, pp. 1173-1182, 1986.',
      'Baron RM, Kenny DA. The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.. Journal of Personality and Social Psychology. 1986;51(6):1173-1182.',
    ];

    const { response } = await processV2Conversion({
      sourceType: 'text',
      content: references.join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: true,
    });

    for (const citation of response.citations) {
      console.log(JSON.stringify({
        raw: citation.raw,
        selectedBranch: citation.extraction?.selectedBranch,
        authorParserMode: citation.extraction?.authorParserMode,
        authors: citation.authors.value,
        rendered: citation.rendered?.formatted,
      }, null, 2));
    }
  });
});
