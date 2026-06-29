import { describe, expect, it } from 'vitest';
import { resolvePersistenceBackend } from '../../../src/runtime/persistenceMode.js';

describe('resolvePersistenceBackend', () => {
  it('prefers explicit database mode', () => {
    expect(resolvePersistenceBackend({
      nodeEnv: 'development',
      configuredBackend: 'database',
      databaseUrl: '',
    })).toBe('database');
  });

  it('keeps tests on the in-memory backend', () => {
    expect(resolvePersistenceBackend({
      nodeEnv: 'test',
      configuredBackend: 'auto',
      databaseUrl: 'postgresql://postgres:postgres@localhost:5432/bulkreferences_test',
    })).toBe('memory');
  });

  it('uses the database backend in development auto mode when DATABASE_URL is configured', () => {
    expect(resolvePersistenceBackend({
      nodeEnv: 'development',
      configuredBackend: 'auto',
      databaseUrl: 'postgresql://postgres:postgres@localhost:5432/bulkreferences',
    })).toBe('database');
  });

  it('keeps development on the database backend when DATABASE_URL is absent', () => {
    expect(resolvePersistenceBackend({
      nodeEnv: 'development',
      configuredBackend: 'auto',
      databaseUrl: '',
    })).toBe('database');
  });

  it('keeps production on the database backend in auto mode', () => {
    expect(resolvePersistenceBackend({
      nodeEnv: 'production',
      configuredBackend: 'auto',
      databaseUrl: '',
    })).toBe('database');
  });
});
