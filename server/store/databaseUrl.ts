let hasWarnedAboutInvalidDatabaseUrl = false;

function isPostgresConnectionString(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";
  } catch {
    return false;
  }
}

export function getUsableDatabaseUrl(): string | null {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return null;
  if (isPostgresConnectionString(raw)) return raw;

  if (!hasWarnedAboutInvalidDatabaseUrl) {
    hasWarnedAboutInvalidDatabaseUrl = true;
    console.warn(
      "[store] Ignoring DATABASE_URL because it is not a Postgres connection string. Falling back to local file storage.",
    );
  }

  return null;
}
