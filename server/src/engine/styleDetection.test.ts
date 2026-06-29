import { describe, expect, it } from 'vitest';
import {
  detectCitationStyle,
  detectCitationStyles,
  extractStyleSignals,
  normalizeStyleInput,
} from './styleDetection.js';

describe('styleDetection', () => {
  it('normalizes unicode, whitespace, smart quotes, and superscripts before scoring', () => {
    const normalized = normalizeStyleInput(
      '  “Smith”\nA Mathematical Theory of Communication 10¹23  ',
    );

    expect(normalized).toBe('"Smith" A Mathematical Theory of Communication 10123');
  });

  it('extracts positive structural signals from numeric citations without using field extraction', () => {
    const signals = extractStyleSignals(
      '[1] A. Doe, "Circuit paper," Journal of Testing, vol. 4, no. 2, pp. 10-14, 2022.',
    );

    expect(signals.matchedSignals.has('bracketed_enumerator')).toBe(true);
    expect(signals.matchedSignals.has('quoted_title')).toBe(true);
    expect(signals.matchedSignals.has('locator_pp')).toBe(true);
  });

  it('returns family-known but exact-style-unknown when numeric evidence is insufficiently specific', () => {
    const result = detectCitationStyle(
      '1. Smith J, Doe A. Example study. J Examples. 2020, 12(3), 44-50.',
    );

    expect(result.family).toBe('numeric');
    expect(result.primary.style).toBe('unknown');
    expect(result.isUnknown).toBe(false);
  });

  it('dampens conflicted family evidence instead of overclassifying', () => {
    const result = detectCitationStyle(
      '[1] Smith, J. (2023). Example study. Journal of Examples, 12(3), 44-50.',
    );

    expect(result.family).toBe('unknown');
    expect(result.isUnknown).toBe(true);
    expect(result.conflictDampened).toBe(true);
  });

  it('does not overcommit vancouver on sparse semicolon journal spines', () => {
    const result = detectCitationStyle('Smith J. Article title. J Med. 2023;45:100.');

    expect(result.family).toBe('numeric');
    expect(result.primary.style).toBe('unknown');
    expect(result.certaintyTier).toBe('low');
  });

  it('does not overcommit apa7 on parenthesized-year author-date strings without apa punctuation cues', () => {
    const result = detectCitationStyle(
      'Smith J (2023) Article title. Journal of Medicine 45(2):100-110.',
    );

    expect(result.family).toBe('author_date');
    expect(result.primary.style).toBe('unknown');
    expect(result.certaintyTier).toBe('low');
  });

  it('marks truly mixed batches as multi-style and skips forced smoothing on tiny batches', () => {
    const results = detectCitationStyles([
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
      '[1] A. Doe, "Circuit paper," Journal of Testing, vol. 4, no. 2, pp. 10-14, 2022.',
    ]);

    expect(results.every((result) => result.isMultiStyle)).toBe(true);
  });

  describe('biomedical numeric journal spines', () => {
    const cases: Array<{ label: string; text: string }> = [
      {
        label: 'comma volume pages with doi tail',
        text: 'Paul D, Sanap G, Shenoy S, Kalyane D, Kalia K, Tekade RK: Artificial intelligence in drug discovery and development. Drug Discov Today. 2021, 26:80-93. 10.1016/j.drudis.2020.10.010',
      },
      {
        label: 'comma volume identifier with doi tail',
        text: 'Sapoval N, Aghazadeh A, Nute MG, et al.: Current progress and open challenges for applying deep learning across the biosciences. Nat Commun. 2022, 13: 10.1038/s41467-022-29268-7',
      },
      {
        label: 'single-word journal with comma spine and doi tail',
        text: 'Norrby PO: Holistic models of reaction selectivity. Nature. 2019, 571:332-3. 10.1038/d41586-019-02148-9',
      },
    ];

    it.each(cases)('commits vancouver for $label', ({ text }) => {
      const result = detectCitationStyle(text);

      expect(result.family).toBe('numeric');
      expect(result.primary.style).toBe('vancouver');
      expect(result.isUnknown).toBe(false);
    });

    it('keeps webpage-like batch entries out of vancouver despite trailing year and url', () => {
      const result = detectCitationStyle(
        'Tapping into the drug discovery potential of AI . (2021). https://www.nature.com/articles/d43747-021-00045-7.',
      );

      expect(result.primary.style).toBe('unknown');
      expect(result.family).toBe('web_accessed');
    });
  });

  describe('IEEE-like journal spine (vol./no./p. + trailing year)', () => {
    const ieeeLikeBmc =
      'C. J. Kelly, A. Karthikesalingam, M. Suleyman, G. Corrado, and D. King, "Key challenges for delivering clinical impact with artificial intelligence," BMC Medicine, vol. 17, no. 1, p. 195, 2019.';

    it('extracts locator_ieee_signature and related locators', () => {
      const signals = extractStyleSignals(ieeeLikeBmc);

      expect(signals.matchedSignals.has('locator_vol')).toBe(true);
      expect(signals.matchedSignals.has('locator_no')).toBe(true);
      expect(signals.matchedSignals.has('locator_pp')).toBe(true);
      expect(signals.matchedSignals.has('locator_ieee_signature')).toBe(true);
      expect(signals.signalGroups.size).toBeGreaterThanOrEqual(3);
    });

    it('detects numeric family and ieee (not unknown)', () => {
      const result = detectCitationStyle(ieeeLikeBmc);

      expect(result.family).toBe('numeric');
      expect(result.primary.style).toBe('ieee');
      expect(result.isUnknown).toBe(false);
    });
  });

  describe('APA vs IEEE (author-date year, no terminal publication year)', () => {
    const apaJournalArticle =
      'Gomes, M.A.S., Kovaleski, J.L., Pagani, R.N. and da Silva, V.L., 2022. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology, 46(7), pp.608-616.';

    it('flags ieee-incompatible year placement', () => {
      const signals = extractStyleSignals(apaJournalArticle);

      expect(signals.matchedSignals.has('ieee_incompatible_author_date_year_placement')).toBe(true);
      expect(signals.matchedSignals.has('locator_ieee_signature')).toBe(false);
    });

    it('detects author_date apa7, not numeric/ieee', () => {
      const result = detectCitationStyle(apaJournalArticle);

      expect(result.family).toBe('author_date');
      expect(result.primary.style).toBe('apa7');
      expect(result.isUnknown).toBe(false);
    });
  });

  /** Aligned with mixed-format demo batch (curriculum reference table). */
  describe('curriculum sample lines', () => {
    const cases: Array<{ label: string; text: string; family: string; style: string }> = [
      {
        label: 'Gomes v1',
        text: 'Gomes, M.A.S., Kovaleski, J.L., Pagani, R.N. and da Silva, V.L., 2022. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology, 46(7), pp.608-616.',
        family: 'author_date',
        style: 'apa7',
      },
      {
        label: 'Gomes v2',
        text: 'Gomes MA, Kovaleski JL, Pagani RN, da Silva VL. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology. 2022 Oct 3;46(7):608-16.',
        family: 'numeric',
        style: 'vancouver',
      },
      {
        label: 'Adams',
        text: 'Adams, K. L., and R. Chen. "A survey of graph neural networks in medicine." Journal of Medical Informatics, vol. 51, no. 2, 2022, pp. 101-119.',
        family: 'notes_bibliography',
        style: 'mla9',
      },
      {
        label: 'McCoy',
        text: 'McCoy, L. G., Banja, J. D., Ghassemi, M., & Celi, L. A. (2020). Ensuring machine learning for healthcare works for all. BMJ Health & Care Informatics, 27(3), e100237.',
        family: 'author_date',
        style: 'apa7',
      },
      {
        label: 'Shailaja',
        text: 'Shailaja K, Seetharamulu B, Jabbar MA. Machine learning in healthcare: A review. In 2018 Second International Conference on Electronics, Communication and Aerospace Technology (ICECA) 2018 Mar 29 (pp. 910-914). IEEE.',
        family: 'numeric',
        style: 'ama',
      },
      {
        label: 'Rajkomar',
        text: 'Rajkomar A, Dean J, Kohane I. Machine learning in medicine. New England Journal of Medicine. 2019;380(14):1347-1358.',
        family: 'numeric',
        style: 'vancouver',
      },
      {
        label: 'Topol',
        text: 'Topol, Eric. "High-performance medicine: the convergence of human and artificial intelligence." Nature Medicine 25, no. 1 (2019): 44-56.',
        family: 'notes_bibliography',
        style: 'chicago-notes-bib',
      },
      {
        label: 'Esteva',
        text: 'Esteva A, Kuprel B, Novoa RA, Ko J, Swetter SM, Blau HM, Thrun S. Dermatologist-level classification of skin cancer with deep neural networks. Nature. 2017 Feb 2;542(7639):115-118.',
        family: 'numeric',
        style: 'vancouver',
      },
      {
        label: 'Obermeyer',
        text: 'Obermeyer, Ziad, and Ezekiel J. Emanuel. "Predicting the future-big data, machine learning, and clinical medicine." The New England Journal of Medicine 375, no. 13 (2016): 1216-1219.',
        family: 'notes_bibliography',
        style: 'chicago-notes-bib',
      },
      {
        label: 'Kelly',
        text: 'C. J. Kelly, A. Karthikesalingam, M. Suleyman, G. Corrado, and D. King, "Key challenges for delivering clinical impact with artificial intelligence," BMC Medicine, vol. 17, no. 1, p. 195, 2019.',
        family: 'numeric',
        style: 'ieee',
      },
    ];

    it.each(cases)('$label → $family / $style', ({ text, family, style }) => {
      const r = detectCitationStyle(text);
      expect(r.family).toBe(family);
      expect(r.primary.style).toBe(style);
    });
  });

  describe('webpage exact-style commits', () => {
    const cases: Array<{ label: string; text: string; family: string; style: string }> = [
      {
        label: 'apa title-first rfc webpage',
        text: 'Export of UDP Options Information in IP Flow Information Export (IPFIX). (2025). RFC Editor. https://www.rfc-editor.org/rfc/rfc9870.html',
        family: 'author_date',
        style: 'apa7',
      },
      {
        label: 'apa corporate rfc webpage',
        text: 'Internet Engineering Task Force. (2018). The Transport Layer Security (TLS) Protocol Version 1.3. Internet Engineering Task Force. RFC Editor. https://www.rfc-editor.org/rfc/rfc8446',
        family: 'author_date',
        style: 'apa7',
      },
      {
        label: 'mla rfc webpage',
        text: 'Internet Engineering Task Force. "The Transport Layer Security (TLS) Protocol Version 1.3." Internet Engineering Task Force, RFC Editor, 2018, https://www.rfc-editor.org/rfc/rfc8446.',
        family: 'notes_bibliography',
        style: 'mla9',
      },
      {
        label: 'vancouver enumerated webpage',
        text: '[1]Mozilla Contributors. Array.prototype.map(). MDN Web Docs 2024. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map',
        family: 'numeric',
        style: 'vancouver',
      },
      {
        label: 'apa bracketed thesis with doi',
        text: 'Botter Junior, W. (2021). Relações interfaciais de poli(dimetilsiloxano) com sólidos inorgânicos. [Dissertation, Universidade Estadual de Campinas]. https://doi.org/10.47749/t/unicamp.1997.133750',
        family: 'author_date',
        style: 'apa7',
      },
    ];

    it.each(cases)('$label → $family / $style', ({ text, family, style }) => {
      const result = detectCitationStyle(text);

      expect(result.family).toBe(family);
      expect(result.primary.style).toBe(style);
      expect(result.isUnknown).toBe(false);
    });
  });

  it('emits family candidate scores and conflict dampening metadata for ambiguous mixed-family strings', () => {
    const result = detectCitationStyle(
      '[1] Smith, J. (2023). Example study. Journal of Examples, 12(3), 44-50.',
    );

    expect(result.familyCandidates.length).toBeGreaterThan(0);
    expect(result.conflictDampened).toBe(true);
    expect(result.primary.style).toBe('unknown');
  });
});
