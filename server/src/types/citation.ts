import { z } from 'zod';

export enum CitationStyle {
  APA = 'APA',
  MLA = 'MLA',
  CHICAGO = 'CHICAGO',
  HARVARD = 'HARVARD',
  IEEE = 'IEEE',
  VANCOUVER = 'VANCOUVER'
}

export enum ReferenceType {
  BOOK = 'BOOK',
  JOURNAL = 'JOURNAL',
  WEBSITE = 'WEBSITE',
  CONFERENCE = 'CONFERENCE',
  THESIS = 'THESIS',
  OTHER = 'OTHER'
}

export interface ParsedReference {
  authors: string[];
  title: string;
  year?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  url?: string;
  doi?: string;
  accessed?: string;
}

export interface ConversionRequest {
  references: string[];
  inputStyle: CitationStyle;
  outputStyle: CitationStyle;
}

export interface ConvertedReference {
  id: string;
  originalText: string;
  convertedText: string;
  referenceType: ReferenceType;
  parsedData: ParsedReference;
  inputStyle: CitationStyle;
  outputStyle: CitationStyle;
  errors?: string[];
}

export interface ConversionResponse {
  convertedReferences: ConvertedReference[];
  errors?: string[];
} 