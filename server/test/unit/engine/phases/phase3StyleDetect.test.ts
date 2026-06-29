import { describe, expect, it } from 'vitest';
import { Phase3StyleDetect, phase3StyleDetect } from '../../../../src/engine/phases/phase3StyleDetect.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';
import { makeRawBlock } from '../../../helpers/makeRawBlock.js';

describe('phase3StyleDetect', () => {
  it('detects mixed-style batches and marks carriers as multi-style', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.'),
        makeRawBlock('[2] A. Doe, "Circuit paper," Journal of Testing, vol. 4, no. 2, pp. 10-14, 2022.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(2);
    expect(carriers[0]?.style.family).toBe('author_date');
    expect(carriers[1]?.style.family).toBe('numeric');
    expect(carriers[0]?.style.primary.style).toBe('apa7');
    expect(carriers[1]?.style.primary.style).toBe('ieee');
    expect(carriers.every((carrier) => carrier.style.isMultiStyle)).toBe(true);
  });

  it('detects Vancouver-style journal citations without falling back to unknown', async () => {
    const ctx = createTestPipelineContext();
    const [carrier] = await phase3StyleDetect.run(
      [
        makeRawBlock('Gomes MA, Kovaleski JL, Pagani RN, da Silva VL. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology. 2022 Oct 3;46(7):608-16.'),
      ],
      ctx,
    );

    expect(carrier?.style.primary.style).toBe('vancouver');
    expect(carrier?.style.family).toBe('numeric');
    expect(carrier?.style.isUnknown).toBe(false);
  });

  it('detects conference proceeding references with pages as a known style', async () => {
    const ctx = createTestPipelineContext();
    const [carrier] = await phase3StyleDetect.run(
      [
        makeRawBlock('Shailaja K, Seetharamulu B, Jabbar MA. Machine learning in healthcare: A review. In 2018 Second International Conference on Electronics, Communication and Aerospace Technology (ICECA) 2018 Mar 29 (pp. 910-914). IEEE.'),
      ],
      ctx,
    );

    expect(carrier?.style.primary.style).toBe('ama');
    expect(carrier?.style.family).toBe('numeric');
    expect(carrier?.style.isUnknown).toBe(false);
  });

  it('keeps family-known ambiguous numeric citations conservative instead of forcing an exact style', async () => {
    const ctx = createTestPipelineContext();
    const [carrier] = await phase3StyleDetect.run(
      [
        makeRawBlock('1. Smith J, Doe A. Example study. J Examples. 2020, 12(3), 44-50.'),
      ],
      ctx,
    );

    expect(carrier?.style.family).toBe('numeric');
    expect(carrier?.style.primary.style).toBe('unknown');
    expect(carrier?.style.isUnknown).toBe(false);
  });

  it('keeps sparse parenthesized author-date citations family-known instead of forcing apa7', async () => {
    const ctx = createTestPipelineContext();
    const [carrier] = await phase3StyleDetect.run(
      [
        makeRawBlock('Smith J (2023) Article title. Journal of Medicine 45(2):100-110.'),
      ],
      ctx,
    );

    expect(carrier?.style.family).toBe('author_date');
    expect(carrier?.style.primary.style).toBe('unknown');
    expect(carrier?.style.isUnknown).toBe(false);
  });

  it('rescues noisy thesis citations from unknown by matching thesis cues after diacritic folding', async () => {
    const ctx = createTestPipelineContext();
    const [carrier] = await phase3StyleDetect.run(
      [
        makeRawBlock('Hérrmànn, Hildébràndo. Politicà Do Aprovéitàménto dé Aréià No Estàdo dé São Pàulo. 2021, https://doi.org/10.47749/t/unicàmp.1990.27020. Univérsidàdé Estàduàl dé Càmpinàs, Dissértàtion.'),
      ],
      ctx,
    );

    expect(carrier?.style.family).toBe('notes_bibliography');
    expect(carrier?.style.primary.style).toBe('mla9');
    expect(carrier?.style.isUnknown).toBe(false);
  });

  it('falls back when ML style detection exceeds the phase budget', async () => {
    const ctx = createTestPipelineContext();
    ctx.performanceBudgets.style_detection = 1;
    const phase = new Phase3StyleDetect({
      detectStyle: async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        return [];
      },
    } as never);

    const carriers = await phase.run(
      [
        makeRawBlock('Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.'),
        makeRawBlock('[2] A. Doe, "Circuit paper," Journal of Testing, vol. 4, no. 2, pp. 10-14, 2022.'),
      ],
      ctx,
    );

    expect(carriers[0]?.style.primary.style).toBe('apa7');
    expect(ctx.stageLog.at(-1)?.message).toContain('latency budget');
  });

  it('aborts the in-flight ML style request when the phase budget is exceeded', async () => {
    const ctx = createTestPipelineContext();
    ctx.performanceBudgets.style_detection = 50;
    let abortObserved = false;
    const phase = new Phase3StyleDetect({
      detectStyle: async (_texts, options) => await new Promise<never>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          abortObserved = true;
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }),
    } as never);

    const carriers = await phase.run(
      [
        makeRawBlock('Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.'),
        makeRawBlock('[2] A. Doe, "Circuit paper," Journal of Testing, vol. 4, no. 2, pp. 10-14, 2022.'),
      ],
      ctx,
    );

    expect(abortObserved).toBe(true);
    expect(carriers[0]?.style.primary.style).toBe('apa7');
    expect(ctx.stageLog.at(-1)?.message).toContain('latency budget');
  });

  it('uses trusted ML style hints to rescue high-confidence APA, Harvard, and IEEE exact styles without overriding Vancouver theses', async () => {
    const ctx = createTestPipelineContext();
    const phase = new Phase3StyleDetect({
      detectStyle: async () => [
        {
          primary: { style: 'apa7', confidence: 0.995 },
          secondary: { style: 'harvard-ctr', confidence: 0.003 },
        },
        {
          primary: { style: 'harvard-ctr', confidence: 0.991 },
          secondary: { style: 'apa7', confidence: 0.004 },
        },
        {
          primary: { style: 'ieee', confidence: 0.9912 },
          secondary: { style: 'chicago-notes-bib', confidence: 0.0006 },
        },
        {
          primary: { style: 'ieee', confidence: 0.9912 },
          secondary: { style: 'vancouver', confidence: 0.004 },
        },
      ],
    } as never);

    const carriers = await phase.run(
      [
        makeRawBlock('Elgaafary, S., Hlevnjak, M., Schulze, M., Thewes, V., Seitz, J., Fremd, C., Michel, L., Beck, K., Pfütze, K., Richter, D., Wolf, S., Pixberg, C., Hutter, B., Ishaque, N., Hirsch, S., Gieldon, L., Stenzinger, A., Springfeld, C., Kreutzfeld, S., … Schneeweiss, A. (2020). Dauerhaftes Ansprechen auf Olaparib und endokrine Therapie bei einer Patientin mit metastasiertem luminalem Mammakarzinom und gBRCA-Mutation. Geburtshilfe und Frauenheilkunde. https://doi.org/10.1055/s-0040-1714539'),
        makeRawBlock('Export of UDP Options Information in IP Flow Information Export (IPFIX) (2025) RFC Editor. Available at: https://www.rfc-editor.org/rfc/rfc9870.html.'),
        makeRawBlock('[1]US Geological Survey, “The minerals of North Carolina,” US Geological Survey, 1891. doi: 10.3133/b74.'),
        makeRawBlock('[1]Pashaei Adl H, Gorji S, Muñoz Matutano G, Gualdrón-Reyes AF, Suárez I, S. Chirvony V, et al. The thermal decoherence of superradiance in halide perovskite supercrystals, FUNDACIO DE LA COMUNITAT VALENCIANA SCITO; 2022. https://doi.org/10.29363/nanoge.emlem.2022.044.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(4);
    expect(carriers[0]?.style.primary.style).toBe('apa7');
    expect(carriers[1]?.style.primary.style).toBe('harvard-ctr');
    expect(carriers[2]?.style.primary.style).toBe('ieee');
    expect(carriers[3]?.style.primary.style).toBe('vancouver');
  });

  it('skips ML hints in core_parse_fast and keeps the phase successful', async () => {
    const ctx = createTestPipelineContext({
      options: { parseProfile: 'core_parse_fast' },
    });
    let mlCalls = 0;
    const phase = new Phase3StyleDetect({
      detectStyle: async () => {
        mlCalls += 1;
        return [];
      },
    } as never);

    const [carrier] = await phase.run(
      [
        makeRawBlock('Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.'),
      ],
      ctx,
    );

    expect(mlCalls).toBe(0);
    expect(carrier?.style.primary.style).toBe('apa7');
    expect(ctx.stageLog.at(-1)?.status).toBe('success');
    expect(ctx.stageLog.at(-1)?.message).toContain('execution policy');
  });

  it('skips ML hints for strong single-citation deterministic detections', async () => {
    const ctx = createTestPipelineContext();
    let mlCalls = 0;
    const phase = new Phase3StyleDetect({
      detectStyle: async () => {
        mlCalls += 1;
        return [];
      },
    } as never);

    const [carrier] = await phase.run(
      [
        makeRawBlock('Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.'),
      ],
      ctx,
    );

    expect(mlCalls).toBe(0);
    expect(carrier?.style.primary.style).toBe('apa7');
    expect(ctx.stageLog.at(-1)?.status).toBe('success');
    expect(ctx.stageLog.at(-1)?.message).toContain('high-confidence single citation');
  });

  it('ignores ML hints that abstain exact-style commits under decision policy', async () => {
    const ctx = createTestPipelineContext();
    const phase = new Phase3StyleDetect({
      detectStyle: async () => [
        {
          decision: 'family_only',
          family: 'numeric',
          exactStyle: null,
          supportedExact: false,
          abstain: true,
          confidence: 0.86,
          margin: 0.04,
          oodScore: 0.12,
          reasonCodes: ['UNSUPPORTED_EXACT_OR_LOW_MARGIN'],
          inputProfile: 'clean-structured',
          thresholdSetVersion: 'policy-1',
          primary: { style: 'ieee', confidence: 0.9 },
          secondary: { style: 'vancouver', confidence: 0.08 },
        },
      ],
    } as never);

    const [carrier] = await phase.run(
      [
        makeRawBlock('Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.'),
      ],
      ctx,
    );

    expect(carrier?.style.family).toBe('author_date');
    expect(carrier?.style.primary.style).toBe('apa7');
  });

  it('keeps real benchmark-style exact-style commits stable across the current blocker families', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Кирчанов, М. (2011) “A Cat’s Lick: Democratisation and Minority Communities in the Post-Soviet Baltic by Timofey Agarin, and Continuity and Change in the Baltic Sea Region: Comparing Foreign Policies by David J. Galbreath, Ainius Lašas, Jeremy W. Lamoreaux (review),” Ab Imperio, 2011(3), pp. 461–468. Available at: https://doi.org/10.1353/imp.2011.0081.'),
        makeRawBlock('Tiwari, N. (2011). Merger Under The Regime of Competition Law: A Comparative Study of Indian Legal Framework With EC and UK. Bond Law Review, 23(1). https://doi.org/10.53300/001c.5580'),
        makeRawBlock('Кирчанов, Максим. “A Cat’s Lick: Democratisation and Minority Communities in the Post-Soviet Baltic by Timofey Agarin, and Continuity and Change in the Baltic Sea Region: Comparing Foreign Policies by David J. Galbreath, Ainius Lašas, Jeremy W. Lamoreaux (Review).” Ab Imperio, vol. 2011, no. 3, 2011, pp. 461–68, https://doi.org/10.1353/imp.2011.0081.'),
        makeRawBlock('Алексеев, Игорь. “Собирание Расколотой Уммы: Фундаментализм Как Реинтерпретация Исламской Истории.” Ab Imperio 2004, no. 3 (2004): 491–516. https://doi.org/10.1353/imp.2004.0159.'),
        makeRawBlock('[1]N. Tiwari, “Merger Under The Regime of Competition Law: A Comparative Study of Indian Legal Framework With EC and UK,” Bond Law Review, vol. 23, no. 1, 2011, doi: 10.53300/001c.5580.'),
        makeRawBlock('[1]Tiwari N. Merger Under The Regime of Competition Law: A Comparative Study of Indian Legal Framework With EC and UK. Bond Law Review 2011;23. https://doi.org/10.53300/001c.5580.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(6);
    expect(carriers[0]?.style.family).toBe('author_date');
    expect(carriers[0]?.style.primary.style).toBe('harvard-ctr');
    expect(carriers[1]?.style.family).toBe('author_date');
    expect(carriers[1]?.style.primary.style).toBe('apa7');
    expect(carriers[2]?.style.family).toBe('notes_bibliography');
    expect(carriers[2]?.style.primary.style).toBe('mla9');
    expect(carriers[3]?.style.family).toBe('notes_bibliography');
    expect(carriers[3]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[4]?.style.family).toBe('numeric');
    expect(carriers[4]?.style.primary.style).toBe('ieee');
    expect(carriers[5]?.style.family).toBe('numeric');
    expect(carriers[5]?.style.primary.style).toBe('vancouver');
  });

  it('commits harvard-ctr for real benchmark conference and chapter citations with parenthesized years', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Li, D. and Zhang, B. (2022) “DECOMPOSING THE IMPLEMENTATION OF COMPLEX ENGINEERING PROBLEM-SOLVING SKILLS ON PYTHON-BASED ARTIFICIAL INTELLIGENCE AND BIG DATA.” International Organization Center of Academic Research. Available at: https://doi.org/10.47696/adved.202211.'),
        makeRawBlock('Seyffart, G. (1991) “P,” Drug Dosage in Renal Insufficiency. Springer Netherlands, pp. 443–515. Available at: https://doi.org/10.1007/978-94-011-3804-8_16.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(2);
    expect(carriers[0]?.style.family).toBe('author_date');
    expect(carriers[0]?.style.primary.style).toBe('harvard-ctr');
    expect(carriers[1]?.style.family).toBe('author_date');
    expect(carriers[1]?.style.primary.style).toBe('harvard-ctr');
  });

  it('commits exact styles for the current Chicago, Harvard patent, and Vancouver conference blockers', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Görling, Reinhold. “Pursuing Emptiness: Obsession and (Im) Potence in Kathryn Bigelow’s Blue Steel (US 1990).” In From La Strada to The Hours. Springer Berlin Heidelberg, 2024. https://doi.org/10.1007/978-3-662-68789-5_22.'),
        makeRawBlock('“Computer speech recognition and processing technology” (2006) Patent Application No. AU2005203028A1. Available at: https://doi.org/10.22541/au.116685616.31427431/v1.'),
        makeRawBlock('[1]Pashaei Adl H, Gorji S, Muñoz Matutano G, Gualdrón-Reyes AF, Suárez I, S. Chirvony V, et al. The thermal decoherence of superradiance in halide perovskite supercrystals, FUNDACIO DE LA COMUNITAT VALENCIANA SCITO; 2022. https://doi.org/10.29363/nanoge.emlem.2022.044.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(3);
    expect(carriers[0]?.style.family).toBe('notes_bibliography');
    expect(carriers[0]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[1]?.style.family).toBe('author_date');
    expect(carriers[1]?.style.primary.style).toBe('harvard-ctr');
    expect(carriers[2]?.style.family).toBe('numeric');
    expect(carriers[2]?.style.primary.style).toBe('vancouver');
  });

  it('commits exact styles for the remaining clean structured benchmark blocker patterns', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Jin, J., Yuan, F., & Lu, H. (2014). Patch nearfield acoustic holography based visualization of spatial distribution of sound quality objective parameters. The Journal of the Acoustical Society of America, 135(4_Supplement), 2418–2419. https://doi.org/10.1121/1.4878030'),
        makeRawBlock('[1]Bird IL. A Lady’s Life in the Rocky Mountains. Victorian Review 1997;23:167–167. https://doi.org/10.1353/vcr.1997.0036.'),
        makeRawBlock('Tiwari, Neeraj. “Merger Under The Regime of Competition Law: A Comparative Study of Indian Legal Framework With EC and UK.” Bond Law Review 23, no. 1 (2011). https://doi.org/10.53300/001c.5580.'),
        makeRawBlock('Tiwari, Neeraj. “Merger Under The Regime of Competition Law: A Comparative Study of Indian Legal Framework With EC and UK.” Bond Law Review, vol. 23, no. 1, 2011, https://doi.org/10.53300/001c.5580.'),
        makeRawBlock('Lim, C.S. et al. (2010) “Retroperitoneal Inflammatory Liposarcoma in a Patient with Non-Hodgkin Lymphoma: A Report Highlighting Diagnostic Pitfalls,” Pathology Research International, 2010, pp. 1–4. Available at: https://doi.org/10.4061/2010/505436.'),
        makeRawBlock('[1]M. Taylor, Quantum Microscopy of Biological Systems. Springer International Publishing, 2015. doi: 10.1007/978-3-319-18938-3.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(6);
    expect(carriers[0]?.style.primary.style).toBe('apa7');
    expect(carriers[1]?.style.primary.style).toBe('vancouver');
    expect(carriers[2]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[3]?.style.primary.style).toBe('mla9');
    expect(carriers[4]?.style.primary.style).toBe('harvard-ctr');
    expect(carriers[5]?.style.primary.style).toBe('ieee');
  });

  it('commits exact styles for the latest post-alignment blocker families instead of falling back to unknown', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]Padgett A. Fall. Appalachian Heritage 2015;43:87–99. https://doi.org/10.1353/aph.2015.0029.'),
        makeRawBlock('Alexandra A. Taylor. (2022). Obituary: John H. Litchfield. Chemical & Engineering News, 25–25. https://doi.org/10.47287/cen-10040-obits4'),
        makeRawBlock('Gebreegziabher, Tesafaldet, and Filimon Gebreeyesus. “Biomass Waste to Energy for a Particleboards Industry.” Paper presented at International Conference on Energy Harvesting, Storage, and Transfer. 2023. https://doi.org/10.11159/ehst23.123.'),
        makeRawBlock('Pillai, Rachna, et al. “An Updated Methodology for Sediment Distribution Maps Using Conditional Strings in Arc GIS 10.X.” Arabian Journal of Geosciences, vol. 14, no. 20, 2021, https://doi.org/10.1007/s12517-021-07053-y.'),
        makeRawBlock('MARTINS, D.M. (2022) CONEXÕES INTERDISCIPLINARES. Arco Editores. Available at: https://doi.org/10.48209/978-65-5417-045-1.'),
        makeRawBlock('[1]C. P. Loizou and C. S. Pattichis, Despeckle Filtering Algorithms and Software for Ultrasound Imaging. Springer International Publishing, 2008. doi: 10.1007/978-3-031-01510-6.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(6);
    expect(carriers[0]?.style.primary.style).toBe('vancouver');
    expect(carriers[1]?.style.primary.style).toBe('apa7');
    expect(carriers[2]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[3]?.style.primary.style).toBe('mla9');
    expect(carriers[4]?.style.primary.style).toBe('harvard-ctr');
    expect(carriers[5]?.style.primary.style).toBe('ieee');
  });

  it('commits exact styles for long-author APA, quoted MLA/Chicago tails, Vancouver institutional numerics, and IEEE reports', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Elgaafary, S., Hlevnjak, M., Schulze, M., Thewes, V., Seitz, J., Fremd, C., Michel, L., Beck, K., Pfütze, K., Richter, D., Wolf, S., Pixberg, C., Hutter, B., Ishaque, N., Hirsch, S., Gieldon, L., Stenzinger, A., Springfeld, C., Kreutzfeld, S., … Schneeweiss, A. (2020). Dauerhaftes Ansprechen auf Olaparib und endokrine Therapie bei einer Patientin mit metastasiertem luminalem Mammakarzinom und gBRCA-Mutation. Geburtshilfe und Frauenheilkunde. https://doi.org/10.1055/s-0040-1714539'),
        makeRawBlock('Cubeta, Germana. Dickens and the Italians in “Pictures from Italy.” Springer International Publishing, 2020. https://doi.org/10.1007/978-3-030-47429-4.'),
        makeRawBlock('Cubeta, Germana. Dickens and the Italians in “Pictures from Italy.” Springer International Publishing, 2020, https://doi.org/10.1007/978-3-030-47429-4.'),
        makeRawBlock('Streeten, Paul. “Towards a Country and Crop Typology.” In What Price Food? Palgrave Macmillan UK, 1987. https://doi.org/10.1007/978-1-349-18921-2_3.'),
        makeRawBlock('Yakimenko, Valerie V. “The Major Rivers and the Genesis of the Recent Area of Ticks Ixodes Persulcatus in Western Siberia.” Parasitology Research Monographs, Springer International Publishing, 2019, pp. 367–81, https://doi.org/10.1007/978-3-030-29061-0_16.'),
        makeRawBlock('[1]Singh B, Singh G, Lee A. Five-Year Carotid Artery Intervention Outcomes, Thieme Medical and Scientific Publishers Pvt. Ltd.; 2023. https://doi.org/10.1055/s-0043-1763383.'),
        makeRawBlock('[1]US Geological Survey, “The minerals of North Carolina,” US Geological Survey, 1891. doi: 10.3133/b74.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(7);
    expect(carriers[0]?.style.primary.style).toBe('apa7');
    expect(carriers[1]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[2]?.style.primary.style).toBe('mla9');
    expect(carriers[3]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[4]?.style.primary.style).toBe('mla9');
    expect(carriers[5]?.style.primary.style).toBe('vancouver');
    expect(carriers[6]?.style.primary.style).toBe('ieee');
  });

  it('keeps long-author APA conference proceedings on the author-date side instead of leaking into numeric due DOI tails', async () => {
    const ctx = createTestPipelineContext();
    const [carrier] = await phase3StyleDetect.run(
      [
        makeRawBlock('Pashaei Adl, H., Gorji, S., Muñoz Matutano, G., Gualdrón-Reyes, A. F., Suárez, I., S. Chirvony, V., Mora-Seró, I., & Martínez-Pastor, J. P. (2022). The thermal decoherence of superradiance in halide perovskite supercrystals. Proceedings of the International Conference on Emerging Light Emitting Materials. https://doi.org/10.29363/nanoge.emlem.2022.044'),
      ],
      ctx,
    );

    expect(carrier?.style.family).toBe('author_date');
    expect(carrier?.style.primary.style).toBe('apa7');
  });

  it('commits exact styles for the current issue-only MLA, APA article-number, Harvard available-at book, and Vancouver journal blockers', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Hoàng, An Quốc. “Cộng Đồng Kinh Tế ASEAN và Cơ Hội Phát Triển Của Việt Nam.” Dong Thap University Journal of Science, no. 13, 2015, pp. 100–03, https://doi.org/10.52714/dthu.13.6.2015.212.'),
        makeRawBlock('Abe, Y., Shen, C., Boilley, D., & Giraud, B. G. (2010). Compound Nucleus Reaction Theory for Synthesis of Super-Heavy Elements. EPJ Web of Conferences, 2, 10002. https://doi.org/10.1051/epjconf/20100210002'),
        makeRawBlock('TARREGA, M.C.V.B., SILVA, A.G. and LIMA NETO, R.B. (2022) Coletânea de Legislação Nacional e Internacional sobre Povos e Comunidades Tradicionais: Volume I - Normas Internacionais. Dialética. Available at: https://doi.org/10.48021/978-65-252-3979-8.'),
        makeRawBlock('[1]Howard J. Editor’s Note. Appalachian Heritage 2015;43:5–7. https://doi.org/10.1353/aph.2015.0035.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(4);
    expect(carriers[0]?.style.primary.style).toBe('mla9');
    expect(carriers[1]?.style.primary.style).toBe('apa7');
    expect(carriers[2]?.style.primary.style).toBe('harvard-ctr');
    expect(carriers[3]?.style.primary.style).toBe('vancouver');
  });

  it('commits exact styles for older books and multilingual conference cues instead of collapsing to unknown', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Eberhard, W. (1896) Ludwig III. Kurfürst von der Pfalz und das Reich 1410–1427. De Gruyter. Available at: https://doi.org/10.1515/9783112466384.'),
        makeRawBlock('Eberhard, Wilhelm. Ludwig III. Kurfürst von der Pfalz und das Reich 1410–1427. De Gruyter, 1896. https://doi.org/10.1515/9783112466384.'),
        makeRawBlock('[1]W. Eberhard, Ludwig III. Kurfürst von der Pfalz und das Reich 1410–1427. De Gruyter, 1896. doi: 10.1515/9783112466384.'),
        makeRawBlock('Contreras, María Luisa, et al. “Anafilaxia Inducida Por Ejercicio: A Propósito de Un Caso.” 2023, XXIX Congreso Nacional de Medicina General y de Familia y V Jornadas SEMG Andalucía Abstracts Publication, https://doi.org/10.48158/semg23-144.'),
        makeRawBlock('Gebreegziabher, Tesafaldet, and Filimon Gebreeyesus. “Biomass Waste to Energy for a Particleboards Industry.” 2023, International Conference on Energy Harvesting, Storage, and Transfer, https://doi.org/10.11159/ehst23.123.'),
        makeRawBlock('Albright, Carol Bonomo. American Woman, Italian Style. Fordham University Press, 2022, https://doi.org/10.1515/9780823290840.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(6);
    expect(carriers[0]?.style.primary.style).toBe('harvard-ctr');
    expect(carriers[1]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[2]?.style.primary.style).toBe('ieee');
    expect(carriers[3]?.style.primary.style).toBe('mla9');
    expect(carriers[4]?.style.primary.style).toBe('mla9');
    expect(carriers[5]?.style.primary.style).toBe('mla9');
  });

  it('keeps numbered author-date citations and sparse truncated web snippets on the correct family side', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('1. SHOJI, Mamoru, & Group, LHD Experiment (2020). Radiation Resistant Camera System for Monitoring Deuterium Plasma Discharges in the Large Helical Device. Plasma and Fusion Research, 15(0), 2402039.'),
        makeRawBlock('41. Intelligent clinical trials . (2020). https://www2.deloitte.com/content/dam/insights/us/articles/22934_intelligent-clinical-trials/DI_Intelligent-clinical-....'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(2);
    expect(carriers[0]?.style.family).toBe('author_date');
    expect(carriers[0]?.style.primary.style).toBe('apa7');
    expect(carriers[1]?.style.family).toBe('unknown');
    expect(carriers[1]?.style.primary.style).toBe('unknown');
  });

  it('keeps web-accessed public health pages in web_accessed unknown instead of escalating into notes or author-date families', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('World Health Organization. T cell guidance. https://www.who.int/news-room/fact-sheets/detail/t-cells. Accessed March 2, 2024.'),
        makeRawBlock('J. (2024). T cell guide. https://example.org/t-cells. Accessed March 2, 2024.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(2);
    expect(carriers[0]?.style.family).toBe('web_accessed');
    expect(carriers[0]?.style.primary.style).toBe('unknown');
    expect(carriers[1]?.style.family).toBe('web_accessed');
    expect(carriers[1]?.style.primary.style).toBe('unknown');
  });

  it('commits exact styles for the current poster, thesis, proceedings, chapter, and institutional numeric blockers', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Brown, A. (2022). Directional Dark Matter Detection With Scintillating Crystals [Poster]. N/A. https://doi.org/10.22323/1.414.0997'),
        makeRawBlock('Botter Junior, W. (2021) Relações interfaciais de poli(dimetilsiloxano) com solidos inorganicos. Dissertation. Universidade Estadual de Campinas. Available at: https://doi.org/10.47749/t/unicamp.1997.133750.'),
        makeRawBlock('Fahrutdinova, A. V. “TRADION OF ENGLISH HUMOUR IN THE NOVEL “ENGLAND, ENGLAND” BY JULIAN BARNES.” 2022, ACTUAL PROBLEMS OF LINGUISTICS AND LITERARY STUDIES. Proceedings of the IX (XXIII) International Scientific and Practical Conference of Young Scientists, https://doi.org/10.17223/978-5-907572-71-0-2022-40.'),
        makeRawBlock('Yakimenko, Valerie V. “The Major Rivers and the Genesis of the Recent Area of Ticks Ixodes persulcatus in Western Siberia.” In Parasitology Research Monographs. Springer International Publishing, 2019. https://doi.org/10.1007/978-3-030-29061-0_16.'),
        makeRawBlock('[1]Li D, Zhang B. DECOMPOSING THE IMPLEMENTATION OF COMPLEX ENGINEERING PROBLEM-SOLVING SKILLS ON PYTHON-BASED ARTIFICIAL INTELLIGENCE AND BIG DATA, International Organization Center of Academic Research; 2022. https://doi.org/10.59499/ep235765321.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(5);
    expect(carriers[0]?.style.primary.style).toBe('apa7');
    expect(carriers[1]?.style.primary.style).toBe('harvard-ctr');
    expect(carriers[2]?.style.primary.style).toBe('mla9');
    expect(carriers[3]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[4]?.style.primary.style).toBe('vancouver');
  });

  it('commits exact styles for sparse conference, report, page-only, and multilingual monograph cadences', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Trаtsiak, A. I. (2022). THE 100-YEAR HISTORY OF THE NATIONAL LIBRARY OF BELARUS IN THE AUDIO-VISUAL DOCUMENTS OF THE BELARUSIAN STATE ARCHIVES OF FILMS, PHOTOGRAPHS AND SOUND. LIBRARIES IN THE INFORMATION SOCIETY: PRESERVING TRADITIONS AND DEVELOPING NEW TECHNOLOGIES. https://doi.org/10.47612/978-985-880-283-7-2022-310-324'),
        makeRawBlock('BSI British Standards (2013) Lamps for road vehicles. Dimensional, electrical and luminous requirements. BSI British Standards. Available at: https://doi.org/10.3403/01032627.'),
        makeRawBlock('Trаtsiak, A. I. “THE 100-YEAR HISTORY OF THE NATIONAL LIBRARY OF BELARUS IN THE AUDIO-VISUAL DOCUMENTS OF THE BELARUSIAN STATE ARCHIVES OF FILMS, PHOTOGRAPHS AND SOUND.” 2022, LIBRARIES IN THE INFORMATION SOCIETY: PRESERVING TRADITIONS AND DEVELOPING NEW TECHNOLOGIES, https://doi.org/10.47612/978-985-880-283-7-2022-310-324.'),
        makeRawBlock('Choquette, K. D. “Technology Status and Opportunities of VCSELs.” 2003, 295–97. https://doi.org/10.1109/iciprm.2002.1014379.'),
        makeRawBlock('[1]Monchik EP. MAIN ACTIVITIES OF THE REPUBLICAN LIBRARY FOR SCIENCE AND TECHNOLOGY OF BELARUS AS A METHODOLOGICAL CENTER FOR SCIENTIFIC AND TECHNICAL LIBRARIES OF ENTERPRISES AND ORGANIZATIONS OF THE REPUBLIC OF BELARUS, УП «ИВЦ Минфина»; 2022. https://doi.org/10.47612/978-985-880-283-7-2022-158-166.'),
        makeRawBlock('[1]D. M. MARTINS, CONEXÕES INTERDISCIPLINARES. Arco Editores, 2022. doi: 10.48209/978-65-5417-045-1.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(6);
    expect(carriers[0]?.style.primary.style).toBe('apa7');
    expect(carriers[1]?.style.primary.style).toBe('harvard-ctr');
    expect(carriers[2]?.style.primary.style).toBe('mla9');
    expect(carriers[3]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[4]?.style.primary.style).toBe('vancouver');
    expect(carriers[5]?.style.primary.style).toBe('ieee');
  });

  it('uses family-first exact commits for current title-first Harvard, Chicago thesis, IEEE patent, Vancouver conference, and MLA preprint-like book blockers', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Export of UDP Options Information in IP Flow Information Export (IPFIX) (2025) RFC Editor. Available at: https://www.rfc-editor.org/rfc/rfc9870.html.'),
        makeRawBlock('Botter Junior, Wilson. “Relações Interfaciais de Poli(Dimetilsiloxano) Com Solidos Inorganicos.” Dissertation, Universidade Estadual de Campinas, 2021. https://doi.org/10.47749/t/unicamp.1997.133750.'),
        makeRawBlock('[1]“Web page ranking for page query across public and private,” US20060235842A1, 2006 [Online]. Available: https://patents.google.com/patent/US20060235842A1/en'),
        makeRawBlock('[1]Garg S, Mittal A, Sathiyasuntharam V. Deep Learning Based Model to Recommend Safe Route Navigation System, IEEE; 2025, p. 181–6. https://doi.org/10.1109/cictn64563.2025.10932570.'),
        makeRawBlock('Schloen, Brüne. Zivilisationsrettung Jetzt! Springer Fachmedien Wiesbaden, 2023, https://doi.org/10.1007/978-3-658-38331-2.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(5);
    expect(carriers[0]?.style.family).toBe('author_date');
    expect(carriers[0]?.style.primary.style).toBe('harvard-ctr');
    expect(carriers[1]?.style.family).toBe('notes_bibliography');
    expect(carriers[1]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[2]?.style.family).toBe('numeric');
    expect(carriers[2]?.style.primary.style).toBe('ieee');
    expect(carriers[3]?.style.family).toBe('numeric');
    expect(carriers[3]?.style.primary.style).toBe('vancouver');
    expect(carriers[4]?.style.family).toBe('notes_bibliography');
    expect(carriers[4]?.style.primary.style).toBe('mla9');
  });

  it('keeps the current real benchmark style blockers on their exact styles instead of leaking to unknown or sibling styles', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]MARTINS DM. CONEXÕES INTERDISCIPLINARES. Arco Editores; 2022. https://doi.org/10.48209/978-65-5417-045-1.'),
        makeRawBlock('Кузьмичёва, Ю. А. (2025). Особенности применения приёмов интерактивной игры в работе с детьми дошкольного и младшего школьного возраста на экскурсиях. Матэрыялы навукова-практычнай канферэнцыі. https://doi.org/10.52275/pm2023-53-57'),
        makeRawBlock('Gomes Oliveira, Celina. “A Genese Da CUT.” Dissertation, Universidade Estadual de Campinas, 2021. https://doi.org/10.47749/t/unicamp.1995.111309.'),
        makeRawBlock('Ali, Nafhesa. Older South Asian Migrant Women’s Experiences of Ageing in the UK. Springer International Publishing, 2024, https://doi.org/10.1007/978-3-031-50462-4.'),
        makeRawBlock('[1]謝劍平謝劍平, 當代金融市場. 智勝出版, 2022. doi: 10.53106/9789575118433.'),
        makeRawBlock('[1]“Export of UDP Options Information in IP Flow Information Export (IPFIX),” RFC Editor. [Online]. Available: https://www.rfc-editor.org/rfc/rfc9870.html'),
        makeRawBlock('[1]Carral L, Rodriguez-Guerreiro MJ, Lamas Galdo I, Santiago Caamaño L, Camba Fabal C, Tarrio Saavedra J, et al. Design, Manufacture, Transportation and Installation of “Green Artificial Reefs” in the Galician Estuaries: An Opportunity for a Circular Economy and Sustainable Development. Springer Series on Naval Architecture, Marine Engineering, Shipbuilding and Shipping, Springer Nature Switzerland; 2024, p. 261–72. https://doi.org/10.1007/978-3-031-49799-5_39.'),
        makeRawBlock('Hassan, A., et al. “An Effective Technique for Solving Generalized Cahn-Hilliard (C-H) Problems.” Research Square Platform LLC, 2023, https://doi.org/10.21203/rs.3.rs-2870128/v1.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(8);
    expect(carriers[0]?.style.family).toBe('numeric');
    expect(carriers[0]?.style.primary.style).toBe('vancouver');
    expect(carriers[1]?.style.family).toBe('author_date');
    expect(carriers[1]?.style.primary.style).toBe('apa7');
    expect(carriers[2]?.style.family).toBe('notes_bibliography');
    expect(carriers[2]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[3]?.style.family).toBe('notes_bibliography');
    expect(carriers[3]?.style.primary.style).toBe('mla9');
    expect(carriers[4]?.style.family).toBe('numeric');
    expect(carriers[4]?.style.primary.style).toBe('ieee');
    expect(carriers[5]?.style.family).toBe('numeric');
    expect(carriers[5]?.style.primary.style).toBe('ieee');
    expect(carriers[6]?.style.family).toBe('numeric');
    expect(carriers[6]?.style.primary.style).toBe('vancouver');
    expect(carriers[7]?.style.family).toBe('notes_bibliography');
    expect(carriers[7]?.style.primary.style).toBe('mla9');
  });

  it('commits exact styles for the current stage 2A blocker citations across books, preprints, patents, and numeric theses', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]International Monetary Fund. International Monetary Fund Annual Report 1986. International Monetary Fund; 1986. https://doi.org/10.5089/9781616351984.011.'),
        makeRawBlock('[1]謝劍平謝劍平. 當代金融市場. 智勝出版; 2022. https://doi.org/10.53106/9789575118433.'),
        makeRawBlock('[1]Awang NA, Mahmud NNHEBN, Zulkefli NUHH. Optical Trapping Using Mode-Locked Fiber Laser Au-Np Coated Side-Polished Fiber 2023. https://doi.org/10.2139/ssrn.4577205.'),
        makeRawBlock('Eberhard, W. (1896). Ludwig III. Kurfürst von der Pfalz und das Reich 1410–1427. De Gruyter. https://doi.org/10.1515/9783112466384'),
        makeRawBlock('Orós, Jorge. “Gout.” Mader’s Reptile and Amphibian Medicine and Surgery, Elsevier, 2019, pp. 1308-1309.e1, https://doi.org/10.1016/b978-0-323-48253-0.00151-3.'),
        makeRawBlock('Web page ranking for page query across public and private. Patent US20060235842A1, issued 2006. https://patents.google.com/patent/US20060235842A1/en.'),
        makeRawBlock('“Dendrobii officmalis caulis plants with heat preservation device in winter” (2026). Available at: https://patents.google.com/patent/CN223943381U/en.'),
        makeRawBlock('[1]Carral L, Rodriguez-Guerreiro MJ, Lamas Galdo I, Santiago Caamaño L, Camba Fabal C, Tarrio Saavedra J, et al. Design, Manufacture, Transportation and Installation of “Green Artificial Reefs” in the Galician Estuaries: An Opportunity for a Circular Economy and Sustainable Development. Springer Series on Naval Architecture, Marine Engineering, Shipbuilding and Shipping, Springer Nature Switzerland; 2024, p. 261–72. https://doi.org/10.1007/978-3-031-49799-5_39.'),
        makeRawBlock('[1]Botter Junior W. Relações interfaciais de poli(dimetilsiloxano) com solidos inorganicos. Dissertation. Universidade Estadual de Campinas, 2021. https://doi.org/10.47749/t/unicamp.1997.133750.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(9);
    expect(carriers[0]?.style.primary.style).toBe('vancouver');
    expect(carriers[1]?.style.primary.style).toBe('vancouver');
    expect(carriers[2]?.style.primary.style).toBe('vancouver');
    expect(carriers[3]?.style.primary.style).toBe('apa7');
    expect(carriers[4]?.style.primary.style).toBe('mla9');
    expect(carriers[5]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[6]?.style.primary.style).toBe('harvard-ctr');
    expect(carriers[7]?.style.primary.style).toBe('vancouver');
    expect(carriers[8]?.style.primary.style).toBe('vancouver');
  });

  it('commits exact styles for the current stage 2A unknown-collapse blockers across APA books, MLA repositories/theses, Chicago RFC pages, and Vancouver numeric tails', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('International Monetary Fund. (1986). International Monetary Fund Annual Report 1986. International Monetary Fund. https://doi.org/10.5089/9781616351984.011'),
        makeRawBlock('謝劍平謝劍平. (2022). 當代金融市場. 智勝出版. https://doi.org/10.53106/9789575118433'),
        makeRawBlock('Nurrohman, Eko. “Marjan Advertising Analysis 2023 From The Perspective of Jean Baudrillard.” Center for Open Science, 2023, https://doi.org/10.31219/osf.io/zf69h.'),
        makeRawBlock('Botter Junior, Wilson. Relações Interfaciais de Poli(Dimetilsiloxano) Com Solidos Inorganicos. 2021, https://doi.org/10.47749/t/unicamp.1997.133750. Universidade Estadual de Campinas, Dissertation.'),
        makeRawBlock('RFC Editor. “Export of UDP Options Information in IP Flow Information Export (IPFIX).” 2025. https://www.rfc-editor.org/rfc/rfc9870.html.'),
        makeRawBlock('Internet Engineering Task Force. “The Transport Layer Security (TLS) Protocol Version 1.3.” RFC Editor, Internet Engineering Task Force, 2018. https://www.rfc-editor.org/rfc/rfc8446.'),
        makeRawBlock('[1]Максимова ОВ, Чобитько ВГ, Мясникова АС. НАРУШЕНИЯ УГЛЕВОДНОГО ОБМЕНА У ЛИЦ С МЕТАБОЛИЧЕСКИМ СИНДРОМОМ, ФГБУ «НМИЦ эндокринологии» Минздрава России; 2023. https://doi.org/10.14341/cong23-26.05.23-78.'),
        makeRawBlock('[1]Kalyan birinderjit, Singh B. Fault-Tolerant Quantum-Dot Cellular Automata (Qca) Based Linear Feedback Shift Register (Lfsr) for Nano Communication Applications 2023. https://doi.org/10.2139/ssrn.4525741.'),
        makeRawBlock('[1]Majid H, Arshad H, Rehman S, Abidin Z ul, Siddiqi HS, Fatima S, et al. “A SWOC Analysis of Online Undergraduate Medical Education and its Impact on Cognitive Outcomes: Cross-Sectional Study” (Preprint) 2023. https://doi.org/10.2196/preprints.47303.'),
        makeRawBlock('“A waste storage pool for thermal power plants” (2026). Available at: https://patents.google.com/patent/CN223935505U/en.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(10);
    expect(carriers[0]?.style.primary.style).toBe('apa7');
    expect(carriers[1]?.style.primary.style).toBe('apa7');
    expect(carriers[2]?.style.primary.style).toBe('mla9');
    expect(carriers[3]?.style.primary.style).toBe('mla9');
    expect(carriers[4]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[5]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[6]?.style.primary.style).toBe('vancouver');
    expect(carriers[7]?.style.primary.style).toBe('vancouver');
    expect(carriers[8]?.style.primary.style).toBe('vancouver');
    expect(carriers[9]?.style.primary.style).toBe('harvard-ctr');
  });

  it('commits exact styles for the latest benchmark examples across Chicago docs pages, Vancouver identifiers, IEEE theses, and APA corporate reports', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Mozilla Contributors. “Array.Prototype.Map().” MDN Web Docs, Mozilla Contributors, 2024. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map.'),
        makeRawBlock('React Team. “State: A Component’s Memory.” React, React Team, 2024. https://react.dev/learn/state-a-components-memory.'),
        makeRawBlock('[1]Web page ranking for page query across public and private. US20060235842A1, 2006.'),
        makeRawBlock('[1]Wang Y, Yang X, Lu X, Cao X, Ao L, Ma L, et al. BODIPY-Labeled Aptasensor Based on Multi-Walled Carbon Nanotubes as the Quencher for “Off-On” Detection of Catechin 2023. https://doi.org/10.2139/ssrn.4460726.'),
        makeRawBlock('[1]N. F. de Silva, “Body weight prediction of crossbred beef cattle through the image processing and machine learning algorithms,” Dissertation, Pro-Reitoria de Pesquisa e Pos-Graduacai - UFV, 2023. doi: 10.47328/ufvbbt.2022.729.'),
        makeRawBlock('International Commission on Illumination (CIE). (2022). CIE 012.2-1977 Recommendations for the Lighting of Roads for Motorized Traffic. International Commission on Illumination (CIE). https://doi.org/10.25039/tr.012.2.1977'),
        makeRawBlock('U.S. Pharmacopeial Convention. (2021). Rimexolone Ophthalmic Suspension. U.S. Pharmacopeial Convention. https://doi.org/10.31003/uspnf_m73698_01_01'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(7);
    expect(carriers[0]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[1]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[2]?.style.primary.style).toBe('vancouver');
    expect(carriers[3]?.style.primary.style).toBe('vancouver');
    expect(carriers[4]?.style.primary.style).toBe('ieee');
    expect(carriers[5]?.style.primary.style).toBe('apa7');
    expect(carriers[6]?.style.primary.style).toBe('apa7');
  });

  it('keeps the current Chicago sparse pages, Vancouver RFC, APA patent-title-year, and MLA patent/thesis blocker patterns on the intended exact styles', async () => {
    const ctx = createTestPipelineContext();
    const carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Alexandra A. Taylor. “Obituary: John H. Litchfield.” Chemical & Engineering News, 2022, 25–25. https://doi.org/10.47287/cen-10040-obits4.'),
        makeRawBlock('Richard, Jacques, Vivien Enjolras, Laurent Rys, Juliette Vallon, Isabelle Nann, and Philippe Escudier. “Space Altimetry from Nano-Satellites : Payload Feasibility, Missions and System Performances.” 2008, III-71-III–74. https://doi.org/10.1109/igarss.2008.4779285.'),
        makeRawBlock('[1]Export of UDP Options Information in IP Flow Information Export (IPFIX). RFC Editor 2025. https://www.rfc-editor.org/rfc/rfc9870.html.'),
        makeRawBlock('Web page ranking for page query across public and private (Patent No. US20060235842A1). (2006). https://patents.google.com/patent/US20060235842A1/en'),
        makeRawBlock('Albers, Ulrike. Evolution and Treatment of Vitamin B12 Deficiency as a Risk Factor for (Cognitive and Functional) Neurodegenerative Diseases in Institutionalized Elderly = Evolución y Tratamiento de La Deficiencia de Vitamina B12 Como Factor de Riesgo de Enfermedades Neurodegenerativas (Cognitivas y Funcionales) En Las Personas Mayores Institucionalizadas. 2022, https://doi.org/10.20868/upm.thesis.14629. Universidad Politecnica de Madrid - University Library, Dissertation.'),
        makeRawBlock('Fusarium Venenatum Strain with High Substrate Conversion Rate and Low RNA Content and Application Thereof. no. CN121555333A, 2026, https://patents.google.com/patent/CN121555333A/en.'),
      ],
      ctx,
    );

    expect(carriers).toHaveLength(6);
    expect(carriers[0]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[1]?.style.primary.style).toBe('chicago-notes-bib');
    expect(carriers[2]?.style.primary.style).toBe('vancouver');
    expect(carriers[3]?.style.primary.style).toBe('apa7');
    expect(carriers[4]?.style.primary.style).toBe('mla9');
    expect(carriers[5]?.style.primary.style).toBe('mla9');
  });
});
