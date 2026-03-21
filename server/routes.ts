import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import * as mammoth from "mammoth";
import * as pdfParseModule from "pdf-parse-new";
const pdfParse: (buffer: Buffer) => Promise<{ text: string }> =
  typeof pdfParseModule === "function" ? pdfParseModule : (pdfParseModule?.default ?? pdfParseModule);
import { storage } from "./storage";
import reportsRouter from "./routes/reports";
import v2Router from "./routes/v2";
import { conversionRequestSchema, contactRequestSchema, waitlistRequestSchema, type ConvertedReference, type ConversionResponse, type DuplicateGroup } from "@shared/schema";
import { processReferences, reformatReferences, initCSLStyles } from "./engine/index";
import { processV2Conversion } from "./engine/v2/index.js";
import { mapV2ResponseToLegacyRecords } from "./engine/v2/compat.js";
import { getAuthorityData } from "../shared/authorityLookup";
import { calculateConfidence } from "../shared/confidence";
import { sendContactAutoReply, sendContactNotification, sendWaitlistAutoReply, sendWaitlistNotification } from "./utils/email";
import {
  checkAdminLoginRateLimit,
  clearAdminLoginFailures,
  clearAdminSessionCookie,
  getAdminSessionStatus,
  isAdminAuthConfigured,
  recordFailedAdminLogin,
  setAdminSessionCookie,
  verifyAdminPassword,
} from "./utils/adminAuth.js";

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize CSL styles at startup
  initCSLStyles();

  // Configure multer for file uploads
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
  });

  app.get("/api/admin/session", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(getAdminSessionStatus(req));
  });

  app.post("/api/admin/login", (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    const { password } = req.body as { password?: unknown };
    if (typeof password !== "string" || password.trim().length === 0) {
      return res.status(400).json({ message: "Password is required." });
    }

    if (!isAdminAuthConfigured()) {
      return res.status(503).json({
        message: "Admin access is not configured. Add ADMIN_PASSWORD and ADMIN_SESSION_SECRET.",
      });
    }

    const rateLimit = checkAdminLoginRateLimit(req);
    if (!rateLimit.allowed) {
      res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      return res.status(429).json({
        message: "Too many login attempts. Please try again later.",
      });
    }

    if (!verifyAdminPassword(password)) {
      recordFailedAdminLogin(req);
      return res.status(401).json({ message: "Invalid credentials." });
    }

    clearAdminLoginFailures(req);
    setAdminSessionCookie(req, res);
    return res.json({ success: true });
  });

  app.post("/api/admin/logout", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    clearAdminLoginFailures(req);
    clearAdminSessionCookie(req, res);
    res.json({ success: true });
  });

  app.use("/api/reports", reportsRouter);
  app.use("/api/v2", v2Router);

  // Convert citations endpoint — thin wrapper around engine pipeline
  app.post("/api/convert", async (req, res) => {
    try {
      const validatedData = conversionRequestSchema.parse(req.body);
      const envUseV2Engine = !/^(0|false|no|off)$/i.test(process.env.USE_V2_ENGINE ?? 'true');
      const useV2Engine = validatedData.engineVersion === 'v2'
        ? true
        : validatedData.engineVersion === 'v1'
          ? false
          : envUseV2Engine;

      if (!useV2Engine) {
        const pipelineResult = await processReferences(validatedData.references, {
          inputStyle: validatedData.inputStyle,
          outputStyle: validatedData.outputStyle,
          enrichWithAuthority: validatedData.enrichWithAuthority,
          isPro: validatedData.isPro,
        });

        const storedRefs = await storage.createReferences(
          pipelineResult.storageData.map(({ _uiData, ...record }) => record)
        );

        const convertResults: ConvertedReference[] = pipelineResult.storageData.map((record, idx) => ({
          ...record._uiData,
          id: storedRefs[idx].id.toString(),
        }));

        const response: ConversionResponse = {
          convertedReferences: convertResults,
          clusters: pipelineResult.clusters,
          duplicateGroups: [],
          engineVersion: 'v1',
          errors: pipelineResult.errors.length > 0 ? pipelineResult.errors : undefined,
        };

        return res.json(response);
      }

      const sourceContent = validatedData.references.join("\n\n");
      const { response: v2Response } = await processV2Conversion({
        sourceType: 'text',
        content: sourceContent,
        inputStyle: validatedData.inputStyle,
        outputStyle: validatedData.outputStyle,
        enrich: validatedData.enrichWithAuthority && validatedData.isPro,
        dedup: true,
        group: false,
        debug: false,
      }, {
        executionMode: 'sync',
      });

      const legacyRecords = mapV2ResponseToLegacyRecords(v2Response, {
        inputStyle: validatedData.inputStyle,
        outputStyle: validatedData.outputStyle,
      });

      const storedRefs = await storage.createReferences(
        legacyRecords.map((record) => record.storageData)
      );

      const convertResults: ConvertedReference[] = legacyRecords.map((record, idx) => ({
        ...record.uiData,
        id: storedRefs[idx].id.toString(),
      }));
      const uiRecordBySourceId = new Map(
        legacyRecords.map((record, idx) => [record.sourceId, convertResults[idx]])
      );
      const duplicateGroups: DuplicateGroup[] = v2Response.citations
        .filter((citation) => citation.status === 'merged' && citation.duplicate?.mergedFrom?.length)
        .map((citation) => {
          const members = (citation.duplicate?.mergedFrom ?? [])
            .map((sourceId) => uiRecordBySourceId.get(sourceId))
            .filter((member): member is ConvertedReference => Boolean(member));
          const primarySourceId =
            v2Response.duplicates.find((entry) => entry.mergedId === citation.id)?.originalId
            ?? citation.duplicate?.mergedFrom?.[0]
            ?? '';
          const primaryId = uiRecordBySourceId.get(primarySourceId)?.id ?? members[0]?.id ?? '';
          return {
            groupId: citation.id,
            primaryId,
            method: citation.duplicate?.method ?? 'structural',
            members,
          };
        })
        .filter((group) => group.members.length > 1 && Boolean(group.primaryId));

      const response: ConversionResponse = {
        convertedReferences: convertResults,
        clusters: undefined,
        duplicateGroups,
        engineVersion: 'v2',
        errors: undefined,
      };

      res.json(response);
    } catch (error) {
      console.error('Validation error:', error instanceof Error ? error.message : String(error));
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

  // Reformat endpoint: thin wrapper around engine pipeline
  app.post("/api/reformat", async (req, res) => {
    try {
      const { references, outputStyle } = req.body as {
        references: Array<{ id: string; parsedData: any; referenceType: string; originalText: string; inputStyle: string }>;
        outputStyle: string;
      };
      if (!Array.isArray(references) || !outputStyle) {
        return res.status(400).json({ message: "references[] and outputStyle are required" });
      }

      const reformatResults = reformatReferences(references, outputStyle);
      res.json({ convertedReferences: reformatResults });
    } catch (error) {
      console.error('Reformat error:', error);
      res.status(500).json({ message: "Reformat failed" });
    }
  });

  // Contact/Feedback endpoint
  app.post("/api/contact", async (req, res) => {
    try {
      const { name, email, subject, message } = contactRequestSchema.parse(req.body);

      console.log(`[ContactForm] New message from ${name} (${email}) - [${subject}]`);
      console.log(`Message: ${message}`);

      const notificationResult = await sendContactNotification({ name, email, subject, message });

      if (!notificationResult.success) {
        console.error("[routes] Contact notification failed:", notificationResult.error ?? "Unknown email error");
        return res.status(502).json({
          message: "Message could not be delivered",
          error: notificationResult.error ?? "Email provider rejected the request",
        });
      }

      sendContactAutoReply({ name, email, subject }).catch((err) => {
        console.error("[routes] Contact auto-reply failed:", err instanceof Error ? err.message : String(err));
      });

      res.json({ success: true, message: "Your message has been received." });
    } catch (error) {
      console.error('Contact error:', error);
      res.status(400).json({
        message: "Invalid contact form data",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.post("/api/waitlist", async (req, res) => {
    try {
      const { email, persona } = waitlistRequestSchema.parse(req.body);

      const notificationResult = await sendWaitlistNotification({ email, persona });

      if (!notificationResult.success) {
        console.error("[routes] Waitlist notification failed:", notificationResult.error ?? "Unknown email error");
        return res.status(502).json({
          message: "Waitlist signup could not be delivered",
          error: notificationResult.error ?? "Email provider rejected the request",
        });
      }

      sendWaitlistAutoReply({ email, persona }).catch((err) => {
        console.error("[routes] Waitlist auto-reply failed:", err instanceof Error ? err.message : String(err));
      });

      res.json({ success: true, message: "You've been added to the waitlist." });
    } catch (error) {
      console.error("Waitlist error:", error);
      res.status(400).json({
        message: "Invalid waitlist form data",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
