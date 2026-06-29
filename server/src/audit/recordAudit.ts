import { db } from '../db/connection.js';
import { auditLogs } from '../db/schema.js';
import { env } from '../config.js';
import { resolvePersistenceBackend } from '../runtime/persistenceMode.js';

export interface AuditEventInput {
  actorUserId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  orgId?: string | null;
  correlationId?: string | null;
  statusCode?: number | null;
  metadata?: Record<string, unknown> | null;
}

const MAX_AUDIT_BACKLOG = 500;
const MAX_DRAIN_PER_CALL = 20;

type AuditPersistor = (input: AuditEventInput) => Promise<void>;

const pendingAuditEvents: AuditEventInput[] = [];
let auditDrainInFlight = false;

const defaultAuditPersistor: AuditPersistor = async (input) => {
  await db.insert(auditLogs).values({
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: input.action,
    resource: input.resource.slice(0, 500),
    ...(input.resourceId ? { resourceId: input.resourceId.slice(0, 255) } : {}),
    ...(input.orgId ? { orgId: input.orgId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId.slice(0, 128) } : {}),
    ...(input.statusCode != null ? { statusCode: input.statusCode } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
};

let auditPersistor: AuditPersistor = defaultAuditPersistor;

function shouldSkipDefaultAuditPersistence(): boolean {
  if (auditPersistor !== defaultAuditPersistor) {
    return false;
  }

  return resolvePersistenceBackend({
    nodeEnv: env.NODE_ENV,
    configuredBackend: env.PERSISTENCE_BACKEND,
    databaseUrl: process.env.DATABASE_URL,
  }) !== 'database';
}

function sanitizeAuditEvent(input: AuditEventInput): AuditEventInput {
  return {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: input.action.slice(0, 255),
    resource: input.resource.slice(0, 500),
    ...(input.resourceId ? { resourceId: input.resourceId.slice(0, 255) } : {}),
    ...(input.orgId ? { orgId: input.orgId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId.slice(0, 128) } : {}),
    ...(input.statusCode != null ? { statusCode: input.statusCode } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function logAuditPersistenceFailure(
  stage: 'write' | 'retry' | 'drop',
  input: AuditEventInput,
  error?: unknown,
): void {
  if (stage === 'drop') {
    console.warn(
      `[audit] dropping oldest buffered event to keep backlog bounded (${input.action} ${input.resource})`,
    );
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[audit] ${stage} failed for (${input.action} ${input.resource}): ${message}`,
  );
}

function enqueueAuditEvent(input: AuditEventInput): void {
  if (pendingAuditEvents.length >= MAX_AUDIT_BACKLOG) {
    const dropped = pendingAuditEvents.shift();
    if (dropped) {
      logAuditPersistenceFailure('drop', dropped);
    }
  }
  pendingAuditEvents.push(input);
}

async function drainPendingAuditEvents(
  maxDrain: number = MAX_DRAIN_PER_CALL,
): Promise<void> {
  if (shouldSkipDefaultAuditPersistence()) {
    pendingAuditEvents.length = 0;
    return;
  }

  if (auditDrainInFlight || pendingAuditEvents.length === 0) {
    return;
  }

  auditDrainInFlight = true;
  try {
    let drained = 0;
    while (pendingAuditEvents.length > 0 && drained < maxDrain) {
      const next = pendingAuditEvents[0];
      if (!next) {
        break;
      }
      try {
        await auditPersistor(next);
        pendingAuditEvents.shift();
        drained += 1;
      } catch (error) {
        logAuditPersistenceFailure('retry', next, error);
        break;
      }
    }
  } finally {
    auditDrainInFlight = false;
  }
}

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  const sanitized = sanitizeAuditEvent(input);

  if (shouldSkipDefaultAuditPersistence()) {
    pendingAuditEvents.length = 0;
    return;
  }

  await drainPendingAuditEvents();

  try {
    await auditPersistor(sanitized);
  } catch (error) {
    // Never fail the request path on audit persistence.
    enqueueAuditEvent(sanitized);
    logAuditPersistenceFailure('write', sanitized, error);
  }
}

// Test-only controls for deterministic queue behavior checks.
export function __setAuditPersistorForTests(
  persistor: AuditPersistor | null,
): void {
  auditPersistor = persistor ?? defaultAuditPersistor;
}

export function __resetAuditBufferForTests(): void {
  pendingAuditEvents.length = 0;
  auditDrainInFlight = false;
  auditPersistor = defaultAuditPersistor;
}

export function __getPendingAuditEventCountForTests(): number {
  return pendingAuditEvents.length;
}
