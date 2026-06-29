import { describe, expect, it } from 'vitest';
import { phase3StyleDetect } from '../../../../src/engine/phases/phase3StyleDetect.js';
import { phase4Extract } from '../../../../src/engine/phases/phase4Extract.js';
import {
  Phase5AuthorDisambig,
  phase5AuthorDisambig,
  reconcileIdentifierAuthorGroups,
} from '../../../../src/engine/phases/phase5AuthorDisambig.js';
import { phase10Health } from '../../../../src/engine/phases/phase10Health.js';
import { fieldOf } from '../../../../src/engine/types/field.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';
import { makeRawBlock } from '../../../helpers/makeRawBlock.js';

describe('phase5AuthorDisambig', () => {
  it('normalizes personal authors into canonical form', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1] Smith, John; Doe, Alice (2020). Example article. Journal of Examples, 12(3), 44-50.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    carriers = await phase5AuthorDisambig.run(carriers, ctx);
    const authors = carriers[0]!.fields.authors.value;

    expect(authors).toHaveLength(2);
    expect(authors[0]).toMatchObject({ family: 'Smith', given: 'John', isCorporate: false });
    expect(authors[1]).toMatchObject({ family: 'Doe', given: 'Alice', isCorporate: false });
  });

  it('detects corporate authors', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('World Health Organization. (2022). Health update. https://example.org/update'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    carriers = await phase5AuthorDisambig.run(carriers, ctx);
    const author = carriers[0]!.fields.authors.value[0];

    expect(author).toMatchObject({
      isCorporate: true,
      literal: 'World Health Organization',
    });
  });

  it('retains parsed authors but flags the list as incomplete when "et al." is present', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('A. Smith, B. Jones, et al. (2021). Example article. Journal of Examples, 8(2), 10-20.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    carriers = await phase5AuthorDisambig.run(carriers, ctx);

    const carrier = carriers[0]!;
    expect(Array.isArray(carrier.fields.authors.value)).toBe(true);
    expect((carrier.fields.authors.value as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect(carrier.authorListIncomplete).toBe(true);

    await phase10Health.run(carriers, ctx);
    expect(carrier.health.warnings.some((w) => w.code === 'author_list_incomplete')).toBe(true);
  });

  it('derives canonical initials from ML author payloads that omit initials', async () => {
    const ctx = createTestPipelineContext();
    const phase = new Phase5AuthorDisambig({
      health: async () => ({
        status: 'ok',
        activeModelVersion: 'mock-crf',
        featureVersion: 'mock-features',
        artifactsReady: true,
        lastSuccessfulInferenceAt: null,
      }),
      detectStyle: async () => [],
      extract: async () => ({ results: [] }),
      authorNer: async () => ([{
        authors: [{ family: 'Smith', given: 'John Adam', isCorporate: false }],
        confidence: 0.91,
      }]),
      classifyType: async () => [],
    });
    let carriers = await phase3StyleDetect.run(
      [makeRawBlock('Smith, J. A. (2020). Example article. Journal of Examples, 12(3), 44-50.')],
      ctx,
    );

    carriers = await phase.run(carriers, ctx);
    const author = carriers[0]!.fields.authors.value[0];

    expect(author).toMatchObject({
      family: 'Smith',
      given: 'John Adam',
      initials: 'J. A.',
      isCorporate: false,
    });
  });

  it('does not demote valid author expansions below the author health threshold', async () => {
    const ctx = createTestPipelineContext();
    const phase = new Phase5AuthorDisambig({
      health: async () => ({
        status: 'ok',
        activeModelVersion: 'mock-crf',
        featureVersion: 'mock-features',
        artifactsReady: true,
        lastSuccessfulInferenceAt: null,
      }),
      detectStyle: async () => [],
      extract: async () => ({ results: [] }),
      authorNer: async () => ([{
        authors: [
          { family: 'Lowry', given: 'OliverH', isCorporate: false },
          { family: 'Rosebrough', given: 'NiraJ', isCorporate: false },
          { family: 'Farr', given: 'A. Lewis', isCorporate: false },
          { family: 'Randall', given: 'RoseJ', isCorporate: false },
        ],
        confidence: 0.72,
      }]),
      classifyType: async () => [],
    });
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Lowry, OliverH., Rosebrough, NiraJ., Farr, A. Lewis, & Randall, RoseJ. (1951). PROTEIN MEASUREMENT WITH THE FOLIN PHENOL REAGENT. Journal of Biological Chemistry, 193(1), 265-275.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    carriers = await phase.run(carriers, ctx);

    expect(carriers[0]!.fields.authors.value).toHaveLength(4);
    expect(['ml_author_ner', 'regex_fallback']).toContain(carriers[0]!.fields.authors.source);
    expect(carriers[0]!.fields.authors.confidence).toBeGreaterThanOrEqual(0.75);
    expect(carriers[0]!.fields.authors.uncertain).toBe(false);
  });

  it('does not demote valid fallback author reparses below the author health threshold', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Lowry, OliverH., Rosebrough, NiraJ., Farr, A. Lewis, & Randall, RoseJ. (1951). PROTEIN MEASUREMENT WITH THE FOLIN PHENOL REAGENT. Journal of Biological Chemistry, 193(1), 265-275.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    carriers[0]!.fields.authors.value = [];
    carriers[0]!.healthEvidence.validSpanFields = carriers[0]!.healthEvidence.validSpanFields.filter((field) => field !== 'authors');
    carriers = await phase5AuthorDisambig.run(carriers, ctx);

    expect(carriers[0]!.fields.authors.value.length).toBeGreaterThan(0);
    expect(carriers[0]!.fields.authors.source).toBe('regex_fallback');
    expect(carriers[0]!.fields.authors.confidence).toBeGreaterThanOrEqual(0.75);
    expect(carriers[0]!.fields.authors.uncertain).toBe(false);
  });

  it('uses deterministic fallback reparses when ML author routing is disabled and phase4 preserved too few authors', async () => {
    const ctx = createTestPipelineContext();
    ctx.executionPolicy.authorDisambiguationMl = 'off';
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Lowry, OliverH., Rosebrough, NiraJ., Farr, A. Lewis, & Randall, RoseJ. (1951). PROTEIN MEASUREMENT WITH THE FOLIN PHENOL REAGENT. Journal of Biological Chemistry, 193(1), 265-275.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    carriers[0]!.fields.authors = fieldOf(
      [{ family: 'Lowry', given: 'OliverH.', initials: 'O.', isCorporate: false }],
      'regex_fallback',
      'phase4_extraction',
      0.78,
    );
    carriers[0]!.healthEvidence.validSpanFields = Array.from(new Set([
      ...carriers[0]!.healthEvidence.validSpanFields,
      'authors',
    ]));
    carriers = await phase5AuthorDisambig.run(carriers, ctx);

    expect(carriers[0]!.fields.authors.value).toHaveLength(4);
    expect(carriers[0]!.fields.authors.source).toBe('regex_fallback');
    expect(carriers[0]!.fields.authors.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('prefers a richer deterministic fallback over a valid-looking but weaker ML author split', async () => {
    const ctx = createTestPipelineContext();
    const phase = new Phase5AuthorDisambig({
      health: async () => ({
        status: 'ok',
        activeModelVersion: 'mock-crf',
        featureVersion: 'mock-features',
        artifactsReady: true,
        lastSuccessfulInferenceAt: null,
      }),
      detectStyle: async () => [],
      extract: async () => ({ results: [] }),
      authorNer: async () => ([{
        authors: [
          { family: 'He K', given: 'Zhang X', isCorporate: false },
          { family: 'Ren S', given: 'Sun J', isCorporate: false },
        ],
        confidence: 0.9,
      }]),
      classifyType: async () => [],
    });
    let carriers = await phase3StyleDetect.run(
      [makeRawBlock('He K, Zhang X, Ren S, Sun J. Deep Residual Learning for Image Recognition. Journal. 2016;?:770-778.')],
      ctx,
    );

    carriers = await phase.run(carriers, ctx);

    expect(carriers[0]!.fields.authors.value).toEqual([
      expect.objectContaining({ family: 'He', given: 'K' }),
      expect.objectContaining({ family: 'Zhang', given: 'X' }),
      expect.objectContaining({ family: 'Ren', given: 'S' }),
      expect.objectContaining({ family: 'Sun', given: 'J' }),
    ]);
    expect(carriers[0]!.fields.authors.source).toBe('regex_fallback');
    expect(carriers[0]!.fields.authors.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('rejects ML author predictions when the segment is not plausible author text', async () => {
    const ctx = createTestPipelineContext();
    const phase = new Phase5AuthorDisambig({
      health: async () => ({
        status: 'ok',
        activeModelVersion: 'mock-crf',
        featureVersion: 'mock-features',
        artifactsReady: true,
        lastSuccessfulInferenceAt: null,
      }),
      detectStyle: async () => [],
      extract: async () => ({ results: [] }),
      authorNer: async () => ([{
        authors: [{
          family: 'A guide to T cells. https://example.org/t-cells. Accessed March 2',
          given: null,
          isCorporate: false,
        }],
        confidence: 0.91,
      }]),
      classifyType: async () => [],
    });
    let carriers = await phase3StyleDetect.run(
      [makeRawBlock('A guide to T cells. https://example.org/t-cells. Accessed March 2, 2024.')],
      ctx,
    );

    carriers = await phase.run(carriers, ctx);

    expect(carriers[0]!.fields.authors.value).toHaveLength(0);
  });

  it('preserves validated phase4 author spans for colon-style biomedical citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Jiménez-Luna J, Grisoni F, Weskamp N, Schneider G: Artificial intelligence in drug discovery: recent advances and future perspectives. Expert Opin Drug Discov. 2021, 16:949-59. 10.1080/17460441.2021.1909567'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    expect(carriers[0]!.fields.authors.value).toHaveLength(4);

    carriers = await phase5AuthorDisambig.run(carriers, ctx);

    expect(carriers[0]!.fields.authors.value).toHaveLength(4);
    expect(carriers[0]!.fields.authors.value[3]).toMatchObject({
      family: 'Schneider',
      given: 'G',
      isCorporate: false,
    });
  });

  it('trims known titles out of fallback author spans before reparsing', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Rebel, Annette, and Randall Schell. “Faust’s Anesthesiology Review, 4th Ed.” Anesthesia & Analgesia 120, no. 4 (2015): 953. https://doi.org/10.1213/ane.0000000000000588.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    carriers[0]!.fields.authors.value = [];
    carriers[0]!.healthEvidence.validSpanFields = carriers[0]!.healthEvidence.validSpanFields.filter((field) => field !== 'authors');
    carriers = await phase5AuthorDisambig.run(carriers, ctx);

    expect(carriers[0]!.fields.authors.value).toEqual([
      expect.objectContaining({ family: 'Rebel', given: 'Annette' }),
      expect.objectContaining({ family: 'Schell', given: 'Randall' }),
    ]);
  });

  it('replaces contaminated preserved conference author spans without requiring ML', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Pain, S. and Acharjee, P. (2016) “Solution to security constrained LFC system using chaos based exponential PSO algorithm.” Institution of Engineering and Technology. Available at: https://doi.org/10.1049/cp.2016.1556.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    carriers[0]!.fields.authors.value = [
      { family: 'Pain', given: 'S', initials: 'S.', literal: null, isCorporate: false },
      {
        family: 'algorithm',
        given: 'Acharjee P. Solution to security constrained LFC system using chaos based exponential PSO',
        initials: null,
        literal: null,
        isCorporate: false,
      },
      { family: 'Engineering', given: 'Institution of', initials: null, literal: null, isCorporate: false },
      { family: 'Technology', given: null, initials: null, literal: null, isCorporate: false },
    ];
    carriers[0]!.healthEvidence.validSpanFields = Array.from(new Set([
      ...carriers[0]!.healthEvidence.validSpanFields,
      'authors',
    ]));

    carriers = await phase5AuthorDisambig.run(carriers, ctx);

    expect(carriers[0]!.fields.authors.value).toEqual([
      expect.objectContaining({ family: 'Pain' }),
      expect.objectContaining({ family: 'Acharjee' }),
    ]);
  });

  it('promotes fuller same-identifier author lists over initials-only siblings', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]J. Boberski, M. Reza Shaebani, and D. E. Wolf, “Anisotropy of force distributions in sheared soft-particle systems,” EPL (Europhysics Letters), vol. 108, no. 4, p. 44002, 2014, doi: 10.1209/0295-5075/108/44002.'),
        makeRawBlock('Boberski, Jens, M. Reza Shaebani, and Dietrich E. Wolf. “Anisotropy of Force Distributions in Sheared Soft-Particle Systems.” EPL (Europhysics Letters) 108, no. 4 (2014): 44002. https://doi.org/10.1209/0295-5075/108/44002.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    carriers = await phase5AuthorDisambig.run(carriers, ctx);

    expect(carriers[0]!.fields.authors.value).toEqual([
      expect.objectContaining({ family: 'Boberski', given: 'Jens' }),
      expect.objectContaining({ family: 'Shaebani', given: 'M. Reza' }),
      expect.objectContaining({ family: 'Wolf', given: 'Dietrich E.' }),
    ]);
  });

  it('promotes fuller same-identifier single-author values over initials-only siblings', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Quealy-Gainer, K. (2015). Curiosity House: The Shrunken Head by Lauren Oliver (review). Bulletin of the Center for Children’s Books, 69(3), 158–158. https://doi.org/10.1353/bcc.2015.0839'),
        makeRawBlock('Quealy-Gainer, Kate. “Curiosity House: The Shrunken Head by Lauren Oliver (review).” Bulletin of the Center for Children’s Books 69, no. 3 (2015): 158–158. https://doi.org/10.1353/bcc.2015.0839.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    carriers = await phase5AuthorDisambig.run(carriers, ctx);

    expect(carriers[0]!.fields.authors.value).toEqual([
      expect.objectContaining({ family: 'Quealy-Gainer', given: 'Kate' }),
    ]);
  });

  it('does not promote authors across unrelated bare DOI host stubs', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Allen, T. J. . Hippocrates’ Woman: Reading the Female Body in Ancient Greece by Helen King (review). Mouseion: Journal of the Classical Association of Canada, 46(1), 80–85. https://doi.org/'),
        makeRawBlock('Pillai; R.; Valappil; N. N.; & Parambil; D. A. C. (2021). An updated methodology for sediment distribution maps using conditional strings in Arc GIS 10.X. Arabian Journal of Geosciences; 14(20). https://doi.org/'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    carriers = await phase5AuthorDisambig.run(carriers, ctx);

    expect(carriers[0]!.fields.authors.value).toEqual([
      expect.objectContaining({ family: 'Allen' }),
    ]);
    expect(carriers[1]!.fields.authors.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: 'Pillai' }),
        expect.objectContaining({ family: 'Valappil' }),
        expect.objectContaining({ family: 'Parambil' }),
      ]),
    );
    expect(carriers[1]!.fields.authors.value).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ family: 'Allen' })]),
    );
  });

  it('does not promote author lists across different semantic benchmark groups that share a DOI', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        {
          ...makeRawBlock('Alpha, A., Beta, B., and Gamma, G. (2024). Shared benchmark citation. Journal of Examples, 10(2), 11-19. https://doi.org/10.1234/shared-benchmark-doi'),
          semanticGroupKey: 'benchmark-record-a:clean',
        },
        {
          ...makeRawBlock('Delta, D. et al. (2024). Different benchmark citation. Journal of Other Examples, 12(4), 21-29. https://doi.org/10.1234/shared-benchmark-doi'),
          semanticGroupKey: 'benchmark-record-b:clean',
        },
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    carriers = await phase5AuthorDisambig.run(carriers, ctx);

    expect(carriers[0]!.fields.authors.value).toEqual([
      expect.objectContaining({ family: 'Alpha' }),
      expect.objectContaining({ family: 'Beta' }),
      expect.objectContaining({ family: 'Gamma' }),
    ]);
    expect(carriers[1]!.fields.authors.value).toEqual([
      expect.objectContaining({ family: 'Delta' }),
    ]);
  });

  it('stops fallback author spans at the first true sentence boundary for book citations', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('Eberhard, Wilhelm. Ludwig III. Kurfürst von der Pfalz und das Reich 1410–1427. De Gruyter, 1896. https://doi.org/10.1515/9783112466384.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    carriers[0]!.fields.authors.value = [];
    carriers[0]!.healthEvidence.validSpanFields = carriers[0]!.healthEvidence.validSpanFields.filter((field) => field !== 'authors');
    carriers = await phase5AuthorDisambig.run(carriers, ctx);

    expect(carriers[0]!.fields.authors.value).toEqual([
      expect.objectContaining({ family: 'Eberhard', given: 'Wilhelm' }),
    ]);
  });

  it('preserves repeated institutional-owner report citations without inventing a corporate author', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]BSI British Standards, “Determination of transformer and reactor sound levels,” BSI British Standards, 2015. doi: 10.3403/01400288u.'),
      ],
      ctx,
    );

    carriers = await phase4Extract.run(carriers, ctx);
    expect(carriers[0]!.fields.authors.value).toEqual([]);

    carriers = await phase5AuthorDisambig.run(carriers, ctx);

    expect(carriers[0]!.fields.authors.value).toEqual([]);
    expect(carriers[0]!.healthEvidence.validSpanFields).not.toContain('authors');
  });

  it('does not promote authors into repeated institutional-owner report siblings that are expected to stay authorless', async () => {
    const ctx = createTestPipelineContext();
    let carriers = await phase3StyleDetect.run(
      [
        makeRawBlock('[1]BSI British Standards, “Determination of transformer and reactor sound levels,” BSI British Standards, 2015. doi: 10.3403/01400288u.'),
        {
          ...makeRawBlock('British Standards Institution. Determination of transformer and reactor sound levels. 2015. https://doi.org/10.3403/01400288U.'),
          semanticGroupKey: 'report-bsi-promote-clean',
        },
      ],
      ctx,
    );

    carriers[0]!.semanticGroupKey = 'report-bsi-promote-clean';
    carriers = await phase4Extract.run(carriers, ctx);
    carriers[1]!.fields.authors = fieldOf(
      [
        {
          family: null,
          given: null,
          initials: null,
          literal: 'British Standards Institution',
          isCorporate: true,
        },
      ],
      'regex_fallback',
      'test',
      0.94,
    );
    carriers[1]!.healthEvidence.validSpanFields = Array.from(
      new Set([...carriers[1]!.healthEvidence.validSpanFields, 'authors']),
    );

    reconcileIdentifierAuthorGroups(carriers);

    expect(carriers[0]!.fields.authors.value).toEqual([]);
    expect(carriers[0]!.healthEvidence.validSpanFields).not.toContain('authors');
    expect(carriers[1]!.fields.authors.value).toEqual([
      expect.objectContaining({
        literal: 'British Standards Institution',
        isCorporate: true,
      }),
    ]);
  });
});
