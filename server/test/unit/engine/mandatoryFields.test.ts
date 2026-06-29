import { describe, expect, it } from 'vitest';
import { FIELD_SCHEMAS, auditMandatoryFields, getFieldSchema } from '../../../src/engine/mandatory-fields.js';
import { createEmptyExtractedFields } from '../../../src/engine/utils/fields.js';

describe('mandatory field schemas', () => {
  it('returns the direct schema for a known type-style pair', () => {
    const schema = getFieldSchema('book', 'apa7');

    expect(schema.mandatory).toEqual(['title', 'year', 'publisher']);
    expect(schema.requireOneOf.map((group) => group.id)).toContain('book_authorship');
    expect(schema.preferred).toContain('edition');
  });

  it('falls back to the unknown schema when a direct mapping is unavailable', () => {
    const schema = getFieldSchema('unknown', 'unknown');

    expect(schema.mandatory).toEqual(['title']);
    expect(schema.preferred).toContain('authors');
    expect(schema.preferred).toContain('doi');
  });

  it('ships the full supported schema map for the current style matrix', () => {
    expect(Object.keys(FIELD_SCHEMAS).length).toBe(99);
  });

  it('treats article numbers as satisfying page locator requirements for article schemas', () => {
    const fields = createEmptyExtractedFields('test');
    fields.authors.value = [{ family: 'Smith', given: 'J', initials: 'J.', isCorporate: false }];
    fields.title.value = 'Example study';
    fields.year.value = 2020;
    fields.journal.value = 'Journal of Examples';
    fields.volume.value = '12';
    fields.issue.value = '3';
    fields.articleNumber.value = 'e100237';

    const audit = auditMandatoryFields({
      fields,
      referenceType: 'article-journal',
      requestedStyle: 'apa7',
      detectedStyle: 'apa7',
    });

    expect(audit.missingMandatory).not.toContain('pages');
  });

  it('treats journal page locators as preferred completeness instead of mandatory', () => {
    const schema = getFieldSchema('article-journal', 'apa7');
    const locatorGroup = schema.requireOneOf.find((group) => group.id === 'journal_locator');

    expect(locatorGroup?.severity).toBe('preferred');
    expect(locatorGroup?.completenessOnly).toBe(true);
  });
});
