import { describe, expect, it } from 'vitest';
import { resolvePersistenceBackend } from './persistenceMode.js';

describe('resolvePersistenceBackend', () => {
  it('uses database when explicitly configured', () => {
    expect(
      resolvePersistenceBackend({
        nodeEnv: 'development',
        configuredBackend: 'database',
        databaseUrl: '',
      }),
    ).toBe('database');
  });

  it('uses database for auto mode in development when a database URL exists', () => {
    expect(
      resolvePersistenceBackend({
        nodeEnv: 'development',
        configuredBackend: 'auto',
        databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/bulkreferences',
      }),
    ).toBe('database');
  });

  it('keeps development on the database backend even when no database URL is provided explicitly', () => {
    expect(
      resolvePersistenceBackend({
        nodeEnv: 'development',
        configuredBackend: 'auto',
        databaseUrl: '',
      }),
    ).toBe('database');
  });

  it('keeps test mode in-memory for isolated test runs', () => {
    expect(
      resolvePersistenceBackend({
        nodeEnv: 'test',
        configuredBackend: 'auto',
        databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/bulkreferences_test',
      }),
    ).toBe('memory');
  });
});
