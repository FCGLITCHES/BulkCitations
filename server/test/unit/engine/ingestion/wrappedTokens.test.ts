import { describe, expect, it } from 'vitest';
import { joinWrappedDoiLines, joinWrappedUrlLines } from '../../../../src/engine/ingestion/wrappedTokens.js';

describe('wrappedTokens', () => {
  it('joins true single-token DOI continuations across lines', () => {
    const text = [
      'Smith J. Example study. Nat Commun. 2022, 13: 10.1038/s41467-022-',
      '29268-7',
    ].join('\n');

    expect(joinWrappedDoiLines(text)).toContain('10.1038/s41467-022-29268-7');
  });

  it('joins DOI continuations when the break happens immediately after the slash', () => {
    const text = [
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. doi:10.1000/',
      'example-study',
    ].join('\n');

    expect(joinWrappedDoiLines(text)).toContain('doi:10.1000/example-study');
  });

  it('does not fuse DOI lines with footer text that merely starts with a year', () => {
    const text = [
      '3. Sapoval N, Aghazadeh A, Nute MG, et al.: Current progress and open challenges for applying deep learning',
      'across the biosciences. Nat Commun. 2022, 13: 10.1038/s41467-022-29268-7',
      '2023 Singh et al. Cureus 15(8): e44359. DOI 10.7759/cureus.44359 15 of 17',
    ].join('\n');

    const result = joinWrappedDoiLines(text);

    expect(result).toContain('10.1038/s41467-022-29268-7\n2023 Singh et al. Cureus');
  });

  it('joins true single-token URL continuations without crossing into numbered content', () => {
    const text = [
      'Available at https://example.com/articles/very-long-',
      'path',
      '2. Next citation starts here.',
    ].join('\n');

    const result = joinWrappedUrlLines(text);

    expect(result).toContain('https://example.com/articles/very-long-path');
    expect(result).toContain('\n2. Next citation starts here.');
  });
});
