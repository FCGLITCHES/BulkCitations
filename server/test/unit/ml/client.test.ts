import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpMLClient } from '../../../src/ml/client.js';

describe('HttpMLClient.detectStyle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns primary and secondary style hints from the local style endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      {
        primary: { style: 'apa7', confidence: 0.94 },
        secondary: { style: 'harvard-ctr', confidence: 0.05 },
      },
    ]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    const client = new HttpMLClient('http://ml.test', 500);
    const response = await client.detectStyle(['Taylor, A. A. (2022). Example title. Journal.']);

    expect(response[0]?.primary.style).toBe('apa7');
    expect(response[0]?.secondary?.style).toBe('harvard-ctr');
  });

  it('aborts detectStyle when an external signal is cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_input, init?: RequestInit) => {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }));

    const client = new HttpMLClient('http://ml.test', 5_000);
    const controller = new AbortController();
    const pending = client.detectStyle(
      ['Taylor, A. A. (2022). Example title. Journal.'],
      { signal: controller.signal },
    );

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: 'INFERENCE_TIMEOUT',
    });
  });
});

describe('HttpMLClient.extract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('accepts 207 partial-success responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [
        null,
        {
          fields: { title: 'Parsed title' },
          fieldConfidences: { title: 0.92 },
          overallConfidence: 0.92,
          modelVersion: 'crf_1.2.0',
          featureVersion: 'feat_2026-04-01',
          styleUsed: 'apa',
          uncertainFields: [],
          entities: [],
        },
      ],
      errors: [{ index: 0, code: 'INFERENCE_TIMEOUT' }],
    }), {
      status: 207,
      headers: { 'content-type': 'application/json' },
    })));

    const client = new HttpMLClient('http://ml.test', 500);
    const response = await client.extract(['one', 'two'], ['apa7', 'apa7']);

    expect(response.results[0]).toBeNull();
    expect(response.results[1]?.fields.title).toBe('Parsed title');
    expect(response.errors?.[0]?.code).toBe('INFERENCE_TIMEOUT');
  });

  it('rejects mismatched batch lengths before issuing a request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const client = new HttpMLClient('http://ml.test', 500);

    await expect(client.extract(['one'], ['apa7', 'mla9'])).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps HTTP 400 to BAD_REQUEST without retrying', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchSpy);

    const client = new HttpMLClient('http://ml.test', 500);

    await expect(client.extract(['one'], ['apa7'])).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects responses with both a result and an error for the same index', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      results: [{
        fields: { title: 'Parsed title' },
        fieldConfidences: { title: 0.92 },
        overallConfidence: 0.92,
        modelVersion: 'crf_1.2.0',
        featureVersion: 'feat_2026-04-01',
        styleUsed: 'apa',
        uncertainFields: [],
        entities: [],
      }],
      errors: [{ index: 0, code: 'INTERNAL_ERROR' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    const client = new HttpMLClient('http://ml.test', 500);

    await expect(client.extract(['one'], ['apa7'])).rejects.toThrow(/both a result and an error/i);
  });

  it('maps HTTP 503 to MODEL_UNAVAILABLE and retries once', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{
          fields: { title: 'Recovered title' },
          fieldConfidences: { title: 0.91 },
          overallConfidence: 0.91,
          modelVersion: 'crf_1.2.0',
          featureVersion: 'feat_2026-04-01',
          styleUsed: 'apa',
          uncertainFields: [],
          entities: [],
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchSpy);

    const client = new HttpMLClient('http://ml.test', 500);
    const response = await client.extract(['one'], ['apa7']);

    expect(response.results[0]?.fields.title).toBe('Recovered title');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
