import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';
import type { ExportFormat } from '../engine/types/api.js';
import type { ProcessedCitation } from '../engine/types/citation.js';

export async function buildExportContent(
  format: ExportFormat,
  references: ProcessedCitation[],
): Promise<string | Buffer> {
  switch (format) {
    case 'txt':
      return buildTxtExport(references);
    case 'bib':
      return buildBibtexExport(references);
    case 'ris':
      return buildRisExport(references);
    case 'csv':
      return buildCsvExport(references);
    case 'docx':
      return buildDocxExport(references);
  }
}

export function contentTypeForFormat(format: ExportFormat): string {
  switch (format) {
    case 'txt':
      return 'text/plain; charset=utf-8';
    case 'bib':
      return 'application/x-bibtex; charset=utf-8';
    case 'ris':
      return 'application/x-research-info-systems; charset=utf-8';
    case 'csv':
      return 'text/csv; charset=utf-8';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
}

export function buildTxtExport(references: ProcessedCitation[]): string {
  return references.map((reference) => reference.renderedText || reference.raw).join('\n');
}

function buildBibtexExport(references: ProcessedCitation[]): string {
  return references.map((reference, index) => {
    const key = bibtexKey(reference, index);
    const fields = [
      fieldLine('title', reference.fields.title.value),
      fieldLine('author', authorsPlain(reference)),
      fieldLine('year', reference.fields.year.value != null ? String(reference.fields.year.value) : null),
      fieldLine('journal', reference.fields.journal.value),
      fieldLine('publisher', reference.fields.publisher.value),
      fieldLine('url', reference.fields.url.value),
      fieldLine('doi', reference.fields.doi.value),
    ].filter(Boolean).join(',\n');

    return `@${bibtexType(reference.referenceType)}{${key},\n${fields}\n}`;
  }).join('\n\n');
}

function buildRisExport(references: ProcessedCitation[]): string {
  return references.map((reference) => {
    const lines = [
      `TY  - ${risType(reference.referenceType)}`,
      ...reference.fields.authors.value.map((author) => `AU  - ${author.isCorporate ? author.literal ?? author.family : `${author.family}, ${author.given ?? author.initials ?? ''}`}`),
      `TI  - ${reference.fields.title.value ?? 'Untitled reference'}`,
      ...(reference.fields.journal.value ? [`JO  - ${reference.fields.journal.value}`] : []),
      ...(reference.fields.year.value != null ? [`PY  - ${reference.fields.year.value}`] : []),
      ...(reference.fields.url.value ? [`UR  - ${reference.fields.url.value}`] : []),
      ...(reference.fields.doi.value ? [`DO  - ${reference.fields.doi.value}`] : []),
      'ER  -',
    ];
    return lines.join('\n');
  }).join('\n\n');
}

function buildCsvExport(references: ProcessedCitation[]): string {
  const header = ['id', 'status', 'type', 'authors', 'title', 'year', 'journal', 'doi', 'url', 'renderedText'];
  const rows = references.map((reference) => [
    reference.id,
    reference.publicStatus,
    reference.referenceType,
    authorsPlain(reference),
    reference.fields.title.value ?? '',
    reference.fields.year.value != null ? String(reference.fields.year.value) : '',
    reference.fields.journal.value ?? '',
    reference.fields.doi.value ?? '',
    reference.fields.url.value ?? '',
    reference.renderedText,
  ]);

  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

async function buildDocxExport(references: ProcessedCitation[]): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240, line: 480 },
          children: [
            new TextRun({
              text: 'References',
              font: 'Times New Roman',
              size: 24,
              bold: true,
            }),
          ],
        }),
        ...references.map((ref) =>
          new Paragraph({
            spacing: { line: 480 },
            indent: { left: 720, hanging: 720 },
            children: parseItalicRuns(ref.renderedText || ref.raw),
          }),
        ),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

/**
 * Splits rendered text on `*italic*` or legacy `_italic_` markers and
 * produces TextRun objects with `italics: true` for the marked segments.
 */
function parseItalicRuns(text: string): TextRun[] {
  const segments = splitItalicSegments(text);
  const runs: TextRun[] = [];

  for (const segment of segments) {
    if (!segment.text) continue;

    if (segment.italic) {
      runs.push(new TextRun({
        text: segment.text,
        font: 'Times New Roman',
        size: 24,
        italics: true,
      }));
    } else {
      runs.push(new TextRun({
        text: segment.text,
        font: 'Times New Roman',
        size: 24,
      }));
    }
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text, font: 'Times New Roman', size: 24 }));
  }

  return runs;
}

export function splitItalicSegments(text: string): Array<{ text: string; italic: boolean }> {
  const rawSegments = text.split(/(\*[^*]+\*|_[^_]+_)/g);
  const segments = rawSegments.flatMap((segment) => {
    if (!segment) return [];

    if (
      (segment.startsWith('*') && segment.endsWith('*') && segment.length > 2)
      || (segment.startsWith('_') && segment.endsWith('_') && segment.length > 2)
    ) {
      return [{ text: segment.slice(1, -1), italic: true }];
    }

    return [{ text: segment, italic: false }];
  });

  if (segments.length === 0) {
    return [{ text, italic: false }];
  }

  return segments;
}

function bibtexKey(reference: ProcessedCitation, index: number): string {
  const author = reference.fields.authors.value[0]?.family?.toLowerCase() ?? 'ref';
  const year = reference.fields.year.value ?? index + 1;
  return `${author}${year}`;
}

function bibtexType(type: ProcessedCitation['referenceType']): string {
  switch (type) {
    case 'article-journal':
      return 'article';
    case 'conference-paper':
      return 'inproceedings';
    case 'book-chapter':
      return 'incollection';
    case 'webpage':
      return 'misc';
    default:
      return 'misc';
  }
}

function risType(type: ProcessedCitation['referenceType']): string {
  switch (type) {
    case 'article-journal':
      return 'JOUR';
    case 'book':
      return 'BOOK';
    case 'book-chapter':
      return 'CHAP';
    case 'conference-paper':
      return 'CPAPER';
    case 'thesis':
      return 'THES';
    case 'report':
      return 'RPRT';
    case 'dataset':
      return 'DATA';
    case 'webpage':
      return 'ELEC';
    default:
      return 'GEN';
  }
}

function authorsPlain(reference: ProcessedCitation): string {
  return reference.fields.authors.value
    .map((author) => author.isCorporate ? author.literal ?? author.family : `${author.family}, ${author.given ?? author.initials ?? ''}`.trim())
    .join(' and ');
}

function fieldLine(name: string, value: string | null): string | null {
  if (!value) return null;
  return `  ${name} = {${value}}`;
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
