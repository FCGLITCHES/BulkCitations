import { describe, expect, it } from 'vitest';
import { processV2Conversion } from './pipeline.js';
import { splitRawReferenceBlock } from './rawPdfCopy.js';

const SMALL_NUMBERED_BLOCK = [
  '1. Smith, J. A., & Doe, R. B. (2023). Neural network optimization in low-resource environments. Journal of Artificial Intelligence Research, 45(2), 112-128. doi.org',
  '   2. Chen, L., Wang, X., & Liu, Y. (2022). Impact of urban green spaces on mental health: A longitudinal study. Environmental Health Perspectives, 130(4), 047005. doi.org',
  '   3. Kennedy, David. New Relations: The Refashioning of British Poetry 1980-1994. Bridgend: Seren, 1996.',
].join('\n');

const MIXED_NUMBERED_BULK_BLOCK = [
  '1. Smith, J. A., & Doe, R. B. (2023). Neural network optimization in low-resource environments. Journal of Artificial Intelligence Research, 45(2), 112-128. doi.org',
  '   2. Chen, L., Wang, X., & Liu, Y. (2022). Impact of urban green spaces on mental health: A longitudinal study. Environmental Health Perspectives, 130(4), 047005. doi.org',
  '   3. Rodriguez, M. S. (2021). The role of micro-LEDs in next-generation display technology. Advanced Optical Materials, 9(15), 2100456. doi.org',
  '   4. Thompson, K., & Williams, P. (2024). Re-evaluating the Bretton Woods system in a digital economy. Global Economic Review, 53(1), 15-39. doi.org',
  '   5. Nakamura, H. (2020). Quantum entanglement in macroscopic systems. Nature Physics, 16(8), 814-820. doi.org',
  '   6. Gupta, V., & Miller, S. T. (2022). Genomic sequencing and the future of personalized oncology. The Lancet Oncology, 23(11), e512-e524. doi.org',
  '   7. Patel, A. R. (2023). Blockchain applications in secure supply chain management. International Journal of Production Economics, 255, 108682. doi.org',
  '   8. Lee, S. Y., & Kim, Y. J. (2021). Linguistic patterns in social media communication during global crises. Journal of Pragmatics, 178, 145-160. doi.org',
  '   9. Foster, G. L., Hull, P. M., Lunt, D. J., & Zachos, J. C. (2022). Ocean acidification rates in the North Atlantic over the last millennium. Paleoceanography and Paleoclimatology, 37(3), e2021PA004354. doi.org',
  '   10. Brown, E. (2024). Ethics of autonomous vehicle decision-making frameworks. Ethics and Information Technology, 26(1), 12. doi.org',
  '   11. Bellur, S., Nowak, K. L., & Hull, K. S. (2015). Make it our time: In class multitaskers have lower academic performance. Computers in Human Behavior, 53, 63-70. doi.org',
  '   12. Kennedy, David. New Relations: The Refashioning of British Poetry 1980-1994. Bridgend: Seren, 1996.',
].join('\n');

describe('v2 numbered bibliography splitting', () => {
  it('splits indented numbered bibliography lines into separate raw chunks', () => {
    const chunks = splitRawReferenceBlock(SMALL_NUMBERED_BLOCK, []);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.rawChunk).toMatch(/^1\.\s+Smith,/);
    expect(chunks[1]?.rawChunk).toMatch(/^2\.\s+Chen,/);
    expect(chunks[2]?.rawChunk).toMatch(/^3\.\s+Kennedy,/);
  });

  it('keeps mixed numbered bulk references separated through the full pipeline', async () => {
    const { response } = await processV2Conversion({
      sourceType: 'text',
      content: MIXED_NUMBERED_BULK_BLOCK,
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: true,
    });

    expect(response.stats.input_count).toBe(12);
    expect(response.citations).toHaveLength(12);
    expect(response.citations[0]?.raw).toMatch(/^1\.\s+Smith,/);
    expect(response.citations[11]?.raw).toMatch(/^12\.\s+Kennedy,/);
    expect(response.debug?.citations[0]?.stages.split).toBeTruthy();
  });
});
