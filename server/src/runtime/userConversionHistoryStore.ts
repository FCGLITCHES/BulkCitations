import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { userConversionHistory } from '../db/schema.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** In-memory store for non-UUID actor ids (e.g. `test-user` in auth middleware tests). */
const memory = new Map<string, unknown[]>();

export async function readUserConversionHistoryJson(userId: string): Promise<unknown[]> {
  if (!UUID_RE.test(userId)) {
    return memory.get(userId) ?? [];
  }

  const [row] = await db
    .select({ items: userConversionHistory.items })
    .from(userConversionHistory)
    .where(eq(userConversionHistory.userId, userId))
    .limit(1);

  const raw = row?.items;
  return Array.isArray(raw) ? raw : [];
}

export async function writeUserConversionHistoryJson(userId: string, items: unknown[]): Promise<void> {
  if (!UUID_RE.test(userId)) {
    memory.set(userId, items);
    return;
  }

  await db
    .insert(userConversionHistory)
    .values({
      userId,
      items,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userConversionHistory.userId,
      set: {
        items,
        updatedAt: new Date(),
      },
    });
}
