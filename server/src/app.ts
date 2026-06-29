import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import { corsAllowedOrigins, env, shouldUseRedisBackedRateLimits } from './config.js';
import { getRedis } from './redis/client.js';
import { AppError, ErrorCode } from './engine/errors/index.js';
import {
  requireAuth,
  optionalAuth,
  requireAdmin,
  requireOrgAdmin,
  attachAuditOrgContext,
  shouldRunOptionalAuthBeforeRateLimit,
  requestIsAdminBypassingLimits,
} from './middleware/auth.js';
import { runWithRequestContext, getCorrelationId } from './runtime/requestContext.js';
import { recordAuditEvent } from './audit/recordAudit.js';
import { healthRoute } from './routes/health.js';
import { adminRoute } from './routes/admin.js';
import { adminAnalyticsRoute } from './routes/admin-analytics.js';
import { adminCslRoute } from './routes/admin-csl.js';
import { adminReferencesRoute } from './routes/admin-references.js';
import { adminApproveRoute } from './routes/admin-approve.js';
import { adminSessionProbeRoute } from './routes/adminSessionProbe.js';
import { convertRoute } from './routes/convert.js';
import { exportRoute } from './routes/export.js';
import { feedbackRoute } from './routes/feedback.js';
import { sseRoute } from './routes/sse.js';
import { inspectRoute } from './routes/inspect.js';
import { jobsRoute } from './routes/jobs.js';
import { proEnrichRoute } from './routes/proEnrich.js';
import { keysRoute } from './routes/keys.js';
import { historyRoute } from './routes/history.js';
import { regressionRoute } from './routes/regression.js';
import { webhooksRoute } from './routes/webhooks.js';
import { authRoute } from './routes/auth.js';
import { authPublicRoute } from './routes/authPublic.js';
import { workosUserManagementProxyRoute } from './routes/workosUserManagementProxy.js';
import { orgAdminRoute } from './routes/org.js';
import { contactRoute } from './routes/contact.js';
import { waitlistRoute } from './routes/waitlist.js';
import { analyticsPublicRoute } from './routes/analyticsPublic.js';
import { JSON_BODY_LIMIT_BYTES } from './routes/requestLimits.js';
import { resetReportIpLimiter } from './services/reportIpLimiter.js';
import {
  assertRouteAuthorizationMatrixCoverage,
  collectRegisteredRouteSignatures,
  type RegisteredRouteSignature,
} from './security/routeAuthorizationMatrix.js';

