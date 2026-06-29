import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { env, resolvedRedisUrl } from '../config.js';
import { db } from '../db/connection.js';
import { getRedis } from '../redis/client.js';
import { runtimePersistenceBackend } from '../runtime/persistence.js';

type DependencyStatus = 'ok' | 'error' | 'disabled';

interface DependencyCheck {
  status: DependencyStatus;
  required: boolean;
  configured: boolean;
}

const HEALTH_CHECK_TIMEOUT_MS = 1_000;

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', { logLevel: 'silent' }, async (_req, reply) => {
    const checks: Record<string, DependencyCheck> = {};
    const postgresRequired = runtimePersistenceBackend === 'database';
    const postgresConfigured = Boolean(process.env.DATABASE_URL?.trim());
    const redisRequired = env.NODE_ENV === 'production';
    const redisConfigured = Boolean(resolvedRedisUrl);

    // Postgres check
    if (!postgresConfigured) {
      checks['postgres'] = {
        status: 'disabled',
        required: postgresRequired,
        configured: false,
      };
    } else {
      try {
        await withTimeout(db.execute(sql`SELECT 1`), HEALTH_CHECK_TIMEOUT_MS);
        checks['postgres'] = {
          status: 'ok',
          required: postgresRequired,
          configured: true,
        };
      } catch {
        checks['postgres'] = {
          status: 'error',
          required: postgresRequired,
          configured: true,
        };
      }
    }

    // Redis check
    if (!redisConfigured) {
      checks['redis'] = {
        status: 'disabled',
        required: redisRequired,
        configured: false,
      };
    } else {
      try {
        await withTimeout(getRedis().ping(), HEALTH_CHECK_TIMEOUT_MS);
        checks['redis'] = {
          status: 'ok',
          required: redisRequired,
          configured: true,
        };
      } catch {
        checks['redis'] = {
          status: 'error',
          required: redisRequired,
          configured: true,
        };
      }
    }

    const hasRequiredFailure = Object.values(checks).some((check) => check.required && check.status !== 'ok');
    const hasOptionalIssue = Object.values(checks).some((check) => !check.required && check.status === 'error');
    return reply.status(hasRequiredFailure ? 503 : 200).send({
      status: hasRequiredFailure || hasOptionalIssue ? 'degraded' : 'ok',
      checks,
      version: '1.0.0',
      pipelineMajor: 3,
      runtime: {
        nodeEnv: env.NODE_ENV,
        port: env.PORT,
        persistenceMode: env.PERSISTENCE_BACKEND,
        persistenceBackend: runtimePersistenceBackend,
      },
    });
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Dependency check timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
