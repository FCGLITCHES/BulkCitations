import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lookupAuthorityDoiHints } from '../../../src/engine/data/authorityPack.js';
import {
  buildGeneratedAuthorityPack,
  resetGeneratedAuthorityPackCache,
} from '../../../src/engine/data/generatedAuthorityPack.js';
import { lookupIssnByJournalTitle } from '../../../src/engine/data/journalIssnHints.js';
import type { StoredApprovedTruth } from '../../../src/runtime/store.js';

describe('generated authority pack', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    delete process.env.LOCAL_AUTHORITY_PACK_PATH;
    resetGeneratedAuthorityPackCache();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('builds DOI exact hints and journal ISSN hints from reviewed truth rows', () => {
    const rows: StoredApprovedTruth[] = [
      {
        id: 'truth-1',
        inputHash: 'hash-1',
        rawText: 'Example DOI 10.1000/example-conf',
        expectedFields: {
          doi: '10.1000/example-conf',
          conferenceTitle: 'Proceedings of ExampleConf 2026',
          publisher: 'Example Press',
          journal: 'Journal of Example Results',
          issn: '1234-5678',
        },
        expectedType: 'conference-paper',
        expectedStyle: 'ieee',
        provenance: 'manual',
        pipelineMajor: 3,
        datasetSplit: 'train',
        trustLevel: 'gold',
        rowStatus: 'reviewed',
        taskCertifications: [
          {
            task: 'authority_pack',
            truthScope: 'core',
            status: 'certified',
            certifiedAt: new Date().toISOString(),
            certifiedBy: 'reviewer@example.com',
            requiredReviewPasses: 1,
            completedReviewPasses: 1,
            pass1Hash: null,
            pass2Hash: null,
          },
        ],
        goldKind: 'authority_seed',
        adversarialPair: null,
        noiseProfile: null,
        approvalSource: 'manual',
        reviewedBy: 'reviewer@example.com',
        reviewedAt: new Date().toISOString(),
        notes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const bundle = buildGeneratedAuthorityPack(rows, '2026-04-13.generated-authority-pack.v1', '2026-04-13T00:00:00Z');

    expect(bundle.version).toBe('2026-04-13.generated-authority-pack.v1');
    expect(bundle.doiExactHints).toEqual([
      expect.objectContaining({
        doi: '10.1000/example-conf',
        typeHint: 'conference-paper',
        conferenceTitleHint: 'Proceedings of ExampleConf 2026',
        publisherHint: 'Example Press',
      }),
    ]);
    expect(bundle.journalIssnHints).toEqual([
      expect.objectContaining({
        journal: 'Journal of Example Results',
        issn: '1234-5678',
      }),
    ]);
  });

  it('lets authority and journal lookups consume the generated bundle at runtime', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'generated-authority-pack-'));
    const bundlePath = join(tempDir, 'authority-pack.json');
    await writeFile(
      bundlePath,
      JSON.stringify({
        version: '2026-04-13.generated-authority-pack.v1',
        generatedAt: '2026-04-13T00:00:00Z',
        doiExactHints: [
          {
            doi: '10.1000/generated-article',
            typeHint: 'article-journal',
            conferenceTitleHint: null,
            publisherHint: 'Generated Publisher',
            truthId: 'truth-2',
            trustLevel: 'gold',
            goldKind: 'authority_seed',
          },
        ],
        journalIssnHints: [
          {
            journal: 'Generated Journal of Examples',
            issn: '2042-003X',
            truthId: 'truth-2',
            trustLevel: 'gold',
            goldKind: 'authority_seed',
          },
        ],
      }),
      'utf8',
    );
    process.env.LOCAL_AUTHORITY_PACK_PATH = bundlePath;
    resetGeneratedAuthorityPackCache();

    const doiHint = lookupAuthorityDoiHints('10.1000/generated-article');
    expect(doiHint.typeHint).toBe('article-journal');
    expect(doiHint.publisherHint).toBe('Generated Publisher');
    expect(doiHint.packVersion).toBe('2026-04-13.generated-authority-pack.v1');

    expect(lookupIssnByJournalTitle('Generated Journal of Examples')).toBe('2042-003X');
  });
});
