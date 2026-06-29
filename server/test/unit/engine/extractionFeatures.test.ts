import { describe, expect, it } from 'vitest';
import {
  compareCitationFeatureRecall,
  extractCitationFeatures,
} from '../../../src/engine/extractionFeatures.js';

describe('extractionFeatures', () => {
  it('extracts core identifier and locator features for DOI-backed journal citations', () => {
    const raw = 'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. doi:10.1000/xyz123';
    const features = extractCitationFeatures(raw, 'author_date');

    expect(features.yearMatch?.year).toBe(2020);
    expect(features.identifiers.doi.normalized).toBe('10.1000/xyz123');
    expect(features.identifiers.url.normalized).toBeNull();
    expect(features.quotedTitle).toBeNull();
  });

  it('extracts quoted titles and URLs for webpage citations', () => {
    const raw = 'World Wide Web Consortium. (2023). "Web Content Accessibility Guidelines (WCAG) 2.2." W3C. https://www.w3.org/TR/WCAG22/';
    const features = extractCitationFeatures(raw, 'author_date');

    expect(features.yearMatch?.year).toBe(2023);
    expect(features.quotedTitle?.title).toBe('Web Content Accessibility Guidelines (WCAG) 2.2.');
    expect(features.identifiers.url.normalized).toBe('https://www.w3.org/TR/WCAG22/');
  });

  it('extracts bookish identifiers from Springer chapter citations', () => {
    const raw = 'Abts, D. (2015). Imperative Sprachkonzepte. In Grundkurs JAVA (pp. 11–33). Springer Fachmedien Wiesbaden. https://doi.org/10.1007/978-3-658-07968-0_2';
    const features = extractCitationFeatures(raw, 'author_date');

    expect(features.identifiers.doi.normalized).toBe('10.1007/978-3-658-07968-0_2');
    expect(features.identifiers.isbn.normalized).toBeNull();
    expect(features.yearMatch?.year).toBe(2015);
  });

  it('extracts patent identifiers without confusing DOI-like contexts', () => {
    const raw = 'Google LLC. "Systems and methods for safe browsing." US Patent Application No. US12345678A1, 2024. https://patents.google.com/patent/US12345678A1/en';
    const features = extractCitationFeatures(raw, 'author_date');

    expect(features.identifiers.patent.normalized).toBe('US12345678A1');
    expect(features.identifiers.url.normalized).toBe('https://patents.google.com/patent/US12345678A1/en');
    expect(features.yearMatch?.year).toBe(2024);
  });

  it('strips trailing url-plus-identifier tails from parseable raw text', () => {
    const raw = '[1] Internet Engineering Task Force. The Transport Layer Security (TLS) Protocol Version 1.3. RFC Editor. https://www.rfc-editor.org/rfc/rfc8446 PMID: 32002124';
    const features = extractCitationFeatures(raw, 'numeric');

    expect(features.parseableRaw).toBe(
      '[1] Internet Engineering Task Force. The Transport Layer Security (TLS) Protocol Version 1.3. RFC Editor',
    );
    expect(features.identifiers.url.normalized).toBe('https://www.rfc-editor.org/rfc/rfc8446');
    expect(features.identifiers.pmid.normalized).toBe('32002124');
  });

  it('matches legacy heuristic candidate recall for real parser inputs', () => {
    const citations = [
      {
        raw: 'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. doi:10.1000/xyz123',
        family: 'author_date' as const,
      },
      {
        raw: 'World Wide Web Consortium. (2023). "Web Content Accessibility Guidelines (WCAG) 2.2." W3C. https://www.w3.org/TR/WCAG22/',
        family: 'author_date' as const,
      },
      {
        raw: 'Abts, D. (2015). Imperative Sprachkonzepte. In Grundkurs JAVA (pp. 11–33). Springer Fachmedien Wiesbaden. https://doi.org/10.1007/978-3-658-07968-0_2',
        family: 'author_date' as const,
      },
      {
        raw: '[1]Internet Engineering Task Force, “The WebSocket Protocol,” RFC Editor. [Online]. Available: https://www.rfc-editor.org/rfc/rfc6455',
        family: 'numeric' as const,
      },
      {
        raw: 'Google LLC. "Systems and methods for safe browsing." US Patent Application No. US12345678A1, 2024. https://patents.google.com/patent/US12345678A1/en',
        family: 'author_date' as const,
      },
    ];

    for (const citation of citations) {
      const shadow = compareCitationFeatureRecall(citation.raw, citation.family);
      expect(shadow.allMatch).toBe(true);
    }
  });
});
