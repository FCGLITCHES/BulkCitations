/**
 * Prints WORKOS_JWKS_URL for your Client ID (run with Node, not PowerShell).
 *
 * Usage (from repo root):
 *   pnpm -C server exec node scripts/print-workos-jwks-url.mjs client_YOUR_ID
 */
import { WorkOS } from '@workos-inc/node';

const clientId = process.argv[2];
if (!clientId?.startsWith('client_')) {
  console.error('Usage: node scripts/print-workos-jwks-url.mjs client_...');
  console.error('Get Client ID: https://dashboard.workos.com/api-keys');
  process.exit(1);
}

const workos = new WorkOS(process.env.WORKOS_API_KEY ?? 'sk_test_placeholder');
const url = workos.userManagement.getJwksUrl(clientId);
console.log(url);
console.log('');
console.log('Set in .env:');
console.log(`WORKOS_JWKS_URL=${url}`);
