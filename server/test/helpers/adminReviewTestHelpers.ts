import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import type { ConvertResponse } from '../../src/engine/types/api.js';
import { flushBatchHealthSummaryQueueForTests } from '../../src/admin/batchHealthSummary.js';
import { upsertApprovedTruthPayload } from '../../src/runtime/persistence.js';

export async function createSingleCitation(app: FastifyInstance): Promise<ConvertResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/convert',
    payload: {
      sourceType: 'text',
      content: 'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
      outputStyle: 'apa7',
    },
  });

  expect(response.statusCode).toBe(200);
  return response.json() as ConvertResponse;
}

export async function createSingleDoiCitation(app: FastifyInstance): Promise<ConvertResponse> {
  await upsertApprovedTruthPayload({
    rawText: '10.1000/good-2020-study',
    expectedFields: {
      doi: '10.1000/good-2020-study',
      title: 'Example study',
      authors: ['Smith, J.'],
      year: 2020,
      journal: 'Journal of Examples',
      volume: '12',
      issue: '3',
      pages: '44-50',
    },
    expectedType: 'article-journal',
    expectedStyle: 'apa7',
    trustLevel: 'gold',
    reviewedBy: 'integration-test',
    provenance: 'approved_truth_seed',
  });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/convert',
    payload: {
      sourceType: 'doi_list',
      content: '10.1000/good-2020-study',
      outputStyle: 'apa7',
    },
  });

  expect(response.statusCode).toBe(200);
  return response.json() as ConvertResponse;
}

export async function createMissingPagesCitation(app: FastifyInstance): Promise<ConvertResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/convert',
    payload: {
      sourceType: 'text',
      content: 'Smith, J. (2020). Example study. Journal of Examples, 12(3).',
      outputStyle: 'apa7',
    },
  });

  expect(response.statusCode).toBe(200);
  return response.json() as ConvertResponse;
}

export async function createRetractedCitation(app: FastifyInstance): Promise<ConvertResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/convert',
    payload: {
      sourceType: 'text',
      content: 'Smith, J. (2020). Retracted study on examples. Journal of Examples, 12(3), 44-50.',
      outputStyle: 'apa7',
    },
  });

  expect(response.statusCode).toBe(200);
  return response.json() as ConvertResponse;
}

export async function flushAdminReviewQueue() {
  await flushBatchHealthSummaryQueueForTests();
}
