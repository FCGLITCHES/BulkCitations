import { describe, expect, it, beforeEach } from 'vitest';
import {
  appendCitationVersion,
  listCitationVersions,
  resetRuntimeStore,
  saveCitationVersion,
  type StoredCitationVersion,
} from '../../../src/runtime/store.js';

function makeVersion(partial: Partial<StoredCitationVersion> = {}): StoredCitationVersion {
  return {
    id: partial.id ?? 'v-1',
    citationId: partial.citationId ?? 'citation-1',
    jobId: partial.jobId ?? 'job-1',
    versionNumber: partial.versionNumber ?? 1,
    fields: partial.fields ?? {},
    source: partial.source ?? 'test',
    createdAt: partial.createdAt ?? new Date().toISOString(),
  };
}

describe('citation version append', () => {
  beforeEach(() => {
    resetRuntimeStore();
  });

  it('assigns versionNumber=1 for the first appended version', () => {
    const appended = appendCitationVersion({
      id: 'v-1',
      citationId: 'citation-1',
      jobId: 'job-1',
      fields: {},
      source: 'first',
      createdAt: new Date().toISOString(),
    });

    expect(appended.versionNumber).toBe(1);
    expect(listCitationVersions('citation-1').map((entry) => entry.versionNumber)).toEqual([1]);
  });

  it('appends the next version number after existing stored versions', () => {
    saveCitationVersion(makeVersion({ id: 'existing-2', versionNumber: 2 }));
    saveCitationVersion(makeVersion({ id: 'existing-4', versionNumber: 4 }));

    const appended = appendCitationVersion({
      id: 'v-5',
      citationId: 'citation-1',
      jobId: 'job-1',
      fields: {},
      source: 'append',
      createdAt: new Date().toISOString(),
    });

    expect(appended.versionNumber).toBe(5);
    expect(listCitationVersions('citation-1').map((entry) => entry.versionNumber)).toEqual([2, 4, 5]);
  });
});
