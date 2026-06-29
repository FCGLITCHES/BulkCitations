import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shouldOverrideDotenv =
  !process.env.DOTENV_OVERRIDE || process.env.DOTENV_OVERRIDE === 'true' || process.env.DOTENV_OVERRIDE === '1';
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), override: shouldOverrideDotenv });

async function main() {
  // Load modules AFTER dotenv so config.ts reads the real environment.
  const [
    { buildApp },
    { closeDb },
    { closeRedis },
    { env },
    { runtimePersistenceBackend },
    { resumeRuntimeJobs },
    { resumeTruthBackgroundJobs },
    { scheduleBatchHealthSummaryRepairSweep },
    { bootstrapStyleGoldIntoApprovedTruth },
    { prewarmCertifiedApprovedTruthCache },
  ] = await Promise.all([
    import('./app.js'),
    import('./db/connection.js'),
    import('./redis/client.js'),
    import('./config.js'),
    import('./runtime/persistence.js'),
    import('./jobs/runtime.js'),
    import('./routes/adminTruthRoutes.js'),
    import('./admin/batchHealthSummary.js'),
    import('./training/bootstrapStyleGoldIntoApprovedTruth.js'),
    import('./engine/phases/phase13FeedbackLoop.js'),
  ]);

  const app = await buildApp();

  const bootstrapResult = await bootstrapStyleGoldIntoApprovedTruth();
  if (bootstrapResult) {
    app.log.info(
      {
        sourcePath: bootstrapResult.path,
        loaded: bootstrapResult.loaded,
        skipped: bootstrapResult.skipped,
        persistenceBackend: runtimePersistenceBackend,
      },
      'Bootstrapped style_gold rows into approved truth transient test store',
    );
  }
  const approvedTruthCache = await prewarmCertifiedApprovedTruthCache();
  app.log.info(
    {
      entryCount: approvedTruthCache.entryCount,
      revision: approvedTruthCache.revision,
      persistenceBackend: runtimePersistenceBackend,
    },
    'Prewarmed certified approved truth cache',
  );

  if (runtimePersistenceBackend === 'database') {
    await Promise.all([
      resumeRuntimeJobs(),
      resumeTruthBackgroundJobs(),
    ]);
    void scheduleBatchHealthSummaryRepairSweep().catch((err) => {
      app.log.error({ err }, 'Batch health summary repair sweep failed');
    });
  }

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully`);
    try {
      await app.close();
      await closeDb();
      await closeRedis();
      app.log.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

void main();
