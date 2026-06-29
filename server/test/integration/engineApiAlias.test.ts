import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { ConvertResponse, InspectResponse } from '../../src/engine/types/api.js';

describe('engine API website aliases', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('serves the website conversion flow from /api/engine/*', async () => {
    app = await buildApp();

    const payload = {
      sourceType: 'text' as const,
      content: 'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
      outputStyle: 'apa7',
    };

    const inspectResponse = await app.inject({
      method: 'POST',
      url: '/api/engine/inspect',
      payload: {
        sourceType: payload.sourceType,
        content: payload.content,
      },
    });

    expect(inspectResponse.statusCode).toBe(200);
    const inspect = inspectResponse.json() as InspectResponse;
    expect(inspect.splitCount).toBe(1);

    const convertResponse = await app.inject({
      method: 'POST',
      url: '/api/engine/convert',
      payload,
    });

    expect(convertResponse.statusCode).toBe(200);
    const convert = convertResponse.json() as ConvertResponse;
    expect(convert.summary.total).toBe(1);

    const exportResponse = await app.inject({
      method: 'GET',
      url: `/api/engine/export/${convert.jobId}/txt`,
      headers: jobAccessHeaders(convert.jobAccessToken),
    });

    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.headers['content-type']).toContain('text/plain');
  });

  it('exposes a same-origin health endpoint for the website path', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/engine/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runtime: {
        persistenceBackend: 'memory',
      },
    });
  });
});

function jobAccessHeaders(jobAccessToken: string | undefined): Record<string, string> {
  return jobAccessToken
    ? { 'x-job-access-token': jobAccessToken }
    : {};
}
