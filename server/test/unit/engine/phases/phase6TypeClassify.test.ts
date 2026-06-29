import { describe, expect, it } from 'vitest';
import { phase6TypeClassify } from '../../../../src/engine/phases/phase6TypeClassify.js';
import { buildReferenceCarrier } from '../../../../src/engine/utils/carriers.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';
import { runThroughPhase6 } from '../../../helpers/runSprint2Core.js';

describe('phase6TypeClassify', () => {
  it('classifies journal articles from extracted field presence', async () => {
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. doi:10.1000/xyz123',
    );

    expect(carrier.type.type).toBe('article-journal');
    expect(carrier.type.isUnknown).toBe(false);
  });

  it('keeps colon-subtitled journal venues as article-journal instead of conference-paper', async () => {
    const { carrier } = await runThroughPhase6(
      'Proehl, K. B. (2015). Tomboyism and Familial Belonging in Carson McCullers’s The Member of the Wedding : Queer Sentiments. Jeunesse: Young People, Texts, Cultures, 7(1), 87–109. https://doi.org/10.1353/jeu.2015.0002',
    );

    expect(carrier.fields.journal.value).toBe('Jeunesse: Young People, Texts, Cultures');
    expect(carrier.fields.conferenceTitle.value).toBeNull();
    expect(carrier.type.type).toBe('article-journal');
    expect(carrier.type.isUnknown).toBe(false);
  });

  it('keeps jurnal venues with article locators as article-journal instead of conference-paper', async () => {
    const { carrier } = await runThroughPhase6(
      'Ratnamiasih, I. & Widi Andini. (2023). ANALISIS BEBAN KERJA PADA PT. BPR SUBANG GEMI NASTITI (PERSERODA) KANTOR PUSAT OPERASIONAL DI KOTA SUBANG. Brainy: Jurnal Riset Mahasiswa, 4(1), 29–34. https://doi.org/10.23969/brainy.v4i1.54',
    );

    expect(carrier.fields.journal.value).toBe('Brainy: Jurnal Riset Mahasiswa');
    expect(carrier.fields.conferenceTitle.value).toBeNull();
    expect(carrier.type.type).toBe('article-journal');
    expect(carrier.type.isUnknown).toBe(false);
  });

  it('classifies webpages when a URL is present without journal metadata', async () => {
    const { carrier } = await runThroughPhase6(
      'World Health Organization. (2022). Health update. https://example.org/update Accessed January 1, 2024.',
    );

    expect(carrier.type.type).toBe('webpage');
  });

  it('keeps isbn-backed proceedings chapters as book-chapter instead of conference-paper', async () => {
    const { carrier } = await runThroughPhase6(
      'Djamarin, D. (2019). Adaptation Novel to Film: Contribution Malay Literary. In Proceeding of The 13th International Conference onMalaysia-Indonesia Relations (PAHMI) (pp. 142–146). Sciendo. https://doi.org/10.2478/9783110680003-027',
    );

    expect(carrier.fields.bookTitle.value).toBe(
      'Proceeding of The 13th International Conference onMalaysia-Indonesia Relations (PAHMI)',
    );
    expect(carrier.type.type).toBe('book-chapter');
  });

  it('accepts strong conference structural routing instead of leaving the type unknown', async () => {
    const ctx = createTestPipelineContext();
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'S. Claeys, "Fluid mud density determination in navigational channels," Hydro12 - Taking care of the sea, Hydrographic Society Benelux, 2012. https://doi.org/10.3990/2.228',
        splitMethod: 'blank_line',
        splitConfidence: 1,
        flags: [],
      },
      {
        primary: { style: 'ieee', confidence: 0.94 },
        secondary: null,
        family: 'numeric',
        familyConfidence: 0.94,
        styleConfidence: 0.94,
        familyMarginToRunnerUp: 0.4,
        styleMarginToRunnerUp: 0.4,
        certaintyTier: 'high',
        familyCandidates: [{ family: 'numeric', score: 0.94 }],
        styleCandidates: [{ style: 'ieee', score: 0.94 }],
        signals: [],
        conflictDampened: false,
        isUnknown: false,
        isMultiStyle: false,
      },
    );
    carrier.structuralRouting = {
      type: 'conference-paper',
      confidence: 0.93,
      source: 'heuristic',
      reasonCodes: ['conference_container_profile'],
    };

    const [classified] = await phase6TypeClassify.run([carrier], ctx);

    expect(classified?.type.type).toBe('conference-paper');
    expect(classified?.type.isUnknown).toBe(false);
  });

  it('accepts strong report structural routing instead of leaving the type unknown', async () => {
    const ctx = createTestPipelineContext();
    const carrier = buildReferenceCarrier(
      {
        index: 0,
        text: 'BSI British Standards. (2021). Photography. Dimensions of glass plates. BSI British Standards. https://doi.org/10.3403/30432757u',
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
    carrier.structuralRouting = {
      type: 'report',
      confidence: 0.9,
      source: 'heuristic',
      reasonCodes: ['institutional_report_profile'],
    };

    const [classified] = await phase6TypeClassify.run([carrier], ctx);

    expect(classified?.type.type).toBe('report');
    expect(classified?.type.isUnknown).toBe(false);
  });

  it('keeps noisy placeholder-doi books out of unknown', async () => {
    const first = await runThroughPhase6(
      'MARTINS, D. M. . CONEXÕES INTERDISCIPLINARES. Arco Editores. https://doi.org/',
    );
    const second = await runThroughPhase6(
      'Buchanan, S., & Joyner, J. . Azure Arc-Enabled Kubernetes and Servers. Apress. https://doi.org/',
    );

    expect(first.carrier.fields.title.value).toBe('CONEXÕES INTERDISCIPLINARES');
    expect(first.carrier.fields.publisher.value).toBe('Arco Editores');
    expect(first.carrier.type.type).toBe('book');
    expect(first.carrier.type.isUnknown).toBe(false);

    expect(second.carrier.fields.title.value).toBe('Azure Arc-Enabled Kubernetes and Servers');
    expect(second.carrier.fields.publisher.value).toBe('Apress');
    expect(second.carrier.type.type).toBe('book');
    expect(second.carrier.type.isUnknown).toBe(false);
  });

  it('keeps noisy numeric conference publisher tails out of unknown', async () => {
    const { carrier } = await runThroughPhase6(
      '[1]Gràchév V, Shulgà L, Smirnovà M, Nàidà N. Productivé ànd réproductivé quàlitiés of récord cows, Làtvià Univérsity of Agriculturé; 2017. https://doi.org/10.22616/érdév2017.16.n307.',
    );

    expect(carrier.fields.title.value).toBe('Productivé ànd réproductivé quàlitiés of récord cows');
    expect(carrier.fields.publisher.value).toBe('Làtvià Univérsity of Agriculturé');
    expect(carrier.type.type).toBe('conference-paper');
    expect(carrier.type.isUnknown).toBe(false);
  });

  it('keeps RFC webpages with trailing PMID tails in the webpage bucket', async () => {
    const { carrier } = await runThroughPhase6(
      'Internet Engineering Task Force. (2018). The Transport Layer Security (TLS) Protocol Version 1.3. Internet Engineering Task Force. RFC Editor. https://www.rfc-editor.org/rfc/rfc8446 PMID:99999999',
    );

    expect(carrier.fields.title.value).toBe('The Transport Layer Security (TLS) Protocol Version 1.3');
    expect(carrier.fields.siteName.value).toBe('RFC Editor');
    expect(carrier.fields.journal.value).toBeNull();
    expect(carrier.type.type).toBe('webpage');
    expect(carrier.type.isUnknown).toBe(false);
  });

  it('keeps Studies in book-series chapters in the book-chapter bucket', async () => {
    const { carrier } = await runThroughPhase6(
      'Wallinga, M. (2020). The Effects of a Right of Withdrawal on Consumers’ Willingness to Purchase Online. Studies in European Economic Law and Regulation. Springer International Publishing, pp. 71–113. Available at: https://doi.org/10.1007/978-3-030-54001-2_3.',
    );

    expect(carrier.fields.bookTitle.value).toBe('Studies in European Economic Law and Regulation');
    expect(carrier.type.type).toBe('book-chapter');
    expect(carrier.type.isUnknown).toBe(false);
  });

  it('keeps comma-separated IEEE numeric conference tails in the conference-paper bucket', async () => {
    const { carrier } = await runThroughPhase6(
      '[1]A. Rahman and D. Singh, “Early Diagnosis of Alzheimer’s Disease Using Machine Learning in MCI Individuals,” IEEE, 2024, pp. 1–5. doi: 10.1109/ccis63231.2024.10932134.',
    );

    expect(carrier.fields.title.value).toBe(
      'Early Diagnosis of Alzheimer’s Disease Using Machine Learning in MCI Individuals',
    );
    expect(carrier.fields.publisher.value).toBe('IEEE');
    expect(carrier.fields.pages.value).toBe('1-5');
    expect(carrier.type.type).toBe('conference-paper');
    expect(carrier.type.isUnknown).toBe(false);
  });

  it('keeps sparse placeholder-doi owner profiles in the preprint bucket', async () => {
    const { carrier } = await runThroughPhase6(
      'Chen, H., Zeng, Y., Yang, Y., Zhang, S., Li, J., Li, Y., Zhang, J., & Zhao, B. (2023). Ripv1, a potential antibacterial protein encoded in the common potato. Elsevier BV. https://doi.org/',
    );

    expect(carrier.fields.publisher.value).toBe('Elsevier BV');
    expect(carrier.type.type).toBe('preprint');
    expect(carrier.type.isUnknown).toBe(false);
  });

  it('keeps accented thesis citations out of the webpage bucket', async () => {
    const { carrier } = await runThroughPhase6(
      'Botter Junior, W. (2021). Relações interfaciais de poli(dimetilsiloxano) com sólidos inorgânicos. Dissértàtion. Univérsidàdé Estàduàl dé Càmpinàs. Avàilàblé àt: https://doi.org/10.47749/t/unicamp.1997.133750.',
    );

    expect(carrier.fields.thesisType.value).toBe('Dissertation');
    expect(String(carrier.fields.siteName.value ?? '')).not.toMatch(/available|avàilàblé/i);
    expect(carrier.type.type).toBe('thesis');
    expect(carrier.type.isUnknown).toBe(false);
  });

  it('keeps accented standards-style report citations out of the conference bucket', async () => {
    const { carrier } = await runThroughPhase6(
      'ASTM Intérnàtionàl. (2013). Practice for Selection of Blood for in vitro Evaluation of Blood Pumps. ASTM Spécificàtion F1830. ASTM Intérnàtionàl. https://doi.org/10.1520/f1830-97r13.',
    );

    expect(carrier.type.type).toBe('report');
    expect(carrier.type.isUnknown).toBe(false);
  });
});
