function readOptionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return fallback;
}

const configuredClerkJwtTemplate = readOptionalEnv(import.meta.env.VITE_CLERK_JWT_TEMPLATE as string | undefined);
const configuredWorkosClientId = readOptionalEnv(import.meta.env.VITE_WORKOS_CLIENT_ID as string | undefined);
const workosExplicitlyEnabled = readBooleanEnv(import.meta.env.VITE_ENABLE_WORKOS as string | undefined, false);

export const clerkJwtTemplate = configuredClerkJwtTemplate;
export const workosEnabled = workosExplicitlyEnabled && Boolean(configuredWorkosClientId);
export const workosClientId = workosEnabled ? configuredWorkosClientId : undefined;
