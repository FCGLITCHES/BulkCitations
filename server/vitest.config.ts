import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['./test/**/*.test.ts', './test/**/*.spec.ts', './src/**/*.test.ts', './src/**/*.spec.ts'],
    exclude: ['./test/**/*.db.test.ts', './node_modules/**'],
    testTimeout: 15_000,
    env: {
      CROSSREF_TIMEOUT_MS: '200',
      OPENALEX_TIMEOUT_MS: '200',
      OPENAI_TIMEOUT_MS: '200',
      RETRACTION_WATCH_TIMEOUT_MS: '200',
      ML_SERVICE_TIMEOUT_MS: '200',
    },
  },
});
