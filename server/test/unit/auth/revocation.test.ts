import { afterEach, describe, expect, it } from 'vitest';
import {
  isSessionRevoked,
  isTokenJtiRevoked,
  resetRevocationStateForTests,
  revokeSession,
  revokeTokenJti,
} from '../../../src/auth/revocation.js';

describe('revocation store', () => {
  afterEach(() => {
    resetRevocationStateForTests();
  });

  it('tracks revoked token JTIs without requiring Redis', async () => {
    expect(await isTokenJtiRevoked('token-jti-1')).toBe(false);

    await revokeTokenJti('token-jti-1');

    expect(await isTokenJtiRevoked('token-jti-1')).toBe(true);
  });

  it('tracks revoked session ids without requiring Redis', async () => {
    expect(await isSessionRevoked('session-1')).toBe(false);

    await revokeSession('session-1');

    expect(await isSessionRevoked('session-1')).toBe(true);
  });
});
