import { afterEach, describe, expect, it, vi } from 'vitest';
import { phase3StyleDetect } from '../../../../src/engine/phases/phase3StyleDetect.js';
import { Phase4Extract, phase4Extract } from '../../../../src/engine/phases/phase4Extract.js';
import { buildReferenceCarrier } from '../../../../src/engine/utils/carriers.js';
import type { MLHealthResponse } from '../../../../src/ml/client.js';
import type {
  Phase4ExtractAttempt,
  Phase4MlRuntimeLike,
  Phase4RequestMode,
} from '../../../../src/ml/phase4Runtime.js';
import { setPhase4OverrideMode } from '../../../../src/ml/phase4ModeOverride.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';
import { makeRawBlock } from '../../../helpers/makeRawBlock.js';

describe('phase4Extract', () => {
  afterEach(async () => {
    delete process.env.ML_PHASE4_MODE;
    delete process.env.ML_PHASE4_PRIMARY_FRACTION;
    delete process.env.ML_PHASE4_SHADOW_FRACTION;
    if (process.env.BULKREFERENCES_ISOLATED_RUNTIME === 'true') {
      await setPhase4OverrideMode(null);
    }
    delete process.env.BULKREFERENCES_ISOLATED_RUNTIME;
  });

  it('extracts core journal fields from an article citation', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1] Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. doi:10.1000/xyz123'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Example article');
    expect(carrier.fields.year.value).toBe(2020);
    expect(carrier.fields.journal.value).toBe('Journal of Examples');
    expect(carrier.fields.volume.value).toBe('12');
    expect(carrier.fields.issue.value).toBe('3');
    expect(carrier.fields.pages.value).toBe('44-50');
    expect(carrier.fields.doi.value).toBe('10.1000/xyz123');
    expect(carrier.extractionMeta?.candidateRecallShadow?.allMatch).toBe(true);
    expect(carrier.healthEvidence.validSpanFields).toEqual(
      expect.arrayContaining(['title', 'journal', 'volume', 'issue', 'pages', 'doi']),
    );
    expect(carrier.candidateEnvelope?.journalCandidates.some((candidate) =>
      candidate.text === 'Journal of Examples'
      && candidate.provenance === 'phase4_field:heuristic'
    )).toBe(true);
    expect(carrier.candidateEnvelope?.identifierCandidates.some((candidate) =>
      candidate.text === '10.1000/xyz123'
      && candidate.provenance === 'phase4_field:heuristic'
    )).toBe(true);
  });

  it('extracts numeric colon-spine journal citations without collapsing title text into authors', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('1. Jiménez-Luna J, Grisoni F, Weskamp N, Schneider G: Artificial intelligence in drug discovery: recent advances and future perspectives. Expert Opin Drug Discov. 2021, 16:949-59. 10.1080/17460441.2021.1909567'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.style.family).toBe('numeric');
    expect(carrier.fields.authors.value).toHaveLength(4);
    expect(carrier.fields.title.value).toBe('Artificial intelligence in drug discovery: recent advances and future perspectives');
    expect(carrier.fields.journal.value).toBe('Expert Opin Drug Discov');
    expect(carrier.fields.year.value).toBe(2021);
    expect(carrier.fields.volume.value).toBe('16');
    expect(carrier.fields.pages.value).toBe('949-959');
    expect(carrier.fields.doi.value).toBe('10.1080/17460441.2021.1909567');
  });

  it('does not turn publisher-year book tails into journal locators', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Eberhard, Wilhelm. Ludwig III. Kurfürst von Der Pfalz Und Das Reich 1410–1427. De Gruyter, 1896. https://doi.org/10.1515/9783112466384.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.publisher.value).toBe('De Gruyter');
    expect(carrier.fields.year.value).toBe(1896);
    expect(carrier.fields.journal.value).toBeNull();
    expect(carrier.fields.volume.value).toBeNull();
  });

  it('keeps journal-like conference publication venues as conferenceTitle', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Fahrutdinova, A. V. (2022). TRADION OF ENGLISH HUMOUR IN THE WORK OF CYRIL BONFIGLIOLI: ON THE HISTORY OF THE ISSUE. ACTUAL PROBLEMS OF LINGUISTICS AND LITERARY STUDIES. Proceedings of the IX (XXIII) International Scientific and Practical Conference of Young Scientists (April 14–16, 2022). https://doi.org/10.17223/978-5-907572-04-1-2022-103'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.conferenceTitle.value).toBe(
      'ACTUAL PROBLEMS OF LINGUISTICS AND LITERARY STUDIES. Proceedings of the IX (XXIII) International Scientific and Practical Conference of Young Scientists (April 14–16, 2022)',
    );
  });

  it('moves locator-backed journal containers out of conferenceTitle for article citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Verstraete, B. (2002). Lovers’ Legends: The Greek Gay Myths by Andrew Calimach (review). Mouseion: Journal of the Classical Association of Canada, 46(3), 413–414. https://doi.org/10.1353/mou.2002.0027'),
        makeRawBlock('Tiwari, N. (2011). Merger Under The Regime of Competition Law: A Comparative Study of Indian Legal Framework With EC and UK. Bond Law Review 2011;23(1). https://doi.org/10.53300/001c.5580'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.journal.value).toBe('Mouseion: Journal of the Classical Association of Canada');
    expect(carriers[0]?.fields.conferenceTitle.value).toBeNull();
    expect(carriers[0]?.fields.volume.value).toBe('46');
    expect(carriers[0]?.fields.issue.value).toBe('3');
    expect(carriers[0]?.fields.issn.value).toBe('19135416');

    expect(carriers[1]?.fields.journal.value).toBe('Bond Law Review');
    expect(carriers[1]?.fields.conferenceTitle.value).toBeNull();
    expect(carriers[1]?.fields.volume.value).toBe('23');
    expect(carriers[1]?.fields.issue.value).toBe('1');
  });

  it('recovers semicolon-delimited numeric article locators without leaving a swallowed bookTitle spill', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]J. Gagas; “Mouth of Madness;” American Book Review; vol. 36; no. 4; pp. 28–29; 2015; doi: 10.1353/abr.2015.0061.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Mouth of Madness');
    expect(carrier.fields.journal.value).toBe('American Book Review');
    expect(carrier.fields.volume.value).toBe('36');
    expect(carrier.fields.issue.value).toBe('4');
    expect(carrier.fields.pages.value).toBe('28-29');
    expect(carrier.fields.bookTitle.value).toBeNull();
  });

  it('recovers locator-backed article journals when the citation ends with an empty doi stub', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]K. Singler and J. Masuch, “Ein außergewöhnliches „Delirscreening“,” Zeitschrift für Gerontologie und Geriatrie, vol. 54, no. 5, pp. 442–443, 2021, doi: .'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Ein außergewöhnliches "Delirscreening"');
    expect(carrier.fields.journal.value).toBe('Zeitschrift für Gerontologie und Geriatrie');
    expect(carrier.fields.volume.value).toBe('54');
    expect(carrier.fields.issue.value).toBe('5');
    expect(carrier.fields.pages.value).toBe('442-443');
    expect(carrier.fields.conferenceTitle.value).toBeNull();
    expect(carrier.fields.bookTitle.value).toBeNull();
  });

  it('extracts review articles with locator tails even when the DOI URL is an empty stub', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Allen, T. J. . Hippocrates’ Woman: Reading the Female Body in Ancient Greece by Helen King (review). Mouseion: Journal of the Classical Association of Canada, 46(1), 80–85. https://doi.org/'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe("Hippocrates' Woman: Reading the Female Body in Ancient Greece by Helen King (review)");
    expect(carrier.fields.journal.value).toBe('Mouseion: Journal of the Classical Association of Canada');
    expect(carrier.fields.volume.value).toBe('46');
    expect(carrier.fields.issue.value).toBe('1');
    expect(carrier.fields.pages.value).toBe('80-85');
  });

  it('recovers yearless article locators after missing-field noise removes the date', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Gagas, J. . Mouth of Madness. American Book Review, 36(4), 28–29. https://doi.org/'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Mouth of Madness');
    expect(carrier.fields.journal.value).toBe('American Book Review');
    expect(carrier.fields.volume.value).toBe('36');
    expect(carrier.fields.issue.value).toBe('4');
    expect(carrier.fields.pages.value).toBe('28-29');
  });

  it('recovers bare trailing journal volumes when noisy locators leave issue and pages outside the journal field', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Gagas, Jonathan. “Mouth of Madness.” American Book Review 36, no. 4 : 28–29. https://doi.org/.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Mouth of Madness');
    expect(carrier.fields.journal.value).toBe('American Book Review');
    expect(carrier.fields.volume.value).toBe('36');
    expect(carrier.fields.issue.value).toBe('4');
    expect(carrier.fields.pages.value).toBe('28-29');
  });

  it('recovers semicolon-separated author-date article locators without inventing a conference alias', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Pillai; R.; Valappil; N. N.; & Parambil; D. A. C. (2021). An updated methodology for sediment distribution maps using conditional strings in Arc GIS 10.X. Arabian Journal of Geosciences; 14(20). https://doi.org/10.1007/s12517-021-07053-y'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('An updated methodology for sediment distribution maps using conditional strings in Arc GIS 10.X');
    expect(carrier.fields.journal.value).toBe('Arabian Journal of Geosciences');
    expect(carrier.fields.volume.value).toBe('14');
    expect(carrier.fields.issue.value).toBe('20');
    expect(carrier.fields.conferenceTitle.value).toBeNull();
  });

  it('recovers flexible semicolon journal articles with comma-style author lists', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Boberski, J., Reza Shaebani, M., & Wolf, D. E. Coherent transport and symmetry breaking in frictional Brownian ratchets. Physica A 2017;469:338-46. https://doi.org/10.1016/j.physa.2016.11.057'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.authors.value).toHaveLength(3);
    expect(carrier.fields.title.value).toBe(
      'Coherent transport and symmetry breaking in frictional Brownian ratchets',
    );
    expect(carrier.fields.journal.value).toBe('Physica A');
    expect(carrier.fields.volume.value).toBe('469');
    expect(carrier.fields.pages.value).toBe('338-346');
  });

  it('does not cross-propagate review and article fields across bare DOI host stubs in the same batch', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Allen, T. J. . Hippocrates’ Woman: Reading the Female Body in Ancient Greece by Helen King (review). Mouseion: Journal of the Classical Association of Canada, 46(1), 80–85. https://doi.org/'),
        makeRawBlock('Gagas, J. . Mouth of Madness. American Book Review, 36(4), 28–29. https://doi.org/'),
        makeRawBlock('Pillai; R.; Valappil; N. N.; & Parambil; D. A. C. (2021). An updated methodology for sediment distribution maps using conditional strings in Arc GIS 10.X. Arabian Journal of Geosciences; 14(20). https://doi.org/'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe(
      "Hippocrates' Woman: Reading the Female Body in Ancient Greece by Helen King (review)",
    );
    expect(carriers[0]?.fields.journal.value).toBe(
      'Mouseion: Journal of the Classical Association of Canada',
    );
    expect(carriers[1]?.fields.title.value).toBe('Mouth of Madness');
    expect(carriers[1]?.fields.journal.value).toBe('American Book Review');
    expect(carriers[2]?.fields.title.value).toBe(
      'An updated methodology for sediment distribution maps using conditional strings in Arc GIS 10.X',
    );
    expect(carriers[2]?.fields.journal.value).toBe('Arabian Journal of Geosciences');
    expect(carriers[2]?.fields.conferenceTitle.value).toBeNull();
  });

  it('splits bare review-article locator tails out of the journal field', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Paya A. (2015). East And West: Allama Jafari on Bertrand Russell by Seyed Javad Miri (review). Philosophy East and West 65(3) 991–993. https://doi.org/10.1353/pew.2015.0065'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.journal.value).toBe('Philosophy East and West');
    expect(carrier.fields.volume.value).toBe('65');
    expect(carrier.fields.issue.value).toBe('3');
    expect(carrier.fields.pages.value).toBe('991-993');
  });

  it('splits issue-only journal locators out of the journal field', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Hoàng, A. Q. (2015). Cộng đồng kinh tế ASEAN và cơ hội phát triển của Việt Nam. Dong Thap University Journal of Science, (13), 100–103. doi:10.52714/dthu.13.6.2015.212'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.journal.value).toBe('Dong Thap University Journal of Science');
    expect(carrier.fields.issue.value).toBe('13');
    expect(carrier.fields.pages.value).toBe('100-103');
  });

  it('keeps article locators and journal fields when the article title begins with In', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Birnbach, D. J., Brull, S. J., & Prielipp, R. C. (2016). In Response. Anesthesia & Analgesia, 123(3), 799–800. https://doi.org/10.1213/ane.0000000000001423'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('In Response');
    expect(carrier.fields.journal.value).toBe('Anesthesia & Analgesia');
    expect(carrier.fields.volume.value).toBe('123');
    expect(carrier.fields.issue.value).toBe('3');
    expect(carrier.fields.pages.value).toBe('799-800');
    expect(carrier.fields.conferenceTitle.value).toBeNull();
    expect(carrier.fields.publisher.value).toBeNull();
  });

  it('does not infer compact conference aliases from article-like DOI slugs when locator cadence is present', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Callahan, J.F. (2015) “Opening Comments: from a video address to those attending Ralph Ellison at 100: A Centennial Symposium, March 8, 2014, Oklahoma City, OK,” American Studies, 54(3), pp. 153–156. Available at: https://doi.org/10.1353/ams.2015.0103.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.journal.value).toBe('American Studies');
    expect(carrier.fields.conferenceTitle.value).toBeNull();
    expect(carrier.fields.publisher.value).toBeNull();
  });

  it('drops preprint-like conferenceTitle spill when repository evidence is present', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock(`Majid, H. et al. (2023) "'A SWOC Analysis of Online Undergraduate Medical Education and its Impact on Cognitive Outcomes: Cross-Sectional Study' (Preprint)." JMIR Publications Inc. Available at: https://doi.org/10.2196/preprints.47303.`),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.repository.value).toBe('JMIR Publications Inc.');
    expect(carrier.fields.conferenceTitle.value).toBeNull();
  });

  it('drops title-embedded conferenceTitle spill when article locators and issn are present', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Callahan, J.F. (2015) “Opening Comments: from a video address to those attending Ralph Ellison at 100: A Centennial Symposium, March 8, 2014, Oklahoma City, OK,” American Studies, 54(3), pp. 153–156. Available at: https://doi.org/10.1353/ams.2015.0103.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.journal.value).toBe('American Studies');
    expect(carrier.fields.conferenceTitle.value).toBeNull();
    expect(carrier.fields.volume.value).toBe('54');
    expect(carrier.fields.issue.value).toBe('3');
    expect(carrier.fields.pages.value).toBe('153-156');
  });

  it('recovers placeholder conference containers for single-author cited slides without swallowing authors', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Kessler, David. “Muon G-2: An Overview [Slides].” 2022, N/A, https://doi.org/10.2172/1877621.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.authors.value).toHaveLength(1);
    expect(carrier.fields.authors.value?.[0]).toMatchObject({
      family: 'Kessler',
      given: 'David',
    });
    expect(carrier.fields.conferenceTitle.value).toBe('N/A');
    expect(carrier.fields.publisher.value).toBe('US DOE');
  });

  it('does not keep webpage site labels as conference titles after propagation cleanup', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Python Software Foundation (2024) Built-in Functions, Python Documentation. Python Software Foundation. Available at: https://docs.python.org/3/library/functions.html.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.conferenceTitle.value).toBeNull();
    expect(carrier.fields.siteName.value).toBe('Python Documentation');
  });

  it('recovers owner-backed webpage site names and drops site-owner journal echoes', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('World Wide Web Consortium. (2023). Web Content Accessibility Guidelines (WCAG) 2.2. World Wide Web Consortium. W3C. https://www.w3.org/TR/WCAG22/'),
        makeRawBlock('[1]Internet Engineering Task Force, “The WebSocket Protocol,” RFC Editor. [Online]. Available: https://www.rfc-editor.org/rfc/rfc6455'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.siteName.value).toBe('W3C');
    expect(carriers[0]?.fields.journal.value).toBeNull();
    expect(carriers[1]?.fields.siteName.value).toBe('RFC Editor');
    expect(carriers[1]?.fields.journal.value).toBeNull();
  });

  it('does not treat journal titles with institutional words as institutions on article citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Quealy-Gainer, K. (2015) “Curiosity House: The Shrunken Head by Lauren Oliver (review),” Bulletin of the Center for Children’s Books, 69(3), pp. 158–158. Available at: https://doi.org/10.1353/bcc.2015.0839.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.journal.value).toBe("Bulletin of the Center for Children's Books");
    expect(carrier.fields.institution.value).toBeNull();
  });

  it('applies doi-backed conference title and publisher hints for endocrine congress citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Максимова, О.В., Чобитько, В.Г. and Мясникова, А.С. (2023) “НАРУШЕНИЯ УГЛЕВОДНОГО ОБМЕНА У ЛИЦ С МЕТАБОЛИЧЕСКИМ СИНДРОМОМ.” ФГБУ «НМИЦ эндокринологии» Минздрава России. Available at: https://doi.org/10.14341/cong23-26.05.23-78.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('НАРУШЕНИЯ УГЛЕВОДНОГО ОБМЕНА У ЛИЦ С МЕТАБОЛИЧЕСКИМ СИНДРОМОМ');
    expect(carrier.fields.conferenceTitle.value).toBe(
      'Сборник тезисов X (XXIX) Национального конгресса эндокринологов с международным участием «Персонализированная медицина и практическое здравоохранение',
    );
    expect(carrier.fields.publisher.value).toBe('ФГБУ «НМИЦ эндокринологии» Минздрава России');
  });

  it('repairs doi-backed numeric conference citations that only expose publisher tails', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Oliveira HL de PR, BRITO JLS. MORFOMETRIA DAS BACIAS HIDROGRÁFICAS DOS CÓRREGOS BOA VISTA E TENDA (BHCBVT), EM UBERLÂNDIA-MG, Revista Multidisciplinar de Educação e Meio Ambiente; 2023. https://doi.org/10.51189/iii-coninters/14933.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe(
      'MORFOMETRIA DAS BACIAS HIDROGRÁFICAS DOS CÓRREGOS BOA VISTA E TENDA (BHCBVT), EM UBERLÂNDIA-MG',
    );
    expect(carrier.fields.conferenceTitle.value).toBe(
      'Anais do III Congresso On-line Internacional de Sustentabilidade',
    );
    expect(carrier.fields.publisher.value).toBe('Revista Multidisciplinar de Educação e Meio Ambiente');
  });

  it('prefers specific doi-backed proceedings titles over generic proceedings series containers', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Adesti MYI, Hidayah N, Rahman DH. Flashbacks of Guidance and Counseling Services in Indonesia, Atlantis Press; 2020. https://doi.org/10.2991/assehr.k.201204.003.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.conferenceTitle.value).toBe(
      'Proceedings of the 6th International Conference on Education and Technology (ICET 2020)',
    );
    expect(carrier.fields.publisher.value).toBe('Atlantis Press');
  });

  it('prefers explicit raw conference publishers over generic doi publisher hints', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]B. Singh, G. Singh, and A. Lee, “Five-Year Carotid Artery Intervention Outcomes,” Thieme Medical and Scientific Publishers Pvt. Ltd., 2023. doi: 10.1055/s-0043-1763383.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.publisher.value).toBe('Thieme Medical and Scientific Publishers Pvt. Ltd');
  });

  it('repairs decimal title fragments that spill into conference publishers', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]ALEMSAN MK, PALADINI EP. MÉTODOS DE AVALIAÇÃO DO NÍVEL DE MATURIDADE DA QUALIDADE 4.0 - UMA ANÁLISE CRÍTICA, ENEGEP 2022 - Encontro Nacional de Engenharia de Produção; 2022. https://doi.org/10.14488/enegep2022_tn_st_385_1907_43154.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe(
      'MÉTODOS DE AVALIAÇÃO DO NÍVEL DE MATURIDADE DA QUALIDADE 4.0 - UMA ANÁLISE CRÍTICA',
    );
    expect(carrier.fields.publisher.value).toBe('ENEGEP 2022 - Encontro Nacional de Engenharia de Produção');
  });

  it('does not turn book title year ranges into article pages or drop the publisher', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Verini, S. (2024). English Women’s Spiritual Utopias, 1400-1700. Springer International Publishing. https://doi.org/10.1007/978-3-031-61854-3'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe("English Women's Spiritual Utopias, 1400-1700");
    expect(carrier.fields.publisher.value).toBe('Springer International Publishing');
    expect(carrier.fields.pages.value).toBeNull();
    expect(carrier.fields.journal.value).toBeNull();
    expect(carrier.fields.institution.value).toBeNull();
  });

  it('does not promote institutional acronyms into conferenceTitle for poster-style citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Brown, T., Smith, A., et al. Poster title [Poster]. US DOE; 2022. https://doi.org/10.2172/1888228'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.conferenceTitle.value).toBeNull();
    expect(carrier.fields.institution.value).toBe('US DOE');
  });

  it('does not convert report-like abstracts publications into conference containers', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Smith, J. Geophysical abstracts. US Geological Survey; 1955. https://doi.org/10.3133/70194121'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.conferenceTitle.value).toBeNull();
    expect(carrier.fields.institution.value).toBe('US Geological Survey');
  });

  it('preserves publisher legal suffixes ending in GmbH & Co. KG', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Example, A. (2020). Polymer handbook. Carl Hanser Verlag GmbH & Co. KG. https://doi.org/10.3139/9783446444683'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.publisher.value).toBe('Carl Hanser Verlag GmbH & Co. KG');
  });

  it('records invalid solitary author spans from ML evidence', async () => {
    process.env.ML_PHASE4_MODE = 'primary';
    process.env.ML_PHASE4_PRIMARY_FRACTION = '1';
    process.env.ML_PHASE4_SHADOW_FRACTION = '0';

    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [makeRawBlock('Smith 2020 Example article Journal of Examples')],
      ctx,
    );

    const phase = new Phase4Extract(createRuntimeStub({
      health: healthOk(),
      extractImpl: async () => ({
        mode: 'primary',
        outcome: 'success',
        attempted: true,
        health: healthOk(),
        response: {
          results: [{
            fields: {
              authors: [{ family: 'Smith', given: null, isCorporate: false }],
              year: 2020,
              title: 'Example article',
              journal: 'Journal of Examples',
            },
            fieldConfidences: {
              authors: 0.51,
              year: 0.97,
              title: 0.82,
              journal: 0.83,
            },
            overallConfidence: 0.78,
            modelVersion: 'mock-crf',
            featureVersion: 'mock-features',
            styleUsed: 'unknown',
            uncertainFields: ['authors'],
            entities: [
              { field: 'authors', tokenStart: 0, tokenEnd: 1, text: 'Smith', confidence: 0.51, valid: false },
              { field: 'year', tokenStart: 1, tokenEnd: 2, text: '2020', confidence: 0.97, valid: true },
            ],
          }],
        },
      }),
    }));

    carriers = await phase.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.healthEvidence.validSpanFields).not.toContain('authors');
    expect(carrier.healthEvidence.invalidSpanFields).toContain('authors');
    expect(carrier.healthEvidence.parserWarnings).toContain('invalid_author_span');
  });

  it('bypasses ML for unsupported AMA style even in primary mode', async () => {
    process.env.ML_PHASE4_MODE = 'primary';
    process.env.ML_PHASE4_PRIMARY_FRACTION = '1';
    process.env.ML_PHASE4_SHADOW_FRACTION = '0';

    const extractSpy = vi.fn();
    const ctx = createTestPipelineContext();
    const carrier = buildReferenceCarrier(makeRawBlock('1. Smith J. Example article. Journal. 2020;12(3):44-50.'), {
      primary: { style: 'ama', confidence: 1 },
      secondary: null,
      isUnknown: false,
      isMultiStyle: false,
    });
    const phase = new Phase4Extract(createRuntimeStub({
      health: healthOk(),
      extractImpl: extractSpy,
    }));

    const [result] = await phase.run([carrier], ctx);

    expect(extractSpy).not.toHaveBeenCalled();
    expect(result?.extractionMeta?.runMode).toBe('heuristic');
  });

  it('sends exact numbered duplicate inputs to Phase 4 ML once per batch', async () => {
    process.env.ML_PHASE4_MODE = 'primary';
    process.env.ML_PHASE4_PRIMARY_FRACTION = '1';
    process.env.ML_PHASE4_SHADOW_FRACTION = '0';

    const extractSpy = vi.fn(async (
      mode: Phase4RequestMode,
      texts: string[],
      _styles: string[],
    ) => ({
      mode,
      outcome: 'success' as const,
      attempted: true,
      health: healthOk(),
      response: {
        results: texts.map(() => ({
          fields: {
            authors: [{ family: 'Smith', given: 'J', isCorporate: false }],
            year: 2020,
            title: 'Example article',
            journal: 'Journal of Examples',
            volume: '12',
            issue: '3',
            pages: '44-50',
          },
          fieldConfidences: {
            authors: 0.92,
            year: 0.95,
            title: 0.93,
            journal: 0.93,
            volume: 0.9,
            issue: 0.9,
            pages: 0.9,
          },
          overallConfidence: 0.92,
          modelVersion: 'mock-crf',
          featureVersion: 'mock-features',
          styleUsed: 'apa7',
          uncertainFields: [],
        })),
      },
    }));
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('1. Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.'),
        makeRawBlock('2. Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.'),
      ],
      ctx,
    );
    const phase = new Phase4Extract(createRuntimeStub({
      health: healthOk(),
      extractImpl: extractSpy,
    }));

    carriers = await phase.run(carriers, ctx);

    expect(extractSpy).toHaveBeenCalledTimes(1);
    expect(extractSpy.mock.calls[0]?.[1]).toHaveLength(1);
    expect(carriers.map((carrier) => carrier.fields.title.value)).toEqual([
      'Example article',
      'Example article',
    ]);
    expect(carriers.map((carrier) => carrier.extractionMeta?.runMode)).toEqual([
      'ml',
      'ml',
    ]);
  });

  it('forces heuristic extraction in core_parse_fast even when phase4 ML is globally primary', async () => {
    process.env.ML_PHASE4_MODE = 'primary';
    process.env.ML_PHASE4_PRIMARY_FRACTION = '1';
    process.env.ML_PHASE4_SHADOW_FRACTION = '0';

    const extractSpy = vi.fn();
    const ctx = createTestPipelineContext({
      options: {
        parseProfile: 'core_parse_fast',
      },
    });
    const carrier = buildReferenceCarrier(
      makeRawBlock('Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.'),
      {
        primary: { style: 'apa7', confidence: 1 },
        secondary: null,
        isUnknown: false,
        isMultiStyle: false,
      },
    );
    const phase = new Phase4Extract(createRuntimeStub({
      health: healthOk(),
      extractImpl: extractSpy,
    }));

    const [result] = await phase.run([carrier], ctx);

    expect(extractSpy).not.toHaveBeenCalled();
    expect(result?.extractionMeta?.runMode).toBe('heuristic');
    expect(result?.stageLog).toEqual([]);
    expect(result?.candidateEnvelope).toBeUndefined();
  });

  it('keeps admin ML override bounded by the configured primary fraction', async () => {
    process.env.BULKREFERENCES_ISOLATED_RUNTIME = 'true';
    process.env.ML_PHASE4_MODE = 'heuristic';
    process.env.ML_PHASE4_PRIMARY_FRACTION = '0';
    process.env.ML_PHASE4_SHADOW_FRACTION = '1';
    await setPhase4OverrideMode('primary');

    const extractSpy = vi.fn(async () => ({
      mode: 'primary' as const,
      outcome: 'success' as const,
      attempted: true,
      health: healthOk(),
      response: {
        results: [{
          fields: {
            title: 'Example article',
            year: 2020,
            journal: 'Journal of Examples',
          },
          fieldConfidences: {
            title: 0.94,
            year: 0.98,
            journal: 0.9,
          },
          overallConfidence: 0.94,
          modelVersion: 'mock-crf',
          featureVersion: 'mock-features',
          styleUsed: 'apa',
          uncertainFields: [],
          entities: [],
        }],
      },
    }));
    const ctx = createTestPipelineContext();
    const carrier = buildReferenceCarrier(
      makeRawBlock('Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.'),
      {
        primary: { style: 'apa7', confidence: 1 },
        secondary: null,
        isUnknown: false,
        isMultiStyle: false,
      },
    );
    const phase = new Phase4Extract(createRuntimeStub({
      health: healthOk(),
      extractImpl: extractSpy,
    }));

    await phase.run([carrier], ctx);

    expect(extractSpy).not.toHaveBeenCalled();
  });

  it('records a shadow diff while keeping heuristic output visible', async () => {
    process.env.ML_PHASE4_MODE = 'shadow';
    process.env.ML_PHASE4_PRIMARY_FRACTION = '0';
    process.env.ML_PHASE4_SHADOW_FRACTION = '1';

    const ctx = createTestPipelineContext();
    const carrier = buildReferenceCarrier(
      makeRawBlock('Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.'),
      {
        primary: { style: 'apa7', confidence: 1 },
        secondary: null,
        isUnknown: false,
        isMultiStyle: false,
      },
    );
    const phase = new Phase4Extract(createRuntimeStub({
      health: healthOk(),
      extractImpl: async () => ({
        mode: 'shadow',
        outcome: 'success',
        attempted: true,
        health: healthOk(),
        response: {
          results: [{
            fields: {
              title: 'Different ML Title',
              year: 2020,
              journal: 'Journal of Examples',
            },
            fieldConfidences: {
              title: 0.92,
              year: 0.98,
              journal: 0.9,
            },
            overallConfidence: 0.93,
            modelVersion: 'mock-crf',
            featureVersion: 'mock-features',
            styleUsed: 'apa',
            uncertainFields: [],
            entities: [
              { field: 'title', tokenStart: 4, tokenEnd: 7, text: 'Different ML Title', confidence: 0.92, valid: true },
            ],
          }],
        },
      }),
    }));

    const [result] = await phase.run([carrier], ctx);

    expect(result?.fields.title.value).toBe('Example article');
    expect(result?.extractionMeta?.runMode).toBe('shadow');
    expect(result?.extractionMeta?.shadowDiff?.perFieldDiff.title).toBe('changed');
    expect(result?.extractionMeta?.modelVersion).toBe('mock-crf');
  });

  it('keeps heuristic runMode with no citation-level mlError when shadow does not execute', async () => {
    process.env.ML_PHASE4_MODE = 'shadow';
    process.env.ML_PHASE4_PRIMARY_FRACTION = '0';
    process.env.ML_PHASE4_SHADOW_FRACTION = '1';

    const ctx = createTestPipelineContext();
    const carrier = buildReferenceCarrier(
      makeRawBlock('Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.'),
      {
        primary: { style: 'apa7', confidence: 1 },
        secondary: null,
        isUnknown: false,
        isMultiStyle: false,
      },
    );
    const phase = new Phase4Extract(createRuntimeStub({
      health: healthOk(),
      extractImpl: async () => ({
        mode: 'shadow',
        outcome: 'shadow_dropped',
        attempted: false,
        health: healthOk(),
      }),
    }));

    const [result] = await phase.run([carrier], ctx);

    expect(result?.extractionMeta?.runMode).toBe('heuristic');
    expect(result?.extractionMeta?.mlError).toBeUndefined();
    expect(result?.extractionMeta?.shadowDiff).toBeUndefined();
  });

  it('falls back to heuristic with mlError for primary runtime skips', async () => {
    process.env.ML_PHASE4_MODE = 'primary';
    process.env.ML_PHASE4_PRIMARY_FRACTION = '1';
    process.env.ML_PHASE4_SHADOW_FRACTION = '0';

    const ctx = createTestPipelineContext();
    const carrier = buildReferenceCarrier(
      makeRawBlock('Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.'),
      {
        primary: { style: 'apa7', confidence: 1 },
        secondary: null,
        isUnknown: false,
        isMultiStyle: false,
      },
    );
    const phase = new Phase4Extract(createRuntimeStub({
      health: healthOk(),
      extractImpl: async () => ({
        mode: 'primary',
        outcome: 'queue_full',
        attempted: false,
        health: healthOk(),
        error: {
          code: 'QUEUE_FULL',
          message: 'Phase 4 queue is full.',
        },
      }),
    }));

    const [result] = await phase.run([carrier], ctx);

    expect(result?.fields.title.value).toBe('Example article');
    expect(result?.extractionMeta?.runMode).toBe('heuristic');
    expect(result?.extractionMeta?.mlError?.code).toBe('QUEUE_FULL');
  });

  it('maps partial ML batch results by response index', async () => {
    process.env.ML_PHASE4_MODE = 'primary';
    process.env.ML_PHASE4_PRIMARY_FRACTION = '1';
    process.env.ML_PHASE4_SHADOW_FRACTION = '0';

    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Smith, J. (2020). First heuristic title. Journal A, 12(3), 44-50.'),
        makeRawBlock('Jones, R. (2021). Second heuristic title. Journal B, 10(2), 11-18.'),
      ],
      ctx,
    );

    const phase = new Phase4Extract(createRuntimeStub({
      health: healthOk(),
      extractImpl: async () => ({
        mode: 'primary',
        outcome: 'partial',
        attempted: true,
        health: healthOk(),
        response: {
          results: [
            null,
            {
              fields: {
                title: 'ML title for second citation',
                year: 2021,
                journal: 'Journal B',
              },
              fieldConfidences: {
                title: 0.94,
                year: 0.98,
                journal: 0.9,
              },
              overallConfidence: 0.94,
              modelVersion: 'mock-crf',
              featureVersion: 'mock-features',
              styleUsed: 'apa',
              uncertainFields: [],
              entities: [],
            },
          ],
          errors: [{ index: 0, code: 'INFERENCE_TIMEOUT' }],
        },
      }),
    }));

    const results = await phase.run(carriers, ctx);

    expect(results[0]?.fields.title.value).toBe('First heuristic title');
    expect(results[0]?.extractionMeta?.runMode).toBe('heuristic');
    expect(results[0]?.extractionMeta?.mlError?.code).toBe('INFERENCE_TIMEOUT');
    expect(results[1]?.fields.title.value).toBe('Second heuristic title');
    expect(results[1]?.extractionMeta?.runMode).toBe('heuristic');
    expect(results[1]?.extractionMeta?.shadowDiff?.perFieldDiff.title).toBe('changed');
  });

  it('applies grounded ML patches for scoped fallback fields in primary mode', async () => {
    process.env.ML_PHASE4_MODE = 'primary';
    process.env.ML_PHASE4_PRIMARY_FRACTION = '1';
    process.env.ML_PHASE4_SHADOW_FRACTION = '0';

    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Doe, J. (2020). Sample title. Proceedings of the Example Conference on Testing. Example Press Ltd.'),
      ],
      ctx,
    );

    const phase = new Phase4Extract(createRuntimeStub({
      health: healthOk(),
      extractImpl: async () => ({
        mode: 'primary',
        outcome: 'success',
        attempted: true,
        health: healthOk(),
        response: {
          results: [
            {
              fields: {
                conferenceTitle: 'Proceedings of the Example Conference on Testing',
                publisher: 'Example Press',
              },
              fieldConfidences: {
                conferenceTitle: 0.93,
                publisher: 0.92,
              },
              overallConfidence: 0.93,
              modelVersion: 'mock-crf',
              featureVersion: 'mock-features',
              styleUsed: 'apa',
              uncertainFields: [],
              entities: [
                { field: 'conferenceTitle', tokenStart: 7, tokenEnd: 14, text: 'Proceedings of the Example Conference on Testing', confidence: 0.93, valid: true },
                { field: 'publisher', tokenStart: 14, tokenEnd: 16, text: 'Example Press', confidence: 0.92, valid: true },
              ],
              bio: {
                tokens: [],
                labels: [],
                offsets: [],
                labelConfidences: [],
                entities: [
                  {
                    label: 'CONFERENCE_TITLE',
                    field: 'conferenceTitle',
                    tokenStart: 7,
                    tokenEnd: 14,
                    charStart: 28,
                    charEnd: 77,
                    text: 'Proceedings of the Example Conference on Testing',
                    confidence: 0.93,
                    valid: true,
                  },
                  {
                    label: 'PUBLISHER',
                    field: 'publisher',
                    tokenStart: 14,
                    tokenEnd: 16,
                    charStart: 79,
                    charEnd: 92,
                    text: 'Example Press',
                    confidence: 0.92,
                    valid: true,
                  },
                ],
                diagnostics: [],
                labelSchemaVersion: 'citation-bio-v1',
                featureVersion: 'mock-features',
                modelVersion: 'mock-crf',
              },
            },
          ],
        },
      }),
    }));

    const [result] = await phase.run(carriers, ctx);

    expect(result?.fields.conferenceTitle.value).toBe('Proceedings of the Example Conference on Testing');
    expect(result?.fields.publisher.value).toBe('Example Press. Ltd');
    expect(result?.fields.conferenceTitle.source).toBe('ml_extraction');
    expect(result?.fields.publisher.source).toBe('ml_extraction');
    expect(result?.extractionMeta?.runMode).toBe('ml');
    expect(result?.extractionMeta?.bio?.entities).toHaveLength(2);
    expect(result?.extractionMeta?.shadowDiff?.perFieldDiff.publisher).toBe('changed');
  });

  it('expands abbreviated Vancouver page ranges during heuristic extraction', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Gomes MA, Kovaleski JL, Pagani RN, da Silva VL. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology. 2022 Oct 3;46(7):608-16.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.pages.value).toBe('608-616');
    expect(carrier.healthEvidence.validSpanFields).toContain('pages');
  });

  it('cleans conference year and date noise from conference titles', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Shailaja K, Seetharamulu B, Jabbar MA. Machine learning in healthcare: A review. In 2018 Second International Conference on Electronics, Communication and Aerospace Technology (ICECA) 2018 Mar 29 (pp. 910-914). IEEE.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Machine learning in healthcare: A review');
    expect(carrier.fields.year.value).toBe(2018);
    expect(carrier.fields.conferenceTitle.value).toBe('Second International Conference on Electronics, Communication and Aerospace Technology (ICECA)');
  });

  it('prefers the quoted IEEE title and backfills conference aliases across same-doi siblings', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]S. Garg, A. Mittal, and V. Sathiyasuntharam, "Deep Learning Based Model to Recommend Safe Route Navigation System," IEEE, 2025, pp. 181-186, doi: 10.1109/CICTN64563.2025.10932570.'),
        makeRawBlock('Garg, S., Mittal, A. and Sathiyasuntharam, V. (2025) Deep Learning Based Model to Recommend Safe Route Navigation System. CICTN. Available at: https://doi.org/10.1109/CICTN64563.2025.10932570.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]!.fields.title.value).toBe('Deep Learning Based Model to Recommend Safe Route Navigation System');
    expect(carriers[0]!.fields.conferenceTitle.value).toBe('2025 2nd International Conference on Computational Intelligence, Communication Technology and Networking (CICTN)');
  });

  it('does not infer a patent identifier from a plain publication year', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Rebel, A., & Schell, R. (2015). Faust’s Anesthesiology Review, 4th ed. Anesthesia & Analgesia, 120(4), 953. doi:10.1213/ANE.0000000000000588'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.year.value).toBe(2015);
    expect(carrier.fields.patent.value).toBeNull();
  });

  it('extracts IEEE journal locators when the citation uses smart quotes and a trailing DOI tail', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]I. L. Bird, “A Lady’s Life in the Rocky Mountains,” Victorian Review, vol. 23, no. 2, pp. 167–167, 1997, doi: 10.1353/vcr.1997.0036.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe("A Lady's Life in the Rocky Mountains");
    expect(carrier.fields.year.value).toBe(1997);
    expect(carrier.fields.journal.value).toBe('Victorian Review');
    expect(carrier.fields.volume.value).toBe('23');
    expect(carrier.fields.issue.value).toBe('2');
    expect(carrier.fields.pages.value).toBe('167-167');
    expect(carrier.fields.url.value).toBe('https://doi.org/10.1353/vcr.1997.0036');
    expect(carrier.fields.doi.value).toBe('10.1353/vcr.1997.0036');
  });

  it('extracts book chapter container and publisher from author-date citations with DOI tails', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Yakimenko, V. V. (2019). The Major Rivers and the Genesis of the Recent Area of Ticks Ixodes persulcatus in Western Siberia. In Parasitology Research Monographs (pp. 367–381). Springer International Publishing. https://doi.org/10.1007/978-3-030-29061-0_16'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('The Major Rivers and the Genesis of the Recent Area of Ticks Ixodes persulcatus in Western Siberia');
    expect(carrier.fields.bookTitle.value).toBe('Parasitology Research Monographs');
    expect(carrier.fields.pages.value).toBe('367-381');
    expect(carrier.fields.publisher.value).toBe('Springer International Publishing');
    expect(carrier.fields.doi.value).toBe('10.1007/978-3-030-29061-0_16');
  });

  it('extracts webpage title and site name without inventing an author segment', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Export of UDP Options Information in IP Flow Information Export (IPFIX). (2025). RFC Editor. https://www.rfc-editor.org/rfc/rfc9870.html'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.authors.value).toEqual([]);
    expect(carrier.fields.title.value).toBe('Export of UDP Options Information in IP Flow Information Export (IPFIX)');
    expect(carrier.fields.year.value).toBe(2025);
    expect(carrier.fields.siteName.value).toBe('RFC Editor');
    expect(carrier.fields.url.value).toBe('https://www.rfc-editor.org/rfc/rfc9870.html');
  });

  it('extracts Chicago webpage owner tails with the site name instead of downgrading them into book containers', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Internet Engineering Task Force. “The Transport Layer Security (TLS) Protocol Version 1.3.” RFC Editor, Internet Engineering Task Force, 2018. https://www.rfc-editor.org/rfc/rfc8446.'),
        makeRawBlock('Mozilla Contributors. “Array.Prototype.Map().” MDN Web Docs, Mozilla Contributors, 2024. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe('The Transport Layer Security (TLS) Protocol Version 1.3');
    expect(carriers[0]?.fields.siteName.value).toBe('RFC Editor');
    expect(carriers[0]?.fields.bookTitle.value).toBeNull();
    expect(carriers[1]?.fields.title.value).toBe('Array.Prototype.Map()');
    expect(carriers[1]?.fields.siteName.value).toBe('MDN Web Docs');
    expect(carriers[1]?.fields.bookTitle.value).toBeNull();
  });

  it('repairs vancouver owner-site webpages without swapping institutional owners into siteName', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Internet Engineering Task Force. QUIC: A UDP-Based Multiplexed and Secure Transport. RFC Editor 2021. https://www.rfc-editor.org/rfc/rfc9000.'),
        makeRawBlock('[1]Ecma International. ECMAScript 2024 Language Specification. ECMAScript 2024. https://tc39.es/ecma262/.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe('QUIC: A UDP-Based Multiplexed and Secure Transport');
    expect(carriers[0]?.fields.siteName.value).toBe('RFC Editor');
    expect(carriers[0]?.fields.institution.value).toBe('Internet Engineering Task Force');

    expect(carriers[1]?.fields.title.value).toBe('ECMAScript 2024 Language Specification');
    expect(carriers[1]?.fields.siteName.value).toBe('ECMAScript');
    expect(carriers[1]?.fields.institution.value).toBe('Ecma International');
  });

  it('prefers webpage site names recovered from bookTitle-like tails over repeated corporate owners', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('React Team. “State: A Component’s Memory.” React, React Team, 2024. https://react.dev/learn/state-a-components-memory.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe("State: A Component's Memory");
    expect(carrier.fields.siteName.value).toBe('React');
    expect(carrier.fields.bookTitle.value).toBeNull();
    expect(carrier.fields.url.value).toBe('https://react.dev/learn/state-a-components-memory');
  });

  it('extracts thesis institution from bracketed author-date citations without swallowing the DOI suffix', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Botter Junior, W. (2021). Relações interfaciais de poli(dimetilsiloxano) com solidos inorganicos [Dissertation, Universidade Estadual de Campinas]. https://doi.org/10.47749/t/unicamp.1997.133750'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Relações interfaciais de poli(dimetilsiloxano) com solidos inorganicos');
    expect(carrier.fields.thesisType.value).toBe('Dissertation');
    expect(carrier.fields.institution.value).toBe('Universidade Estadual de Campinas');
    expect(carrier.fields.doi.value).toBe('10.47749/t/unicamp.1997.133750');
  });

  it('keeps thesis tails out of conferenceTitle for non-bracketed thesis citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Botter Junior, Wilson. “Relações Interfaciais de Poli(Dimetilsiloxano) Com Solidos Inorganicos.” Dissertation, Universidade Estadual de Campinas, 2021. https://doi.org/10.47749/t/unicamp.1997.133750.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Relações Interfaciais de Poli(Dimetilsiloxano) Com Solidos Inorganicos');
    expect(carrier.fields.thesisType.value).toBe('Dissertation');
    expect(carrier.fields.institution.value).toBe('Universidade Estadual de Campinas');
    expect(carrier.fields.conferenceTitle.value).toBeNull();
  });

  it('treats acronym publisher tails as report institutions instead of conference containers', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Vaillancourt, F., & Magnan, M. (2022). Le partage du financement des services de l’agglomération de Montréal en 2020: État des lieux, analyse et éléments de comparaison. CIRANO. https://doi.org/10.54932/cvub5177'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.institution.value).toBe('CIRANO');
    expect(carrier.fields.conferenceTitle.value).toBeNull();
  });

  it('extracts Vancouver article fields when the citation omits an issue number', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Rebel A, Schell R. Faust’s Anesthesiology Review, 4th ed. Anesthesia & Analgesia 2015;120:953. https://doi.org/10.1213/ane.0000000000000588.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe("Faust's Anesthesiology Review, 4th ed");
    expect(carrier.fields.journal.value).toBe('Anesthesia & Analgesia');
    expect(carrier.fields.volume.value).toBe('120');
    expect(carrier.fields.pages.value).toBe('953');
    expect(carrier.fields.year.value).toBe(2015);
  });

  it('extracts book chapter container, publisher, and pages from IEEE in-collection citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]V. V. Yakimenko, “The Major Rivers and the Genesis of the Recent Area of Ticks Ixodes persulcatus in Western Siberia,” in Parasitology Research Monographs, Springer International Publishing, 2019, pp. 367–381. doi: 10.1007/978-3-030-29061-0_16.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('The Major Rivers and the Genesis of the Recent Area of Ticks Ixodes persulcatus in Western Siberia');
    expect(carrier.fields.bookTitle.value).toBe('Parasitology Research Monographs');
    expect(carrier.fields.publisher.value).toBe('Springer International Publishing');
    expect(carrier.fields.pages.value).toBe('367-381');
    expect(carrier.fields.isbn.value).toBe('9783030290603');
  });

  it('keeps proceedings book chapters with hyphen-suffixed DOI ISBNs as book chapters across styles', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Djamarin, D. (2019) “Adaptation Novel to Film: Contribution Malay Literary,” Proceeding of The 13th International Conference onMalaysia-Indonesia Relations (PAHMI). Sciendo, pp. 142–146. Available at: https://doi.org/10.2478/9783110680003-027.'),
        makeRawBlock('Djamarin, Djusmalinar. “Adaptation Novel to Film: Contribution Malay Literary.” Proceeding of The 13th International Conference onMalaysia-Indonesia Relations (PAHMI), Sciendo, 2019, pp. 142–46, https://doi.org/10.2478/9783110680003-027.'),
        makeRawBlock('Djamarin, Djusmalinar. “Adaptation Novel to Film: Contribution Malay Literary.” In Proceeding of The 13th International Conference onMalaysia-Indonesia Relations (PAHMI). Sciendo, 2019. https://doi.org/10.2478/9783110680003-027.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    for (const carrier of carriers) {
      expect(carrier?.fields.title.value).toBe('Adaptation Novel to Film: Contribution Malay Literary');
      expect(carrier?.fields.bookTitle.value).toBe('Proceeding of The 13th International Conference onMalaysia-Indonesia Relations (PAHMI)');
      expect(carrier?.fields.publisher.value).toBe('Sciendo');
      expect(carrier?.fields.isbn.value).toBe('9783110680003');
      expect(carrier?.fields.conferenceTitle.value).toBeNull();
    }

    expect(carriers[0]?.fields.pages.value).toBe('142-146');
  });

  it('extracts publisher and identifier-derived ISBN for late-year book citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]C. B. Albright, American Woman, Italian Style. Fordham University Press, 2022. doi: 10.1515/9780823290840.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('American Woman, Italian Style');
    expect(carrier.fields.publisher.value).toBe('Fordham University Press');
    expect(carrier.fields.isbn.value).toBe('9780823290840');
  });

  it('extracts site names from IEEE webpage citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]“Export of UDP Options Information in IP Flow Information Export (IPFIX),” RFC Editor. [Online]. Available: https://www.rfc-editor.org/rfc/rfc9870.html'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Export of UDP Options Information in IP Flow Information Export (IPFIX)');
    expect(carrier.fields.siteName.value).toBe('RFC Editor');
    expect(carrier.fields.url.value).toBe('https://www.rfc-editor.org/rfc/rfc9870.html');
  });

  it('preserves institutional owners on corporate webpages alongside the site name', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Internet Engineering Task Force. (2018). The Transport Layer Security (TLS) Protocol Version 1.3. Internet Engineering Task Force. RFC Editor. https://www.rfc-editor.org/rfc/rfc8446'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.institution.value).toBe('Internet Engineering Task Force');
    expect(carrier.fields.siteName.value).toBe('RFC Editor');
  });

  it('propagates missing container fields across citations that share the same DOI', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Gebreegziabher, T., & Gebreeyesus, F. (2023). Biomass Waste to Energy for a Particleboards Industry. International Conference on Energy Harvesting, Storage, and Transfer. https://doi.org/10.11159/ehst23.123'),
        makeRawBlock('[1]T. Gebreegziabher and F. Gebreeyesus, “Biomass Waste to Energy for a Particleboards Industry,” Avestia Publishing, 2023. doi: 10.11159/ehst23.123.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const conferenceCarrier = carriers[1]!;

    expect(conferenceCarrier.fields.conferenceTitle.value).toBe('International Conference on Energy Harvesting, Storage, and Transfer');
    expect(conferenceCarrier.fields.title.value).toBe('Biomass Waste to Energy for a Particleboards Industry');
  });

  it('extracts journal locators and synthesizes a DOI URL for IEEE article citations without pages', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]N. Tiwari, “Merger Under The Regime of Competition Law: A Comparative Study of Indian Legal Framework With EC and UK,” Bond Law Review, vol. 23, no. 1, 2011, doi: 10.53300/001c.5580.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Merger Under The Regime of Competition Law: A Comparative Study of Indian Legal Framework With EC and UK');
    expect(carrier.fields.journal.value).toBe('Bond Law Review');
    expect(carrier.fields.volume.value).toBe('23');
    expect(carrier.fields.issue.value).toBe('1');
    expect(carrier.fields.url.value).toBe('https://doi.org/10.53300/001c.5580');
  });

  it('prefers publisher over site name for DOI-backed books with available-at tails', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Albright, C.B. (2022) American Woman, Italian Style. Fordham University Press. Available at: https://doi.org/10.1515/9780823290840.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.publisher.value).toBe('Fordham University Press');
    expect(carrier.fields.siteName.value).toBeNull();
    expect(carrier.fields.url.value).toBe('https://doi.org/10.1515/9780823290840');
  });

  it('prefers institutions over site names for DOI-backed report citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('US Geological Survey (1914) Results of spirit leveling in Kansas, 1896 to 1913, inclusive. US Geological Survey. Available at: https://doi.org/10.3133/b571.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.institution.value).toBe('US Geological Survey');
    expect(carrier.fields.siteName.value).toBeNull();
    expect(carrier.fields.pages.value).toBeNull();
  });

  it('promotes conference-like publisher tails into conference titles for Spanish congress citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Contreras, M. L., Vargas, J. M., Rodríguez, S., Laserna, C., Esteves, J. A., & Gajate, A. (2023). Anafilaxia inducida por ejercicio: a propósito de un caso. XXIX Congreso Nacional de Medicina General y de Familia y V Jornadas SEMG Andalucía Abstracts Publication. https://doi.org/10.48158/semg23-144'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.conferenceTitle.value).toBe('XXIX Congreso Nacional de Medicina General y de Familia y V Jornadas SEMG Andalucía Abstracts Publication');
    expect(carrier.fields.publisher.value).toBe('Grupo Pacífico');
  });

  it('infers conference containers from proceedings-style uppercase remainder text', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Trаtsiak, A. I. (2022). THE 100-YEAR HISTORY OF THE NATIONAL LIBRARY OF BELARUS IN THE AUDIO-VISUAL DOCUMENTS OF THE BELARUSIAN STATE ARCHIVES OF FILMS, PHOTOGRAPHS AND SOUND. LIBRARIES IN THE INFORMATION SOCIETY: PRESERVING TRADITIONS AND DEVELOPING NEW TECHNOLOGIES. https://doi.org/10.47612/978-985-880-283-7-2022-310-324'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.conferenceTitle.value).toBe('LIBRARIES IN THE INFORMATION SOCIETY: PRESERVING TRADITIONS AND DEVELOPING NEW TECHNOLOGIES');
    expect(carrier.fields.institution.value).toBeNull();
  });

  it('keeps in-collection book chapter parsing ahead of generic publisher-tail parsing', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Danielmeyer, G. (2022). Verfahrensdokumentation. In Steuerrecht und Steuerberatung (pp. 105–116). Erich Schmidt Verlag GmbH & Co. KG. https://doi.org/10.37307/b.978-3-503-20045-0.08'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Verfahrensdokumentation');
    expect(carrier.fields.bookTitle.value).toBe('Steuerrecht und Steuerberatung');
    expect(carrier.fields.publisher.value).toBe('Erich Schmidt Verlag GmbH & Co. KG');
    expect(carrier.fields.pages.value).toBe('105-116');
  });

  it('does not promote report institutions into conference titles for Vancouver institutional tails', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Vaillancourt T, Brittain H, Krygsman A, Farrell AH, Landon S, Pepler D. School readiness in 4-year-old very preterm and full-term children associated with aggressive behaviour and peer play. CIRANO; 2022. https://doi.org/10.54932/tcby3094.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.conferenceTitle.value).toBeNull();
    expect(carrier.fields.institution.value).toBe('CIRANO');
  });

  it('cleans repeated institutional tails so standards references stay reports instead of book chapters', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]BSI British Standards, “Lamps for road vehicles. Dimensional, electrical and luminous requirements,” BSI British Standards, 2013. doi: 10.3403/01032627.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Lamps for road vehicles. Dimensional, electrical and luminous requirements');
    expect(carrier.fields.institution.value).toBe('BSI British Standards');
    expect(carrier.fields.bookTitle.value).toBeNull();
  });

  it('recovers owner-year corporate reports without emitting a corporate author', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('BSI British Standards. Live Working. Portable Phase Comparators for Use on Voltages from 1 kV to 36 kV a.c. BSI British Standards, 2015. https://doi.org/10.3403/30267622u.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Live Working. Portable Phase Comparators for Use on Voltages from 1 kV to 36 kV a.c');
    expect(carrier.fields.institution.value).toBe('BSI British Standards');
    expect(carrier.fields.authors.value).toEqual([]);
    expect(carrier.fields.conferenceTitle.value).toBeNull();
    expect(carrier.fields.publisher.value).toBeNull();
  });

  it('suppresses mirrored corporate authors after final propagation for repeated-owner reports', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('US Geological Survey. Results of Spirit Leveling in Kansas, 1896 to 1913, Inclusive. US Geological Survey, 1914, https://doi.org/10.3133/b571.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.institution.value).toBe('US Geological Survey');
    expect(carrier.fields.authors.value).toEqual([]);
  });

  it('extracts quoted-title preprint repositories without swallowing the title into publisher text', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Awang, Noor Azura, et al. “Optical Trapping Using Mode-Locked Fiber Laser Au-Np Coated Side-Polished Fiber.” Elsevier BV, 2023, https://doi.org/10.2139/ssrn.4577205.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Optical Trapping Using Mode-Locked Fiber Laser Au-Np Coated Side-Polished Fiber');
    expect(carrier.fields.repository.value).toBe('Elsevier BV');
    expect(carrier.fields.authors.value).not.toHaveLength(0);
  });

  it('infers preprint ids from preprints.org DOI tails when explicit arxiv text is absent', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Saavedra, E. G. (2023). Chilean Student Teachers’ Willingness to Learn with Gamified Systems. MDPI AG. https://doi.org/10.20944/preprints202309.0516.v1'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.arxiv.value).toBe('2309.0516');
  });

  it('does not infer arxiv ids from conference-style DOIs that only contain year-like segments', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Pain, S., & Acharjee, P. (2016). Solution to security constrained LFC system using chaos based exponential PSO algorithm. 3rd International Conference on Electrical, Electronics, Engineering Trends, Communication, Optimization and Sciences (EEECOS 2016). https://doi.org/10.1049/cp.2016.1556'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.arxiv.value).toBeNull();
    expect(carrier.fields.conferenceTitle.value).toBe(
      '3rd International Conference on Electrical, Electronics, Engineering Trends, Communication, Optimization and Sciences (EEECOS 2016)',
    );
  });

  it('infers ISBNs from dotted and embedded DOI book identifiers', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('FURLAN, V. BIOPOLÍTICA, RECONHECIMENTO E IDENTIDADE. EDITORA CRV, 2020. doi: 10.24824/978655578779.5.'),
        makeRawBlock('Loizou, C.P. and Pattichis, C.S. (2008) Despeckle Filtering Algorithms and Software for Ultrasound Imaging. Springer International Publishing. Available at: https://doi.org/10.1007/978-3-031-01510-6.'),
        makeRawBlock('Herschel, W. (2013). The Scientific Papers of Sir William Herschel. Cambridge University Press. https://doi.org/10.1017/cbo9781139649650'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.isbn.value).toBe('9786555787795');
    expect(carriers[1]?.fields.isbn.value).toBe('9783031015106');
    expect(carriers[2]?.fields.isbn.value).toBe('9781139649650');
  });

  it('prefers the parent print ISBN for plain Springer International Publishing book DOIs', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Taylor, M. (2015). Quantum Microscopy of Biological Systems. Springer International Publishing. https://doi.org/10.1007/978-3-319-18938-3'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.isbn.value).toBe('9783319189376');
  });

  it('keeps known Springer book DOI slugs on the electronic ISBN when the corpus expects that surface value', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Gupta, N. (2022). Endoscopic Balloon Dacryoplasty in Congenital Nasolacrimal Duct Obstruction. Springer Nature Singapore. https://doi.org/10.1007/978-981-19-6109-0'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.isbn.value).toBe('9789811961090');
  });

  it('infers ISBNs from chapter DOI tails with underscore and dotted chapter suffixes', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Grunow, D., & Khoudja, Y. (2024). Multidimensionalität sozialstrukturellen Wandels. In Handbuch Sozialstrukturanalyse (pp. 1–36). Springer Fachmedien Wiesbaden. https://doi.org/10.1007/978-3-658-39759-3_6-1'),
        makeRawBlock('Zhao, W. (2014). Pro-poor tourism. In Encyclopedia of Tourism (pp. 1–2). Springer International Publishing. https://doi.org/10.1007/978-3-319-01669-6_152-1'),
        makeRawBlock('Hatala, B. (2021). Gas Cooled Fast Reactor System (GFR). In Encyclopedia of Nuclear Energy (pp. 545–552). Elsevier. https://doi.org/10.1016/b978-0-12-409548-9.12207-9'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.isbn.value).toBe('9783658397593');
    expect(carriers[1]?.fields.isbn.value).toBe('9783319016696');
    expect(carriers[2]?.fields.isbn.value).toBe('9780124095489');
  });

  it('uses local journal hints to backfill ISSN when the citation text omits it', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]N. Tiwari, “Merger Under The Regime of Competition Law: A Comparative Study of Indian Legal Framework With EC and UK,” Bond Law Review, vol. 23, no. 1, 2011, doi: 10.53300/001c.5580.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.journal.value).toBe('Bond Law Review');
    expect(carrier.fields.issn.value).toBe('22024824');
  });

  it('extracts quoted author-date journal articles without collapsing the title into author text', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Rebel, A. and Schell, R. (2015) “Faust’s Anesthesiology Review, 4th ed.,” Anesthesia & Analgesia, 120(4), p. 953. Available at: https://doi.org/10.1213/ane.0000000000000588.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.authors.value).toHaveLength(2);
    expect(carrier.fields.title.value).toBe("Faust's Anesthesiology Review, 4th ed");
    expect(carrier.fields.journal.value).toBe('Anesthesia & Analgesia');
    expect(carrier.fields.volume.value).toBe('120');
    expect(carrier.fields.issue.value).toBe('4');
    expect(carrier.fields.pages.value).toBe('953');
  });

  it('extracts quoted author-date publisher tails without swallowing the title into et al or author fragments', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Elgaafary, S. et al. (2020) “Dauerhaftes Ansprechen auf Olaparib und endokrine Therapie bei einer Patientin mit metastasiertem luminalem Mammakarzinom und gBRCA-Mutation.” © Georg Thieme Verlag KG. Available at: https://doi.org/10.1055/s-0040-1714539.'),
        makeRawBlock('Paulo Santos da Silva, M. and de Paula Martins, C. (2023) “FORMAÇÃO POR COMPETÊNCIAS TRANSVERSAIS DE ENGENHEIROS CIVIS NA GEOTECNIA: O PAPEL DA ATIVIDADE DE MONITORIA.” Associação Brasileira de Educação em Engenharia. Available at: https://doi.org/10.37702/2175-957x.cobenge.2023.4540.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe(
      'Dauerhaftes Ansprechen auf Olaparib und endokrine Therapie bei einer Patientin mit metastasiertem luminalem Mammakarzinom und gBRCA-Mutation',
    );
    expect(carriers[0]?.fields.publisher.value).toBe('© Georg Thieme Verlag KG');
    expect(carriers[1]?.fields.authors.value).toHaveLength(2);
    expect(carriers[1]?.fields.title.value).toBe(
      'FORMAÇÃO POR COMPETÊNCIAS TRANSVERSAIS DE ENGENHEIROS CIVIS NA GEOTECNIA: O PAPEL DA ATIVIDADE DE MONITORIA',
    );
    expect(carriers[1]?.fields.conferenceTitle.value).toBe('Associação Brasileira de Educação em Engenharia');
    expect(carriers[1]?.fields.publisher.value).toBe('Associação Brasileira de Educação em Engenharia');
  });

  it('extracts Chicago in-collection chapters without false patent ids or title corruption', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Görling, Reinhold. “Pursuing Emptiness: Obsession and (Im) Potence in Kathryn Bigelow’s Blue Steel (US 1990).” In From La Strada to The Hours. Springer Berlin Heidelberg, 2024. https://doi.org/10.1007/978-3-662-68789-5_22.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.patent.value).toBeNull();
    expect(carrier.fields.year.value).toBe(2024);
    expect(carrier.fields.title.value).toBe(
      "Pursuing Emptiness: Obsession and (Im) Potence in Kathryn Bigelow's Blue Steel (US 1990)",
    );
    expect(carrier.fields.bookTitle.value).toBe('From La Strada to The Hours');
    expect(carrier.fields.publisher.value).toBe('Springer Berlin Heidelberg');
  });

  it('strips swallowed In-container text from book-chapter publishers', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Streeten, Paul. “Towards a Country and Crop Typology.” In What Price Food? Palgrave Macmillan UK, 1987. https://doi.org/10.1007/978-1-349-18921-2_3.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.bookTitle.value).toBe('What Price Food');
    expect(carrier.fields.publisher.value).toBe('Palgrave Macmillan UK');
  });

  it('recovers missing book titles from non-In chapter tails across styles', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Whitehead, G.W. (1989) “The work of Edgar H. Brown, Jr. in Topology,” Lecture Notes in Mathematics. Springer Berlin Heidelberg, pp. 10–14. Available at: https://doi.org/10.1007/bfb0085214.'),
        makeRawBlock('[1]Whitehead GW. The work of Edgar H. Brown, Jr. in Topology. Lecture Notes in Mathematics, Springer Berlin Heidelberg; 1989, p. 10–4. https://doi.org/10.1007/bfb0085214.'),
        makeRawBlock('Schaepkens, S.P.C. and Coccia, C.Q.H. (2022) “In Pursuit of Time: An Inquiry into Kairos and Reflection in Medical Practice and Health Professions Education,” Applied Philosophy for Health Professions Education. Springer Nature Singapore, pp. 311–324. Available at: https://doi.org/10.1007/978-981-19-1512-3_21.'),
        makeRawBlock('[1]Schaepkens SPC, Coccia CQH. In Pursuit of Time: An Inquiry into Kairos and Reflection in Medical Practice and Health Professions Education. Applied Philosophy for Health Professions Education, Springer Nature Singapore; 2022, p. 311–24. https://doi.org/10.1007/978-981-19-1512-3_21.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.bookTitle.value).toBe('Lecture Notes in Mathematics');
    expect(carriers[0]?.fields.publisher.value).toBe('Springer Berlin Heidelberg');
    expect(carriers[1]?.fields.bookTitle.value).toBe('Lecture Notes in Mathematics');
    expect(carriers[1]?.fields.publisher.value).toBe('Springer Berlin Heidelberg');
    expect(carriers[2]?.fields.bookTitle.value).toBe('Applied Philosophy for Health Professions Education');
    expect(carriers[2]?.fields.publisher.value).toBe('Springer Nature Singapore');
    expect(carriers[3]?.fields.bookTitle.value).toBe('Applied Philosophy for Health Professions Education');
    expect(carriers[3]?.fields.publisher.value).toBe('Springer Nature Singapore');
  });

  it('does not let page ranges or dotted initials corrupt book-chapter publishers', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Orós, J. (2019) “Gout,” Mader’s Reptile and Amphibian Medicine and Surgery. Elsevier, pp. 1308-1309.e1. Available at: https://doi.org/10.1016/b978-0-323-48253-0.00151-3.'),
        makeRawBlock('Lesniak, S. (2020). Morgenstern, Christian. In Kindlers Literatur Lexikon (KLL) (pp. 1–1). J.B. Metzler. https://doi.org/10.1007/978-3-476-05728-0_12531-1'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.bookTitle.value).toBe("Mader's Reptile and Amphibian Medicine and Surgery");
    expect(carriers[0]?.fields.publisher.value).toBe('Elsevier');
    expect(carriers[1]?.fields.publisher.value).toBe('J.B. Metzler');
  });

  it('strips trailing title numerals from publisher spillover in books', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Crastan, Valentin. Klimawirksame Kennzahlen Band I. Springer Fachmedien Wiesbaden, 2020. https://doi.org/10.1007/978-3-658-30335-8.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe('Klimawirksame Kennzahlen Band I');
    expect(carriers[0]?.fields.publisher.value).toBe('Springer Fachmedien Wiesbaden');
  });

  it('removes leading year spill from recovered conference titles', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Leal, P. B., Giblette, T., Hunsaker, D. F., & Hartl, D. J. (2019). Extended 3D Class/Shape Transformation equations for multicomponent aircraft assemblies. AIAA Scitech 2019 Forum. https://doi.org/10.2514/6.2019-0604'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.conferenceTitle.value).toBe('AIAA Scitech 2019 Forum');
  });

  it('reclaims journal-like conference containers with article locators back into the journal field', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Proehl, K. B. (2015). Tomboyism and Familial Belonging in Carson McCullers’s The Member of the Wedding : Queer Sentiments. Jeunesse: Young People, Texts, Cultures, 7(1), 87–109. https://doi.org/10.1353/jeu.2015.0002'),
        makeRawBlock('Ratnamiasih, I. & Widi Andini. (2023). ANALISIS BEBAN KERJA PADA PT. BPR SUBANG GEMI NASTITI (PERSERODA) KANTOR PUSAT OPERASIONAL DI KOTA SUBANG. Brainy: Jurnal Riset Mahasiswa, 4(1), 29–34. https://doi.org/10.23969/brainy.v4i1.54'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.journal.value).toBe('Jeunesse: Young People, Texts, Cultures');
    expect(carriers[0]?.fields.conferenceTitle.value).toBeNull();
    expect(carriers[1]?.fields.journal.value).toBe('Brainy: Jurnal Riset Mahasiswa');
    expect(carriers[1]?.fields.conferenceTitle.value).toBeNull();
  });

  it('promotes recovered venue tails into conference titles for conference-like records', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Elgaafary, S., Hlevnjak, M., Schulze, M., Thewes, V., Seitz, J., Fremd, C., Michel, L., Beck, K., Pfütze, K., Richter, D., Wolf, S., Pixberg, C., Hutter, B., Ishaque, N., Hirsch, S., Gieldon, L., Stenzinger, A., Springfeld, C., Kreutzfeld, S., Schneeweiss, A. (2020). Dauerhaftes Ansprechen auf Olaparib und endokrine Therapie bei einer Patientin mit metastasiertem luminalem Mammakarzinom und gBRCA-Mutation. Geburtshilfe und Frauenheilkunde. https://doi.org/10.1055/s-0040-1714539'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(
      carriers[0]?.fields.conferenceTitle.value ?? carriers[0]?.fields.journal.value,
    ).toBe('Geburtshilfe und Frauenheilkunde');
    expect(carriers[0]?.fields.publisher.value).toBe('© Georg Thieme Verlag KG');
  });

  it('extracts Vancouver conference publisher tails with et al author lists', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Pashaei Adl H, Gorji S, Muñoz Matutano G, Gualdrón-Reyes AF, Suárez I, S. Chirvony V, et al. The thermal decoherence of superradiance in halide perovskite supercrystals, FUNDACIO DE LA COMUNITAT VALENCIANA SCITO; 2022. https://doi.org/10.29363/nanoge.emlem.2022.044.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.style.primary.style).toBe('vancouver');
    expect(carrier.fields.authors.value).toHaveLength(6);
    expect(carrier.fields.title.value).toBe('The thermal decoherence of superradiance in halide perovskite supercrystals');
    expect(carrier.fields.conferenceTitle.value).toBe('FUNDACIO DE LA COMUNITAT VALENCIANA SCITO');
    expect(carrier.fields.publisher.value).toBe('FUNDACIO DE LA COMUNITAT VALENCIANA SCITO');
    expect(carrier.fields.year.value).toBe(2022);
  });

  it('recovers AIAA as publisher from DOI-backed conference citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Bonhomme, C. et al. (2006) “French / Russian activities on LOX - LCH4 area.” Available at: https://doi.org/10.2514/6.iac-06-c4.3.07.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.publisher.value).toBe('American Institute of Aeronautics and Astronautics');
    expect(carrier.fields.conferenceTitle.value).toBe('57th International Astronautical Congress');
  });

  it('propagates proceedings titles across DOI sibling conference citations with institutional tails', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Pashaei Adl, H., Gorji, S., Muñoz Matutano, G., Gualdrón-Reyes, A. F., Suárez, I., S. Chirvony, V., Mora-Seró, I., & Martínez-Pastor, J. P. (2022). The thermal decoherence of superradiance in halide perovskite supercrystals. Proceedings of the International Conference on Emerging Light Emitting Materials. https://doi.org/10.29363/nanoge.emlem.2022.044'),
        makeRawBlock('Pashaei Adl, H. et al. (2022) “The thermal decoherence of superradiance in halide perovskite supercrystals.” FUNDACIO DE LA COMUNITAT VALENCIANA SCITO. Available at: https://doi.org/10.29363/nanoge.emlem.2022.044.'),
        makeRawBlock('[1]Pashaei Adl H, Gorji S, Muñoz Matutano G, Gualdrón-Reyes AF, Suárez I, S. Chirvony V, et al. The thermal decoherence of superradiance in halide perovskite supercrystals, FUNDACIO DE LA COMUNITAT VALENCIANA SCITO; 2022. https://doi.org/10.29363/nanoge.emlem.2022.044.'),
        makeRawBlock('[1]H. Pashaei Adl et al., “The thermal decoherence of superradiance in halide perovskite supercrystals,” FUNDACIO DE LA COMUNITAT VALENCIANA SCITO, 2022. doi: 10.29363/nanoge.emlem.2022.044.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    for (const carrier of carriers) {
      expect(carrier?.fields.conferenceTitle.value).toBe('Proceedings of the International Conference on Emerging Light Emitting Materials');
      expect(carrier?.fields.publisher.value).toBe('FUNDACIO DE LA COMUNITAT VALENCIANA SCITO');
    }
  });

  it('maps DOI-only SSRN numeric preprints to the benchmark repository owner without swallowing the title into authors', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Awang NA, Mahmud NNHEBN, Zulkefli NUHH. Optical Trapping Using Mode-Locked Fiber Laser Au-Np Coated Side-Polished Fiber 2023. https://doi.org/10.2139/ssrn.4577205.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.authors.value).toHaveLength(3);
    expect(carrier.fields.title.value).toBe('Optical Trapping Using Mode-Locked Fiber Laser Au-Np Coated Side-Polished Fiber');
    expect(carrier.fields.repository.value).toBe('Elsevier BV');
    expect(carrier.fields.doi.value).toBe('10.2139/ssrn.4577205');
  });

  it('maps TechRxiv preprints to the benchmark repository owner instead of the platform label', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Prasanth, V. et al. (2024) “A benchmark style routing study for real citation parsing.” TechRxiv. Available at: https://doi.org/10.36227/techrxiv.17123456.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.repository.value).toBe('Institute of Electrical and Electronics Engineers (IEEE)');
    expect(carrier.fields.doi.value).toBe('10.36227/techrxiv.17123456');
  });

  it('extracts bare patent identifiers from concise Vancouver-style patent references', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Web page ranking for page query across public and private. US20060235842A1, 2006.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.patent.value).toBe('US20060235842A1');
    expect(carrier.fields.title.value).toBe('Web page ranking for page query across public and private');
    expect(carrier.fields.year.value).toBe(2006);
  });

  it('keeps comma-rich IEEE in-collection book containers intact', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]T. Padmavathi, M. Uma Devi, and B. Prathibha Devi, “Mutagenic Effect of Chemicals on Certain Biochemical Parameters in Two Cultivars of Sunflower (Helianthus annuus L.),” in Medicinal Plants: Biodiversity, Sustainable Utilization and Conservation, Springer Singapore, 2020, pp. 693–714. doi: 10.1007/978-981-15-1636-8_42.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Mutagenic Effect of Chemicals on Certain Biochemical Parameters in Two Cultivars of Sunflower (Helianthus annuus L.)');
    expect(carrier.fields.bookTitle.value).toBe('Medicinal Plants: Biodiversity, Sustainable Utilization and Conservation');
    expect(carrier.fields.publisher.value).toBe('Springer Singapore');
    expect(carrier.fields.pages.value).toBe('693-714');
  });

  it('extracts Chicago journal citations with encoded ampersands and a period after the closing quote', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Rebel, Annette, and Randall Schell. “Faust’s Anesthesiology Review, 4th Ed.” Anesthesia &amp; Analgesia 120, no. 4 (2015): 953. https://doi.org/10.1213/ane.0000000000000588.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.authors.value).toHaveLength(2);
    expect(carrier.fields.title.value).toBe("Faust's Anesthesiology Review, 4th Ed");
    expect(carrier.fields.journal.value).toBe('Anesthesia & Analgesia');
    expect(carrier.fields.volume.value).toBe('120');
    expect(carrier.fields.issue.value).toBe('4');
    expect(carrier.fields.pages.value).toBe('953');
  });

  it('keeps nested quoted titles intact instead of truncating at the first inner quote', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Singler, K., and J. Masuch. “Ein Außergewöhnliches „Delirscreening“.” Zeitschrift Für Gerontologie Und Geriatrie 54, no. 5 (2021): 442–43. https://doi.org/10.1007/s00391-021-01916-5.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Ein Außergewöhnliches "Delirscreening"');
    expect(carrier.fields.journal.value).toBe('Zeitschrift Für Gerontologie Und Geriatrie');
    expect(carrier.fields.volume.value).toBe('54');
    expect(carrier.fields.issue.value).toBe('5');
  });

  it('extracts issue-only MLA journal citations without requiring a volume', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Hoàng, An Quốc. “Cộng Đồng Kinh Tế ASEAN và Cơ Hội Phát Triển Của Việt Nam.” Dong Thap University Journal of Science, no. 13, 2015, pp. 100–03, https://doi.org/10.52714/dthu.13.6.2015.212.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.authors.value).toHaveLength(1);
    expect(carrier.fields.title.value).toBe('Cộng Đồng Kinh Tế ASEAN và Cơ Hội Phát Triển Của Việt Nam');
    expect(carrier.fields.journal.value).toBe('Dong Thap University Journal of Science');
    expect(carrier.fields.issue.value).toBe('13');
    expect(carrier.fields.year.value).toBe(2015);
    expect(carrier.fields.pages.value).toBe('100-103');
  });

  it('keeps publisher legal suffixes intact in sentence-tail book references', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Pierre Ibar, Jean. The Physics of Polymer Interactions. Carl Hanser Verlag GmbH & Co. KG, 2019. https://doi.org/10.1007/978-1-56990-711-5.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('The Physics of Polymer Interactions');
    expect(carrier.fields.publisher.value).toBe('Carl Hanser Verlag GmbH & Co. KG');
    expect(carrier.fields.year.value).toBe(2019);
  });

  it('keeps multi-author sentence-tail books from splitting at initials or surname spillover', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Crowder, James A., and Alan C. Crowder. When Robots Hug. Springer Nature Switzerland, 2024. https://doi.org/10.1007/978-3-031-50803-5.'),
        makeRawBlock('Busemeyer, Jerome R., James T. Townsend, Zheng Wang, and Ami Eidels. Review of Basic Mathematical Concepts Used in Computational and Mathematical Psychology. Oxford University Press, 2015. https://doi.org/10.1093/oxfordhb/9780199957996.013.1.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.authors.value).toMatchObject([
      { family: 'Crowder', given: 'James A.' },
      { family: 'Crowder', given: 'Alan C.' },
    ]);
    expect(carriers[0]?.fields.title.value).toBe('When Robots Hug');
    expect((carriers[1]?.fields.authors.value as Array<unknown> | null)?.length).toBeGreaterThan(1);
    expect(carriers[1]?.fields.title.value).toBe(
      'Review of Basic Mathematical Concepts Used in Computational and Mathematical Psychology',
    );
  });

  it('recovers enumerated numeric book leads without swallowing trailing authors into title text', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]J. R. Busemeyer, J. T. Townsend, Z. Wang, and A. Eidels, Review of Basic Mathematical Concepts Used in Computational and Mathematical Psychology. Oxford University Press, 2015. doi: 10.1093/oxfordhb/9780199957996.013.1'),
        makeRawBlock('[1]A. G. SILVA, and R. B. LIMA NETO, Taxonomy of Species Distribution Models in the Light of Source of Uncertainty. Springer International Publishing, 2024. doi: 10.1007/978-3-031-77896-4_5'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.authors.value).toHaveLength(4);
    expect(carriers[0]?.fields.title.value).toBe(
      'Review of Basic Mathematical Concepts Used in Computational and Mathematical Psychology',
    );
    expect(carriers[0]?.fields.publisher.value).toBe('Oxford University Press');

    expect(carriers[1]?.fields.authors.value).toHaveLength(2);
    expect(carriers[1]?.fields.title.value).toBe(
      'Taxonomy of Species Distribution Models in the Light of Source of Uncertainty',
    );
    expect(carriers[1]?.fields.publisher.value).toBe('Springer International Publishing');
  });

  it('keeps DOI URLs with parentheses intact', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Andersson, P. (1973). Example article. Journal of Lumbar Studies, 12(3), 44–50. https://doi.org/10.1016/s0022-3182(73)80040-8'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.url.value).toBe('https://doi.org/10.1016/s0022-3182(73)80040-8');
    expect(carrier.fields.doi.value).toBe('10.1016/s0022-3182(73)80040-8');
  });

  it('extracts older book publishers instead of dropping them when the year predates 1900', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Eberhard, W. (1896). Ludwig III. Kurfürst von der Pfalz und das Reich 1410–1427. De Gruyter. https://doi.org/10.1515/9783112466384'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Ludwig III. Kurfürst von der Pfalz und das Reich 1410–1427');
    expect(carrier.fields.publisher.value).toBe('De Gruyter');
    expect(carrier.fields.year.value).toBe(1896);
  });

  it('extracts APA article titles with internal periods without collapsing them into author fragments', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Pillai, R., Valappil, N. N., & Parambil, D. A. C. (2021). An updated methodology for sediment distribution maps using conditional strings in Arc GIS 10.X. Arabian Journal of Geosciences, 14(20). https://doi.org/10.1007/s12517-021-07053-y'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('An updated methodology for sediment distribution maps using conditional strings in Arc GIS 10.X');
    expect(carrier.fields.journal.value).toBe('Arabian Journal of Geosciences');
    expect(carrier.fields.volume.value).toBe('14');
    expect(carrier.fields.issue.value).toBe('20');
  });

  it('drops journal lead fragments created by inner-title quotes in structured article citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]K. Singler and J. Masuch, “Ein außergewöhnliches „Delirscreening“,” Zeitschrift für Gerontologie und Geriatrie, vol. 54, no. 5, pp. 442–443, 2021, doi: 10.1007/s00391-021-01916-5.'),
        makeRawBlock('Pillai, R., Valappil, N.N. and Parambil, D.A.C. (2021) “An updated methodology for sediment distribution maps using conditional strings in Arc GIS 10.X,” Arabian Journal of Geosciences, 14(20). Available at: https://doi.org/10.1007/s12517-021-07053-y.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.journal.value).toBe('Zeitschrift für Gerontologie und Geriatrie');
    expect(carriers[1]?.fields.journal.value).toBe('Arabian Journal of Geosciences');
  });

  it('does not extract patent identifiers from DOI suffixes that only look patent-like', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Li D, Zhang B. DECOMPOSING THE IMPLEMENTATION OF COMPLEX ENGINEERING PROBLEM-SOLVING SKILLS ON PYTHON-BASED ARTIFICIAL INTELLIGENCE AND BIG DATA, International Organization Center of Academic Research; 2022. https://doi.org/10.59499/ep235765321.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.doi.value).toBe('10.59499/ep235765321');
    expect(carrier.fields.url.value).toBe('https://doi.org/10.59499/ep235765321');
    expect(carrier.fields.patent.value).toBeNull();
  });

  it('does not infer ISBNs from compact DOI substrings that are embedded inside alphanumeric noise', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Example, E. Synthetic Identifier Trap. Example Press, 2024. doi: 10.1234/a9783319189376b.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.doi.value).toBe('10.1234/a9783319189376b');
    expect(carriers[0]?.fields.isbn.value).toBeNull();
  });

  it('does not infer DOI-derived ISBNs or keep publisher on article-journal-shaped references', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Rebel, A., & Schell, R. (2015). Faust’s Anesthesiology Review, 4th ed. Anesthesia & Analgesia, 120(4), 953. https://doi.org/10.1515/9780823290840'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.isbn.value).toBeNull();
    expect(carrier.fields.publisher.value).toBeNull();
    expect(carrier.fields.journal.value).toBe('Anesthesia & Analgesia');
  });

  it('extracts IEEE and Vancouver books without letting initials or title commas leak into the wrong fields', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]S. Buchanan and J. Joyner, Azure Arc-Enabled Kubernetes and Servers. Apress, 2022. doi: 10.1007/978-1-4842-7768-3.'),
        makeRawBlock('[1]Fitting P. Utopian Effects, Dystopian Pleasures. Peter Lang UK; 2021. https://doi.org/10.3726/9781788743549.003.0014.'),
        makeRawBlock('Quach, T. T., Trübestein, M., & Aepli, M. D. (2024). Logistics Real Estate. Springer Fachmedien Wiesbaden. https://doi.org/10.1007/978-3-658-42837-2'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.authors.value).toHaveLength(2);
    expect(carriers[0]?.fields.title.value).toBe('Azure Arc-Enabled Kubernetes and Servers');
    expect(carriers[0]?.fields.publisher.value).toBe('Apress');

    expect(carriers[1]?.fields.authors.value).toHaveLength(1);
    expect(carriers[1]?.fields.title.value).toBe('Utopian Effects, Dystopian Pleasures');
    expect(carriers[1]?.fields.publisher.value).toBe('Peter Lang UK');

    expect(carriers[2]?.fields.title.value).toBe('Logistics Real Estate');
    expect(carriers[2]?.fields.publisher.value).toBe('Springer Fachmedien Wiesbaden');
  });

  it('keeps corporate-author books as books and recovers mla conference titles with smart-quoted titles and et al.', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('International Monetary Fund. International Monetary Fund Annual Report 1986. International Monetary Fund, 1986, https://doi.org/10.5089/9781616351984.011.'),
        makeRawBlock('Rabello, Isaac G. Y., et al. “Desenvolvimento de Uma Interface Gráfica Para Simulador de Meios Ópticos Guiados.” 2022, Anais do XL Simpósio Brasileiro de Telecomunicações e Processamento de Sinais, https://doi.org/10.14209/sbrt.2022.1570814528.'),
        makeRawBlock('Alexandra A. Taylor. “Obituary: John H. Litchfield.” Chemical & Engineering News, 2022, 25–25. https://doi.org/10.47287/cen-10040-obits4.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.authors.value).toMatchObject([
      { family: 'International Monetary Fund', isCorporate: true },
    ]);
    expect(carriers[0]?.fields.publisher.value).toBe('International Monetary Fund');
    expect(carriers[0]?.fields.institution.value).toBeNull();
    expect(carriers[0]?.fields.isbn.value).toBe('9781616351984');

    expect(carriers[1]?.fields.title.value).toBe('Desenvolvimento de Uma Interface Gráfica Para Simulador de Meios Ópticos Guiados');
    expect(carriers[1]?.fields.conferenceTitle.value).toBe('Anais do XL Simpósio Brasileiro de Telecomunicações e Processamento de Sinais');
    expect(carriers[1]?.fields.authors.value).toMatchObject([
      { family: 'Rabello', given: 'Isaac G. Y.' },
    ]);

    expect(carriers[2]?.fields.title.value).toBe('Obituary: John H. Litchfield');
    expect(carriers[2]?.fields.journal.value).toBe('Chemical & Engineering News');
    expect(carriers[2]?.fields.pages.value).toBe('25-25');
  });

  it('recovers repeated-owner institutional books across rendered styles without swallowing authors or publisher', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('International Monetary Fund. (1986). International Monetary Fund Annual Report 1986. International Monetary Fund. https://doi.org/10.5089/9781616351984.011'),
        makeRawBlock('International Monetary Fund. International Monetary Fund Annual Report 1986. International Monetary Fund, 1986. https://doi.org/10.5089/9781616351984.011.'),
        makeRawBlock('International Monetary Fund (1986) International Monetary Fund Annual Report 1986. International Monetary Fund. Available at: https://doi.org/10.5089/9781616351984.011.'),
        makeRawBlock('[1]International Monetary Fund, International Monetary Fund Annual Report 1986. International Monetary Fund, 1986. doi: 10.5089/9781616351984.011.'),
        makeRawBlock('International Monetary Fund. International Monetary Fund Annual Report 1986. International Monetary Fund, 1986, https://doi.org/10.5089/9781616351984.011.'),
        makeRawBlock('[1]International Monetary Fund. International Monetary Fund Annual Report 1986. International Monetary Fund; 1986. https://doi.org/10.5089/9781616351984.011.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    for (const carrier of carriers) {
      expect(carrier.fields.publisher.value).toBe('International Monetary Fund');
      expect(carrier.fields.journal.value).toBe('International Monetary Fund');
      expect(carrier.fields.authors.value).toMatchObject([
        { family: 'International Monetary Fund', isCorporate: true },
      ]);
      expect(carrier.fields.title.value).toBe('International Monetary Fund Annual Report 1986');
    }
  });

  it('keeps owner-backed webpage fields on rendered W3C citations instead of forcing article-journal routing', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('World Wide Web Consortium. (2023). Web Content Accessibility Guidelines (WCAG) 2.2. World Wide Web Consortium. W3C. https://www.w3.org/TR/WCAG22/'),
        makeRawBlock('World Wide Web Consortium. “Web Content Accessibility Guidelines (WCAG) 2.2.” W3C, World Wide Web Consortium, 2023. https://www.w3.org/TR/WCAG22/.'),
        makeRawBlock('World Wide Web Consortium (2023) Web Content Accessibility Guidelines (WCAG) 2.2, W3C. World Wide Web Consortium. Available at: https://www.w3.org/TR/WCAG22/.'),
        makeRawBlock('[1]World Wide Web Consortium, “Web Content Accessibility Guidelines (WCAG) 2.2,” W3C. [Online]. Available: https://www.w3.org/TR/WCAG22/'),
        makeRawBlock('World Wide Web Consortium. “Web Content Accessibility Guidelines (WCAG) 2.2.” W3C, World Wide Web Consortium, 2023, https://www.w3.org/TR/WCAG22/.'),
        makeRawBlock('[1]World Wide Web Consortium. Web Content Accessibility Guidelines (WCAG) 2.2. W3C 2023. https://www.w3.org/TR/WCAG22/.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    for (const carrier of carriers) {
      expect(carrier.fields.siteName.value).toBe('W3C');
      expect(carrier.fields.institution.value).toBe('World Wide Web Consortium');
      expect(carrier.fields.journal.value).toBeNull();
    }
  });

  it('trims publisher and locator spill from book-chapter containers and restores mla article locators', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Streeten, P. (1987) “Towards a Country and Crop Typology,” What Price Food? Palgrave Macmillan UK, pp. 8–10. Available at: https://doi.org/10.1007/978-1-349-18921-2_3.'),
        makeRawBlock('Danielmeyer, G. (2022). Verfahrensdokumentation. In Steuerrecht und Steuerberatung (pp. 105–116). Erich Schmidt Verlag GmbH & Co. KG. https://doi.org/10.37307/b.978-3-503-20045-0.08'),
        makeRawBlock('Al-Douri, Y. “Erratum to ‘The Pressure Effect of the Bulk Modulus Seen by the Charge Density in CdX Compounds’ [Mater. Chem. Phys. 78 (2003) 625–629].” Materials Chemistry and Physics, vol. 82, no. 2, 2003, p. 499, https://doi.org/10.1016/s0254-0584(03)00244-x.'),
        makeRawBlock('Bingen, Jean. “Épitaphes Chrétiennes Grecques d’Hermonthis.” Chronique d’Egypte, vol. 64, nos. 127–128, 1989, pp. 365–67, https://doi.org/10.1484/j.cde.2.308821.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.bookTitle.value).toBe('What Price Food?');
    expect(carriers[0]?.fields.publisher.value).toBe('Palgrave Macmillan UK');

    expect(carriers[1]?.fields.title.value).toBe('Verfahrensdokumentation');
    expect(carriers[1]?.fields.bookTitle.value).toBe('Steuerrecht und Steuerberatung');

    expect(carriers[2]?.fields.journal.value).toBe('Materials Chemistry and Physics');
    expect(carriers[2]?.fields.volume.value).toBe('82');
    expect(carriers[2]?.fields.issue.value).toBe('2');

    expect(carriers[3]?.fields.journal.value).toBe("Chronique d'Egypte");
    expect(carriers[3]?.fields.volume.value).toBe('64');
  });

  it('extracts Harvard owner-site webpages without letting the site or owner spill into the title', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('World Wide Web Consortium (2023) Web Content Accessibility Guidelines (WCAG) 2.2, W3C. World Wide Web Consortium. Available at: https://www.w3.org/TR/WCAG22/.'),
        makeRawBlock('React Team (2024) State: A Component’s Memory, React. React Team. Available at: https://react.dev/learn/state-a-components-memory.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe('Web Content Accessibility Guidelines (WCAG) 2.2');
    expect(carriers[0]?.fields.siteName.value).toBe('W3C');
    expect(carriers[0]?.fields.institution.value).toBe('World Wide Web Consortium');

    expect(carriers[1]?.fields.title.value).toBe("State: A Component's Memory");
    expect(carriers[1]?.fields.siteName.value).toBe('React');
    expect(carriers[1]?.fields.institution.value).toBe('React Team');
  });

  it('moves swallowed journal review tails out of publisher and conference fields into journal', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Kirchanov, M. (2021) Shoar, D. Coussios, C. Cleveland, J. Galbreath, A. Lasas, J. W. Lamoreaux (review). Ab Imperio. Available at: https://doi.org/10.1353/imp.2021.0088.'),
        makeRawBlock('[1]I. L. Bird, “A Lady’s Life in the Rocky Mountains,” by E. Hermon (review). Mouseion: Journal of the Classical Association of Canada, vol. 14, no. 1, pp. 167–167, 2017, doi: 10.3138/mouseion.14.1.167.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.journal.value).toBe('Ab Imperio');
    expect(carriers[0]?.fields.title.value).toContain('J. W. Lamoreaux (review)');
    expect(carriers[0]?.fields.publisher.value).toBeNull();

    expect(carriers[1]?.fields.journal.value).toBe('Mouseion: Journal of the Classical Association of Canada');
    expect(carriers[1]?.fields.conferenceTitle.value).toBeNull();
    expect(carriers[1]?.fields.publisher.value).toBeNull();
  });

  it('recovers repeated-owner report titles even when the year is missing and only a placeholder doi url remains', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('ASTM International Specification for Solar Simulation for Photovoltaic Testing. ASTM International. Available at: https://doi.org/.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Specification for Solar Simulation for Photovoltaic Testing');
    expect(carrier.fields.institution.value).toBe('ASTM International');
    expect(carrier.fields.journal.value).toBeNull();
    expect(carrier.fields.url.value).toBe('https://doi.org/');
  });

  it('keeps valid conference publishers while recovering distinct conference titles', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]A. Researcher, “Efficient signal routing for edge telemetry,” in Proceedings of the International Conference on Edge Systems, IEEE, 2024, pp. 10-18.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.conferenceTitle.value).toBe('Proceedings of the International Conference on Edge Systems');
    expect(carrier.fields.publisher.value).toBe('IEEE');
  });

  it('recovers conference publishers from standalone title tails when sibling proceedings titles ground the container', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Paulo Santos da Silva, M., & de Paula Martins, C. (2023). FORMAÇÃO POR COMPETÊNCIAS TRANSVERSAIS DE ENGENHEIROS CIVIS NA GEOTECNIA: O PAPEL DA ATIVIDADE DE MONITORIA. Proceedings of the 51 Brasilian Congress of Engineering Education. https://doi.org/10.37702/2175-957x.cobenge.2023.4540'),
        makeRawBlock('[1]M. Paulo Santos da Silva and C. de Paula Martins, “FORMAÇÃO POR COMPETÊNCIAS TRANSVERSAIS DE ENGENHEIROS CIVIS NA GEOTECNIA: O PAPEL DA ATIVIDADE DE MONITORIA,” Associação Brasileira de Educação em Engenharia, 2023. doi: 10.37702/2175-957x.cobenge.2023.4540.'),
        makeRawBlock('Vázquez, R., Castro, E., Sexmilo, L., Alonso, L., Méndez, B., & López, N. (2023). La sífilis, una enfermedad olvidada. XXIX Congreso Nacional de Medicina General y de Familia y V Jornadas SEMG Andalucía Abstracts Publication. https://doi.org/10.48158/semg23-265'),
        makeRawBlock('[1]R. Vázquez, E. Castro, L. Sexmilo, L. Alonso, B. Méndez, and N. López, “La sífilis, una enfermedad olvidada,” Grupo Pacífico, 2023. doi: 10.48158/semg23-265.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.conferenceTitle.value).toBe('Proceedings of the 51 Brasilian Congress of Engineering Education');
    expect(carriers[0]?.fields.publisher.value).toBe('Associação Brasileira de Educação em Engenharia');
    expect(carriers[1]?.fields.conferenceTitle.value).toBe('Proceedings of the 51 Brasilian Congress of Engineering Education');
    expect(carriers[1]?.fields.publisher.value).toBe('Associação Brasileira de Educação em Engenharia');

    expect(carriers[2]?.fields.conferenceTitle.value).toBe('XXIX Congreso Nacional de Medicina General y de Familia y V Jornadas SEMG Andalucía Abstracts Publication');
    expect(carriers[2]?.fields.publisher.value).toBe('Grupo Pacífico');
    expect(carriers[3]?.fields.conferenceTitle.value).toBe('XXIX Congreso Nacional de Medicina General y de Familia y V Jornadas SEMG Andalucía Abstracts Publication');
    expect(carriers[3]?.fields.publisher.value).toBe('Grupo Pacífico');
  });

  it('recovers article journal locators when title would otherwise swallow the journal tail', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Smith, J. (2020). Example study. Journal of Examples, vol. 12, no. 3.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Example study');
    expect(carrier.fields.journal.value).toBe('Journal of Examples');
    expect(carrier.fields.volume.value).toBe('12');
    expect(carrier.fields.issue.value).toBe('3');
    expect(carrier.fields.siteName.value).toBeNull();
    expect(carrier.fields.institution.value).toBeNull();
  });

  it('preserves full journal names instead of collapsing them to acronyms', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Rajkomar A, Dean J, Kohane I. Machine learning in medicine. New England Journal of Medicine. 2019;380(14):1347-1358.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.journal.value).toBe('New England Journal of Medicine');
  });

  it('collapses heavily abbreviated journal titles to an initialism when only abbreviation tokens are present', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]A. Example, “Environmental exposure review,” Int J Environ Res Public Health, vol. 21, no. 4, pp. 1-9, 2024.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.journal.value).toBe('IJERPH');
  });

  it('prefers strong proceedings containers over ungrounded journal hints for conference papers', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Acácio, M. da S., MOREIRA, S. L. D. B., SOUZA, M. A. D., BRAGA, T. R. D. S., & REIS, M. C. D. S. (2023). A CONTRIBUIÇÃO DO ESTÁGIO SUPERVISIONADO DE TERAPIA OCUPACIONAL NA ATENÇÃO BÁSICA PARA O ENSINO APRENDIZADO. Anais do II Congresso Brasileiro de Saúde Pública On-line. https://doi.org/10.51161/ii-conbrasp/15864'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.conferenceTitle.value).toBe('Anais do II Congresso Brasileiro de Saúde Pública On-line');
    expect(carrier.fields.journal.value).toBeNull();
    expect(carrier.fields.publisher.value).toBe('Revista Multidisciplinar em Saúde');
    expect(carrier.fields.authors.value).toMatchObject([
      { family: 'Acácio', given: 'M. da S.' },
      { family: 'MOREIRA', given: 'S L D B' },
      { family: 'SOUZA', given: 'M A D' },
      { family: 'BRAGA', given: 'T R D S' },
      { family: 'REIS', given: 'M C D S' },
    ]);
  });

  it('promotes terse proceedings aliases into a grounded conference title while preserving the rendered publisher', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]K. D. Choquette, “Technology status and opportunities of VCSELs,” IEEE, 2003, pp. 295–297. doi: 10.1109/iciprm.2002.1014379.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

      expect(carrier.fields.conferenceTitle.value).toBe('Conference Proceedings. 14th Indium Phosphide and Related Materials Conference (Cat. No.02CH37307)');
      expect(carrier.fields.bookTitle.value).toBeNull();
      expect(carrier.fields.publisher.value).toBe('IEEE');
      expect(carrier.fields.institution.value).toBeNull();
    });

  it('propagates sibling journal venues into conferenceTitle when another DOI sibling proves conference evidence', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Elgaafary, S., Hlevnjak, M., Schulze, M., et al. (2020). Dauerhaftes Ansprechen auf Olaparib und endokrine Therapie bei einer Patientin mit metastasiertem luminalem Mammakarzinom und gBRCA-Mutation. Geburtshilfe und Frauenheilkunde. https://doi.org/10.1055/s-0040-1714539'),
        makeRawBlock('Elgaafary, S., M. Hlevnjak, M. Schulze, et al. “Dauerhaftes Ansprechen Auf Olaparib Und Endokrine Therapie Bei Einer Patientin Mit Metastasiertem Luminalem Mammakarzinom Und gBRCA-Mutation.” Paper presented at Geburtshilfe und Frauenheilkunde. 2020. https://doi.org/10.1055/s-0040-1714539.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    for (const carrier of carriers) {
      expect(carrier.fields.conferenceTitle.value).toBe('Geburtshilfe und Frauenheilkunde');
    }
  });

  it('moves DOI-backed ISBN book containers from journal into publisher', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Zuidema-Cazemier, J. (2010). Ik bepaal. Bohn Stafleu van Loghum. https://doi.org/10.1007/978-90-313-8345-0'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.publisher.value).toBe('Bohn Stafleu van Loghum');
    expect(carrier.fields.journal.value).toBeNull();
    expect(carrier.fields.isbn.value).toBe('9789031383443');
  });

  it('keeps Vancouver institution tails as reports instead of conference papers', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Vaillancourt F, Magnan M. Le partage du financement des services de l’agglomération de Montréal en 2020: État des lieux, analyse et éléments de comparaison. CIRANO; 2022. https://doi.org/10.54932/cvub5177.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.institution.value).toBe('CIRANO');
    expect(carrier.fields.conferenceTitle.value).toBeNull();
    expect(carrier.fields.publisher.value).toBeNull();
  });

  it('treats repeated corporate-institution standards as reports instead of article-journal containers', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('BSI British Standards. (2015). Gas cylinders. Gas properties and associated classification (FTSC) codes. BSI British Standards. https://doi.org/10.3403/30281579'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Gas cylinders. Gas properties and associated classification (FTSC) codes');
    expect(carrier.fields.institution.value).toBe('BSI British Standards');
    expect(carrier.fields.authors.value).toEqual([]);
    expect(carrier.fields.journal.value).toBeNull();
    expect(carrier.fields.publisher.value).toBeNull();
  });

  it('keeps noisy accented repeated-owner BSI standards as reports instead of falling back to journal owners', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]BSI British Stàndàrds, “Nànomànufàcturing. Product spécificàtions,” BSI British Stàndàrds, 2023. doi: 10.3403/30420243.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Nànomànufàcturing. Product spécificàtions');
    expect(carrier.fields.institution.value).toBe('BSI British Stàndàrds');
    expect(carrier.fields.authors.value).toEqual([]);
    expect(carrier.fields.journal.value).toBeNull();
    expect(carrier.fields.conferenceTitle.value).toBeNull();
  });

  it('keeps DOI-backed SSRN publisher tails as preprint repositories instead of conference papers', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]X. Xiang et al., “In Situ Construction of a Multifunctional Interlayer for Garnet-Type Electrolytes to Suppress Lithium Dendrite Formation in Solid-State Lithium Batteries,” 2023, Elsevier BV. doi: 10.2139/ssrn.4467790.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.repository.value).toBe('Elsevier BV');
    expect(carrier.fields.conferenceTitle.value).toBeNull();
    expect(carrier.fields.bookTitle.value).toBeNull();
  });

  it('preserves explicit N/A conference placeholders for poster-style conference records', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Brown, Anthony. “Directional Dark Matter Detection With Scintillating Crystals [Poster].” Paper presented at N/A. 2022. https://doi.org/10.2172/1879510.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.conferenceTitle.value).toBe('N/A');
    expect(carrier.fields.institution.value).toBeNull();
  });

  it('keeps decimal-bearing APA conference titles intact while recovering the full conference container', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('ALEMSAN, M. K., & PALADINI, E. P. (2022). MÉTODOS DE AVALIAÇÃO DO NÍVEL DE MATURIDADE DA QUALIDADE 4.0 - UMA ANÁLISE CRÍTICA. Anais do Encontro Nacional de Engenharia de Produção. https://doi.org/10.14488/enegep2022_tn_st_385_1907_43154'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('MÉTODOS DE AVALIAÇÃO DO NÍVEL DE MATURIDADE DA QUALIDADE 4.0 - UMA ANÁLISE CRÍTICA');
    expect(carrier.fields.conferenceTitle.value).toBe('Anais do Encontro Nacional de Engenharia de Produção');
  });

  it('preserves dated Chicago conference containers with internal abbreviations and final years', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Edwards, Robert. “Baryon Resonance Determination Using LQCD.” Paper presented at BARYONS 2013, Glasgow, U.K., June 24, 2013. 2013. https://doi.org/10.2172/1992065.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Baryon Resonance Determination Using LQCD');
    expect(carrier.fields.conferenceTitle.value).toBe('BARYONS 2013, Glasgow, U.K., June 24, 2013');
  });

  it('preserves year-led conference containers with date tails instead of stripping the opening and closing year', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Norris, Jesse. “IER 518: High Multiplication Subcritical Benchmark Experiments at SNL [Slides].” Paper presented at 2023 Annual NCSP Technical Program Review, Albuquerque, NM (United States), 21-23 Feb 2023. 2023. https://doi.org/10.2172/1973199.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.conferenceTitle.value).toBe('2023 Annual NCSP Technical Program Review, Albuquerque, NM (United States), 21-23 Feb 2023');
    expect(carrier.fields.publisher.value).toBe('US DOE');
  });

  it('propagates grounded proceedings titles instead of swallowed conference tails across DOI siblings', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Trаtsiak, A. I. (2022). THE 100-YEAR HISTORY OF THE NATIONAL LIBRARY OF BELARUS IN THE AUDIO-VISUAL DOCUMENTS OF THE BELARUSIAN STATE ARCHIVES OF FILMS, PHOTOGRAPHS AND SOUND. LIBRARIES IN THE INFORMATION SOCIETY: PRESERVING TRADITIONS AND DEVELOPING NEW TECHNOLOGIES. https://doi.org/10.47612/978-985-880-283-7-2022-310-324'),
        makeRawBlock('Trаtsiak, A.I. (2022) “THE 100-YEAR HISTORY OF THE NATIONAL LIBRARY OF BELARUS IN THE AUDIO-VISUAL DOCUMENTS OF THE BELARUSIAN STATE ARCHIVES OF FILMS, PHOTOGRAPHS AND SOUND.” УП «ИВЦ Минфина». Available at: https://doi.org/10.47612/978-985-880-283-7-2022-310-324.'),
        makeRawBlock('Trаtsiak, A. I. “THE 100-YEAR HISTORY OF THE NATIONAL LIBRARY OF BELARUS IN THE AUDIO-VISUAL DOCUMENTS OF THE BELARUSIAN STATE ARCHIVES OF FILMS, PHOTOGRAPHS AND SOUND.” Paper presented at LIBRARIES IN THE INFORMATION SOCIETY: PRESERVING TRADITIONS AND DEVELOPING NEW TECHNOLOGIES. 2022. https://doi.org/10.47612/978-985-880-283-7-2022-310-324.'),
        makeRawBlock('[1]Trаtsiak AI. THE 100-YEAR HISTORY OF THE NATIONAL LIBRARY OF BELARUS IN THE AUDIO-VISUAL DOCUMENTS OF THE BELARUSIAN STATE ARCHIVES OF FILMS, PHOTOGRAPHS AND SOUND, УП «ИВЦ Минфина»; 2022. https://doi.org/10.47612/978-985-880-283-7-2022-310-324.'),
        makeRawBlock('[1]A. I. Trаtsiak, “THE 100-YEAR HISTORY OF THE NATIONAL LIBRARY OF BELARUS IN THE AUDIO-VISUAL DOCUMENTS OF THE BELARUSIAN STATE ARCHIVES OF FILMS, PHOTOGRAPHS AND SOUND,” УП «ИВЦ Минфина», 2022. doi: 10.47612/978-985-880-283-7-2022-310-324.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    for (const carrier of carriers) {
      expect(carrier.fields.conferenceTitle.value).toBe('LIBRARIES IN THE INFORMATION SOCIETY: PRESERVING TRADITIONS AND DEVELOPING NEW TECHNOLOGIES');
    }
    expect(carriers[1]?.fields.publisher.value).toBe('УП «ИВЦ Минфина»');
    expect(carriers[3]?.fields.publisher.value).toBe('УП «ИВЦ Минфина»');
    expect(carriers[3]?.fields.title.value).toBe('THE 100-YEAR HISTORY OF THE NATIONAL LIBRARY OF BELARUS IN THE AUDIO-VISUAL DOCUMENTS OF THE BELARUSIAN STATE ARCHIVES OF FILMS, PHOTOGRAPHS AND SOUND');
    expect(carriers[3]?.fields.authors.value).toMatchObject([{ family: 'Trаtsiak', given: 'A I' }]);
    expect(carriers[4]?.fields.publisher.value).toBe('УП «ИВЦ Минфина»');
    expect(carriers[4]?.fields.title.value).toBe('THE 100-YEAR HISTORY OF THE NATIONAL LIBRARY OF BELARUS IN THE AUDIO-VISUAL DOCUMENTS OF THE BELARUSIAN STATE ARCHIVES OF FILMS, PHOTOGRAPHS AND SOUND');
    expect(carriers[4]?.fields.authors.value).toMatchObject([{ family: 'Trаtsiak', given: 'A. I.' }]);
  });

  it('replaces weak conference proxies with sibling proceedings titles while preserving the proxy as publisher', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Acácio, M. da S., MOREIRA, S. L. D. B., SOUZA, M. A. D., BRAGA, T. R. D. S., & REIS, M. C. D. S. (2023). A CONTRIBUIÇÃO DO ESTÁGIO SUPERVISIONADO DE TERAPIA OCUPACIONAL NA ATENÇÃO BÁSICA PARA O ENSINO APRENDIZADO. Anais do II Congresso Brasileiro de Saúde Pública On-line. https://doi.org/10.51161/ii-conbrasp/15864'),
        makeRawBlock('Acácio, M. da S. et al. (2023) “A CONTRIBUIÇÃO DO ESTÁGIO SUPERVISIONADO DE TERAPIA OCUPACIONAL NA ATENÇÃO BÁSICA PARA O ENSINO APRENDIZADO.” Revista Multidisciplinar em Saúde. Available at: https://doi.org/10.51161/ii-conbrasp/15864.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.conferenceTitle.value).toBe('Anais do II Congresso Brasileiro de Saúde Pública On-line');
    expect(carriers[0]?.fields.publisher.value).toBe('Revista Multidisciplinar em Saúde');
    expect(carriers[0]?.fields.authors.value).toHaveLength(5);
    expect(carriers[1]?.fields.conferenceTitle.value).toBe('Anais do II Congresso Brasileiro de Saúde Pública On-line');
    expect(carriers[1]?.fields.publisher.value).toBe('Revista Multidisciplinar em Saúde');
    expect(carriers[1]?.fields.authors.value).toHaveLength(5);
  });

  it('backfills conference publishers from sibling proxy aliases when proceedings titles are already grounded', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Montealegre-Melendez, I., Arévalo, C., Ariza, E., Kitzmantel, M., Neubauer, E., & Pérez-Soriano, E. (2023). Manufacturing Of Hastelloy C-22 Specimens Via Plasma Metal Deposition To Determine The Influence Of The Processing Parameters On The Final Properties. Euro PM2023 Proceedings. https://doi.org/10.59499/ep235765321'),
        makeRawBlock('Montealegre-Melendez I, Arévalo C, Ariza E, Kitzmantel M, Neubauer E, Pérez-Soriano E. Manufacturing Of Hastelloy C-22 Specimens Via Plasma Metal Deposition To Determine The Influence Of The Processing Parameters On The Final Properties, EPMA; 2023. https://doi.org/10.59499/ep235765321.'),
        makeRawBlock('Montealegre-Melendez, Isabel, Cristina Arévalo, Enrique Ariza, Michael Kitzmantel, Erich Neubauer, and Eva Pérez-Soriano. “Manufacturing Of Hastelloy C-22 Specimens Via Plasma Metal Deposition To Determine The Influence Of The Processing Parameters On The Final Properties.” Paper presented at Euro PM2023 Proceedings. 2023. https://doi.org/10.59499/ep235765321.'),
        makeRawBlock('Montealegre-Melendez, Isabel, et al. “Manufacturing Of Hastelloy C-22 Specimens Via Plasma Metal Deposition To Determine The Influence Of The Processing Parameters On The Final Properties.” 2023, Euro PM2023 Proceedings, https://doi.org/10.59499/ep235765321.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.conferenceTitle.value).toBe('Euro PM2023 Proceedings');
    expect(carriers[0]?.fields.publisher.value).toBe('EPMA');
    expect(carriers[1]?.fields.conferenceTitle.value).toBe('Euro PM2023 Proceedings');
    expect(carriers[1]?.fields.publisher.value).toBe('EPMA');
    expect(carriers[2]?.fields.conferenceTitle.value).toBe('Euro PM2023 Proceedings');
    expect(carriers[2]?.fields.publisher.value).toBe('EPMA');
    expect(carriers[3]?.fields.conferenceTitle.value).toBe('Euro PM2023 Proceedings');
    expect(carriers[3]?.fields.publisher.value).toBe('EPMA');
  });

  it('falls back to DOI-backed publishers when rendered conference wrappers do not contain a real publisher tail', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Li, D. and Zhang, B. (2022) “DECOMPOSING THE IMPLEMENTATION OF COMPLEX ENGINEERING PROBLEM-SOLVING SKILLS ON PYTHON-BASED ARTIFICIAL INTELLIGENCE AND BIG DATA.” International Organization Center of Academic Research. Available at: https://doi.org/10.47696/adved.202211.'),
        makeRawBlock('Li, Dazhou, and Bo Zhang. “DECOMPOSING THE IMPLEMENTATION OF COMPLEX ENGINEERING PROBLEM-SOLVING SKILLS ON PYTHON-BASED ARTIFICIAL INTELLIGENCE AND BIG DATA.” Paper presented at Proceedings of ADVED 2022- 8th International Conference on Advances in Education. 2022. https://doi.org/10.47696/adved.202211.'),
        makeRawBlock('Li, Dazhou, and Bo Zhang. “DECOMPOSING THE IMPLEMENTATION OF COMPLEX ENGINEERING PROBLEM-SOLVING SKILLS ON PYTHON-BASED ARTIFICIAL INTELLIGENCE AND BIG DATA.” 2022, Proceedings of ADVED 2022- 8th International Conference on Advances in Education, https://doi.org/10.47696/adved.202211.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    for (const carrier of carriers) {
      expect(carrier.fields.conferenceTitle.value).toBe('Proceedings of ADVED 2022- 8th International Conference on Advances in Education');
      expect(carrier.fields.publisher.value).toBe('International Organization Center of Academic Research');
      expect(carrier.fields.authors.value).toMatchObject([
        { family: 'Li', given: expect.any(String) },
        { family: 'Zhang', given: expect.any(String) },
      ]);
    }
  });

  it('does not let article-journal locators and titles masquerade as conference or publisher fields', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Vinkovetsky, I. (2001). Circumnavigation, Empire, Modernity, Race: The Impact of Round-The-World Voyages on Russia’s Imperial Consciousness. Ab Imperio, 2001(1–2), 191–210. https://doi.org/10.1353/imp.2001.0019'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.journal.value).toBe('Ab Imperio');
    expect(carrier.fields.conferenceTitle.value).toBeNull();
    expect(carrier.fields.publisher.value).toBeNull();
    expect(carrier.fields.bookTitle.value).toBeNull();
    expect(carrier.fields.volume.value).toBe('2001');
    expect(carrier.fields.issue.value).toBe('1–2');
    expect(carrier.fields.pages.value).toBe('191-210');
  });

  it('recovers quoted book-chapter title fragments from leading bookTitle overflow', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Bernards, R. (2015) “Cyclin D,” Encyclopedia of Cancer. Springer Berlin Heidelberg, pp. 1–3. Available at: https://doi.org/10.1007/978-3-642-27841-9_1426-2.'),
        makeRawBlock('Whitehead, G. W. (1989). The work of Edgar H. Brown, Jr. in Topology. In Lecture Notes in Mathematics (pp. 10–14). Springer Berlin Heidelberg. https://doi.org/10.1007/bfb0085214'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe('Cyclin D');
    expect(carriers[0]?.fields.bookTitle.value).toBe('Encyclopedia of Cancer');
    expect(carriers[1]?.fields.title.value).toBe('The work of Edgar H. Brown, Jr. in Topology');
    expect(carriers[1]?.fields.bookTitle.value).toBe('Lecture Notes in Mathematics');
  });

  it('recovers repeated-owner corporate reports without swallowing the institution into the title', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('U.S. Pharmacopeial Convention. (2021). Rimexolone Ophthalmic Suspension. U.S. Pharmacopeial Convention. https://doi.org/10.31003/USPNF_M35740_03_01'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Rimexolone Ophthalmic Suspension');
    expect(carrier.fields.institution.value).toBe('U.S. Pharmacopeial Convention');
    expect(carrier.fields.publisher.value).toBeNull();
    expect(carrier.fields.journal.value).toBeNull();
  });

  it('recovers date-place conference containers that have no explicit conference keyword', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Edwards, R. (2013). Baryon Resonance Determination using LQCD. BARYONS 2013, Glasgow, U.K., June 24, 2013. https://doi.org/10.2172/1992065'),
        makeRawBlock('Edwards, Robert. “Baryon Resonance Determination Using LQCD.” 2013, BARYONS 2013, Glasgow, U.K., June 24, 2013, https://doi.org/10.2172/1992065.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    for (const carrier of carriers) {
      expect(carrier.fields.title.value).toBe('Baryon Resonance Determination Using LQCD');
      expect(carrier.fields.conferenceTitle.value).toBe('BARYONS 2013, Glasgow, U.K., June 24, 2013');
      expect(carrier.fields.journal.value).toBeNull();
      expect(carrier.fields.volume.value).toBeNull();
    }
  });

  it('keeps IEEE-style numeric conference publisher tails as publishers when the DOI encodes conference evidence', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Richard J, Enjolras V, Rys L, Vallon J, Nann I, Escudier P. Space Altimetry from Nano-Satellites : Payload Feasibility, Missions and System Performances, IEEE; 2008, p. III-71-III–74. https://doi.org/10.1109/igarss.2008.4779285.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Space Altimetry from Nano-Satellites : Payload Feasibility, Missions and System Performances');
    expect(carrier.fields.publisher.value).toBe('IEEE');
    expect(carrier.fields.pages.value).toBe('III-71-III-74');
  });

  it('recovers DOI-backed conference series titles from weak numeric IEEE publisher tails', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Garg S, Mittal A, Sathiyasuntharam V. Deep Learning Based Model to Recommend Safe Route Navigation System, IEEE; 2025, p. 181–6. https://doi.org/10.1109/cictn64563.2025.10932570.'),
        makeRawBlock('[1]Mahmud I, Abdelhadi A. Neural Network Based Ray Tracing on a Digital Twin for Performance Approximation Using Parameter Analysis, IEEE; 2024, p. 1–6. https://doi.org/10.1109/icca62237.2024.10927985.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe('Deep Learning Based Model to Recommend Safe Route Navigation System');
    expect(carriers[0]?.fields.publisher.value).toBe('IEEE');
    expect(carriers[0]?.fields.conferenceTitle.value).toBe('2025 2nd International Conference on Computational Intelligence, Communication Technology and Networking (CICTN)');

    expect(carriers[1]?.fields.title.value).toBe('Neural Network Based Ray Tracing on a Digital Twin for Performance Approximation Using Parameter Analysis');
    expect(carriers[1]?.fields.publisher.value).toBe('IEEE');
    expect(carriers[1]?.fields.conferenceTitle.value).toBe('2024 International Conference on Computer and Applications (ICCA)');
  });

  it('expands DOI-backed conference aliases while preserving the rendered publisher tail', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Maciel VKP, Bachman GE, Marcondes C. The experience of nursing students in two emergency care units in the southwest of Paraná - an experience report, Seven Congress; 2023. https://doi.org/10.56238/homeiisevenhealth-138.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('The experience of nursing students in two emergency care units in the southwest of Paraná - an experience report');
    expect(carrier.fields.publisher.value).toBe('Seven Congress');
    expect(carrier.fields.conferenceTitle.value).toBe('II SEVEN INTERNATIONAL CONGRESS OF HEALTH');
  });

  it('recovers numeric repeated-owner reports without collapsing the title to the final institutional clause', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]U.S. Pharmacopeial Convention. Rimexolone Ophthalmic Suspension. U.S. Pharmacopeial Convention; 2021. https://doi.org/10.31003/uspnf_m73698_01_01.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Rimexolone Ophthalmic Suspension');
    expect(carrier.fields.institution.value).toBe('U.S. Pharmacopeial Convention');
    expect(carrier.fields.journal.value).toBeNull();
  });

  it('promotes institutional alias containers into report institutions when there are no article locators', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Witz, A. et al. (2023) A proposal to align release standards for endonucleases used in nucleic acid removal. BioPhorum. Available at: https://doi.org/10.46220/2023cgt002.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.institution.value).toBe('BioPhorum');
    expect(carrier.fields.journal.value).toBeNull();
  });

  it('uses DOI publisher hints for poster-style conference records with explicit N/A placeholders', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Brown, A. (2022). Directional Dark Matter Detection With Scintillating Crystals [Poster]. N/A. https://doi.org/10.2172/1879510'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Directional Dark Matter Detection With Scintillating Crystals [Poster]');
    expect(carrier.fields.conferenceTitle.value).toBe('N/A');
    expect(carrier.fields.publisher.value).toBe('US DOE');
  });

  it('recovers full comma-heavy book-chapter containers and titles from raw DOI-backed chapter citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Carral, L., Rodriguez-Guerreiro, M. J., Lamas Galdo, I., Santiago Caamaño, L., Camba Fabal, C., Tarrio Saavedra, J., Díaz-Díaz, A., Castro Santos, L., Álvarez Feal, C., Munín Doce, A., Cartelle Barros, J., & Carballo Sánchez, R. (2024). Design, Manufacture, Transportation and Installation of “Green Artificial Reefs” in the Galician Estuaries: An Opportunity for a Circular Economy and Sustainable Development. In Springer Series on Naval Architecture, Marine Engineering, Shipbuilding and Shipping (pp. 261–272). Springer Nature Switzerland. https://doi.org/10.1007/978-3-031-49799-5_39'),
        makeRawBlock('[1]Carral L, Rodriguez-Guerreiro MJ, Lamas Galdo I, Santiago Caamaño L, Camba Fabal C, Tarrio Saavedra J, et al. Design, Manufacture, Transportation and Installation of “Green Artificial Reefs” in the Galician Estuaries: An Opportunity for a Circular Economy and Sustainable Development. Springer Series on Naval Architecture, Marine Engineering, Shipbuilding and Shipping, Springer Nature Switzerland; 2024, p. 261–72. https://doi.org/10.1007/978-3-031-49799-5_39.'),
        makeRawBlock('Clark, L. (2009). Wat is een time-out?Wanneer gebruiken ouders de time-out? In SOS! Hulp voor ouders (pp. 51–62). Bohn Stafleu van Loghum. https://doi.org/10.1007/978-90-313-6882-2_5'),
        makeRawBlock('[1]Clark L. Wat is een time-out?Wanneer gebruiken ouders de time-out? SOS! Hulp voor ouders, Bohn Stafleu van Loghum; 2009, p. 51–62. https://doi.org/10.1007/978-90-313-6882-2_5.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe('Design, Manufacture, Transportation and Installation of "Green Artificial Reefs" in the Galician Estuaries: An Opportunity for a Circular Economy and Sustainable Development');
    expect(carriers[0]?.fields.bookTitle.value).toBe('Springer Series on Naval Architecture, Marine Engineering, Shipbuilding and Shipping');
    expect(carriers[0]?.fields.journal.value).toBeNull();

    expect(carriers[1]?.fields.title.value).toBe('Design, Manufacture, Transportation and Installation of "Green Artificial Reefs" in the Galician Estuaries: An Opportunity for a Circular Economy and Sustainable Development');
    expect(carriers[1]?.fields.bookTitle.value).toBe('Springer Series on Naval Architecture, Marine Engineering, Shipbuilding and Shipping');
    expect(carriers[1]?.fields.journal.value).toBeNull();

    expect(carriers[2]?.fields.title.value).toBe('Wat is een time-out?Wanneer gebruiken ouders de time-out?');
    expect(carriers[2]?.fields.bookTitle.value).toBe('SOS! Hulp voor ouders');
    expect(carriers[2]?.fields.publisher.value).toBe('Bohn Stafleu van Loghum');

    expect(carriers[3]?.fields.title.value).toBe('Wat is een time-out?Wanneer gebruiken ouders de time-out?');
    expect(carriers[3]?.fields.bookTitle.value).toBe('SOS! Hulp voor ouders');
    expect(carriers[3]?.fields.publisher.value).toBe('Bohn Stafleu van Loghum');
  });

  it('infers Springer print ISBNs from electronic chapter DOI slugs when the raw citation omits the ISBN', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Abts, D. (2015). Imperative Sprachkonzepte. In Grundkurs JAVA (pp. 11–33). Springer Fachmedien Wiesbaden. https://doi.org/10.1007/978-3-658-07968-0_2'),
        makeRawBlock('Matejko, A., & Ansari, D. (2012). Developmental Cognitive Neuroscience and Learning. In Encyclopedia of the Sciences of Learning (pp. 961–966). Springer US. https://doi.org/10.1007/978-1-4419-1428-6_605'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.isbn.value).toBe('9783658079673');
    expect(carriers[1]?.fields.isbn.value).toBe('9781441914279');
  });

  it('falls back to a valid ISBN-13 for legacy Springer chapter DOI slugs when no surface ISBN is present', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Weik, M. H. (2000). attenuation rate. In Computer Science and Communications Dictionary (pp. 75–75). Springer US. https://doi.org/10.1007/1-4020-0613-6_994'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.bookTitle.value).toBe('Computer Science and Communications Dictionary');
    expect(carriers[0]?.fields.isbn.value).toBe('9781402006135');
  });

  it('prefers print ISBNs for Springer-doi books published under the Bohn imprint', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Zuidema-Cazemier, J. (2010) Ik bepaal. Bohn Stafleu van Loghum. Available at: https://doi.org/10.1007/978-90-313-8345-0.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe('Ik bepaal');
    expect(carriers[0]?.fields.publisher.value).toBe('Bohn Stafleu van Loghum');
    expect(carriers[0]?.fields.isbn.value).toBe('9789031383443');
  });

  it('parses Chicago journal issue ranges with nos. locators without swallowing the container', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Bingen, Jean. “Épitaphes Chrétiennes Grecques d’Hermonthis.” Chronique d’Egypte 64, nos. 127–128 (1989): 365–67. https://doi.org/10.1484/j.cde.2.308821.'),
        makeRawBlock('Vinkovetsky, Ilya. “Circumnavigation, Empire, Modernity, Race: The Impact of Round-The-World Voyages on Russia’s Imperial Consciousness.” Ab Imperio 2001, nos. 1–2 (2001): 191–210. https://doi.org/10.1353/imp.2001.0019.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.journal.value).toBe("Chronique d'Egypte");
    expect(carriers[0]?.fields.volume.value).toBe('64');
    expect(carriers[0]?.fields.issue.value).toBe('127–128');

    expect(carriers[1]?.fields.journal.value).toBe('Ab Imperio');
    expect(carriers[1]?.fields.volume.value).toBe('2001');
    expect(carriers[1]?.fields.issue.value).toBe('1–2');
  });

  it('resolves JMIR preprint owners from DOI-backed publisher tails without emitting placeholders', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Majid, H., Arshad, H., Rehman, S., Abidin, Z. ul, Siddiqi, H. S., Fatima, S., & Jafri, L. (2023). “A SWOC Analysis of Online Undergraduate Medical Education and its Impact on Cognitive Outcomes: Cross-Sectional Study” (Preprint). JMIR Publications Inc. https://doi.org/10.2196/preprints.47303'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.repository.value).toBe('JMIR Publications Inc.');
  });

  it('recovers preprint repositories from placeholder-doi owner tails once classification has settled on preprint', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Chen, H., Cheng, D., Zhou, D., Mo, Y., Zhong, L., Wang, Y., Wang, Y., Qiu, H., Tan, X., Wang, B., Huang, M., & Song, B. Ripv1, a Ralstonia solanacearum Type III effector, acts as a novel E3 ubiquitin ligase to suppress plant PAMP-triggered immunity responses and promote susceptibility in potato. Elsevier BV. https://doi.org/'),
        makeRawBlock('[1] H. Chen, D. Cheng, D. Zhou, Y. Mo, L. Zhong, Y. Wang, Y. Wang, H. Qiu, X. Tan, B. Wang, M. Huang, and B. Song, "Ripv1, a Ralstonia solanacearum Type III effector, acts as a novel E3 ubiquitin ligase to suppress plant PAMP-triggered immunity responses and promote susceptibility in potato," 2023, Elsevier BV.'),
        makeRawBlock('[1]H. Chen et al., “Ripv1, a Ralstonia solanacearum Type III effector, acts as a novel E3 ubiquitin ligase to suppress plant PAMP-triggered immunity responses and promote susceptibility in Potato,” 2023, Elsevier BV. doi: .'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.repository.value).toBe('Elsevier BV');
    expect(carriers[0]?.fields.conferenceTitle.value).toBeNull();
    expect(carriers[0]?.fields.bookTitle.value).toBeNull();

    expect(carriers[1]?.fields.repository.value).toBe('Elsevier BV');
    expect(carriers[1]?.fields.conferenceTitle.value).toBeNull();
    expect(carriers[1]?.fields.bookTitle.value).toBeNull();

    expect(carriers[2]?.fields.repository.value).toBe('Elsevier BV');
    expect(carriers[2]?.fields.conferenceTitle.value).toBeNull();
    expect(carriers[2]?.fields.bookTitle.value).toBeNull();
  });

  it('preserves dotted institutional owners in author-date repeated-owner reports', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('U.S. Pharmacopeial Convention (2021) Rimexolone Ophthalmic Suspension. U.S. Pharmacopeial Convention. Available at: https://doi.org/10.31003/uspnf_m73698_01_01.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Rimexolone Ophthalmic Suspension');
    expect(carrier.fields.institution.value).toBe('U.S. Pharmacopeial Convention');
    expect(carrier.fields.journal.value).toBeNull();
  });

  it('keeps DOI-backed institutional publisher tails as reports instead of conference-style containers', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('shah, S. (2023). Dr. Natalie Crawford: Female Hormone Health, Fertility & Vitality. ResearchHub Technologies, Inc. https://doi.org/10.55277/researchhub.6dkbu3xp'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.title.value).toBe('Dr. Natalie Crawford: Female Hormone Health, Fertility & Vitality');
    expect(carrier.fields.institution.value).toBe('ResearchHub Technologies, Inc');
    expect(carrier.fields.journal.value).toBeNull();
    expect(carrier.fields.conferenceTitle.value).toBeNull();
  });

  it('expands iciprm conference DOIs into their grounded proceedings title', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]K. D. Choquette, “Technology status and opportunities of VCSELs,” IEEE, 2003, pp. 295–297. doi: 10.1109/iciprm.2002.1014379.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
      const carrier = carriers[0]!;

      expect(carrier.fields.conferenceTitle.value).toBe('Conference Proceedings. 14th Indium Phosphide and Related Materials Conference (Cat. No.02CH37307)');
      expect(carrier.fields.publisher.value).toBe('IEEE');
      expect(carrier.fields.institution.value).toBeNull();
    });

    it('keeps DOI-grounded author-date conference titles free of trailing publisher aliases', async () => {
      const ctx = createTestPipelineContext();
      let carriers = await phase3StyleDetect.run(
        [
          makeRawBlock('Choquette, K.D. (2003) “Technology status and opportunities of VCSELs.” IEEE, pp. 295–297. Available at: https://doi.org/10.1109/iciprm.2002.1014379.'),
        ],
        ctx,
      );

      carriers = await phase4Extract.run(carriers, ctx);
      const carrier = carriers[0]!;

      expect(carrier.fields.title.value).toBe('Technology status and opportunities of VCSELs');
    expect(carrier.fields.conferenceTitle.value).toBe('Conference Proceedings. 14th Indium Phosphide and Related Materials Conference (Cat. No.02CH37307)');
    expect(carrier.fields.publisher.value).toBeNull();
    expect(carrier.fields.institution.value).toBeNull();
  });

  it('uses IGARSS DOI hints for numeric conference publisher tails', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Richard J, Enjolras V, Rys L, Vallon J, Nann I, Escudier P. Space Altimetry from Nano-Satellites : Payload Feasibility, Missions and System Performances, IEEE; 2008, p. III-71-III–74. https://doi.org/10.1109/igarss.2008.4779285.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    const carrier = carriers[0]!;

    expect(carrier.fields.conferenceTitle.value).toBe('IGARSS 2008 - 2008 IEEE International Geoscience and Remote Sensing Symposium');
    expect(carrier.fields.publisher.value).toBe('IEEE');
    expect(carrier.fields.pages.value).toBe('III-71-III-74');
  });

  it('keeps cached numeric conference recovery deterministic across repeated runs', async () => {
    const raw = '[1]Richard J, Enjolras V, Rys L, Vallon J, Nann I, Escudier P. Space Altimetry from Nano-Satellites : Payload Feasibility, Missions and System Performances, IEEE; 2008, p. III-71-III–74. https://doi.org/10.1109/igarss.2008.4779285.';

    const firstCtx = createTestPipelineContext();
    let firstCarriers = await phase3StyleDetect.run([makeRawBlock(raw)], firstCtx);
    firstCarriers = await phase4Extract.run(firstCarriers, firstCtx);

    const secondCtx = createTestPipelineContext();
    let secondCarriers = await phase3StyleDetect.run([makeRawBlock(raw)], secondCtx);
    secondCarriers = await phase4Extract.run(secondCarriers, secondCtx);

    const firstCarrier = firstCarriers[0]!;
    const secondCarrier = secondCarriers[0]!;

    expect({
      title: firstCarrier.fields.title.value,
      conferenceTitle: firstCarrier.fields.conferenceTitle.value,
      publisher: firstCarrier.fields.publisher.value,
      journal: firstCarrier.fields.journal.value,
      volume: firstCarrier.fields.volume.value,
      issue: firstCarrier.fields.issue.value,
      pages: firstCarrier.fields.pages.value,
      referenceType: firstCarrier.referenceType,
      structuralType: firstCarrier.structuralRouting?.type ?? null,
    }).toEqual({
      title: secondCarrier.fields.title.value,
      conferenceTitle: secondCarrier.fields.conferenceTitle.value,
      publisher: secondCarrier.fields.publisher.value,
      journal: secondCarrier.fields.journal.value,
      volume: secondCarrier.fields.volume.value,
      issue: secondCarrier.fields.issue.value,
      pages: secondCarrier.fields.pages.value,
      referenceType: secondCarrier.referenceType,
      structuralType: secondCarrier.structuralRouting?.type ?? null,
    });
  });

  it('keeps explicit publisher-slot conference owners for publisher-only Harvard citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('SILVA, N.M.D., GOHR, C.F. and MORIOKA, S.N. (2022) “STRATEGIC RESOURCES AND SUSTAINABLE DEVELOPMENT: A MULTIPLE CASE STUDY IN BRAZILIAN COMPANIES.” ENEGEP 2022 - Encontro Nacional de Engenharia de Produção. Available at: https://doi.org/10.14488/enegep2022_tn_wpg_390_1938_43232.'),
        makeRawBlock('Venkataramani, R. and Mahadevan, S. (2023) “At Full Throttle: Delivering Agility in Publishing.” ScienceOpen. Available at: https://doi.org/10.14293/s2199-ssp-am23-01008.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.publisher.value).toBe('ENEGEP 2022 - Encontro Nacional de Engenharia de Produção');
    expect(carriers[0]?.fields.conferenceTitle.value).toBe('Anais do Encontro Nacional de Engenharia de Produção');
    expect(carriers[1]?.fields.publisher.value).toBe('ScienceOpen');
  });

  it('keeps institutional conference publishers when the raw citation uses a publisher-only slot', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]S. Pain and P. Acharjee, “Solution to security constrained LFC system using chaos based exponential PSO algorithm,” Institution of Engineering and Technology, 2016. doi: 10.1049/cp.2016.1556.'),
        makeRawBlock('[1]N. Sato, “Towards Universal Fit of PDFs, Spin Dependent PDFs, and Fragmentation Functions,” US DOE, 2016. doi: 10.2172/1987288.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.publisher.value).toBe('Institution of Engineering and Technology');
    expect(carriers[0]?.fields.conferenceTitle.value).toBe('3rd International Conference on Electrical, Electronics, Engineering Trends, Communication, Optimization and Sciences (EEECOS 2016)');
    expect(carriers[1]?.fields.publisher.value).toBe('US DOE');
  });

  it('propagates conference titles and publishers across publisher-only and conference-only sibling styles', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Кузьмичёва, Ю. А. (2025). Особенности применения приёмов интерактивной игры в работе с детьми дошкольного и младшего школьного возраста на экскурсиях. Матэрыялы навукова-практычнай канферэнцыі. https://doi.org/10.52275/pm2023-53-57'),
        makeRawBlock('Кузьмичёва, Ю.А. (2025) “Особенности применения приёмов интерактивной игры в работе с детьми дошкольного и младшего школьного возраста на экскурсиях.” ГрГУ им. Янки Купалы. Available at: https://doi.org/10.52275/pm2023-53-57.'),
        makeRawBlock('Sato, N. (2016). Towards Universal Fit of PDFs, Spin Dependent PDFs, and Fragmentation Functions. POETIC 7, Temple University, Philadelphia, PA, November 14, 2016. https://doi.org/10.2172/1987288'),
        makeRawBlock('Sato, N. (2016) “Towards Universal Fit of PDFs, Spin Dependent PDFs, and Fragmentation Functions.” US DOE. Available at: https://doi.org/10.2172/1987288.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.conferenceTitle.value).toBe('Матэрыялы навукова-практычнай канферэнцыі');
    expect(carriers[0]?.fields.publisher.value).toBe('ГрГУ им. Янки Купалы');
    expect(carriers[1]?.fields.conferenceTitle.value).toBe('Матэрыялы навукова-практычнай канферэнцыі');
    expect(carriers[1]?.fields.publisher.value).toBe('ГрГУ им. Янки Купалы');
    expect(carriers[2]?.fields.conferenceTitle.value).toBe('POETIC 7, Temple University, Philadelphia, PA, November 14, 2016');
    expect(carriers[2]?.fields.publisher.value).toBe('US DOE');
    expect(carriers[3]?.fields.conferenceTitle.value).toBe('POETIC 7, Temple University, Philadelphia, PA, November 14, 2016');
    expect(carriers[3]?.fields.publisher.value).toBe('US DOE');
  });

  it('does not propagate sibling conference fields across different semantic benchmark groups that share a DOI', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        {
          ...makeRawBlock('Alpha, A. (2024). Conference-only title. Proceedings of the Example Symposium. https://doi.org/10.1234/shared-benchmark-doi'),
          semanticGroupKey: 'benchmark-record-a:clean',
        },
        {
          ...makeRawBlock('Beta Research Group. (2024). Report-only title. Example Research Group. Available at: https://doi.org/10.1234/shared-benchmark-doi'),
          semanticGroupKey: 'benchmark-record-b:clean',
        },
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.conferenceTitle.value).toBe('Proceedings of the Example Symposium');
    expect(carriers[0]?.fields.institution.value).toBeNull();
    expect(carriers[1]?.fields.institution.value).toBe('Example Research Group');
    expect(carriers[1]?.fields.conferenceTitle.value).toBeNull();
  });

  it('normalizes DOI-backed conference publishers and titles for weak proceedings families', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Hermawan, Iwan, Yuni Sudarwati, Rafika Sari, Izzaty Izzaty, and Dewi Wuryandani (2021) “Scrutinizing Indonesia’s Agricultural Start-ups.” Atlantis Press. Available at: https://doi.org/10.2991/assehr.k.211227.049.'),
        makeRawBlock('Oliveira, Angélica Siara. “EFEITOS NUTRICIONAIS NA FISIOLOGIA REPRODUTIVA EQUINA.” 2023, Anais do II Congresso Brasileiro Online de Práticas Veterinárias: Uma abordagem para animais de grande porte e produção Animal, https://doi.org/10.51161/ii-granvet/14149.'),
        makeRawBlock('[1]H. Hashmi, H. Ahmed, R. A. Ahmar, M. I. Syed, K. Khan, and Z. Mahmood, “Towards Electronic Voting Using Face Verification Technology,” IEEE, 2024, pp. 1–6. https://doi.org/10.1109/icet63392.2024.10935228.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.publisher.value).toBe('Atlantis Press');
    expect(carriers[0]?.fields.conferenceTitle.value).toBe('Advances in Social Science, Education and Humanities Research');

    expect(carriers[1]?.fields.publisher.value).toBe('Revista Multidisciplinar em Saúde');
    expect(carriers[1]?.fields.conferenceTitle.value).toBe('Anais do II Congresso Brasileiro Online de Práticas Veterinárias: Uma abordagem para animais de grande porte e produção Animal');

    expect(carriers[2]?.fields.publisher.value).toBe('IEEE');
    expect(carriers[2]?.fields.conferenceTitle.value).toBe('2024 19th International Conference on Emerging Technologies (ICET)');
  });

  it('recovers noisy placeholder-doi books instead of dropping title and publisher', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('MARTINS, D. M. . CONEXÕES INTERDISCIPLINARES. Arco Editores. https://doi.org/'),
        makeRawBlock('Buchanan, S., & Joyner, J. . Azure Arc-Enabled Kubernetes and Servers. Apress. https://doi.org/'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe('CONEXÕES INTERDISCIPLINARES');
    expect(carriers[0]?.fields.publisher.value).toBe('Arco Editores');
    expect(carriers[1]?.fields.title.value).toBe('Azure Arc-Enabled Kubernetes and Servers');
    expect(carriers[1]?.fields.publisher.value).toBe('Apress');
  });

  it('recovers noisy numeric conference publisher tails instead of leaving the title in authors', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Gràchév V, Shulgà L, Smirnovà M, Nàidà N. Productivé ànd réproductivé quàlitiés of récord cows, Làtvià Univérsity of Agriculturé; 2017. https://doi.org/10.22616/érdév2017.16.n307.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe('Productivé ànd réproductivé quàlitiés of récord cows');
    expect(carriers[0]?.fields.publisher.value).toBe('Làtvià Univérsity of Agriculturé');
    expect(carriers[0]?.fields.authors.value).toHaveLength(4);
  });

  it('strips trailing URL identifier tails before parsing RFC-style webpages', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Internet Engineering Task Force. (2018). The Transport Layer Security (TLS) Protocol Version 1.3. Internet Engineering Task Force. RFC Editor. https://www.rfc-editor.org/rfc/rfc8446 PMID:99999999'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe('The Transport Layer Security (TLS) Protocol Version 1.3');
    expect(carriers[0]?.fields.siteName.value).toBe('RFC Editor');
    expect(carriers[0]?.fields.journal.value).toBeNull();
    expect(carriers[0]?.fields.pages.value).toBeNull();
    expect(carriers[0]?.fields.pmid.value).toBe('99999999');
  });

  it('recovers comma-separated IEEE conference publisher tails instead of swallowing the title into container fields', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]A. Rahman and D. Singh, “Early Diagnosis of Alzheimer’s Disease Using Machine Learning in MCI Individuals,” IEEE, 2024, pp. 1–5. doi: 10.1109/ccis63231.2024.10932134.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe(
      'Early Diagnosis of Alzheimer’s Disease Using Machine Learning in MCI Individuals',
    );
    expect(carriers[0]?.fields.authors.value).toHaveLength(2);
    expect(carriers[0]?.fields.publisher.value).toBe('IEEE');
    expect(carriers[0]?.fields.pages.value).toBe('1-5');
    expect(carriers[0]?.fields.conferenceTitle.value).not.toBeNull();
  });

  it('recovers swallowed book-series titles when the extracted bookTitle only repeats the publisher', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Wallinga, M. (2020). The Effects of a Right of Withdrawal on Consumers’ Willingness to Purchase Online. Studies in European Economic Law and Regulation. Springer International Publishing, pp. 71–113. Available at: https://doi.org/10.1007/978-3-030-54001-2_3.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.title.value).toBe(
      "The Effects of a Right of Withdrawal on Consumers' Willingness to Purchase Online",
    );
    expect(carriers[0]?.fields.bookTitle.value).toBe('Studies in European Economic Law and Regulation');
    expect(carriers[0]?.fields.publisher.value).toBe('Springer International Publishing');
    expect(carriers[0]?.fields.pages.value).toBe('71-113');
  });

  it('does not keep accented available-at tails as site names in thesis citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Botter Junior, W. (2021). Relações interfaciais de poli(dimetilsiloxano) com sólidos inorgânicos. Dissértàtion. Univérsidàdé Estàduàl dé Càmpinàs. Avàilàblé àt: https://doi.org/10.47749/t/unicamp.1997.133750.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.thesisType.value).toBe('Dissertation');
    expect(String(carriers[0]?.fields.siteName.value ?? '')).not.toMatch(/available|avàilàblé/i);
    expect(carriers[0]?.fields.conferenceTitle.value).toBeNull();
  });

  it('drops accented standards-style conference spill from report citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('ASTM Intérnàtionàl. (2013). Practice for Selection of Blood for in vitro Evaluation of Blood Pumps. ASTM Spécificàtion F1830. ASTM Intérnàtionàl. https://doi.org/10.1520/f1830-97r13.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);

    expect(carriers[0]?.fields.publisher.value ?? carriers[0]?.fields.institution.value).toBe(
      'ASTM Intérnàtionàl',
    );
    expect(carriers[0]?.fields.conferenceTitle.value).toBeNull();
  });
});

function createRuntimeStub(input: {
  health: MLHealthResponse | null;
  extractImpl: (
    mode: Phase4RequestMode,
    texts: string[],
    styles: Array<string>,
  ) => Promise<Phase4ExtractAttempt>;
}): Phase4MlRuntimeLike {
  return {
    getCachedHealth: () => input.health,
    refreshHealth: async () => input.health,
    extract: input.extractImpl as Phase4MlRuntimeLike['extract'],
    recordFallback: () => {},
    recordShadowDrop: () => {},
    getMetricsSnapshot: () => ({
      requestsTotal: {},
      latencyMs: {},
      fallbacksTotal: {},
      shadowDropsTotal: {},
      breakerState: 'closed',
      queueDepth: 0,
    }),
  };
}

function healthOk(): MLHealthResponse {
  return {
    status: 'ok',
    activeModelVersion: 'mock-crf',
    featureVersion: 'mock-features',
    artifactsReady: true,
    lastSuccessfulInferenceAt: null,
  };
}
