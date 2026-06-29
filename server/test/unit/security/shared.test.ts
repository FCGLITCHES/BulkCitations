import { afterEach, describe, expect, it } from 'vitest';
import {
  readMlServiceStartupTimeoutMs,
  reportDirectoryFromMeta,
} from '../../../scripts/security/shared.js';

const ORIGINAL_SECURITY_ML_STARTUP_TIMEOUT_MS = process.env.SECURITY_ML_STARTUP_TIMEOUT_MS;
const ORIGINAL_SECURITY_REPORT_DESTINATION = process.env.SECURITY_REPORT_DESTINATION;
const ORIGINAL_CI = process.env.CI;
const ORIGINAL_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS;

describe('security harness shared config', () => {
  afterEach(() => {
    if (ORIGINAL_SECURITY_ML_STARTUP_TIMEOUT_MS === undefined) {
      delete process.env.SECURITY_ML_STARTUP_TIMEOUT_MS;
      return;
    }
    process.env.SECURITY_ML_STARTUP_TIMEOUT_MS = ORIGINAL_SECURITY_ML_STARTUP_TIMEOUT_MS;

    if (ORIGINAL_SECURITY_REPORT_DESTINATION === undefined) {
      delete process.env.SECURITY_REPORT_DESTINATION;
    } else {
      process.env.SECURITY_REPORT_DESTINATION = ORIGINAL_SECURITY_REPORT_DESTINATION;
    }

    if (ORIGINAL_CI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = ORIGINAL_CI;
    }

    if (ORIGINAL_GITHUB_ACTIONS === undefined) {
      delete process.env.GITHUB_ACTIONS;
    } else {
      process.env.GITHUB_ACTIONS = ORIGINAL_GITHUB_ACTIONS;
    }
  });

  it('defaults the ML startup timeout when unset', () => {
    delete process.env.SECURITY_ML_STARTUP_TIMEOUT_MS;
    expect(readMlServiceStartupTimeoutMs()).toBe(75_000);
  });

  it('uses an explicit positive ML startup timeout override', () => {
    process.env.SECURITY_ML_STARTUP_TIMEOUT_MS = '45000';
    expect(readMlServiceStartupTimeoutMs()).toBe(45_000);
  });

  it('ignores invalid ML startup timeout overrides', () => {
    process.env.SECURITY_ML_STARTUP_TIMEOUT_MS = 'invalid';
    expect(readMlServiceStartupTimeoutMs()).toBe(75_000);
  });

  it('writes local security harness reports outside CI by default', () => {
    delete process.env.SECURITY_REPORT_DESTINATION;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;

    expect(reportDirectoryFromMeta(import.meta.url).replace(/\\/g, '/')).toContain(
      '/docs/test-results/security/local',
    );
  });

  it('allows security harness reports to target the checked-in directory explicitly', () => {
    process.env.SECURITY_REPORT_DESTINATION = 'checked-in';
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;

    expect(reportDirectoryFromMeta(import.meta.url).replace(/\\/g, '/')).toContain(
      '/docs/test-results/security',
    );
    expect(reportDirectoryFromMeta(import.meta.url).replace(/\\/g, '/')).not.toContain(
      '/docs/test-results/security/local',
    );
  });
});
