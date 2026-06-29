import { listApprovedTruth } from '../src/runtime/persistence.js';
import {
  buildGeneratedAuthorityPack,
  writeGeneratedAuthorityPack,
} from '../src/engine/data/generatedAuthorityPack.js';
import { effectiveRowStatus, isTaskCertified, withLegacyCertification } from '../src/training/truthCertification.js';

async function main(): Promise<void> {
  const rows = await listApprovedTruth({ limit: 5000 });
  const eligibleRows = rows
    .map((row) => withLegacyCertification(row))
    .filter((row) => effectiveRowStatus(row) !== 'quarantined')
    .filter((row) => isTaskCertified(row, 'authority_pack', 'core'));
  const bundle = buildGeneratedAuthorityPack(eligibleRows);
  const writtenPath = await writeGeneratedAuthorityPack(bundle);

  console.log(
    JSON.stringify(
      {
        ok: true,
        version: bundle.version,
        generatedAt: bundle.generatedAt,
        sourceRows: eligibleRows.length,
        doiExactHints: bundle.doiExactHints.length,
        journalIssnHints: bundle.journalIssnHints.length,
        path: writtenPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
