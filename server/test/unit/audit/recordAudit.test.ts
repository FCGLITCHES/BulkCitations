import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __getPendingAuditEventCountForTests,
  __resetAuditBufferForTests,
  __setAuditPersistorForTests,
  recordAuditEvent,
} from '../../../src/audit/recordAudit.js';
import type { AuditEventInput } from '../../../src/audit/recordAudit.js';
import { env } from '../../../src/config.js';

const ORIGINAL_NODE_ENV = env.NODE_ENV;
const ORIGINAL_PERSISTENCE_BACKEND = env.PERSISTENCE_BACKEND;

describe('recordAuditEvent buffering', () => {
  beforeEach(() => {
    __resetAuditBufferForTests();
    env.NODE_ENV = ORIGINAL_NODE_ENV;
    env.PERSISTENCE_BACKEND = ORIGINAL_PERSISTENCE_BACKEND;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    __resetAuditBufferForTests();
    env.NODE_ENV = ORIGINAL_NODE_ENV;
    env.PERSISTENCE_BACKEND = ORIGINAL_PERSISTENCE_BACKEND;
    vi.restoreAllMocks();
  });

  it('buffers a failed audit write instead of throwing', async () => {
    const persistor = vi.fn().mockRejectedValue(new Error('db offline'));
    __setAuditPersistorForTests(persistor);

    await expect(
      recordAuditEvent({
        action: 'api_key.create',
        resource: '/v1/keys',
      }),
    ).resolves.toBeUndefined();

    expect(persistor).toHaveBeenCalledTimes(1);
    expect(__getPendingAuditEventCountForTests()).toBe(1);
  });

  it('drains buffered events before writing new events', async () => {
    let failFirst = true;
    const persistor = vi.fn(async (_input: AuditEventInput) => {
      if (failFirst) {
        failFirst = false;
        throw new Error('transient');
      }
    });
    __setAuditPersistorForTests(persistor);

    await recordAuditEvent({
      action: 'first',
      resource: '/a',
    });
    await recordAuditEvent({
      action: 'second',
      resource: '/b',
    });

    expect(__getPendingAuditEventCountForTests()).toBe(0);
    expect(persistor).toHaveBeenCalledTimes(3);
    expect(persistor.mock.calls.map(([input]) => input.action)).toEqual([
      'first', // initial failure
      'first', // retry from backlog drain
      'second', // current event
    ]);
  });

  it('keeps backlog bounded when persistent failures continue', async () => {
    const persistor = vi.fn().mockRejectedValue(new Error('still offline'));
    __setAuditPersistorForTests(persistor);

    for (let index = 0; index < 530; index += 1) {
      await recordAuditEvent({
        action: `event_${index}`,
        resource: '/audit',
      });
    }

    expect(__getPendingAuditEventCountForTests()).toBe(500);
  });

  it('skips the default database audit writer in memory-backed test mode', async () => {
    env.NODE_ENV = 'test';
    env.PERSISTENCE_BACKEND = 'memory';

    await expect(
      recordAuditEvent({
        action: 'api_key.create',
        resource: '/v1/keys',
      }),
    ).resolves.toBeUndefined();

    expect(__getPendingAuditEventCountForTests()).toBe(0);
    expect(console.error).not.toHaveBeenCalled();
  });
});
