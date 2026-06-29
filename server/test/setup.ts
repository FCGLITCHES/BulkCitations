process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:5432/bulkreferences_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.PORT ??= '3001';
process.env.RATE_LIMIT_MAX ??= '100';
process.env.RATE_LIMIT_WINDOW_MS ??= '60000';

// Short timeouts for external services in test to avoid hanging
process.env.CROSSREF_TIMEOUT_MS ??= '200';
process.env.OPENALEX_TIMEOUT_MS ??= '200';
process.env.OPENAI_TIMEOUT_MS ??= '200';
process.env.RETRACTION_WATCH_TIMEOUT_MS ??= '200';
process.env.ML_SERVICE_TIMEOUT_MS ??= '200';
