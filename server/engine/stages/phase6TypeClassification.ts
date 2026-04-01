import { z } from 'zod';
import type { ReferenceType } from '@shared/schema';

const aiServiceUrl = process.env.AI_MICROSERVICE_URL || 'http://127.0.0.1:8000';

const classifyTypeResponseSchema = z.object({
  reference_type: z.string(),
  confidence: z.number(),
});

export async function classifyReferenceTypeML(citation: string): Promise<ReferenceType | null> {
  try {
    const response = await fetch(`${aiServiceUrl}/classify-type`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ citation }),
    });

    if (!response.ok) {
      console.warn(`[Phase6] Failed to classify reference type via ML: ${response.status}`);
      return null;
    }

    const payload = await response.json();
    const result = classifyTypeResponseSchema.parse(payload);
    
    // Confidence threshold
    if (result.confidence > 0.6) {
        return result.reference_type as ReferenceType;
    }
    return null;

  } catch (error: any) {
    if (error.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      console.warn('[Phase6] ML service offline, using type heuristic fallback.');
    } else {
      console.error('[Phase6] Reference type classification error:', error);
    }
    return null;
  }
}
