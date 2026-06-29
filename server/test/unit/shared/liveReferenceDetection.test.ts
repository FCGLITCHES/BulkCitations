import { describe, expect, it } from 'vitest';
import { countEngineLikeInputReferences } from '../../../../frontend/shared/liveReferenceDetection.js';

describe('countEngineLikeInputReferences', () => {
  it('counts AMA-style 1. … lines, not only [n] lines', () => {
    const text = `References
1. Jiménez-Luna J, Grisoni F, Weskamp N, Schneider G: Artificial intelligence in drug discovery: recent
advances and future perspectives. Expert Opin Drug Discov. 2021, 16:949-59.
10.1080/17460441.2021.1909567

2. Paul D, Sanap G, Shenoy S, Kalyane D, Kalia K, Tekade RK: Artificial intelligence in drug discovery and
development. Drug Discov Today. 2021, 26:80-93. 10.1016/j.drudis.2020.10.010

3. Sapoval N, Aghazadeh A, Nute MG, et al.: Current progress and open challenges for applying deep learning
across the biosciences. Nat Commun. 2022, 13: 10.1038/s41467-022-29268-7
`;
    expect(countEngineLikeInputReferences(text)).toBeGreaterThanOrEqual(3);
  });

  it('counts bracket [n] lines in a second list', () => {
    const text = `[1] Whitley D, A genetic algorithm tutorial, Statistics and computing, 1994 Jun 1;4(2):65-85. 
[2] Goldberg DE, Holland JH, Genetic algorithms and machine learning, 1988. 
`;
    expect(countEngineLikeInputReferences(text)).toBeGreaterThanOrEqual(2);
  });

  it('returns at least 1 for a single unstructured paragraph', () => {
    expect(countEngineLikeInputReferences('Smith, J. (2020). Example. Journal of Examples, 12(3), 44-50.')).toBe(1);
  });
});
