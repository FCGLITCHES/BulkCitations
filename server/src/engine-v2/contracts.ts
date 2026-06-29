export interface LayoutToken {
  text: string;
  pageIndex: number;
  blockIndex: number;
  lineIndex: number;
  tokenIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number | null;
  fontFamily: string | null;
  isBold: boolean;
  isItalic: boolean;
  isSuperscript: boolean;
}

export interface ReferenceBlock {
  id: string;
  tokens: LayoutToken[];
  rawText: string;
  confidence: number;
}

export interface BioSpan {
  field: string;
  startToken: number;
  endToken: number;
  text: string;
  confidence: number;
}

export interface ParsedReference {
  rawText: string;
  spans: BioSpan[];
  fields: Record<string, string | string[] | number | null>;
  parserMode: 'fast' | 'balanced' | 'accuracy';
  confidence: number;
}

export interface EngineV2Result {
  documentId: string;
  references: ParsedReference[];
  warnings: string[];
}
