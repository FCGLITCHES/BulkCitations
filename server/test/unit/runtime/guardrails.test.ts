import { afterEach, describe, expect, it } from 'vitest';
import {
  checkEnrichmentAllowance,
  consumeEnrichmentUse,
  enforceConcurrentJobLimit,
  enforceReferenceQuota,
} from '../../../src/runtime/guardrails.js';
import { resetRuntimeStore, saveJob } from '../../../src/runtime/persistence.js';

describe('runtime guardrails concurrency and quota scoping', () => {
  afterEach(async () => {
    await resetRuntimeStore();
  });

  it('enforces the b2b concurrent cap per organization', async () => {
    for (let index = 0; index < 25; index += 1) {
      await saveJob({
        id: `org-a-${index}`,
        request: {
          sourceType: 'doi_list',
          content: `10.1000/org-a-${index}`,
          outputStyle: 'apa7',
        },
        orgId: 'org-a',
        tier: 'b2b',
        executionMode: 'async',
        status: index % 2 === 0 ? 'pending' : 'processing',
        createdAt: new Date().toISOString(),
        exports: {},
        events: [],
      });
    }

    await expect(
      enforceConcurrentJobLimit('b2b', { orgId: 'org-a' }),
    ).rejects.toMatchObject({
      code: 'CONCURRENT_JOB_LIMIT',
      details: expect.objectContaining({
        tier: 'b2b',
        limit: 25,
        activeJobs: 25,
        scope: 'org:org-a',
      }),
    });
  });

  it('does not let one b2b org consume another org bucket before the global ceiling is hit', async () => {
    for (let index = 0; index < 25; index += 1) {
      await saveJob({
        id: `org-a-${index}`,
        request: {
          sourceType: 'doi_list',
          content: `10.1000/org-a-${index}`,
          outputStyle: 'apa7',
        },
        orgId: 'org-a',
        tier: 'b2b',
        executionMode: 'async',
        status: 'processing',
        createdAt: new Date().toISOString(),
        exports: {},
        events: [],
      });
    }

    await expect(
      enforceConcurrentJobLimit('b2b', { orgId: 'org-b' }),
    ).resolves.toBeUndefined();
  });

  it('enforces the global b2b ceiling across organizations', async () => {
    for (let index = 0; index < 100; index += 1) {
      await saveJob({
        id: `org-${index}`,
        request: {
          sourceType: 'doi_list',
          content: `10.1000/global-${index}`,
          outputStyle: 'apa7',
        },
        orgId: `org-${Math.floor(index / 10)}`,
        tier: 'b2b',
        executionMode: 'async',
        status: 'pending',
        createdAt: new Date().toISOString(),
        exports: {},
        events: [],
      });
    }

    await expect(
      enforceConcurrentJobLimit('b2b', { orgId: 'org-z' }),
    ).rejects.toMatchObject({
      code: 'CONCURRENT_JOB_LIMIT',
      details: expect.objectContaining({
        tier: 'b2b',
        limit: 100,
        activeJobs: 100,
        scope: 'b2b_global',
      }),
    });
  });

  it('tracks the b2b daily quota per organization instead of globally', async () => {
    await expect(
      enforceReferenceQuota(50_000, 'b2b', { orgId: 'org-a' }),
    ).resolves.toBeUndefined();

    await expect(
      enforceReferenceQuota(1, 'b2b', { orgId: 'org-a' }),
    ).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      details: expect.objectContaining({
        tier: 'b2b',
        limit: 50_000,
        attempted: 1,
        currentUsage: 50_000,
      }),
    });

    await expect(
      enforceReferenceQuota(1, 'b2b', { orgId: 'org-b' }),
    ).resolves.toBeUndefined();
  });

  it('scopes non-b2b concurrent caps to the caller identity instead of the entire tier bucket', async () => {
    for (let index = 0; index < 10; index += 1) {
      await saveJob({
        id: `pro-user-a-${index}`,
        request: {
          sourceType: 'doi_list',
          content: `10.1000/pro-user-a-${index}`,
          outputStyle: 'apa7',
        },
        userId: 'pro-user-a',
        tier: 'pro',
        executionMode: 'async',
        status: 'processing',
        createdAt: new Date().toISOString(),
        exports: {},
        events: [],
      });
    }

    await expect(
      enforceConcurrentJobLimit('pro', { userId: 'pro-user-b' }),
    ).resolves.toBeUndefined();

    await expect(
      enforceConcurrentJobLimit('pro', { userId: 'pro-user-a' }),
    ).rejects.toMatchObject({
      code: 'CONCURRENT_JOB_LIMIT',
      details: expect.objectContaining({
        tier: 'pro',
        limit: 10,
        activeJobs: 10,
        scope: 'user:pro-user-a',
      }),
    });
  });
});

describe('inline enrichment tier gating', () => {
  afterEach(async () => {
    await resetRuntimeStore();
  });

  it('allows pro and b2b unlimited enrichment regardless of batch size', async () => {
    await expect(checkEnrichmentAllowance('pro', 500, { userId: 'enrich-pro' })).resolves.toMatchObject({
      allowed: true,
      limit: null,
    });
    await expect(checkEnrichmentAllowance('b2b', 500, { userId: 'enrich-b2b' })).resolves.toMatchObject({
      allowed: true,
      limit: null,
    });
  });

  it('gives free identities a 10-reference lifetime trial, metered by reference count', async () => {
    const identity = { userId: 'enrich-free-a' };
    await expect(checkEnrichmentAllowance('free', 1, identity)).resolves.toMatchObject({
      allowed: true, reason: 'ok', limit: 10, used: 0, remaining: 10,
    });
    await consumeEnrichmentUse(1, identity);
    await expect(checkEnrichmentAllowance('free', 4, identity)).resolves.toMatchObject({
      allowed: true, used: 1, remaining: 9,
    });
    await consumeEnrichmentUse(4, identity); // used = 5

    // 6 references won't fit in the remaining 5 -> bulk (Pro-only).
    await expect(checkEnrichmentAllowance('free', 6, identity)).resolves.toMatchObject({
      allowed: false, reason: 'bulk', used: 5, remaining: 5,
    });
    // exactly 5 fits.
    await expect(checkEnrichmentAllowance('free', 5, identity)).resolves.toMatchObject({ allowed: true });
    await consumeEnrichmentUse(5, identity); // used = 10

    await expect(checkEnrichmentAllowance('free', 1, identity)).resolves.toMatchObject({
      allowed: false, reason: 'over_limit', used: 10, remaining: 0,
    });
    // A different identity keeps its own independent trial.
    await expect(checkEnrichmentAllowance('free', 1, { userId: 'enrich-free-b' })).resolves.toMatchObject({
      allowed: true, used: 0,
    });
  });

  it('treats a batch larger than the whole free trial as bulk (Pro-only)', async () => {
    await expect(checkEnrichmentAllowance('free', 11, { userId: 'enrich-bulk' })).resolves.toMatchObject({
      allowed: false, reason: 'bulk',
    });
  });

  it('denies enrichment to callers with no meterable identity', async () => {
    await expect(checkEnrichmentAllowance('free', 1, {})).resolves.toMatchObject({ allowed: false, reason: 'no_identity' });
    await expect(checkEnrichmentAllowance('anonymous', 1)).resolves.toMatchObject({ allowed: false });
  });
});
