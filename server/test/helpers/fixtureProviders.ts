// Offline provider services backed by the gold-derived fixture
// (test/fixtures/provider-records.gold-v1.json). Lets Phase 8 enrichment run
// end-to-end with zero network: a DOI (including an OCR-recovered one) resolves to
// the canonical record exactly as a live Crossref/OpenAlex lookup would. Injected
// via createPipelineDependencies({ enrichmentPhase: new Phase8Enrich(...) }).
import { readFileSync } from 'node:fs';
import type { CrossrefService, ProviderRecord } from '../../src/services/crossref.js';
import type { OpenAlexService } from '../../src/services/openalex.js';
import type { SemanticScholarService } from '../../src/services/semanticScholar.js';
import type { ExtractedFields } from '../../src/engine/types/citation.js';

function normalizeDoi(value: string): string {
  return value
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim()
    .toLowerCase();
}

export interface FixtureProviders {
  crossref: CrossrefService;
  openalex: OpenAlexService;
  semanticScholar: SemanticScholarService;
  size: number;
  calls: { count: number };
}

export function loadFixtureProviders(
  path = 'test/fixtures/provider-records.gold-v1.json',
): FixtureProviders {
  const byDoi = new Map<string, ProviderRecord>(
    Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, ProviderRecord>),
  );
  const calls = { count: 0 };

  const recordForFields = (fields: ExtractedFields): ProviderRecord | null => {
    const v = fields.doi?.value;
    const doi = typeof v === 'string' && v ? normalizeDoi(v) : null;
    if (!doi) return null;
    calls.count += 1;
    return byDoi.get(doi) ?? null;
  };

  return {
    crossref: {
      async resolveDoi(doi: string) {
        calls.count += 1;
        return byDoi.get(normalizeDoi(doi)) ?? null;
      },
      async lookup(fields: ExtractedFields) {
        return recordForFields(fields);
      },
    },
    openalex: {
      async lookup(fields: ExtractedFields) {
        return recordForFields(fields);
      },
    },
    semanticScholar: {
      async lookupLastResort() {
        return null;
      },
    },
    size: byDoi.size,
    calls,
  };
}
