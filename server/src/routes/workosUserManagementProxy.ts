import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../config.js';
import { instrumentedFetch, mapOutboundFetchError } from '../services/instrumentedFetch.js';

const WORKOS_UPSTREAM = 'https://api.workos.com';

/**
 * Transparent proxy for AuthKit JS → `/user_management/authenticate`.
 * Browsers cannot call api.workos.com directly (CORS); the SPA is configured with
 * `apiHostname` pointing at this app (or Vite in dev), and this forwards to WorkOS.
 */
export async function workosUserManagementProxyRoute(app: FastifyInstance): Promise<void> {
  app.post('/user_management/authenticate', async (req: FastifyRequest, reply) => {
    if (!env.WORKOS_CLIENT_ID?.trim()) {
      req.log.warn('workos proxy: WORKOS_CLIENT_ID unset — refusing');
      return reply.status(503).send({
        error: 'workos_proxy_unconfigured',
        message: 'Set WORKOS_CLIENT_ID (match VITE_WORKOS_CLIENT_ID) on the API server.',
      });
    }

    const body = req.body;
    if (body === undefined || body === null || typeof body !== 'object') {
      return reply.status(400).send({ error: 'invalid_body' });
    }

    const grantType = (body as { grant_type?: unknown }).grant_type;
    if (grantType !== 'refresh_token' && grantType !== 'authorization_code') {
      req.log.warn({ grantType }, 'workos proxy: unexpected grant_type');
    }

    const correlationId = (req.headers['x-correlation-id'] as string | undefined) ?? req.id;
    req.log.info(
      {
        workosProxy: true,
        grantType,
        correlationId,
      },
      'workos proxy: forwarding authenticate',
    );

    try {
      const upstream = await instrumentedFetch({
        provider: 'other',
        route: '/user_management/authenticate',
        method: 'POST',
        url: `${WORKOS_UPSTREAM}/user_management/authenticate`,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
        },
        body,
      });

      const text = await upstream.text();
      const ct = upstream.headers.get('content-type') ?? 'application/json';
      if (ct.includes('application/json')) {
        try {
          return reply.status(upstream.status).header('Content-Type', ct).send(JSON.parse(text));
        } catch {
          return reply.status(upstream.status).header('Content-Type', ct).send(text);
        }
      }
      return reply.status(upstream.status).header('Content-Type', ct).send(text);
    } catch (err) {
      req.log.error({ err }, 'workos proxy: upstream fetch failed');
      const mapped = mapOutboundFetchError(
        err,
        'WorkOS authentication service is temporarily unavailable.',
      );
      return reply.status(mapped.statusCode).send({
        error: mapped.code,
        message: mapped.message,
      });
    }
  });
}
