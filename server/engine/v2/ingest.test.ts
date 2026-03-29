import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import type { V2ConversionRequest } from '@shared/schema';
import { createIngestStage } from './stages/ingest.js';

async function createPdfBuffer(lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);

    if (lines.length === 0) {
      doc.addPage();
    } else {
      lines.forEach((line, index) => {
        doc.text(line);
        if (index < lines.length - 1) doc.moveDown();
      });
    }

    doc.end();
  });
}

function makeContext(request: V2ConversionRequest) {
  return {
    request,
    jobId: 'ingest-test-job',
    receivedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    executionMode: 'sync',
    debugEnabled: false,
    pipelineLog: [],
    stageTimings: [],
    stagesRun: [],
    fallbacksUsed: [],
    partialResult: false,
    partialReasons: [],
    jobDebug: {},
    workingChunkByCitationId: {},
    splitArtifactsByCitationId: {},
    llmBudget: {
      maxCalls: 0,
      totalCalls: 0,
      splitCalls: 0,
      extractCalls: 0,
      capReached: false,
    },
  } as any;
}

describe('v2 ingest PDF sources', () => {
  it('extracts the same raw text from pdf_base64 and pdf_file sources', async () => {
    const pdfBuffer = await createPdfBuffer([
      'Smith, J. (2020). The future of testing. Journal of Quality, 10(2), 11-19.',
    ]);
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'citing-pdf-ingest-'));
    const pdfPath = path.join(tmpDir, 'sample.pdf');
    await writeFile(pdfPath, pdfBuffer);

    try {
      const ingest = createIngestStage();
      const fromBase64 = await ingest.run(makeContext({
        sourceType: 'pdf_base64',
        content: pdfBuffer.toString('base64'),
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrich: false,
        dedup: false,
        group: false,
        debug: false,
      }));
      const fromFile = await ingest.run(makeContext({
        sourceType: 'pdf_file',
        content: pdfPath,
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrich: false,
        dedup: false,
        group: false,
        debug: false,
      }));

      expect(fromBase64.rawItems).toHaveLength(1);
      expect(fromFile.rawItems).toHaveLength(1);
      expect(fromFile.rawItems[0]).toBe(fromBase64.rawItems[0]);
      expect(fromFile.inputProfile?.estimatedCount ?? 0).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('surfaces pdf_no_text for blank PDFs regardless of transport', async () => {
    const pdfBuffer = await createPdfBuffer([]);
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'citing-pdf-ingest-'));
    const pdfPath = path.join(tmpDir, 'blank.pdf');
    await writeFile(pdfPath, pdfBuffer);

    try {
      const ingest = createIngestStage();

      await expect(ingest.run(makeContext({
        sourceType: 'pdf_base64',
        content: pdfBuffer.toString('base64'),
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrich: false,
        dedup: false,
        group: false,
        debug: false,
      }))).rejects.toThrow('pdf_no_text');

      await expect(ingest.run(makeContext({
        sourceType: 'pdf_file',
        content: pdfPath,
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrich: false,
        dedup: false,
        group: false,
        debug: false,
      }))).rejects.toThrow('pdf_no_text');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
