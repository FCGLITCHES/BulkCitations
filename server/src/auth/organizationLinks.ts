import { and, eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { organizationIdentityLinks, organizations } from '../db/schema.js';

/**
 * Resolve or create an internal organization row for an external org id from the IdP (claim hint).
 * Tenant membership and quotas remain DB-driven; this only maps external org → UUID.
 */
export async function ensureOrganizationForExternal(
  provider: 'clerk' | 'workos',
  externalOrgId: string,
): Promise<string> {
  const trimmed = externalOrgId.trim();
  if (!trimmed) {
    throw new Error('External organization id is empty.');
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ organizationId: organizationIdentityLinks.organizationId })
      .from(organizationIdentityLinks)
      .where(and(eq(organizationIdentityLinks.provider, provider), eq(organizationIdentityLinks.externalId, trimmed)))
      .limit(1);

    if (existing) {
      return existing.organizationId;
    }

    const [created] = await tx
      .insert(organizations)
      .values({
        name: `Organization ${trimmed.slice(0, 48)}`,
        tier: 'b2b',
      })
      .returning({ id: organizations.id });

    if (!created) {
      throw new Error('Failed to create organization for external id.');
    }

    const [linked] = await tx
      .insert(organizationIdentityLinks)
      .values({
        provider,
        externalId: trimmed,
        organizationId: created.id,
      })
      .onConflictDoNothing({
        target: [
          organizationIdentityLinks.provider,
          organizationIdentityLinks.externalId,
        ],
      })
      .returning({ organizationId: organizationIdentityLinks.organizationId });

    if (linked) {
      return linked.organizationId;
    }

    const [winner] = await tx
      .select({ organizationId: organizationIdentityLinks.organizationId })
      .from(organizationIdentityLinks)
      .where(and(eq(organizationIdentityLinks.provider, provider), eq(organizationIdentityLinks.externalId, trimmed)))
      .limit(1);

    if (winner) {
      if (winner.organizationId !== created.id) {
        await tx.delete(organizations).where(eq(organizations.id, created.id));
      }
      return winner.organizationId;
    }

    throw new Error('Failed to link external organization id.');
  });
}
