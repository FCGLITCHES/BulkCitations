import { z } from 'zod';


const aiServiceUrl = process.env.AI_MICROSERVICE_URL || 'http://127.0.0.1:8000';

const entityExtractionSchema = z.object({
  entity: z.string(),
  word: z.string(),
  confidence: z.number(),
});

export type EntityExtraction = z.infer<typeof entityExtractionSchema>;

const extractEntitiesResponseSchema = z.object({
  entities: z.array(entityExtractionSchema),
});

export async function extractEntitiesML(citation: string): Promise<EntityExtraction[] | null> {
  try {
    const response = await fetch(`${aiServiceUrl}/extract-entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ citation }),
    });

    if (!response.ok) {
      console.warn(`[Phase4] Failed to extract entities via ML: ${response.status}`);
      return null;
    }

    const payload = await response.json();
    const result = extractEntitiesResponseSchema.parse(payload);
    return result.entities;
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      console.warn('[Phase4] ML service offline, using sequence heuristic fallback.');
    } else {
      console.error('[Phase4] Field extraction ML service error:', error);
    }
    return null;
  }
}
