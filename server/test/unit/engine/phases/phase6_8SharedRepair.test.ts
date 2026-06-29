import { describe, expect, it } from 'vitest';
import { phase6_8SharedRepair } from '../../../../src/engine/phases/phase6_8SharedRepair.js';
import { phase10Health } from '../../../../src/engine/phases/phase10Health.js';
import { fieldOf } from '../../../../src/engine/types/field.js';
import { buildReferenceCarrier } from '../../../../src/engine/utils/carriers.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';

describe('phase6_8SharedRepair', () => {
  it('promotes a journal-like conference spill into journal for article citations', async () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Verstraete, B. (2002). Lovers’ Legends. Mouseion: Journal of the Classical Association of Canada, 46(3), 413–414. https://doi.org/10.1353/mou.2002.0027',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.95 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.95,
        styleConfidence: 0.95,
        familyMarginToRunnerUp: 0.6,
        styleMarginToRunnerUp: 0.6,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.95 }],
        styleCandidates: [{ style: 'apa7', score: 0.95 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.type = { type: 'article-journal', confidence: 0.97, isUnknown: false };
    carrier.fields.title = fieldOf('Lovers’ Legends', 'regex_fallback', 'phase4_extraction', 0.94);
    carrier.fields.conferenceTitle = fieldOf(
      'Mouseion: Journal of the Classical Association of Canada',
      'regex_fallback',
      'phase4_extraction',
      0.92,
    );
    carrier.fields.volume = fieldOf('46', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.issue = fieldOf('3', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.pages = fieldOf('413–414', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.issn = fieldOf('19135416', 'regex_fallback', 'phase4_extraction', 0.9);

    const ctx = createTestPipelineContext();
    const [repaired] = await phase6_8SharedRepair.run([carrier], ctx);

    expect(repaired?.fields.journal.value).toBe('Mouseion: Journal of the Classical Association of Canada');
    expect(repaired?.fields.journal.source).toBe('shared_repair');
    expect(repaired?.fields.conferenceTitle.value).toBeNull();
    expect(repaired?.sharedRepairShadow?.proposedMoves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: 'conference_container_journal_repair',
          destinationField: 'journal',
        }),
      ]),
    );
  });

  it('lets a shared-repair journal satisfy mandatory article presence checks', async () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Tiwari, N. (2011). Merger under the regime of competition law. Bond Law Review, 23(1). https://doi.org/10.53300/001c.5580',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.95 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.95,
        styleConfidence: 0.95,
        familyMarginToRunnerUp: 0.6,
        styleMarginToRunnerUp: 0.6,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.95 }],
        styleCandidates: [{ style: 'apa7', score: 0.95 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.type = { type: 'article-journal', confidence: 0.97, isUnknown: false };
    carrier.fields.title = fieldOf('Merger under the regime of competition law', 'regex_fallback', 'phase4_extraction', 0.94);
    carrier.fields.publisher = fieldOf('Bond Law Review', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.volume = fieldOf('23', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.issue = fieldOf('1', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.issn = fieldOf('22024824', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.healthEvidence.validSpanFields = ['title', 'volume', 'issue', 'issn'];

    const ctx = createTestPipelineContext();
    const [repaired] = await phase6_8SharedRepair.run([carrier], ctx);
    const [validated] = await phase10Health.run([repaired!], ctx);

    expect(validated?.fields.journal.value).toBe('Bond Law Review');
    expect(validated?.health.breakdown.missingMandatory).not.toContain('journal');
  });

  it('promotes issn-backed all-caps conference spills into journal for article citations', async () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Lim, S.-Y., & Ha, Y.-H. (2023). Phonetic Articulation of /l/ in English according to Phonological Environment : Focusing on Duration and Formation. STUDIES IN HUMANITIES, 77, 219–241. https://doi.org/10.33252/sih.2023.6.77.219',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.95 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.95,
        styleConfidence: 0.95,
        familyMarginToRunnerUp: 0.6,
        styleMarginToRunnerUp: 0.6,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.95 }],
        styleCandidates: [{ style: 'apa7', score: 0.95 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.type = { type: 'article-journal', confidence: 0.97, isUnknown: false };
    carrier.fields.title = fieldOf(
      'Phonetic Articulation of /l/ in English according to Phonological Environment : Focusing on Duration and Formation',
      'regex_fallback',
      'phase4_extraction',
      0.94,
    );
    carrier.fields.conferenceTitle = fieldOf('STUDIES IN HUMANITIES', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.volume = fieldOf('77', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.pages = fieldOf('219–241', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.issn = fieldOf('20051263', 'regex_fallback', 'phase4_extraction', 0.9);

    const ctx = createTestPipelineContext();
    const [repaired] = await phase6_8SharedRepair.run([carrier], ctx);

    expect(repaired?.fields.journal.value).toBe('STUDIES IN HUMANITIES');
    expect(repaired?.fields.conferenceTitle.value).toBeNull();
    expect(repaired?.sharedRepairShadow?.proposedMoves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: 'conference_container_journal_repair',
          destinationField: 'journal',
        }),
      ]),
    );
  });

  it('promotes journal-like bookTitle spill into journal and recovers locators for article citations', async () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Ting, F.I.L., Cabaya, N.F. and Guzman, B.G. (2021) “The Distancing of Dermatology and Pathology: Opening the Door to Collaboration”, Asian Journal of Oncology, 07, pp. 060–063. Available at: https://doi.org/10.1055/s-0041-1729348.',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'harvard-ctr', confidence: 0.94 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.94,
        styleConfidence: 0.94,
        familyMarginToRunnerUp: 0.5,
        styleMarginToRunnerUp: 0.5,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.94 }],
        styleCandidates: [{ style: 'harvard-ctr', score: 0.94 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.type = { type: 'article-journal', confidence: 0.96, isUnknown: false };
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

    const ctx = createTestPipelineContext();
    const [repaired] = await phase6_8SharedRepair.run([carrier], ctx);

    expect(repaired?.fields.journal.value).toBe('Asian Journal of Oncology');
    expect(repaired?.fields.volume.value).toBe('07');
    expect(repaired?.fields.issn.value).toBe('2454-6798');
    expect(repaired?.fields.bookTitle.value).toBeNull();
    expect(repaired?.sharedRepairShadow?.proposedMoves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: 'book_container_journal_repair',
          destinationField: 'journal',
        }),
        expect.objectContaining({
          reasonCode: 'book_container_volume_repair',
          destinationField: 'volume',
        }),
        expect.objectContaining({
          reasonCode: 'book_container_issn_repair',
          destinationField: 'issn',
        }),
      ]),
    );
  });

  it('can suppress the global shared-repair summary for fast-lane batch integration', async () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Verstraete, B. (2002). Lovers’ Legends. Mouseion: Journal of the Classical Association of Canada, 46(3), 413–414.',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.95 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.95,
        styleConfidence: 0.95,
        familyMarginToRunnerUp: 0.6,
        styleMarginToRunnerUp: 0.6,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.95 }],
        styleCandidates: [{ style: 'apa7', score: 0.95 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.type = { type: 'article-journal', confidence: 0.97, isUnknown: false };
    carrier.fields.conferenceTitle = fieldOf(
      'Mouseion: Journal of the Classical Association of Canada',
      'regex_fallback',
      'phase4_extraction',
      0.92,
    );
    carrier.fields.volume = fieldOf('46', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.issue = fieldOf('3', 'regex_fallback', 'phase4_extraction', 0.9);
    carrier.fields.issn = fieldOf('19135416', 'regex_fallback', 'phase4_extraction', 0.9);

    const ctx = createTestPipelineContext();
    const result = await phase6_8SharedRepair.apply([carrier], ctx, { suppressContextStageLog: true });

    expect(result.stats.proposedMoveCount).toBeGreaterThan(0);
    expect(ctx.stageLog).toHaveLength(0);
    expect(result.carriers[0]?.stageLog.at(-1)?.phaseId).toBe('shared_repair');
  });

  it('does not rewrite conference publishers into journal when the container is an explicit event', async () => {
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'Paulo Santos da Silva, M., & de Paula Martins, C. (2023). A Extensão Universitária Como Caminho Para a Sustentabilidade Técnica, Econômica e Social na Produção de Biocombustíveis. Proceedings of the 51 Brasilian Congress of Engineering Education. https://doi.org/10.37702/2175-957x.cobenge.2023.4540',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'apa7', confidence: 0.95 },
        secondary: null,
        family: 'author_date',
        familyConfidence: 0.95,
        styleConfidence: 0.95,
        familyMarginToRunnerUp: 0.6,
        styleMarginToRunnerUp: 0.6,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'author_date', score: 0.95 }],
        styleCandidates: [{ style: 'apa7', score: 0.95 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );

    carrier.type = { type: 'article-journal', confidence: 0.97, isUnknown: false };
    carrier.fields.title = fieldOf(
      'A Extensão Universitária Como Caminho Para a Sustentabilidade Técnica, Econômica e Social na Produção de Biocombustíveis',
      'regex_fallback',
      'phase4_extraction',
      0.94,
    );
    carrier.fields.conferenceTitle = fieldOf(
      'Proceedings of the 51 Brasilian Congress of Engineering Education',
      'regex_fallback',
      'phase4_extraction',
      0.92,
    );
    carrier.fields.publisher = fieldOf(
      'Associação Brasileira de Educação em Engenharia',
      'regex_fallback',
      'phase4_extraction',
      0.9,
    );
    carrier.fields.volume = fieldOf('51', 'regex_fallback', 'phase4_extraction', 0.82);

    const ctx = createTestPipelineContext();
    const [repaired] = await phase6_8SharedRepair.run([carrier], ctx);

    expect(repaired?.fields.journal.value).toBeNull();
    expect(repaired?.fields.publisher.value).toBe('Associação Brasileira de Educação em Engenharia');
    expect(repaired?.sharedRepairShadow?.proposedMoves).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: 'publisher_to_journal_repair',
          destinationField: 'journal',
        }),
      ]),
    );
  });
});
