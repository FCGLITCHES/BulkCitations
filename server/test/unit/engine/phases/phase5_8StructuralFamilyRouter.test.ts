import { describe, expect, it } from 'vitest';
import { fieldOf } from '../../../../src/engine/types/field.js';
import { buildReferenceCarrier } from '../../../../src/engine/utils/carriers.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';
import {
  phase5_8StructuralFamilyRouter,
  routeStructuralFamily,
} from '../../../../src/engine/phases/phase5_8StructuralFamilyRouter.js';

describe('phase5_8StructuralFamilyRouter', () => {
  it('routes journal-like conference spill with locators to article-journal', async () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Smith, J. (2020). Example study. Example Review, 12(3), 44-50.',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.94 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.94,
        styleConfidence: 0.94,
        familyMarginToRunnerUp: 0.5,
        styleMarginToRunnerUp: 0.5,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.94 }],
        styleCandidates: [{ style: 'apa7', score: 0.94 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.fields.title = fieldOf('Example study', 'regex_fallback', 'phase4_extraction', 0.94);
    carrier.fields.conferenceTitle = fieldOf('Example Review', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.volume = fieldOf('12', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.issue = fieldOf('3', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.pages = fieldOf('44-50', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.issn = fieldOf('1234-5678', 'regex_fallback', 'phase4_extraction', 0.9);

    const routed = routeStructuralFamily(carrier);

    expect(routed.type).toBe('article-journal');
    expect(routed.reasonCodes).toContain('conference_container_article_override');
    expect(routed.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('routes journal-like bookTitle spill with DOI-backed article cues to article-journal', () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Ting, F.I.L., Cabaya, N.F. and Guzman, B.G. (2021) “The Distancing of Dermatology and Pathology: Opening the Door to Collaboration”, Asian Journal of Oncology, 07, pp. 060–063. Available at: https://doi.org/10.1055/s-0041-1729348.',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'harvard-ctr', confidence: 0.93 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.93,
        styleConfidence: 0.93,
        familyMarginToRunnerUp: 0.4,
        styleMarginToRunnerUp: 0.4,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.93 }],
        styleCandidates: [{ style: 'harvard-ctr', score: 0.93 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.fields.title = fieldOf(
      'The Distancing of Dermatology and Pathology: Opening the Door to Collaboration',
      'regex_fallback',
      'phase4_extraction',
      0.93,
    );
    carrier.fields.bookTitle = fieldOf('Asian Journal of Oncology, 07', 'regex_fallback', 'phase4_extraction', 0.82);
    carrier.fields.pages = fieldOf('060–063', 'regex_fallback', 'phase4_extraction', 0.84);
    carrier.fields.doi = fieldOf('10.1055/s-0041-1729348', 'regex_fallback', 'phase4_extraction', 0.95);
    carrier.fields.url = fieldOf('https://doi.org/10.1055/s-0041-1729348', 'regex_fallback', 'phase4_extraction', 0.92);

    const routed = routeStructuralFamily(carrier);

    expect(routed.type).toBe('article-journal');
    expect(routed.reasonCodes).toContain('book_container_article_override');
    expect(routed.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('does not overcommit isbn-backed university press books to report', () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Albright, C. B. (2022). American Woman, Italian Style. Fordham University Press. https://doi.org/10.1515/9780823290840',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.94 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.94,
        styleConfidence: 0.94,
        familyMarginToRunnerUp: 0.5,
        styleMarginToRunnerUp: 0.5,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.94 }],
        styleCandidates: [{ style: 'apa7', score: 0.94 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.fields.title = fieldOf('American Woman, Italian Style', 'regex_fallback', 'phase4_extraction', 0.95);
    carrier.fields.publisher = fieldOf('Fordham University Press', 'regex_fallback', 'phase4_extraction', 0.92);
    carrier.fields.isbn = fieldOf('9780823290840', 'regex_fallback', 'phase4_extraction', 0.95);
    carrier.fields.doi = fieldOf('10.1515/9780823290840', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.url = fieldOf('https://doi.org/10.1515/9780823290840', 'regex_fallback', 'phase4_extraction', 0.9);

    const routed = routeStructuralFamily(carrier);

    expect(routed.type).toBe('book');
    expect(routed.reasonCodes).toContain('bookish_container_profile');
  });

  it('prefers webpage routing over institutional report routing when a site name and URL are present', () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Internet Engineering Task Force. (2018). The Transport Layer Security (TLS) Protocol Version 1.3. Internet Engineering Task Force. RFC Editor. https://www.rfc-editor.org/rfc/rfc8446',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.9 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.9,
        styleConfidence: 0.9,
        familyMarginToRunnerUp: 0.4,
        styleMarginToRunnerUp: 0.4,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.9 }],
        styleCandidates: [{ style: 'apa7', score: 0.9 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.fields.title = fieldOf('The Transport Layer Security (TLS) Protocol Version 1.3', 'regex_fallback', 'phase4_extraction', 0.92);
    carrier.fields.publisher = fieldOf('Internet Engineering Task Force', 'regex_fallback', 'phase4_extraction', 0.88);
    carrier.fields.institution = fieldOf('Internet Engineering Task Force', 'regex_fallback', 'phase4_extraction', 0.88);
    carrier.fields.siteName = fieldOf('RFC Editor', 'regex_fallback', 'phase4_extraction', 0.92);
    carrier.fields.url = fieldOf('https://www.rfc-editor.org/rfc/rfc8446', 'regex_fallback', 'phase4_extraction', 0.95);

    const routed = routeStructuralFamily(carrier);

    expect(routed.type).toBe('webpage');
    expect(routed.reasonCodes).toContain('web_document_profile');
  });

  it('uses candidate-envelope conference evidence when the final conference field is still empty', () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Doe, J. (2024). Example proceedings paper. Proceedings of ExampleConf 2024.',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.9 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.9,
        styleConfidence: 0.9,
        familyMarginToRunnerUp: 0.4,
        styleMarginToRunnerUp: 0.4,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.9 }],
        styleCandidates: [{ style: 'apa7', score: 0.9 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.fields.title = fieldOf('Example proceedings paper', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.candidateEnvelope = {
      titleCoreCandidates: [],
      titleTailCandidates: [],
      journalCandidates: [],
      conferenceCandidates: [
        {
          field: 'conferenceTitle',
          text: 'Proceedings of ExampleConf 2024',
          score: 0.93,
          provenance: 'phase4_entity:heuristic',
          conflictFlags: [],
        },
      ],
      bookTitleCandidates: [],
      publisherCandidates: [],
      institutionCandidates: [],
      authorBlockCandidates: [],
      editorCandidates: [],
      identifierCandidates: [],
    };

    const routed = routeStructuralFamily(carrier);

    expect(routed.type).toBe('conference-paper');
    expect(routed.reasonCodes).toContain('candidate_envelope_conference_support');
  });

  it('routes named event containers without generic conference keywords to conference-paper', () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Claeys, S. (2012). Fluid mud density determination in navigational channels. Hydro12 - Taking care of the sea. Hydrographic Society Benelux. https://doi.org/10.3990/2.228',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.92 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.92,
        styleConfidence: 0.92,
        familyMarginToRunnerUp: 0.4,
        styleMarginToRunnerUp: 0.4,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.92 }],
        styleCandidates: [{ style: 'apa7', score: 0.92 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.fields.title = fieldOf(
      'Fluid mud density determination in navigational channels',
      'regex_fallback',
      'phase4_extraction',
      0.92,
    );
    carrier.fields.conferenceTitle = fieldOf('Hydro12 - Taking care of the sea', 'regex_fallback', 'phase4_extraction', 0.88);
    carrier.fields.publisher = fieldOf('Hydrographic Society Benelux', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.doi = fieldOf('10.3990/2.228', 'regex_fallback', 'phase4_extraction', 0.95);
    carrier.fields.url = fieldOf('https://doi.org/10.3990/2.228', 'regex_fallback', 'phase4_extraction', 0.92);

    const routed = routeStructuralFamily(carrier);

    expect(routed.type).toBe('conference-paper');
    expect(routed.reasonCodes).toContain('conference_container_profile');
  });

  it('does not treat isbn-backed page-only chapter metadata as an article profile', () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Bischoff A, Schürmann B. Higher Order Neural Networks in a Unified Learning Scheme. ICANN ’93. Springer London; 1993. p. 679–82. https://doi.org/10.1007/978-1-4471-2063-6_187.',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'vancouver', confidence: 0.94 },
        secondary: null,
        family: 'numeric',
        familyConfidence: 0.94,
        styleConfidence: 0.94,
        familyMarginToRunnerUp: 0.5,
        styleMarginToRunnerUp: 0.5,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'numeric', score: 0.94 }],
        styleCandidates: [{ style: 'vancouver', score: 0.94 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.fields.title = fieldOf('Higher Order Neural Networks in a Unified Learning Scheme', 'regex_fallback', 'phase4_extraction', 0.92);
    carrier.fields.bookTitle = fieldOf("ICANN '93", 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.publisher = fieldOf('Springer London', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.journal = fieldOf('Springer London', 'regex_fallback', 'phase4_extraction', 0.75);
    carrier.fields.pages = fieldOf('679–682', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.isbn = fieldOf('9781447120636', 'regex_fallback', 'phase4_extraction', 0.95);
    carrier.fields.doi = fieldOf('10.1007/978-1-4471-2063-6_187', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.url = fieldOf('https://doi.org/10.1007/978-1-4471-2063-6_187', 'regex_fallback', 'phase4_extraction', 0.9);

    const routed = routeStructuralFamily(carrier);

    expect(routed.type).toBe('book-chapter');
    expect(routed.reasonCodes).toContain('book_chapter_profile');
  });

  it('prefers book-chapter routing over conference routing for isbn-backed proceedings books', () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Djamarin, D. (2019). Adaptation Novel to Film: Contribution Malay Literary. In Proceeding of The 13th International Conference onMalaysia-Indonesia Relations (PAHMI) (pp. 142–146). Sciendo. https://doi.org/10.2478/9783110680003-027',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.94 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.94,
        styleConfidence: 0.94,
        familyMarginToRunnerUp: 0.5,
        styleMarginToRunnerUp: 0.5,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.94 }],
        styleCandidates: [{ style: 'apa7', score: 0.94 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.fields.title = fieldOf(
      'Adaptation Novel to Film: Contribution Malay Literary',
      'regex_fallback',
      'phase4_extraction',
      0.94,
    );
    carrier.fields.bookTitle = fieldOf(
      'Proceeding of The 13th International Conference onMalaysia-Indonesia Relations (PAHMI)',
      'regex_fallback',
      'phase4_extraction',
      0.9,
    );
    carrier.fields.publisher = fieldOf('Sciendo', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.pages = fieldOf('142–146', 'regex_fallback', 'phase4_extraction', 0.88);
    carrier.fields.isbn = fieldOf('9783110680003', 'regex_fallback', 'phase4_extraction', 0.95);
    carrier.fields.doi = fieldOf('10.2478/9783110680003-027', 'regex_fallback', 'phase4_extraction', 0.94);
    carrier.fields.url = fieldOf(
      'https://doi.org/10.2478/9783110680003-027',
      'regex_fallback',
      'phase4_extraction',
      0.92,
    );

    const routed = routeStructuralFamily(carrier);

    expect(routed.type).toBe('book-chapter');
    expect(routed.reasonCodes).toContain('bookish_conference_override');
    expect(routed.confidence).toBeGreaterThanOrEqual(0.94);
  });

  it('does not treat Studies in book-series containers as article spill when chapter signals are strong', () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Wallinga, M. (2020). The Effects of a Right of Withdrawal on Consumers’ Willingness to Purchase Online. Studies in European Economic Law and Regulation. Springer International Publishing, pp. 71–113. Available at: https://doi.org/10.1007/978-3-030-54001-2_3.',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.94 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.94,
        styleConfidence: 0.94,
        familyMarginToRunnerUp: 0.5,
        styleMarginToRunnerUp: 0.5,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.94 }],
        styleCandidates: [{ style: 'apa7', score: 0.94 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.fields.title = fieldOf(
      'The Effects of a Right of Withdrawal on Consumers’ Willingness to Purchase Online',
      'regex_fallback',
      'phase4_extraction',
      0.94,
    );
    carrier.fields.bookTitle = fieldOf(
      'Studies in European Economic Law and Regulation',
      'regex_fallback',
      'phase4_extraction',
      0.88,
    );
    carrier.fields.publisher = fieldOf(
      'Springer International Publishing',
      'regex_fallback',
      'phase4_extraction',
      0.9,
    );
    carrier.fields.pages = fieldOf('71–113', 'regex_fallback', 'phase4_extraction', 0.88);
    carrier.fields.isbn = fieldOf('9783030540012', 'regex_fallback', 'phase4_extraction', 0.95);
    carrier.fields.doi = fieldOf('10.1007/978-3-030-54001-2_3', 'regex_fallback', 'phase4_extraction', 0.94);
    carrier.fields.url = fieldOf(
      'https://doi.org/10.1007/978-3-030-54001-2_3',
      'regex_fallback',
      'phase4_extraction',
      0.92,
    );

    const routed = routeStructuralFamily(carrier);

    expect(routed.type).toBe('book-chapter');
    expect(routed.reasonCodes).toContain('book_chapter_profile');
  });

  it('ignores PMID-sized webpage locator spill when routing RFC webpages', () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Internet Engineering Task Force. (2018). The Transport Layer Security (TLS) Protocol Version 1.3. Internet Engineering Task Force. RFC Editor. https://www.rfc-editor.org/rfc/rfc8446 PMID:99999999',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.94 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.94,
        styleConfidence: 0.94,
        familyMarginToRunnerUp: 0.5,
        styleMarginToRunnerUp: 0.5,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.94 }],
        styleCandidates: [{ style: 'apa7', score: 0.94 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.fields.title = fieldOf(
      'The Transport Layer Security (TLS) Protocol Version 1.3',
      'regex_fallback',
      'phase4_extraction',
      0.92,
    );
    carrier.fields.journal = fieldOf('Internet Engineering Task Force', 'regex_fallback', 'phase4_extraction', 0.72);
    carrier.fields.siteName = fieldOf('RFC Editor', 'regex_fallback', 'phase4_extraction', 0.82);
    carrier.fields.institution = fieldOf(
      'https://www.rfc-editor.org/rfc/rfc8446 PMID:99999999',
      'regex_fallback',
      'phase4_extraction',
      0.46,
    );
    carrier.fields.pages = fieldOf('99999999', 'regex_fallback', 'phase4_extraction', 0.4);
    carrier.fields.pmid = fieldOf('99999999', 'regex_fallback', 'phase4_extraction', 0.94);
    carrier.fields.url = fieldOf(
      'https://www.rfc-editor.org/rfc/rfc8446',
      'regex_fallback',
      'phase4_extraction',
      0.92,
    );

    const routed = routeStructuralFamily(carrier);

    expect(routed.type).toBe('webpage');
    expect(routed.reasonCodes).toContain('web_document_profile');
  });

  it('ignores bare RFC page-number spill when a real webpage URL and site context are present', () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Internet Engineering Task Force. (2025). Export of UDP Options Information in IP Flow Information Export (IPFIX). RFC Editor. https://www.rfc-editor.org/rfc/rfc9870.html 99999999',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.94 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.94,
        styleConfidence: 0.94,
        familyMarginToRunnerUp: 0.5,
        styleMarginToRunnerUp: 0.5,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.94 }],
        styleCandidates: [{ style: 'apa7', score: 0.94 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.fields.title = fieldOf(
      'Export of UDP Options Information in IP Flow Information Export (IPFIX)',
      'regex_fallback',
      'phase4_extraction',
      0.92,
    );
    carrier.fields.siteName = fieldOf('RFC Editor', 'regex_fallback', 'phase4_extraction', 0.82);
    carrier.fields.institution = fieldOf(
      'Internet Engineering Task Force',
      'regex_fallback',
      'phase4_extraction',
      0.8,
    );
    carrier.fields.pages = fieldOf('99999999', 'regex_fallback', 'phase4_extraction', 0.35);
    carrier.fields.url = fieldOf(
      'https://www.rfc-editor.org/rfc/rfc9870.html',
      'regex_fallback',
      'phase4_extraction',
      0.92,
    );

    const routed = routeStructuralFamily(carrier);

    expect(routed.type).toBe('webpage');
    expect(routed.reasonCodes).toContain('web_document_profile');
  });

  it('routes sparse placeholder-doi owner profiles to preprint so phase 6 can promote them safely', () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Chen, H., Zeng, Y., Yang, Y., Zhang, S., Li, J., Li, Y., Zhang, J., & Zhao, B. (2023). Ripv1, a potential antibacterial protein encoded in the common potato. Elsevier BV. https://doi.org/',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.93 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.93,
        styleConfidence: 0.93,
        familyMarginToRunnerUp: 0.4,
        styleMarginToRunnerUp: 0.4,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.93 }],
        styleCandidates: [{ style: 'apa7', score: 0.93 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.fields.title = fieldOf(
      'Ripv1, a potential antibacterial protein encoded in the common potato',
      'regex_fallback',
      'phase4_extraction',
      0.92,
    );
    carrier.fields.publisher = fieldOf('Elsevier BV', 'regex_fallback', 'phase4_extraction', 0.82);
    carrier.fields.url = fieldOf('https://doi.org/', 'regex_fallback', 'phase4_extraction', 0.35);

    const routed = routeStructuralFamily(carrier);

    expect(routed.type).toBe('preprint');
    expect(routed.reasonCodes).toContain('preprint_sparse_owner_profile');
    expect(routed.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('routes accented standards-style spill to report instead of conference-paper', () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'ASTM Intérnàtionàl. (2013). Practice for Selection of Blood for in vitro Evaluation of Blood Pumps. ASTM Spécificàtion F1830. ASTM Intérnàtionàl. https://doi.org/10.1520/f1830-97r13.',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.94 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.94,
        styleConfidence: 0.94,
        familyMarginToRunnerUp: 0.4,
        styleMarginToRunnerUp: 0.4,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.94 }],
        styleCandidates: [{ style: 'apa7', score: 0.94 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.fields.title = fieldOf(
      'Practice for Selection of Blood for in vitro Evaluation of Blood Pumps',
      'regex_fallback',
      'phase4_extraction',
      0.9,
    );
    carrier.fields.publisher = fieldOf('ASTM Intérnàtionàl', 'regex_fallback', 'phase4_extraction', 0.84);
    carrier.fields.conferenceTitle = fieldOf(
      'ASTM Spécificàtion F1830',
      'regex_fallback',
      'phase4_extraction',
      0.48,
    );
    carrier.fields.url = fieldOf(
      'https://doi.org/10.1520/f1830-97r13',
      'regex_fallback',
      'phase4_extraction',
      0.92,
    );

    const routed = routeStructuralFamily(carrier);

    expect(routed.type).toBe('report');
    expect(routed.reasonCodes).toContain('institutional_report_profile');
  });

  it('keeps doi-only partial parses unresolved', async () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: '10.1000/example-study',
        splitMethod: 'doi_resolved',
        splitConfidence: 1,
        isDoiResolved: true,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 1 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 1,
        styleConfidence: 1,
        familyMarginToRunnerUp: 1,
        styleMarginToRunnerUp: 1,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 1 }],
        styleCandidates: [{ style: 'apa7', score: 1 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.fields.doi = fieldOf('10.1000/example-study', 'ingestion', 'phase1_doi_local_cache', 1);
    carrier.fields.url = fieldOf('https://doi.org/10.1000/example-study', 'ingestion', 'phase1_doi_local_cache', 1);

    const routed = routeStructuralFamily(carrier);

    expect(routed.type).toBe('unknown');
    expect(routed.reasonCodes).toContain('doi_only_partial_parse');
  });

  it('preserves approved-truth routing when the phase runs', async () => {
    const ctx = createTestPipelineContext();
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: '10.1000/example-study',
        splitMethod: 'doi_resolved',
        splitConfidence: 1,
        isDoiResolved: true,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 1 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 1,
        styleConfidence: 1,
        familyMarginToRunnerUp: 1,
        styleMarginToRunnerUp: 1,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 1 }],
        styleCandidates: [{ style: 'apa7', score: 1 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.structuralRouting = {
      type: 'article-journal',
      confidence: 1,
      source: 'approved_truth',
      reasonCodes: ['approved_truth_doi_match'],
    };

    const [routed] = await phase5_8StructuralFamilyRouter.run([carrier], ctx);

    expect(routed?.structuralRouting).toEqual({
      type: 'article-journal',
      confidence: 1,
      source: 'approved_truth',
      reasonCodes: ['approved_truth_doi_match'],
    });
  });
});
