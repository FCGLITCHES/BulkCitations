import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  extractClerkUserTraits,
  selectPrimaryClerkEmail,
  verifyJwtForProvider,
} from '../../../src/auth/externalAuth.js';

describe('selectPrimaryClerkEmail', () => {
  it('returns the normalized primary email and verification status', () => {
    const result = selectPrimaryClerkEmail({
      primary_email_address_id: 'email_primary',
      email_addresses: [
        {
          id: 'email_secondary',
          email_address: 'secondary@example.com',
          verification: { status: 'verified' },
        },
        {
          id: 'email_primary',
          email_address: ' Admin@Example.com ',
          verification: { status: 'verified' },
        },
      ],
    });

    expect(result).toEqual({
      email: 'admin@example.com',
      verified: true,
    });
  });

  it('falls back to the first email when Clerk does not expose a primary id', () => {
    const result = selectPrimaryClerkEmail({
      emailAddresses: [
        {
          id: 'email_first',
          emailAddress: 'staff@example.com',
          verification: { status: 'pending' },
        },
      ],
    });

    expect(result).toEqual({
      email: 'staff@example.com',
      verified: false,
    });
  });
});

describe('extractClerkUserTraits', () => {
  it('hydrates email, display name, username, admin flag, and tier from Clerk user data', () => {
    const result = extractClerkUserTraits({
      primary_email_address_id: 'email_primary',
      email_addresses: [
        {
          id: 'email_primary',
          email_address: 'Admin@Example.com',
          verification: { status: 'verified' },
        },
      ],
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'ada',
      public_metadata: {
        is_admin: true,
        tier: 'b2b',
      },
    });

    expect(result).toEqual({
      email: 'admin@example.com',
      emailVerified: true,
      isAdmin: true,
      tier: 'b2b',
      displayName: 'Ada Lovelace',
      username: 'ada',
    });
  });

  it('treats admin role arrays in Clerk metadata as admin access', () => {
    const result = extractClerkUserTraits({
      emailAddresses: [
        {
          id: 'email_first',
          emailAddress: 'reviewer@example.com',
          verification: { status: 'verified' },
        },
      ],
      publicMetadata: {
        roles: ['member', 'admin'],
      },
    });

    expect(result.isAdmin).toBe(true);
    expect(result.email).toBe('reviewer@example.com');
  });

  it('treats administrator role strings in Clerk metadata as admin access', () => {
    const result = extractClerkUserTraits({
      emailAddresses: [
        {
          id: 'email_first',
          emailAddress: 'staff@example.com',
          verification: { status: 'verified' },
        },
      ],
      privateMetadata: {
        role: 'administrator',
      },
    });

    expect(result.isAdmin).toBe(true);
    expect(result.email).toBe('staff@example.com');
  });

  it('ignores unsafe metadata for admin and tier decisions', () => {
    const result = extractClerkUserTraits({
      emailAddresses: [
        {
          id: 'email_first',
          emailAddress: 'user@example.com',
          verification: { status: 'verified' },
        },
      ],
      unsafeMetadata: {
        is_admin: true,
        tier: 'b2b',
      },
    });

    expect(result.isAdmin).toBe(false);
    expect(result.tier).toBeUndefined();
    expect(result.email).toBe('user@example.com');
  });
});

describe('verifyJwtForProvider', () => {
  it('rejects Clerk tokens when audience is configured but aud claim is missing', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key';
    const jwks = createLocalJWKSet({ keys: [jwk] });

    const token = await new SignJWT({ email: 'admin@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://issuer.example.com')
      .setSubject('user_123')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

    await expect(
      verifyJwtForProvider(token, jwks, {
        name: 'clerk',
        issuer: 'https://issuer.example.com/',
        jwksUrl: 'https://issuer.example.com/.well-known/jwks.json',
        audiences: ['bulkreferences-api'],
      }),
    ).rejects.toMatchObject({
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'aud',
    });
  });
});
