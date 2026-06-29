import { describe, expect, it } from 'vitest';
import { phase7Normalize } from '../../../../src/engine/phases/phase7Normalize.js';
import { phase10Health } from '../../../../src/engine/phases/phase10Health.js';
import { extractRenderedTitleText, phase12Render } from '../../../../src/engine/phases/phase12Render.js';
import { phase11Authority } from '../../../../src/engine/phases/phase11Authority.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';
import { runThroughPhase6 } from '../../../helpers/runSprint2Core.js';

const SHARED_OUTPUT_STYLES = [
  'apa7',
  'mla9',
  'chicago-author-date',
  'vancouver',
  'ieee',
  'harvard-ctr',
] as const;

describe('Phase12Render', () => {
  it('renders an APA-style journal citation from normalized fields', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. https://doi.org/10.1000/example-study',
    );

    await phase7Normalize.run([carrier], ctx);
    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);
    await phase11Authority.run([carrier], ctx);

    expect(carrier.rendered.text).toContain('Smith');
    expect(carrier.rendered.text).toContain('(2020)');
    expect(carrier.rendered.text).toContain('Example study');
    expect(carrier.rendered.text).toContain('Journal of Examples');
    expect(carrier.rendered.text).toContain('*Journal of Examples*');
    expect(carrier.rendered.text).toContain('*12*(3)');
    expect(carrier.rendered.text).not.toContain('_Journal of Examples_');
  });

  it('suppresses an unverified DOI without dropping the webpage URL', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example webpage. Example Site. https://example.org/page. Accessed March 2, 2024.',
    );

    await phase7Normalize.run([carrier], ctx);
    carrier.fields.doi.value = '10.1000/example-page';
    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);
    await phase11Authority.run([carrier], ctx);

    expect(carrier.publicStatus).toBe('ready');
    expect(carrier.rendered.text).toContain('https://example.org/page');
    expect(carrier.rendered.text).not.toContain('https://doi.org/10.1000/example-page');
    expect(carrier.rendered.warnings).not.toContain('render_output_structurally_incomplete');
  });

  it('suppresses DOI-shaped URLs when there is no matching DOI field to justify rendering them', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. doi:https://doi.org/10.1016/j.neunet.2025.108137',
    );

    await phase7Normalize.run([carrier], ctx);
    carrier.type = {
      type: 'article-journal',
      confidence: 0.95,
      isUnknown: false,
    };
    carrier.fields.title.value = 'Example study';
    carrier.fields.journal.value = 'Journal of Examples';
    carrier.fields.volume.value = '12';
    carrier.fields.issue.value = '3';
    carrier.fields.pages.value = '44-50';
    carrier.fields.doi.value = null;
    carrier.fields.url.value = 'https://doi.org/10.1016/j.neunet.2025.108137';
    carrier.doiVerification = {
      status: 'absent',
      reasons: [],
    };
    carrier.healthEvidence.validSpanFields.push('title', 'journal', 'volume', 'issue', 'pages');

    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.rendered.text).not.toContain('https://doi.org/10.1016/j.neunet.2025.108137');
  });

  it('does not flag a reformatted locator as structurally incomplete', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'vancouver';

    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 608-616.',
    );

    await phase7Normalize.run([carrier], ctx);
    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.rendered.text).toMatch(/608[-–]616/);
    expect(carrier.rendered.warnings).not.toContain('locator_lost_during_render');
  });

  it('keeps the guaranteed scoring path when the requested style is guaranteed', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'ieee';

    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
    );

    carrier.detection.confidence = 0.4;
    await phase7Normalize.run([carrier], ctx);
    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.scoring.breakdown.formatScoringPath).toBe('guaranteed');
    expect(carrier.scoring.breakdown.diagnostics.formatScoringPathReason).toBe('style_guaranteed');
    expect(carrier.scoring.breakdown.diagnostics.effectiveDetectionConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it('does not penalize allowlisted scientific acronyms in title-case scoring', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'ama';

    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). DNA responses in cells. Journal of Examples, 12(3), 44-50.',
    );

    await phase7Normalize.run([carrier], ctx);
    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    // ama is now a first-class renderer (guaranteed scoring path), not an APA fallback;
    // the acronym allowlist (DNA must not be penalized) is path-independent.
    expect(carrier.scoring.breakdown.formatScoringPath).toBe('guaranteed');
    expect(carrier.scoring.breakdown.formatSubscores.titleCaseScore).toBe(1);
  });

  it('uses apa7 as the default effective render style when input detection stays unknown', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'auto';

    const { carrier } = await runThroughPhase6(
      'World Health Organization. T cell guidance. https://www.who.int/news-room/fact-sheets/detail/t-cells. Accessed March 2, 2024.',
    );

    await phase7Normalize.run([carrier], ctx);
    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.style.primary.style).toBe('unknown');
    expect(carrier.styleResolution.effectiveStyle).toBe('apa7');
    expect(carrier.styleResolution.effectiveStyleSource).toBe('default');
    expect(carrier.rendered.text).toContain('https://www.who.int/news-room/fact-sheets/detail/t-cells');
  });

  it('caps heuristic-path score reduction at three points for ready high-integrity citations', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      'Gomes MA, Kovaleski JL, Pagani RN, da Silva VL. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology. 2022 Oct 3;46(7):608-16.',
    );

    await phase7Normalize.run([carrier], ctx);
    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.publicStatus).toBe('ready');
    expect(carrier.extractionMeta?.runMode).toBe('heuristic');
    expect(carrier.scoring.rawScore).toBeGreaterThanOrEqual(97);
  });

  it('renders patent identifiers explicitly instead of relying on patent URLs alone', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      '[1]Web page ranking for page query across public and private. US20060235842A1, 2006.',
    );

    await phase7Normalize.run([carrier], ctx);
    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.type.type).toBe('patent');
    expect(carrier.rendered.text).toContain('US20060235842A1');
    expect(carrier.rendered.warnings).not.toContain('render_output_structurally_incomplete');
  });

  it('renders issue information even when volume is missing', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      'Smith, J. (2024). Example article. Example Journal.',
    );

    await phase7Normalize.run([carrier], ctx);
    carrier.type = {
      type: 'article-journal',
      confidence: 0.95,
      isUnknown: false,
    };
    carrier.fields.title.value = 'Example article';
    carrier.fields.journal.value = 'Example Journal';
    carrier.fields.volume.value = null;
    carrier.fields.issue.value = '4';
    carrier.fields.pages.value = null;
    carrier.fields.articleNumber.value = null;
    carrier.healthEvidence.validSpanFields.push('title', 'journal', 'issue');

    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.rendered.text).toContain('4');
    expect(carrier.rendered.audit?.lost).not.toContain('issue');
  });

  it('renders pages when they are the only locator field available', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      'Smith, J. (2024). Example article. Example Journal.',
    );

    await phase7Normalize.run([carrier], ctx);
    carrier.type = {
      type: 'article-journal',
      confidence: 0.95,
      isUnknown: false,
    };
    carrier.fields.title.value = 'Example article';
    carrier.fields.journal.value = 'Example Journal';
    carrier.fields.volume.value = null;
    carrier.fields.issue.value = null;
    carrier.fields.pages.value = '123-145';
    carrier.fields.articleNumber.value = null;
    carrier.healthEvidence.validSpanFields.push('title', 'journal', 'pages');

    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.rendered.text).toMatch(/123[-–]145/);
    expect(carrier.rendered.audit?.lost).not.toContain('pages');
  });

  it('renders journal locators without vol/pp fallback labels when the journal field is missing', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      'Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Rev Med Chem. 2021;21:2788-800. DOI: 10.2174/1389557521666210401091147',
    );

    await phase7Normalize.run([carrier], ctx);
    carrier.type = {
      type: 'article-journal',
      confidence: 0.95,
      isUnknown: false,
    };
    carrier.fields.title.value = 'A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery';
    carrier.fields.journal.value = null;
    carrier.fields.volume.value = '21';
    carrier.fields.issue.value = null;
    carrier.fields.pages.value = '2788-2800';
    carrier.fields.articleNumber.value = null;
    carrier.fields.doi.value = '10.2174/1389557521666210401091147';
    carrier.doiVerification = {
      status: 'verified',
      reasons: ['provider_match'],
    };
    carrier.healthEvidence.validSpanFields.push('title', 'volume', 'pages', 'doi');

    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    // Page ranges render with an en-dash (the APA/MLA/Chicago/IEEE/Harvard
    // convention applied by formatPageRange), including via the no-journal
    // locator fallback — never a raw ASCII hyphen.
    expect(carrier.rendered.text).toContain('21, 2788–2800');
    expect(carrier.rendered.text).not.toContain('vol. 21');
    expect(carrier.rendered.text).not.toContain('pp. 2788');
    expect(carrier.rendered.audit?.lost).not.toContain('volume');
    expect(carrier.rendered.audit?.lost).not.toContain('pages');
  });

  it('renders article numbers when page ranges are unavailable', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      'Smith, J. (2024). Example article. Example Journal.',
    );

    await phase7Normalize.run([carrier], ctx);
    carrier.type = {
      type: 'article-journal',
      confidence: 0.95,
      isUnknown: false,
    };
    carrier.fields.title.value = 'Example article';
    carrier.fields.journal.value = 'Example Journal';
    carrier.fields.volume.value = null;
    carrier.fields.issue.value = null;
    carrier.fields.pages.value = null;
    carrier.fields.articleNumber.value = 'e12345';
    carrier.healthEvidence.validSpanFields.push('title', 'journal', 'articleNumber');

    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.rendered.text).toContain('e12345');
    expect(carrier.rendered.audit?.lost).not.toContain('articleNumber');
  });

  it('renders report numbers when present and valid', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      'Smith, J. (2024). Example report. Example Publisher.',
    );

    await phase7Normalize.run([carrier], ctx);
    carrier.type = {
      type: 'report',
      confidence: 0.95,
      isUnknown: false,
    };
    carrier.fields.title.value = 'Example report';
    carrier.fields.publisher.value = 'Example Publisher';
    carrier.fields.reportNumber.value = 'TR-2024-18';
    carrier.healthEvidence.validSpanFields.push('title', 'publisher', 'reportNumber');

    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.rendered.text).toContain('TR-2024-18');
    expect(carrier.rendered.audit?.lost).not.toContain('reportNumber');
  });

  it('renders a distinct report URL alongside a verified DOI', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      'Smith, J. (2024). Example report. Example Publisher.',
    );

    await phase7Normalize.run([carrier], ctx);
    carrier.type = {
      type: 'report',
      confidence: 0.95,
      isUnknown: false,
    };
    carrier.fields.title.value = 'Example report';
    carrier.fields.publisher.value = 'Example Publisher';
    carrier.fields.reportNumber.value = 'TR-2024-18';
    carrier.fields.doi.value = '10.1000/example-report';
    carrier.fields.url.value = 'https://example.org/report.pdf';
    carrier.doiVerification = {
      status: 'verified',
      reasons: ['provider_match'],
    };
    carrier.healthEvidence.validSpanFields.push('title', 'publisher', 'reportNumber', 'doi', 'url');

    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.rendered.text).toContain('https://doi.org/10.1000/example-report');
    expect(carrier.rendered.text).toContain('https://example.org/report.pdf');
    expect(carrier.rendered.audit?.lost).not.toContain('doi');
    expect(carrier.rendered.audit?.lost).not.toContain('url');
  });

  it('renders report publisher metadata without duplicating identical institution text', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      'Smith, J. (2024). Example report. National Bureau of Economic Research.',
    );

    await phase7Normalize.run([carrier], ctx);
    carrier.type = {
      type: 'report',
      confidence: 0.95,
      isUnknown: false,
    };
    carrier.fields.title.value = 'Example report';
    carrier.fields.publisher.value = 'National Bureau of Economic Research';
    carrier.fields.institution.value = 'National Bureau of Economic Research';
    carrier.fields.placeOfPublication.value = 'Cambridge, MA';
    carrier.fields.reportNumber.value = 'w14448';
    carrier.healthEvidence.validSpanFields.push(
      'title',
      'publisher',
      'institution',
      'placeOfPublication',
      'reportNumber',
    );

    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.rendered.text).toContain('Cambridge, MA');
    expect((carrier.rendered.text.match(/National Bureau of Economic Research/g) ?? [])).toHaveLength(1);
    expect(carrier.rendered.audit?.lost).not.toContain('publisher');
    expect(carrier.rendered.audit?.lost).not.toContain('institution');
    expect(carrier.rendered.audit?.lost).not.toContain('placeOfPublication');
  });

  it('renders valid webpage URLs when they are available', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      'Example Page. Example Site. https://example.com/page. Accessed March 2, 2024.',
    );

    await phase7Normalize.run([carrier], ctx);
    carrier.type = {
      type: 'webpage',
      confidence: 0.95,
      isUnknown: false,
    };
    carrier.fields.title.value = 'Example page';
    carrier.fields.siteName.value = 'Example Site';
    carrier.fields.url.value = 'https://example.com/page';
    carrier.fields.doi.value = null;
    carrier.healthEvidence.validSpanFields.push('title', 'siteName', 'url');

    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.rendered.text).toContain('https://example.com/page');
    expect(carrier.rendered.audit?.lost).not.toContain('url');
  });

  it('keeps conflicted identifiers suppressed from the rendered citation', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      'Example Page. Example Site. https://example.com/page. Accessed March 2, 2024.',
    );

    await phase7Normalize.run([carrier], ctx);
    carrier.type = {
      type: 'webpage',
      confidence: 0.95,
      isUnknown: false,
    };
    carrier.fields.title.value = 'Example page';
    carrier.fields.siteName.value = 'Example Site';
    carrier.fields.url.value = 'https://example.com/page';
    carrier.fields.doi.value = '10.1000/conflicted-doi';
    carrier.doiVerification = {
      status: 'conflicted',
      reasons: ['provider_title_mismatch'],
    };
    carrier.healthEvidence.validSpanFields.push('title', 'siteName', 'url');

    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.rendered.text).toContain('https://example.com/page');
    expect(carrier.rendered.text).not.toContain('10.1000/conflicted-doi');
    expect(carrier.rendered.audit?.available).not.toContain('doi');
    expect(carrier.rendered.audit?.suppressed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'doi' }),
      ]),
    );
  });

  it('reads title-case scoring input from the actual rendered title segment', () => {
    expect(extractRenderedTitleText([
      { text: 'Ignored', fieldKeys: ['authors'] },
      { text: 'Actual Rendered Title', fieldKeys: ['title'] },
      { text: 'Fallback', fieldKeys: [] },
    ])).toBe('Actual Rendered Title');
  });

  for (const outputStyle of SHARED_OUTPUT_STYLES) {
    it(`does not demote online-first journal citations during render for ${outputStyle}`, async () => {
      const ctx = createTestPipelineContext();
      ctx.outputStyle = outputStyle;

      const { carrier } = await runThroughPhase6(
        'Smith, J. (2024). Example online-first study. Journal of Examples. https://doi.org/10.1000/example-online-first',
      );

      carrier.type = {
        type: 'article-journal',
        confidence: 0.95,
        isUnknown: false,
      };
      carrier.fields.journal.value = 'Journal of Examples';
      carrier.fields.journal.confidence = 0.92;
      carrier.fields.journal.uncertain = false;
      carrier.fields.volume.value = null;
      carrier.fields.issue.value = null;
      carrier.fields.pages.value = null;
      carrier.fields.articleNumber.value = null;
      carrier.fields.doi.value = '10.1000/example-online-first';
      carrier.doiVerification = {
        status: 'unverified',
        reasons: [],
      };
      carrier.healthEvidence.validSpanFields.push('journal', 'doi');

      await phase7Normalize.run([carrier], ctx);
      carrier.fields.journal.value = 'Journal of Examples';
      carrier.fields.journal.confidence = 0.92;
      carrier.fields.journal.uncertain = false;
      carrier.fields.volume.value = null;
      carrier.fields.issue.value = null;
      carrier.fields.pages.value = null;
      carrier.fields.articleNumber.value = null;
      carrier.fields.doi.value = '10.1000/example-online-first';
      carrier.doiVerification = {
        status: 'unverified',
        reasons: [],
      };

      await phase10Health.run([carrier], ctx);
      await phase12Render.run([carrier], ctx);

      expect(carrier.publicStatus).toBe('ready');
      expect(carrier.rendered.warnings).not.toContain('render_output_structurally_incomplete');
      expect(carrier.rendered.text).toContain('Journal of Examples');
      expect(carrier.rendered.text).toContain('https://doi.org/10.1000/example-online-first');
    });
  }
});