export async function buildApp() {
  const useRedisBackedRateLimit = shouldUseRedisBackedRateLimits();

  // Test suites create many isolated app instances in a single process.
  // Reset the per-IP in-memory report limiter for each test app so suite order
  // cannot leak report quota between unrelated cases.
  if (env.NODE_ENV === 'test') {
    resetReportIpLimiter();
  }

  const logger = {
    level: env.NODE_ENV === 'test' ? 'silent' : 'info',
    serializers: {
      req(req: FastifyRequest) {
        return {
          method: req.method,
          url: req.url,
          correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? req.id,
        };
      },
    },
  };

  const app = Fastify({
    logger,
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    disableRequestLogging: env.NODE_ENV === 'test',
    trustProxy: env.NODE_ENV === 'development' || env.NODE_ENV === 'test'
      ? true
      : env.TRUST_PROXY_CIDRS,
    requestIdHeader: 'x-correlation-id',
  });

  const registeredRoutes: RegisteredRouteSignature[] = [];
  app.addHook('onRoute', (routeOptions) => {
    collectRegisteredRouteSignatures(routeOptions, registeredRoutes);
  });

  // Webhook providers sign the exact raw body bytes. Default JSON parsing + JSON.stringify()
  // breaks Svix / WorkOS verification (key order and spacing differ from the signed payload).
  app.addHook('preParsing', async (request, _reply, payload) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/webhooks/')) {
      return payload;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of payload as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks);
    request.rawBody = raw.toString('utf8');
    return Readable.from(raw);
  });

  // ---------------------------------------------------------------------------
  // Plugins
  // ---------------------------------------------------------------------------
  await app.register(cors, {
    origin(origin, cb) {
      if (env.NODE_ENV !== 'production') {
        cb(null, true);
        return;
      }

      // Allow same-origin / non-browser callers.
      if (!origin) {
        cb(null, true);
        return;
      }

      if (corsAllowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }

      // Cloudflare Pages preview domains (e.g. https://<project>-<hash>.pages.dev)
      if (/^https:\/\/[a-z0-9-]+\.pages\.dev$/i.test(origin)) {
        cb(null, true);
        return;
      }

      cb(new Error('CORS origin not allowed'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Correlation-Id',
      'X-Break-Glass-Secret',
    ],
    credentials: true,
  });

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: env.UPLOAD_MAX_BYTES,
      fields: 16,
    },
  });

  await app.register(compress, {
    global: true,
    encodings: ['br', 'gzip'],
    threshold: 1024,
  });

  app.addHook('onRequest', async (req, _reply) => {
    if (!shouldRunOptionalAuthBeforeRateLimit(req.url)) {
      return;
    }
    await optionalAuth(req, _reply);
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    ...(useRedisBackedRateLimit ? { redis: getRedis() } : {}),
    /** Session polling from the SPA can burst; staff `/internal/*` is authenticated separately. */
    allowList(req) {
      const path = (req.url.split('?')[0] ?? '').replace(/\/$/, '') || '/';
      if (requestIsAdminBypassingLimits(req)) {
        return true;
      }
      if (req.method !== 'GET') {
        return false;
      }
      return path === '/v1/auth/session' || path === '/internal/admin/session';
    },
    keyGenerator(req) {
      // Prefer authenticated user ID, fall back to IP
      const userId = (req as { userId?: string }).userId;
      return userId ? `user:${userId}` : `ip:${req.ip}`;
    },
    errorResponseBuilder(_req, context) {
      return {
        error: ErrorCode.RATE_LIMIT_EXCEEDED,
        message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)}s.`,
        retryAfter: Math.ceil(context.ttl / 1000),
      };
    },
    /** If Redis is unavailable in dev, do not fail every request. */
    skipOnError: env.NODE_ENV === 'development',
  });

  // ---------------------------------------------------------------------------
  // Global error handler
  // ---------------------------------------------------------------------------
  app.setErrorHandler((error, _req, reply) => {
    const errorLike = error as Partial<Error> & {
      statusCode?: number;
      code?: string;
      details?: unknown;
      stack?: string;
    };
    const message = error instanceof Error ? error.message : 'An internal error occurred.';
    const statusCode = errorLike.statusCode ?? 500;
    const isServerError = statusCode >= 500;
    const errorCode =
      typeof errorLike.code === 'string'
        ? errorLike.code
        : isServerError
          ? ErrorCode.INTERNAL_ERROR
          : ErrorCode.INPUT_VALIDATION_FAILED;

    if (isServerError) {
      app.log.error({ err: error }, 'Unhandled error');
    }

    return reply.status(statusCode).send({
      error: errorCode,
      message: isServerError ? 'An internal error occurred.' : message,
      ...(error instanceof AppError && error.details ? { details: error.details } : {}),
      ...(env.NODE_ENV === 'development' && isServerError && errorLike.stack ? { stack: errorLike.stack } : {}),
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    return reply.status(404).send({
      error: ErrorCode.NOT_FOUND,
      message: 'Route not found.',
    });
  });

  // ---------------------------------------------------------------------------
  // Request context (correlation id propagation)
  // ---------------------------------------------------------------------------
  app.addHook('onRequest', (req, _reply, done) => {
    const correlationId =
      (req.headers['x-correlation-id'] as string | undefined) ?? req.id;
    runWithRequestContext({ correlationId }, () => done());
  });

  // ---------------------------------------------------------------------------
  // Routes — public (no auth)
  // ---------------------------------------------------------------------------
  await app.register(healthRoute);
  await app.register(healthRoute, { prefix: '/api/engine' });
  await app.register(webhooksRoute);

  await app.register(async function workosBrowserProxy(scope: FastifyInstance) {
    await scope.register(rateLimit, {
      max: 120,
      timeWindow: 60_000,
      ...(useRedisBackedRateLimit ? { redis: getRedis() } : {}),
      allowList(req) {
        return requestIsAdminBypassingLimits(req);
      },
      keyGenerator(req) {
        return `workos-proxy:${req.ip}`;
      },
      skipOnError: env.NODE_ENV === 'development',
    });
    await scope.register(workosUserManagementProxyRoute);
  });

  await app.register(authPublicRoute, { prefix: '/v1' });

  await app.register(async function contactScope(scope: FastifyInstance) {
    await scope.register(rateLimit, {
      max: 8,
      timeWindow: 60 * 60 * 1000,
      ...(useRedisBackedRateLimit ? { redis: getRedis() } : {}),
      allowList(req) {
        return requestIsAdminBypassingLimits(req);
      },
      keyGenerator(req) {
        return `contact:${req.ip}`;
      },
    });
    await scope.register(contactRoute);
  }, { prefix: '/api' });

  await app.register(async function waitlistScope(scope: FastifyInstance) {
    await scope.register(rateLimit, {
      max: 10,
      timeWindow: 60 * 60 * 1000,
      ...(useRedisBackedRateLimit ? { redis: getRedis() } : {}),
      allowList(req) {
        return requestIsAdminBypassingLimits(req);
      },
      keyGenerator(req) {
        return `waitlist:${req.ip}`;
      },
    });
    await scope.register(waitlistRoute);
  }, { prefix: '/api' });

  await app.register(async function publicAnalyticsScope(scope: FastifyInstance) {
    await scope.register(rateLimit, {
      max: 300,
      timeWindow: 60_000,
      ...(useRedisBackedRateLimit ? { redis: getRedis() } : {}),
      allowList(req) {
        return requestIsAdminBypassingLimits(req);
      },
      keyGenerator(req) {
        return `analytics:${req.ip}`;
      },
      skipOnError: env.NODE_ENV === 'development',
    });
    await scope.register(analyticsPublicRoute);
  }, { prefix: '/api' });

  await app.register(async function authRateLimited(scope: FastifyInstance) {
    await scope.register(rateLimit, {
      max: 30,
      timeWindow: 60_000,
      ...(useRedisBackedRateLimit ? { redis: getRedis() } : {}),
      allowList(req) {
        return requestIsAdminBypassingLimits(req);
      },
      keyGenerator(req) {
        return `auth:${req.ip}`;
      },
    });
    await scope.register(authRoute);
  }, { prefix: '/v1' });

  // ---------------------------------------------------------------------------
  // Routes — engine runtime (anonymous allowed with rate limits)
  // ---------------------------------------------------------------------------
  const registerEngineRuntimeRoutes = async (scope: FastifyInstance) => {
    await scope.register(inspectRoute);
    await scope.register(convertRoute);
    await scope.register(jobsRoute);
    await scope.register(proEnrichRoute);
    await scope.register(exportRoute);
    await scope.register(feedbackRoute);
    await scope.register(sseRoute);
  };

  await app.register(registerEngineRuntimeRoutes, { prefix: '/v1' });
  await app.register(registerEngineRuntimeRoutes, { prefix: '/api/engine' });

  // ---------------------------------------------------------------------------
  // Routes — account/authenticated utilities
  // ---------------------------------------------------------------------------
  await app.register(async function authenticatedRoutes(scope: FastifyInstance) {
    scope.addHook('preHandler', requireAuth);
    await scope.register(keysRoute);
    await scope.register(historyRoute);
  }, { prefix: '/v1' });

  await app.register(async function orgAdminRoutes(scope: FastifyInstance) {
    scope.addHook('preHandler', requireAuth);
    scope.addHook('preHandler', requireOrgAdmin);
    await scope.register(orgAdminRoute);
  }, { prefix: '/v1' });

  // ---------------------------------------------------------------------------
  // Routes — admin session probe (JWT only; returns authenticated:false if not staff)
  // ---------------------------------------------------------------------------
  await app.register(async function adminSessionProbe(scope: FastifyInstance) {
    scope.addHook('preHandler', requireAuth);
    await scope.register(adminSessionProbeRoute);
  }, { prefix: '/internal' });

  await app.register(async function adminApproveProtected(scope: FastifyInstance) {
    scope.addHook('preHandler', requireAuth);
    scope.addHook('preHandler', requireAdmin);
    scope.addHook('preHandler', attachAuditOrgContext);
    await scope.register(rateLimit, {
      max: 5,
      timeWindow: 60_000,
      ...(useRedisBackedRateLimit ? { redis: getRedis() } : {}),
      keyGenerator(req) {
        const userId = (req as { userId?: string }).userId ?? 'anonymous';
        return `internal-admin-approve:${userId}:${req.ip}`;
      },
      skipOnError: env.NODE_ENV === 'development',
    });
    await scope.register(adminApproveRoute);
  }, { prefix: '/internal' });

  // ---------------------------------------------------------------------------
  // Routes — admin (require auth + admin flag)
  // ---------------------------------------------------------------------------
  await app.register(async function adminRoutes(scope: FastifyInstance) {
    scope.addHook('preHandler', requireAuth);
    scope.addHook('preHandler', requireAdmin);
    scope.addHook('preHandler', attachAuditOrgContext);
    scope.addHook('onResponse', async (req, reply) => {
      const userId = (req as { userId?: string }).userId;
      if (!userId) {
        return;
      }
      const auditOrgId = (req as { auditOrgId?: string }).auditOrgId;
      const path = String(req.routeOptions?.url ?? req.url).split('?')[0] ?? '';
      const actorLooksUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId);
      void recordAuditEvent({
        ...(actorLooksUuid ? { actorUserId: userId } : { metadata: { syntheticActor: userId } }),
        action: 'admin.request',
        resource: `${req.method} ${path}`.slice(0, 500),
        orgId: auditOrgId ?? null,
        correlationId: getCorrelationId(),
        statusCode: reply.statusCode,
      });
    });
    await scope.register(adminRoute);
    await scope.register(adminAnalyticsRoute);
    await scope.register(adminCslRoute);
    await scope.register(adminReferencesRoute);
    await scope.register(regressionRoute);
  }, { prefix: '/internal' });

  assertRouteAuthorizationMatrixCoverage(registeredRoutes);

  return app;
}
