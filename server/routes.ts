import type { Express } from "express";
import { createServer, type Server } from "http";
import { createRequire } from "module";
import multer from "multer";
import * as mammoth from "mammoth";

const require = createRequire(import.meta.url);
const pdfParseModule = require("pdf-parse");
const pdfParse: (buffer: Buffer) => Promise<{ text: string }> =
  typeof pdfParseModule === "function" ? pdfParseModule : (pdfParseModule?.default ?? pdfParseModule);
import { storage } from "./storage";
import reportsRouter from "./routes/reports";
import { conversionRequestSchema, normalizeCitationStyle, type ConversionResponse, type CitationStyle, type ConvertedReference, type AuthorityStatus } from "@shared/schema";
import { CitationParser } from "./services/citationParser";
import { formatCSLData, parsedReferenceToCSL, initCSLStyles } from "./services/cslConverter";
import { fixFormatting, runAssertions, type AssertionResult } from "./services/strictRenderer";
import { getAuthorityData } from "../shared/authorityLookup";
import { calculateConfidence } from "../shared/confidence";
import { hasAuthorInitialsOnly } from "./utils/authorResolution";
import { clusterCitations } from "../shared/clustering";
import { computeWorkKey } from "./utils/workKey";
import { toRawReferenceText } from "@shared/types/textBrands";

