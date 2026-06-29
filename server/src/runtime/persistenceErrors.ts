export class PersistenceConflictError extends Error {
  readonly currentUpdatedAt?: string;

  constructor(message: string, currentUpdatedAt?: string) {
    super(message);
    this.name = 'PersistenceConflictError';
    if (currentUpdatedAt) {
      this.currentUpdatedAt = currentUpdatedAt;
    }
  }
}
