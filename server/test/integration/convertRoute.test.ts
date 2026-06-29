import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { ConvertResponse, InspectResponse } from '../../src/engine/types/api.js';
import { listLearningQueue, resetRuntimeStore } from '../../src/runtime/store.js';
import { getApprovedTruthByInputHash, getCitation, upsertApprovedTruthPayload } from '../../src/runtime/persistence.js';
import { hashInputForTruth } from '../../src/training/truthHash.js';

describe('POST /v1/convert', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    resetRuntimeStore();
  });

  it('converts a full batch end to end', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        sourceType: 'text',
        content: [
          'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
          '',
          'Doe, A. (2021). Another study. Example Review, 9(1), 1-10.',
        ].join('\n'),
        outputStyle: 'apa7',
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as ConvertResponse;

    expect(body.summary.total).toBe(2);
    expect(body.references).toHaveLength(2);
    expect(body.countAudit.splitCount).toBe(2);
    expect(body.references.every((citation) => citation.renderedText.length > 0)).toBe(true);
    expect(body.references.every((citation) => citation.outputLatencyMs >= 0)).toBe(true);
    expect(body.executionProfile).toBe('core_parse_full');
    expect(body.coreParseLatencyMs).toBeGreaterThanOrEqual(0);
    expect(body.overlay).toEqual({
      status: 'not_requested',
      jobId: null,
      providerLatencyMs: null,
    });
    expect(body.processingPath.stagesRun).toContain('rendering');
  });

  it('honors an explicit parseProfile on the request contract', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        sourceType: 'text',
        content: 'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
        outputStyle: 'apa7',
        options: {
          parseProfile: 'core_parse_fast',
        },
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as ConvertResponse;
    expect(body.executionProfile).toBe('core_parse_fast');
    expect(body.providerUsage.crossrefCalls).toBe(0);
    expect(body.overlay.status).toBe('not_requested');
    expect(body.processingPath.stagesRun).toContain('shared_repair');
    expect(body.processingPath.stagesRun).toContain('normalization');
    expect(body.diagnostics?.filter((stage) => stage.stageId === 'phase6_8_shared_repair')).toHaveLength(1);
    expect(body.diagnostics?.filter((stage) => stage.stageId === 'phase7_normalization')).toHaveLength(1);
    expect(body.references.every((citation) => citation.stageLog.length === 0)).toBe(true);
  });

  it('keeps inspect and convert counts in parity', async () => {
    app = await buildApp();
    const payload = {
      sourceType: 'text' as const,
      content: [
        'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
        '',
        'Doe, A. (2021). Another study. Example Review, 9(1), 1-10.',
      ].join('\n'),
    };

    const inspectResponse = await app.inject({
      method: 'POST',
      url: '/v1/inspect',
      payload,
    });
    const convertResponse = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        ...payload,
        outputStyle: 'apa7',
      },
    });

    const inspect = inspectResponse.json() as InspectResponse;
    const convert = convertResponse.json() as ConvertResponse;

    expect(convert.countAudit.splitCount).toBe(inspect.countAudit.splitCount);
    expect(convert.references).toHaveLength(inspect.splitCount);
    expect(convert.countAudit.droppedCount).toBe(0);
  });

  it('keeps /convert on the core lane even when enrich is requested', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        sourceType: 'text',
        content: 'Smith, J. (2020). rough title. Journal of Examples, 12(3), 44-50. doi:10.1000/smith-2020-better-title-study',
        outputStyle: 'apa7',
        options: {
          enrich: true,
        },
      },
    });

    const body = response.json() as ConvertResponse;
    const citation = body.references[0]!;

    expect(response.statusCode).toBe(200);
    expect(body.providerUsage.crossrefCalls).toBe(0);
    expect(citation.fields.title.value).not.toBe('Better Title Study');
    expect(citation.fields.title.source).not.toBe('enrichment_crossref');
  });

  it('generates and accepts pro overlay enrichment proposals without mutating the original parse', async () => {
    app = await buildApp();

    const convertResponse = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        sourceType: 'text',
        content: 'Smith, J. (2020). rough title. Journal of Examples, 12(3), 44-50. doi:10.1000/smith-2020-better-title-study',
        outputStyle: 'apa7',
      },
    });

    expect(convertResponse.statusCode).toBe(200);

    const convertBody = convertResponse.json() as ConvertResponse;
    const citation = convertBody.references[0]!;

    expect(convertBody.providerUsage.crossrefCalls).toBe(0);
    expect(citation.fields.title.value).not.toBe('Better Title Study');

    const proposalResponse = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${convertBody.jobId}/pro-enrich`,
      headers: jobAccessHeaders(convertBody.jobAccessToken),
      payload: {},
    });

    expect(proposalResponse.statusCode).toBe(200);

    const proposalBody = proposalResponse.json() as {
      jobId: string;
      proposalCount: number;
      proposals: Array<{
        citationId: string;
        fields: Array<{
          field: string;
          proposedValue: unknown;
          provider: string;
        }>;
      }>;
    };

    expect(proposalBody.jobId).toBe(convertBody.jobId);
    expect(proposalBody.proposalCount).toBeGreaterThan(0);
    expect(proposalBody.proposals[0]?.citationId).toBe(citation.id);
    expect(proposalBody.proposals[0]?.fields.some((field) =>
      field.field === 'title'
      && field.proposedValue === 'Better Title Study'
      && field.provider === 'crossref'
    )).toBe(true);

    const previewResponse = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${convertBody.jobId}/pro-enrich/preview`,
      headers: jobAccessHeaders(convertBody.jobAccessToken),
      payload: {
        citationId: citation.id,
        fields: {
          title: 'Better Title Study',
        },
      },
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.json()).toMatchObject({
      jobId: convertBody.jobId,
      citationId: citation.id,
      selectedFieldCount: 1,
    });
    expect(previewResponse.json()).toEqual(
      expect.objectContaining({
        renderedText: expect.stringMatching(/better title study/i),
      }),
    );

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${convertBody.jobId}/pro-enrich/accept`,
      headers: jobAccessHeaders(convertBody.jobAccessToken),
      payload: {
        overlays: [
          {
            citationId: citation.id,
            fields: {
              title: 'Better Title Study',
            },
            reviewedBy: 'integration-test',
            optInTraining: true,
          },
        ],
      },
    });

    expect(acceptResponse.statusCode).toBe(200);
    expect(acceptResponse.json()).toMatchObject({
      jobId: convertBody.jobId,
      acceptedOverlays: 1,
      acceptedFieldCount: 1,
      queuedForReview: true,
    });

    const learningQueue = listLearningQueue();
    expect(learningQueue).toHaveLength(1);
    expect(learningQueue[0]?.trainingData.overlayAccepted).toBe(true);
    expect(learningQueue[0]?.trainingData.overlayFields).toEqual({
      title: 'Better Title Study',
    });
  });

  it('applies pro overlay corrections as the live citation and can restore the original baseline', async () => {
    app = await buildApp();

    const convertResponse = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        sourceType: 'text',
        content: 'Smith, J. (2020). rough title. Journal of Examples, 12(3), 44-50. doi:10.1000/smith-2020-better-title-study',
        outputStyle: 'apa7',
      },
    });

    expect(convertResponse.statusCode).toBe(200);

    const convertBody = convertResponse.json() as ConvertResponse;
    const citation = convertBody.references[0]!;
    expect(citation.fields.title.value).not.toBe('Better Title Study');

    const applyResponse = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${convertBody.jobId}/pro-enrich/apply`,
      headers: jobAccessHeaders(convertBody.jobAccessToken),
      payload: {
        overlays: [
          {
            citationId: citation.id,
            fields: {
              title: 'Better Title Study',
            },
          },
        ],
      },
    });

    expect(applyResponse.statusCode).toBe(200);
    expect(applyResponse.json()).toMatchObject({
      jobId: convertBody.jobId,
      appliedOverlays: 1,
      appliedFieldCount: 1,
      queuedForReview: true,
      updatedCitations: [
        expect.objectContaining({
          id: citation.id,
          renderedText: expect.stringMatching(/better title study/i),
          scoreBreakdown: expect.objectContaining({
            diagnostics: expect.objectContaining({
              rescoredAfterCorrection: true,
            }),
          }),
        }),
      ],
    });

    const storedAfterApply = await getCitation(convertBody.jobId, citation.id);
    expect(storedAfterApply?.fields.title.value).toBe('Better Title Study');
    expect(storedAfterApply?.fields.title.source).toBe('user_correction');
    expect(storedAfterApply?.renderedText).toMatch(/better title study/i);
    expect(storedAfterApply?.scoreBreakdown.diagnostics.rescoredAfterCorrection).toBe(true);

    const approvedTruth = await getApprovedTruthByInputHash(hashInputForTruth(citation.raw));
    expect(approvedTruth).not.toBeNull();
    expect(approvedTruth).toMatchObject({
      rawText: citation.raw,
      trustLevel: 'gold',
      rowStatus: 'reviewed',
      datasetSplit: null,
      provenance: `pro_overlay:${citation.id}`,
      goldKind: 'overlay_accept',
      approvalSource: 'overlay_accept',
      overlayTruth: {
        title: 'Better Title Study',
        corrected_output: expect.stringMatching(/better title study/i),
      },
      expectedFields: expect.objectContaining({
        title: 'Better Title Study',
        corrected_output: expect.stringMatching(/better title study/i),
      }),
      coreTruth: expect.objectContaining({
        title: 'Better Title Study',
        corrected_output: expect.stringMatching(/better title study/i),
      }),
    });

    const restoreResponse = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${convertBody.jobId}/pro-enrich/apply`,
      headers: jobAccessHeaders(convertBody.jobAccessToken),
      payload: {
        overlays: [
          {
            citationId: citation.id,
            fields: {},
          },
        ],
      },
    });

    expect(restoreResponse.statusCode).toBe(200);
    expect(restoreResponse.json()).toMatchObject({
      jobId: convertBody.jobId,
      appliedOverlays: 1,
      appliedFieldCount: 0,
      updatedCitations: [
        expect.objectContaining({
          id: citation.id,
          renderedText: expect.not.stringMatching(/better title study/i),
          scoreBreakdown: expect.objectContaining({
            diagnostics: expect.objectContaining({
              rescoredAfterCorrection: true,
            }),
          }),
        }),
      ],
    });

    const restoredCitation = await getCitation(convertBody.jobId, citation.id);
    expect(restoredCitation?.fields.title.value).toBe(citation.fields.title.value);
    expect(restoredCitation?.renderedText).not.toMatch(/better title study/i);

    const learningQueue = listLearningQueue();
    expect(learningQueue).toHaveLength(1);
    expect(learningQueue[0]?.trainingData.overlayFields).toEqual({
      title: 'Better Title Study',
    });
  });

  it('uses the DOI fast-path for doi_list conversion', async () => {
    app = await buildApp();
    await upsertApprovedTruthPayload({
      rawText: '10.1000/smith-2020-example-study',
      expectedFields: {
        doi: '10.1000/smith-2020-example-study',
        title: 'Example study',
        authors: ['Smith, J.'],
        year: 2020,
        journal: 'Journal of Examples',
        volume: '12',
        issue: '3',
        pages: '44-50',
      },
      expectedType: 'article-journal',
      trustLevel: 'gold',
      reviewedBy: 'integration-test',
      provenance: 'approved_truth_seed',
    });
    await upsertApprovedTruthPayload({
      rawText: '10.1000/doe-2021-second-study',
      expectedFields: {
        doi: '10.1000/doe-2021-second-study',
        title: 'Second study',
        authors: ['Doe, A.'],
        year: 2021,
        journal: 'Example Review',
        volume: '9',
        issue: '1',
        pages: '1-10',
      },
      expectedType: 'article-journal',
      trustLevel: 'gold',
      reviewedBy: 'integration-test',
      provenance: 'approved_truth_seed',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        sourceType: 'doi_list',
        content: [
          '10.1000/smith-2020-example-study',
          '10.1000/doe-2021-second-study',
        ].join('\n'),
        outputStyle: 'apa7',
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as ConvertResponse;

    expect(body.references).toHaveLength(2);
    expect(body.processingPath.stagesRun).not.toContain('splitting');
    expect(body.processingPath.stagesRun).not.toContain('style_detection');
    expect(body.providerUsage.crossrefCalls).toBe(0);
    expect(body.references.every((citation) => citation.fields.doi.source === 'admin_confirmed')).toBe(true);
    expect(body.processingPath.stagesRun).toContain('structural_family_routing');
    expect(body.processingPath.stagesRun).toContain('shared_repair');
    expect(body.processingPath.stagesRun).toContain('normalization');
  });

  it('uses reviewed local authority-pack hints for DOI fast-path parity when approved truth is missing', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        sourceType: 'doi_list',
        content: '10.14341/cong23-1234',
        outputStyle: 'apa7',
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as ConvertResponse;
    const citation = body.references[0]!;
    const routingRecord = citation.stageLog.find(
      (record) => record.phaseId === 'structural_family_routing',
    );

    expect(body.providerUsage.crossrefCalls).toBe(0);
    expect(citation.publicStatus).toBe('needs_action');
    expect(citation.parseOutcome).toBe('needs_action');
    expect(citation.referenceType).toBe('conference-paper');
    expect(citation.fields.doi.source).toBe('doi_resolution');
    expect(citation.fields.publisher.value).toBe('ФГБУ «НМИЦ эндокринологии» Минздрава России');
    expect(citation.fields.conferenceTitle.value).toContain('Национального конгресса эндокринологов');
    expect(routingRecord?.details).toMatchObject({
      type: 'conference-paper',
      source: 'authority_pack',
    });
    expect(body.processingPath.stagesRun).toContain('structural_family_routing');
    expect(body.processingPath.stagesRun).toContain('shared_repair');
    expect(body.processingPath.stagesRun).toContain('normalization');
  });

  it('keeps DOI-only text input structurally aligned with the DOI fast-path for authority-backed hints', async () => {
    app = await buildApp();

    const textResponse = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        sourceType: 'text',
        content: '10.14341/cong23-1234',
        outputStyle: 'apa7',
      },
    });
    const doiResponse = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        sourceType: 'doi_list',
        content: '10.14341/cong23-1234',
        outputStyle: 'apa7',
      },
    });

    expect(textResponse.statusCode).toBe(200);
    expect(doiResponse.statusCode).toBe(200);

    const textBody = textResponse.json() as ConvertResponse;
    const doiBody = doiResponse.json() as ConvertResponse;
    const textCitation = textBody.references[0]!;
    const doiCitation = doiBody.references[0]!;

    expect(textCitation.referenceType).toBe('conference-paper');
    expect(doiCitation.referenceType).toBe('conference-paper');
    expect(textCitation.fields.doi.value).toBe(doiCitation.fields.doi.value);
    expect(textCitation.fields.publisher.value).toBe(doiCitation.fields.publisher.value);
    expect(textCitation.fields.conferenceTitle.value).toBe(doiCitation.fields.conferenceTitle.value);
    expect(textBody.processingPath.stagesRun).toContain('structural_family_routing');
    expect(textBody.processingPath.stagesRun).toContain('shared_repair');
    expect(doiBody.processingPath.stagesRun).toContain('structural_family_routing');
    expect(doiBody.processingPath.stagesRun).toContain('shared_repair');
  });

  it('does not 500 on deterministic weird unicode text payloads', async () => {
    app = await buildApp();
    const rng = createDeterministicRng(0x5eeda11);
    const content = randomWeirdString(rng, 180);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        sourceType: 'text',
        content,
        outputStyle: 'apa7',
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as ConvertResponse;
    expect(body.summary.total).toBeGreaterThan(0);
    expect(body.references).toHaveLength(body.summary.total);
    expect(body.references.every((citation) => citation.renderedText.length > 0)).toBe(true);
  });
});

function jobAccessHeaders(jobAccessToken: string | undefined): Record<string, string> {
  return jobAccessToken
    ? { 'x-job-access-token': jobAccessToken }
    : {};
}

function createDeterministicRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10_000) / 10_000;
  };
}

function randomWeirdString(rng: () => number, length: number): string {
  const alphabet = [
    'A',
    '9',
    ' ',
    '\n',
    '\r',
    '\t',
    '\u0000',
    '\u200b',
    '\u2028',
    '/',
    '\\',
    '%',
    '?',
    '&',
    '=',
    ';',
    ':',
    '<',
    '>',
    '"',
    "'",
    'Ω',
    'Ж',
    '中',
    '😀',
  ];

  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += alphabet[Math.floor(rng() * alphabet.length)] ?? 'X';
  }
  return output;
}
