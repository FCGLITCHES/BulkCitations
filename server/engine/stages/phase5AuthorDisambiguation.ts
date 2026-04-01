import { z } from 'zod';
import type { CanonicalAuthor } from '@shared/schema';

const aiServiceUrl = process.env.AI_MICROSERVICE_URL || 'http://127.0.0.1:8000';

const authorEntitySchema = z.object({
  entity: z.string(),
  word: z.string(),
  confidence: z.number(),
});

const parseAuthorsResponseSchema = z.object({
  author_entities: z.array(authorEntitySchema),
});

export async function disambiguateAuthorsML(authorsString: string): Promise<CanonicalAuthor[] | null> {
  try {
    const response = await fetch(`${aiServiceUrl}/parse-authors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authors_string: authorsString }),
    });

    if (!response.ok) {
      console.warn(`[Phase 5] Failed to disambiguate authors via ML: ${response.status}`);
      return null;
    }

    const payload = await response.json();
    const result = parseAuthorsResponseSchema.parse(payload);
    
    // Convert BIO tags back to CanonicalAuthor objects
    const authors: CanonicalAuthor[] = [];
    let current: Partial<CanonicalAuthor> | null = null;
    
    const flush = () => {
        if (current && current.last) {
            authors.push({
                first: current.first || null,
                last: current.last,
                initials: current.initials || null,
                literal: current.literal,
                orcid: current.orcid
            });
        }
    };
    
    for (const e of result.author_entities) {
        const tag = e.entity;
        const word = e.word;
        
        if (tag === 'B-FamilyName') {
            flush();
            current = { last: word };
        } else if (tag === 'I-FamilyName') {
            if (current) current.last = current.last ? `${current.last} ${word}` : word;
            else current = { last: word };
        } else if (tag === 'B-GivenName') {
            if (!current) current = { last: 'Unknown' }; // Fallback if B-Family is missed
            current.first = word;
        } else if (tag === 'I-GivenName') {
            if (current) current.first = current.first ? `${current.first} ${word}` : word;
        } else if (tag === 'B-Initials') {
            if (!current) current = { last: 'Unknown' };
            current.initials = word;
        }
    }
    flush();
    
    return authors.length > 0 ? authors : null;

  } catch (error: any) {
    if (error.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      console.warn('[Phase5] ML service offline, using author heuristics formatting.');
    } else {
      console.error('[Phase5] Author disambiguation error:', error);
    }
    return null;
  }
}
