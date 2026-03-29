import { processV2Conversion } from './server/engine/v2/pipeline.js';
import { regressionFixtures } from './server/engine/v2/regressionFixtures.js';
for (const fixture of regressionFixtures) {
  if (fixture.expectedDuplicateCount == null) continue;
  const { response } = await processV2Conversion({
    sourceType: 'text',
    content: fixture.references.join('\n\n'),
    inputStyle: 'auto',
    outputStyle: 'apa',
    enrich: false,
    dedup: true,
    group: false,
    debug: true,
  });
  if (response.stats.duplicate_count !== fixture.expectedDuplicateCount) {
    console.log(JSON.stringify({
      fixture: fixture.id,
      expectedDuplicateCount: fixture.expectedDuplicateCount,
      actualDuplicateCount: response.stats.duplicate_count,
      unique_count: response.stats.unique_count,
      duplicates: response.duplicates,
      citations: response.citations.map((c: any) => ({
        id: c.id,
        status: c.status,
        referenceType: c.referenceType,
        title: c.title?.value,
        authors: c.authors?.value?.map((a: any) => ({ last: a.last, first: a.first, initials: a.initials, literal: a.literal })) ?? [],
        year: c.year?.value,
        journal: c.journal?.value,
        raw: c.raw,
      })),
    }, null, 2));
    break;
  }
}
