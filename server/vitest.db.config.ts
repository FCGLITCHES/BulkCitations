import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/dbSetup.ts'],
    include: ['./test/integration/**/*.db.test.ts'],
    // DB integration tests share a single runtime store and truncate the same tables
    // between files. Running them in parallel creates false negatives by design.
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
