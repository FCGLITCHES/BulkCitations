import { citations, insertCitationSchema } from '@shared/schema';
import { z } from 'zod';

let inMemoryStore: z.infer<typeof insertCitationSchema>[] = [];

export async function storeCitation(
  db: any,
  data: z.infer<typeof insertCitationSchema>
) {
  const validated = insertCitationSchema.parse(data);
  if (db) {
    await db.insert(citations).values(validated);
  } else {
    inMemoryStore.push(validated); // Fallback
  }
}

export async function getCitations(db: any) {
  if (db) {
    return db.select().from(citations);
  }
  return inMemoryStore;
} 