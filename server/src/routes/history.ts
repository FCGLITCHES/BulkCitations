import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { readUserConversionHistoryJson, writeUserConversionHistoryJson } from '../runtime/userConversionHistoryStore.js';

const HISTORY_ROUTE_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

const userHistoryItemSchema = z.object({
  id: z.string().trim().min(1).max(160),
  originalText: z.string().trim().min(1).max(10000),
  convertedText: z.string().trim().min(1).max(10000),
  inputStyle: z.string().trim().min(1).max(80),
  outputStyle: z.string().trim().min(1).max(80),
  healthState: z.string().trim().min(1).max(40).optional(),
  timestamp: z.string().trim().min(1).max(80),
  customName: z.string().trim().max(160).optional(),
});

const userHistorySnapshotSchema = z.object({
  clientId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,80}$/),
  items: z.array(userHistoryItemSchema).max(5000),
});

type UserHistoryItem = z.infer<typeof userHistoryItemSchema>;

function parseStoredItems(raw: unknown[]): UserHistoryItem[] {
  const out: UserHistoryItem[] = [];
  for (const row of raw) {
    const parsed = userHistoryItemSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    }
  }
  return out;
}

export async function historyRoute(app: FastifyInstance): Promise<void> {
  app.get('/history', async (req, reply) => {
    const userId = (req as FastifyRequest & { userId?: string }).userId;
    if (!userId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Unauthorized.' });
    }

    const raw = await readUserConversionHistoryJson(userId);
    const items = parseStoredItems(raw);
    return reply.status(200).send({ items });
  });

  app.put(
    '/history',
    {
      // Authenticated users can sync large accumulated citation histories.
      // The Fastify default body limit is too small for that snapshot payload.
      bodyLimit: HISTORY_ROUTE_BODY_LIMIT_BYTES,
    },
    async (req, reply) => {
      const userId = (req as FastifyRequest & { userId?: string }).userId;
      if (!userId) {
        return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Unauthorized.' });
      }

      const parsed = userHistorySnapshotSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'INPUT_VALIDATION_FAILED',
          message: 'Invalid history payload.',
        });
      }

      await writeUserConversionHistoryJson(userId, parsed.data.items);
      return reply.status(200).send({ items: parsed.data.items });
    },
  );
}
