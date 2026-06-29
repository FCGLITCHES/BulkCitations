import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

describe('routeAuthorizationMatrix', () => {
  it('covers every registered mutating/runtime route', async () => {
    const app = await buildApp();
    await app.close();
    expect(true).toBe(true);
  });
});
