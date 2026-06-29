import { z } from 'zod';

import type { CitationStyle, ReferenceType } from './citation.js';
import type { DetectedFormat, IngestionStructure } from './ingestion.js';
import type { ExportFormat, InspectRequest } from './api.js';
import { ENGINE_PARSE_PROFILES } from './parseProfile.js';

export const ENGINE_CITATION_STYLES = [
  'apa7',
  'mla9',
  'chicago-author-date',
  'chicago-notes-bib',
  'vancouver',
  'ieee',
  'harvard-ctr',
  'ama',
  'acs',
  'unknown',
  'auto',
] as const satisfies readonly CitationStyle[];

export const ENGINE_REFERENCE_TYPES = [
  'article-journal',
  'book',
  'book-chapter',
  'thesis',
  'conference-paper',
  'webpage',
  'report',
  'patent',
  'dataset',
  'preprint',
  'unknown',
] as const satisfies readonly ReferenceType[];

export const ENGINE_DETECTED_FORMATS = [
  'doi_list',
  'bibtex',
  'ris',
  'numbered_list',
  'blank_line',
  'hanging_indent',
  'plain_text',
  'unknown',
] as const satisfies readonly DetectedFormat[];

export const ENGINE_INGESTION_STRUCTURES = [
  'structured',
  'semi_structured',
  'unstructured',
  'unknown',
] as const satisfies readonly IngestionStructure[];

export const ENGINE_EXPORT_FORMATS = ['txt', 'bib', 'ris', 'csv', 'docx'] as const satisfies readonly ExportFormat[];

export const ENGINE_CONVERT_SOURCE_TYPES = ['text', 'doi_list'] as const;
export const ENGINE_PARSE_PROFILE_VALUES = ENGINE_PARSE_PROFILES;

export const ENGINE_INSPECT_SOURCE_TYPES = [
  'text',
  'pdf',
  'docx',
  'txt',
  'bib',
  'ris',
  'doi_list',
] as const satisfies readonly InspectRequest['sourceType'][];

export const engineCitationStyleSchema = z.enum(ENGINE_CITATION_STYLES);
export const engineReferenceTypeSchema = z.enum(ENGINE_REFERENCE_TYPES);
export const engineDetectedFormatSchema = z.enum(ENGINE_DETECTED_FORMATS);
export const engineIngestionStructureSchema = z.enum(ENGINE_INGESTION_STRUCTURES);
export const engineExportFormatSchema = z.enum(ENGINE_EXPORT_FORMATS);
export const engineConvertSourceTypeSchema = z.enum(ENGINE_CONVERT_SOURCE_TYPES);
export const engineInspectSourceTypeSchema = z.enum(ENGINE_INSPECT_SOURCE_TYPES);
export const engineParseProfileSchema = z.enum(ENGINE_PARSE_PROFILE_VALUES);
