export type RuntimePersistenceBackend = 'memory' | 'database';
export type RuntimePersistenceMode = 'auto' | 'database';
export type RuntimeNodeEnv = 'development' | 'test' | 'production';

interface ResolvePersistenceBackendInput {
  nodeEnv: RuntimeNodeEnv;
  configuredBackend: RuntimePersistenceMode;
  databaseUrl?: string | null | undefined;
}

export function resolvePersistenceBackend({
  nodeEnv,
  configuredBackend,
  databaseUrl: _databaseUrl,
}: ResolvePersistenceBackendInput): RuntimePersistenceBackend {
  if (configuredBackend === 'database') {
    return 'database';
  }

  if (nodeEnv === 'test') {
    return 'memory';
  }

  return 'database';
}
