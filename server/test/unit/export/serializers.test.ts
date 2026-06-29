import { describe, expect, it } from 'vitest';
import { splitItalicSegments } from '../../../src/export/serializers.js';

describe('splitItalicSegments', () => {
  it('recognizes current asterisk italics and legacy underscore italics', () => {
    expect(splitItalicSegments('Alpha *Journal of Examples* and _Legacy Volume_ text.')).toEqual([
      { text: 'Alpha ', italic: false },
      { text: 'Journal of Examples', italic: true },
      { text: ' and ', italic: false },
      { text: 'Legacy Volume', italic: true },
      { text: ' text.', italic: false },
    ]);
  });

  it('leaves plain text untouched when no italic markers are present', () => {
    expect(splitItalicSegments('Plain rendered citation text.')).toEqual([
      { text: 'Plain rendered citation text.', italic: false },
    ]);
  });
});
