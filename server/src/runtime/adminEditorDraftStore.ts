import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { approvedTruthEditorDrafts as approvedTruthEditorDraftsTable } from '../db/schema.js';
import type {
  ApprovedTruthEditorDraftPayload,
  StoredApprovedTruthEditorDraft,
} from './store.js';

function rowToStored(
  row: typeof approvedTruthEditorDraftsTable.$inferSelect,
): StoredApprovedTruthEditorDraft {
  return {
    id: row.id,
    userId: row.userId,
    payload: row.payload as ApprovedTruthEditorDraftPayload,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

export async function getApprovedTruthEditorDraftDb(
  userId: string,
): Promise<StoredApprovedTruthEditorDraft | null> {
  const [row] = await db
    .select()
    .from(approvedTruthEditorDraftsTable)
    .where(eq(approvedTruthEditorDraftsTable.userId, userId))
    .limit(1);
  return row ? rowToStored(row) : null;
}

export async function upsertApprovedTruthEditorDraftDb(input: {
  userId: string;
  payload: ApprovedTruthEditorDraftPayload;
}): Promise<StoredApprovedTruthEditorDraft> {
  const [existing] = await db
    .select()
    .from(approvedTruthEditorDraftsTable)
    .where(eq(approvedTruthEditorDraftsTable.userId, input.userId))
    .limit(1);
  const now = new Date();

  if (existing) {
    await db
      .update(approvedTruthEditorDraftsTable)
      .set({
        payload: input.payload,
        updatedAt: now,
      })
      .where(eq(approvedTruthEditorDraftsTable.userId, input.userId));
    const updated = await getApprovedTruthEditorDraftDb(input.userId);
    if (!updated) {
      throw new Error('approved_truth_editor_drafts update read failed');
    }
    return updated;
  }

  const id = randomUUID();
  await db.insert(approvedTruthEditorDraftsTable).values({
    id,
    userId: input.userId,
    payload: input.payload,
    createdAt: now,
    updatedAt: now,
  });
  const created = await getApprovedTruthEditorDraftDb(input.userId);
  if (!created) {
    throw new Error('approved_truth_editor_drafts insert read failed');
  }
  return created;
}

export async function deleteApprovedTruthEditorDraftDb(userId: string): Promise<boolean> {
  const deleted = await db
    .delete(approvedTruthEditorDraftsTable)
    .where(eq(approvedTruthEditorDraftsTable.userId, userId))
    .returning({ id: approvedTruthEditorDraftsTable.id });
  return deleted.length > 0;
}
