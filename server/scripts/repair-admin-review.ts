import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, isNull, sql } from 'drizzle-orm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
process.env.PERSISTENCE_BACKEND = 'database';

async function main() {
  const [
    { db, closeDb },
    { userCorrections },
    { listJobs, saveJob },
    { rebuildBatchHealthSummary },
  ] = await Promise.all([
    import('../src/db/connection.js'),
    import('../src/db/schema.js'),
    import('../src/runtime/persistence.js'),
    import('../src/admin/batchHealthSummary.js'),
  ]);

  try {
    const jobs = await listJobs();
    const citationToJobId = new Map<string, string>();
    let projectedCitationCount = 0;

    for (const job of jobs) {
      if (job.result) {
        projectedCitationCount += job.result.references.length;
        for (const citation of job.result.references) {
          citationToJobId.set(citation.id, job.id);
        }
      }
      await saveJob(job);
    }

    await db.execute(sql`
      UPDATE "user_corrections" AS "corrections"
      SET "job_id" = "citations"."job_id"
      FROM "citations"
      WHERE "corrections"."citation_id" = "citations"."id"
        AND "corrections"."job_id" IS NULL
    `);

    const remainingCorrections = await db
      .select({
        id: userCorrections.id,
        citationId: userCorrections.citationId,
      })
      .from(userCorrections)
      .where(isNull(userCorrections.jobId));

    let repairedCorrections = 0;
    for (const correction of remainingCorrections) {
      if (!correction.citationId) {
        continue;
      }
      const jobId = citationToJobId.get(correction.citationId);
      if (!jobId) {
        continue;
      }
      await db
        .update(userCorrections)
        .set({
          jobId,
          updatedAt: new Date(),
        })
        .where(eq(userCorrections.id, correction.id));
      repairedCorrections += 1;
    }

    for (const job of jobs) {
      await rebuildBatchHealthSummary(job.id);
    }

    console.info(
      `[repair-admin-review] projected ${projectedCitationCount} citations across ${jobs.length} jobs and repaired ${repairedCorrections} correction job links.`,
    );
  } finally {
    const { closeRedis } = await import('../src/redis/client.js');
    await closeDb();
    await closeRedis();
  }
}

void main().catch((error) => {
  console.error('[repair-admin-review] failed:', error);
  process.exit(1);
});