export async function registerRoutes(app: Express): Promise<Server> {
  const citationParser = new CitationParser();

  // Initialize CSL styles at startup
  initCSLStyles();

  // Configure multer for file uploads
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
  });

  app.use("/api/reports", reportsRouter);

  // Safety: max reference length to avoid ReDoS on dynamic patterns
  const MAX_REF_LENGTH = 4000;

  // Convert citations endpoint
  app.post("/api/convert", async (req, res) => {
    try {
      const validatedData = conversionRequestSchema.parse(req.body);
      const { references, inputStyle, outputStyle } = validatedData;
      const outputStyleInternal = normalizeCitationStyle(outputStyle);

      const convertedReferences: ConvertedReference[] = [];
      const errors: string[] = [];

      // Pro extraction parameters
      const enrichWithAuthority = validatedData.enrichWithAuthority;

      for (let i = 0; i < references.length; i++) {
        const rawRef = toRawReferenceText(references[i].trim());
        if (!rawRef) continue;
        if (rawRef.length > MAX_REF_LENGTH) {
          errors.push(`Reference ${i + 1} exceeds ${MAX_REF_LENGTH} character limit — skipped for safety.`);
          continue;
        }

        try {
          // Pre-normalize once so detect and parse see the same string
          const normalized = citationParser.preNormalize(rawRef);
          if (!normalized) continue;

          // Detect style if auto-detection is requested; soft-fail with fallback instead of hard skip
          let detectedStyle = inputStyle;
          let styleDetectionFailed = false;
          if (inputStyle === 'auto') {
            const detected = citationParser.detectStyle(normalized);
            if (detected) {
              detectedStyle = detected;
            } else {
              detectedStyle = 'apa'; // fallback to APA-ish stub
              styleDetectionFailed = true;
              errors.push(`Could not detect citation style for reference ${i + 1} — converted as best-guess stub`);
            }
          }

          // Parse the reference (same normalized text)
          const { parsed: parsedData, patternHits } = citationParser.parseReference(normalized, detectedStyle as any);
          (parsedData as any)._inputHadLocator = /\bpp?\.?\s*[A-Z]?\d|\bArt(?:icle)?\.?\s*(?:no\.?\s*)?[A-Z]?\d|\b\d+\(\d+\)\s*:\s*[A-Z]?\d|\bS\d+(?:[-–]S?\d+)?\b/i.test(normalized);
          (parsedData as any).rawInput = rawRef;

          // Determine reference type
          const referenceType = citationParser.determineReferenceType(parsedData);

          // Canonical work key for clustering, storage, and cache
          const workKey = computeWorkKey(parsedData);

          // Build CSL-JSON from our parser output
          let cslData = parsedReferenceToCSL(parsedData, referenceType, `ref${i} `);

          // Format using CSL engine
          // Pass includeDoi=false as we stripped DOI functionality
          const rawConvertedText = formatCSLData(cslData, outputStyleInternal as any, { includeDoi: false });

          // Apply Strict Renderer post-processing (Harvard, APA, IEEE, Chicago, MLA, Vancouver)
          const convertedText = fixFormatting(outputStyleInternal, rawConvertedText, parsedData);
          const assertionResult: AssertionResult = runAssertions(outputStyleInternal, convertedText, parsedData);
          let warnings = assertionResult.warnings;
          const parseWarnings = (parsedData.parseWarnings ?? []).map((w: string) => `parse: ${w}`);
          if (parseWarnings.length > 0) warnings = [...parseWarnings, ...warnings];
          const { assertionSummary, assertionHighlights } = assertionResult;
          if (styleDetectionFailed) {
            warnings = [`warning: Style could not be detected; output is a best-guess stub.`, ...warnings];
          }

          // Confidence Grader execution
          // Translate warnings into a 0-100 base rule score (deduct for missing fields or critical formatting breaks)
          let baseRulesScore = 100;
          for (let w of warnings) {
            if (w.startsWith('error:')) baseRulesScore -= 30;
            else if (w.startsWith('warning:')) baseRulesScore -= 15;
          }
          baseRulesScore = Math.max(0, baseRulesScore);

          let authorityData: import("@shared/schema").AuthorityData | undefined;
          let authorityStatus: AuthorityStatus = 'none';

          if (!validatedData.isPro) {
            authorityStatus = 'blocked';
          } else if (!enrichWithAuthority) {
            authorityStatus = 'skipped';
          } else {
            const result = await getAuthorityData(parsedData);
            authorityStatus = result.status;
            if (result.data) authorityData = result.data;
          }

          // Generate Confidence Object
          const confidence = calculateConfidence(parsedData, baseRulesScore, authorityData);

          // Store the conversion internally
          const storedReference = await storage.createReference({
            originalText: rawRef,
            inputStyle: detectedStyle,
            outputStyle,
            parsedData,
            convertedText,
            referenceType,
            confidenceScore: confidence.score,
            workKey,
            patternHits,
            authorityStatus,
          });

          convertedReferences.push({
            id: storedReference.id.toString(),
            originalText: rawRef,
            convertedText,
            referenceType,
            parsedData,
            inputStyle: detectedStyle as any,
            outputStyle,
            warnings,
            confidence,
            authorityData,
            patternHits,
            authorityStatus,
            workKey,
            styleDetectionFailed,
            assertionSummary,
            assertionHighlights,
            authorInitialsOnly: hasAuthorInitialsOnly(parsedData),
          });

        } catch (error) {
          console.error(`Error processing reference ${i + 1}: `, error);
          errors.push(`Error processing reference ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'} `);
        }
      }

      // Execute Clustering (Similarity Grouping) on the batched set
      const clusters = clusterCitations(convertedReferences, 80);

      const response: ConversionResponse = {
        convertedReferences,
        clusters: clusters.length > 0 ? clusters : undefined,
        errors: errors.length > 0 ? errors : undefined,
      };

      res.json(response);
    } catch (error) {
      console.error('Validation error:', error);
      res.status(400).json({
        message: "Invalid request data",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Export endpoints
  app.post("/api/export/txt", async (req, res) => {
    try {
      const { references } = req.body;
      if (!Array.isArray(references)) {
        return res.status(400).json({ message: "References array is required" });
      }

      const isIEEE = references[0]?.outputStyle === "ieee";
      const textContent = references.map((ref, index) => {
        let text = ref.convertedText;
        if (isIEEE && /^\[\d+\]\s*/.test(text)) {
          text = text.replace(/^\[\d+\]\s*/, `[${index + 1}] `);
        }
        return text;
      }).join('\n');

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', 'attachment; filename="references.txt"');
      res.send(textContent);
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ message: "Export failed" });
    }
  });

  app.post("/api/export/bibtex", async (req, res) => {
    try {
      const { references } = req.body;
      if (!Array.isArray(references)) {
        return res.status(400).json({ message: "References array is required" });
      }

      // Convert to BibTeX format
      const bibtexContent = references.map((ref, index) => {
        const key = `ref${index + 1} `;
        const type = ref.referenceType === 'journal' ? 'article' :
          ref.referenceType === 'book' ? 'book' : 'misc';

        let bibtex = `@${type} {${key}, \n`;
        if (ref.parsedData.title) bibtex += `  title = {${ref.parsedData.title.replace(/\n/g, ' ').trim()}}, \n`;
        if (ref.parsedData.authors) bibtex += `  author = { ${ref.parsedData.authors.join(' and ')}}, \n`;
        if (ref.parsedData.year) bibtex += `  year = { ${ref.parsedData.year}}, \n`;
        if (ref.parsedData.journal) bibtex += `  journal = { ${ref.parsedData.journal}}, \n`;
        if (ref.parsedData.volume) bibtex += `  volume = { ${ref.parsedData.volume}}, \n`;
        if (ref.parsedData.issue) bibtex += `  number = { ${ref.parsedData.issue}}, \n`;
        if (ref.parsedData.pages) bibtex += `  pages = { ${ref.parsedData.pages}}, \n`;
        if (ref.parsedData.publisher) bibtex += `  publisher = { ${ref.parsedData.publisher}}, \n`;
        if (ref.parsedData.doi) bibtex += `  doi = { ${ref.parsedData.doi}}, \n`;
        bibtex += '}';

        return bibtex;
      }).join('\n\n');

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', 'attachment; filename="references.bib"');
      res.send(bibtexContent);
    } catch (error) {
      console.error('BibTeX export error:', error);
      res.status(500).json({ message: "BibTeX export failed" });
    }
  });

  app.post("/api/export/ris", async (req, res) => {
    try {
      const { references } = req.body;
      if (!Array.isArray(references)) {
        return res.status(400).json({ message: "References array is required" });
      }

      const risLines: string[] = [];
      for (let i = 0; i < references.length; i++) {
        const ref = references[i];
        const p = ref.parsedData || {};
        const type = ref.referenceType === "journal" ? "JOUR" :
          ref.referenceType === "book" ? "BOOK" :
            ref.referenceType === "conference" ? "CONF" : "JOUR";

        risLines.push(`TY  - ${type}`);
        if (p.authors && Array.isArray(p.authors)) {
          for (const a of p.authors) risLines.push(`AU  - ${a}`);
        } else if (p.authors) risLines.push(`AU  - ${p.authors}`);
        if (p.title) risLines.push(`TI  - ${p.title}`);
        if (p.journal) risLines.push(`JO  - ${p.journal}`);
        if (p.conferenceTitle) risLines.push(`T2  - ${p.conferenceTitle}`);
        if (p.bookTitle) risLines.push(`BT  - ${p.bookTitle}`);
        if (p.volume) risLines.push(`VL  - ${p.volume}`);
        if (p.issue) risLines.push(`IS  - ${p.issue}`);
        if (p.pages) {
          const m = p.pages.match(/^(\d+)[–-](\d+)$/);
          if (m) {
            risLines.push(`SP  - ${m[1]}`);
            risLines.push(`EP  - ${m[2]}`);
          } else risLines.push(`SP  - ${p.pages}`);
        }
        if ((p as any)['article-number']) risLines.push(`AN  - ${(p as any)['article-number']}`);
        if (p.year) risLines.push(`PY  - ${p.year}`);
        if (p.publisher) risLines.push(`PB  - ${p.publisher}`);
        if (p.doi) risLines.push(`DO  - ${p.doi}`);
        if (p.url) risLines.push(`UR  - ${p.url}`);
        risLines.push("ER  - ");
        risLines.push("");
      }

      const risContent = risLines.join("\n").trimEnd();
      res.setHeader('Content-Type', 'application/x-research-info-systems');
      res.setHeader('Content-Disposition', 'attachment; filename="references.ris"');
      res.send(risContent);
    } catch (error) {
      console.error('RIS export error:', error);
      res.status(500).json({ message: "RIS export failed" });
    }
  });

  // Recheck authority for a single reference (Pro; optionally bypass cache)
  app.post("/api/recheck", async (req, res) => {
    try {
      const { referenceId, force } = req.body as { referenceId?: string; workKey?: string; force?: boolean };
      const id = referenceId != null ? parseInt(String(referenceId), 10) : NaN;
      if (isNaN(id) || id < 1) {
        return res.status(400).json({ message: "referenceId (number) is required" });
      }
      const ref = await storage.getReference(id);
      if (!ref?.parsedData) {
        return res.status(404).json({ message: "Reference not found" });
      }
      const result = await getAuthorityData(ref.parsedData, { force: !!force });
      const authorityData = result.data ?? undefined;
      const authorityStatus = result.status;
      const confidence = calculateConfidence(ref.parsedData, 100, authorityData); // assume full rules score for recheck
      res.json({ authorityData, authorityStatus, confidence });
    } catch (error) {
      console.error("Recheck error:", error);
      res.status(500).json({
        message: "Recheck failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // File parsing endpoint
  app.post("/api/parse-file", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const file = req.file;
      const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
      const mime = file.mimetype || '';
      let text = '';

      const isTxt = mime === 'text/plain' || ext === '.txt';
      const isPdf = mime === 'application/pdf' || ext === '.pdf';
      const isDocx =
        mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        ext === '.docx';

      if (isTxt) {
        text = file.buffer.toString('utf-8');
      } else if (isPdf) {
        const pdfData = await pdfParse(file.buffer);
        text = (pdfData && pdfData.text) ? pdfData.text : '';
      } else if (isDocx) {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        text = (result && result.value) ? result.value : '';
      } else {
        return res.status(400).json({
          error: 'File type not supported. Please upload a .txt, .pdf, or .docx file.'
        });
      }

      res.json({ text: (text || '').trim() });
    } catch (error) {
      console.error('File parsing error:', error);
      res.status(500).json({
        error: 'Failed to parse file',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Reformat endpoint: re-renders stored parsedData with a new output style
  // Powers the onStyleChange live hook without re-parsing from raw text
  app.post("/api/reformat", async (req, res) => {
    try {
      const { references, outputStyle } = req.body as {
        references: Array<{ id: string; parsedData: any; referenceType: string; originalText: string; inputStyle: string }>;
        outputStyle: string;
      };
      if (!Array.isArray(references) || !outputStyle) {
        return res.status(400).json({ message: "references[] and outputStyle are required" });
      }
      const outputStyleInternal = normalizeCitationStyle(outputStyle);

      const reformatted: ConvertedReference[] = [];

      for (const ref of references) {
        try {
          const cslData = parsedReferenceToCSL(ref.parsedData, ref.referenceType as any, ref.id);
          const rawText = formatCSLData(cslData, outputStyleInternal as any, { includeDoi: false });
          const convertedText = fixFormatting(outputStyleInternal, rawText, ref.parsedData);
          const assertionResult: AssertionResult = runAssertions(outputStyleInternal, convertedText, ref.parsedData);

          let baseRulesScore = 100;
          for (const w of assertionResult.warnings) {
            if (w.startsWith('error:')) baseRulesScore -= 30;
            else if (w.startsWith('warning:')) baseRulesScore -= 15;
          }
          baseRulesScore = Math.max(0, baseRulesScore);

          const confidence = calculateConfidence(ref.parsedData, baseRulesScore);

          reformatted.push({
            id: ref.id,
            originalText: ref.originalText,
            convertedText,
            referenceType: ref.referenceType as any,
            parsedData: ref.parsedData,
            inputStyle: ref.inputStyle,
            outputStyle,
            warnings: assertionResult.warnings,
            confidence,
            assertionSummary: assertionResult.assertionSummary,
            assertionHighlights: assertionResult.assertionHighlights,
            authorInitialsOnly: hasAuthorInitialsOnly(ref.parsedData),
          });
        } catch (error) {
          console.error(`Reformat error for ref ${ref.id}:`, error);
        }
      }

      res.json({ convertedReferences: reformatted });
    } catch (error) {
      console.error('Reformat error:', error);
      res.status(500).json({ message: "Reformat failed" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
