import { describe, expect, it } from 'vitest';

import { parseAuthorSegment } from '../../../src/engine/utils/authors.js';

describe('author parsing utilities', () => {
  it('parses leading family-given pairs followed by standalone full names', () => {
    expect(
      parseAuthorSegment(
        'Bairros, Thiago, Alessandro Paulo de Oliveira, Rausley Adriano Amaral de Souza, Yacoub, Michel Daoud',
      ),
    ).toEqual([
      expect.objectContaining({ family: 'Bairros', given: 'Thiago' }),
      expect.objectContaining({ family: 'de Oliveira', given: 'Alessandro Paulo' }),
      expect.objectContaining({ family: 'de Souza', given: 'Rausley Adriano Amaral' }),
      expect.objectContaining({ family: 'Yacoub', given: 'Michel Daoud' }),
    ]);
  });

  it('parses initials-first authors with multiword surnames', () => {
    expect(
      parseAuthorSegment(
        'C. Gomes Casagrande, D. Pereira Pinto, Á. Gotelip Tostes Costalonga, B. Juliano Agostinho, and M. de Loreto Cury Ferreira',
      ),
    ).toEqual([
      expect.objectContaining({ family: 'Casagrande', given: 'C. Gomes' }),
      expect.objectContaining({ family: 'Pinto', given: 'D. Pereira' }),
      expect.objectContaining({ family: 'Gotelip Tostes Costalonga', given: 'Á.' }),
      expect.objectContaining({ family: 'Agostinho', given: 'B. Juliano' }),
      expect.objectContaining({ family: 'de Loreto Cury Ferreira', given: 'M.' }),
    ]);
  });

  it('parses a leading family-initial pair followed by standalone initial authors', () => {
    expect(
      parseAuthorSegment(
        'Bonhomme, C., M. Theron, E. Louaas, A. Beaurain, and E. P. Seleznev',
      ),
    ).toEqual([
      expect.objectContaining({ family: 'Bonhomme', given: 'C.' }),
      expect.objectContaining({ family: 'Theron', given: 'M.' }),
      expect.objectContaining({ family: 'Louaas', given: 'E.' }),
      expect.objectContaining({ family: 'Beaurain', given: 'A.' }),
      expect.objectContaining({ family: 'Seleznev', given: 'E P', initials: 'E. P.' }),
    ]);
  });

  it('keeps surname particles attached to the family name', () => {
    expect(parseAuthorSegment('M. Paulo Santos da Silva and C. de Paula Martins')).toEqual([
      expect.objectContaining({ family: 'Paulo Santos da Silva', given: 'M.' }),
      expect.objectContaining({ family: 'de Paula Martins', given: 'C.' }),
    ]);
  });

  it('parses uppercase family-given leads followed by standalone uppercase authors', () => {
    expect(
      parseAuthorSegment(
        'FERREIRA, THAIS ANGELICA CARDOSO, BELMIRO CARDOSO DE OLVEIRA, and PEDRO HENRIQUE ALVES LEITÃO',
      ),
    ).toEqual([
      expect.objectContaining({ family: 'FERREIRA', given: 'THAIS ANGELICA CARDOSO' }),
      expect.objectContaining({ family: 'DE OLVEIRA', given: 'BELMIRO CARDOSO' }),
      expect.objectContaining({ family: 'LEITÃO', given: 'PEDRO HENRIQUE ALVES' }),
    ]);
  });

  it('parses trailing particle family spans in standalone conference author lists', () => {
    expect(parseAuthorSegment('Cátia de Paula Martins')).toEqual([
      expect.objectContaining({ family: 'de Paula Martins', given: 'Cátia' }),
    ]);
    expect(parseAuthorSegment('Mariah de Loreto Cury Ferreira')).toEqual([
      expect.objectContaining({ family: 'de Loreto Cury Ferreira', given: 'Mariah' }),
    ]);
  });
});
