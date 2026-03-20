/**
 * Reports Router — Community failure reporting + admin review API
 *
 * Public endpoints:
 *   POST /api/reports          — Submit a user failure report
 *
 * Admin endpoints:
 *   GET  /api/reports          — List all reports (with optional status filter)
 *   GET  /api/reports/grouped  — Grouped failures sorted by frequency
 *   GET  /api/reports/:id      — Single report detail
 *   PATCH /api/reports/:id     — Update report fields (status, fixType, proposedPattern, etc.)
 *   POST /api/reports/:id/accept    — Accept fix → write pattern + mark accepted
 *   POST /api/reports/:id/reject    — Mark rejected with reason
 *   POST /api/reports/:id/duplicate — Mark as duplicate
 *   POST /api/reports/:id/add-to-stress — Add raw input to stress test corpus
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import type {
  CitationReport,
  ReportStatus,
  FailureCategory,
  FixType,
  ApprovedCanonicalFields,
  FieldApprovalMap,
} from "@shared/schema";
import {
  saveReport,
  loadReports,
  updateReport,
  getReportById,
  getGroupedReports,
  addToStressTest,
  computeFingerprint,
  hashIP,
  checkRateLimit,
} from "../store/reportStore.js";
import { saveTruth } from "../store/truthStore.js";
import { writePattern } from "../utils/patternWriter.js";
import { requireAdmin } from "../utils/adminAuth.js";

// ── Validation constants ──

const VALID_CATEGORIES: FailureCategory[] = [
  "author",
  "style-detection",
  "reference-type",
  "venue",
  "locator",
  "title",
  "year",
  "other",
];

/** Backward-compatible: map old category strings to new enum */
const LEGACY_CATEGORY_MAP: Record<string, FailureCategory> = {
  "Year missing or incorrect": "year",
  "Author name incorrect": "author",
  "Title missing or incorrect": "title",
  "Journal / venue incorrect": "venue",
  "Pages missing or incorrect": "locator",
  "Wrong citation style detected": "style-detection",
  "Other...": "other",
};

const VALID_STATUSES: ReportStatus[] = ["pending", "proposed", "accepted", "rejected", "duplicate"];

const VALID_FIX_TYPES: FixType[] = ["dynamic-pattern", "parser-logic", "scoring-tweak", "renderer-fix", "type-correction", "other-fix"];

// ── Router ──

const router: Router = Router();

/**
 * POST /api/reports — User submission
 * Accepts both old-format fields (rawInput, userCategory) and new-format fields.
 */
router.post("/", (req, res) => {
  try {
    const body = req.body as {
      // New fields
      originalText?: string;
      detectedStyle?: string;
      outputStyle?: string;
      convertedText?: string;
      failureCategory?: string;
      userNote?: string;
      parsedData?: any;
      referenceType?: string;
      confidence?: number;
      originalEngineOutput?: CitationReport["originalEngineOutput"];
      // Legacy fields (backward compat)
      rawInput?: string;
      detectedInputStyle?: string;
      targetStyle?: string;
      convertedOutput?: string;
      userCategory?: string;
    };

    // Normalize: accept both old and new field names
    const originalText = (body.originalText || body.rawInput || "").trim();
    const detectedStyle = (body.detectedStyle || body.detectedInputStyle || "").trim();
    const outputStyle = (body.outputStyle || body.targetStyle || "").trim();
    const convertedText = (body.convertedText || body.convertedOutput || "").trim();
    const rawCategory = body.failureCategory || body.userCategory || "";
    const userNote = body.userNote;

    // Validate required fields
    if (!originalText) {
      return res.status(400).json({ message: "originalText (or rawInput) is required" });
    }
    if (!convertedText) {
      return res.status(400).json({ message: "convertedText (or convertedOutput) is required" });
    }

    // Map category
    let failureCategory: FailureCategory;
    if (VALID_CATEGORIES.includes(rawCategory as FailureCategory)) {
      failureCategory = rawCategory as FailureCategory;
    } else if (LEGACY_CATEGORY_MAP[rawCategory]) {
      failureCategory = LEGACY_CATEGORY_MAP[rawCategory];
    } else {
      failureCategory = "other";
    }

    // Validate user note length
    if (userNote != null && (typeof userNote !== "string" || userNote.length > 500)) {
      return res.status(400).json({ message: "userNote must be a string with max 500 characters" });
    }

    // Rate limiting
    const clientIP = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      || req.socket.remoteAddress
      || "unknown";
    const ipHashed = hashIP(clientIP);
    const rateCheck = checkRateLimit(ipHashed);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        message: "Rate limit exceeded. Maximum 10 reports per day.",
        remaining: 0,
      });
    }

    const fingerprint = computeFingerprint(originalText);

    const report: CitationReport = {
      id: randomUUID(),
      source: "user",
      originalText,
      detectedStyle,
      outputStyle,
      parsedData: body.parsedData,
      referenceType: body.referenceType as any,
      convertedText,
      confidence: body.confidence,
      failureCategory,
      userNote: userNote?.trim() || undefined,
      status: "pending",
      createdAt: new Date().toISOString(),
      fingerprint,
      reportCount: 1,
      ipHash: ipHashed,
      originalEngineOutput: body.originalEngineOutput ?? {
        convertedText,
        parsedData: body.parsedData,
        referenceType: body.referenceType as any,
        confidence: body.confidence,
      },
    };

    const saved = saveReport(report);

    return res.json({
      success: true,
      id: saved.id,
      deduplicated: saved.id !== report.id, // true if merged into existing
      remaining: rateCheck.remaining,
    });
  } catch (err) {
    console.error("POST /api/reports error:", err instanceof Error ? err.message : String(err));
    return res.status(500).json({ message: "Failed to save report" });
  }
});

router.use(requireAdmin);

/**
 * GET /api/reports — List all reports
 * Query params: ?status=pending&source=user
 */
router.get("/", (_req, res) => {
  try {
    let reports = loadReports();
    const { status, source } = _req.query;
    if (status && typeof status === "string") {
      reports = reports.filter((r) => r.status === status);
    }
    if (source && typeof source === "string") {
      reports = reports.filter((r) => r.source === source);
    }
    return res.json(reports);
  } catch (err) {
    console.error("GET /api/reports error:", err instanceof Error ? err.message : String(err));
    return res.status(500).json({ message: "Failed to load reports" });
  }
});

/**
 * GET /api/reports/grouped — Grouped failures sorted by frequency
 * Query params: ?status=pending
 */
router.get("/grouped", (_req, res) => {
  try {
    const status = _req.query.status as ReportStatus | undefined;
    const groups = getGroupedReports(
      status && VALID_STATUSES.includes(status) ? status : undefined
    );
    return res.json(groups);
  } catch (err) {
    console.error("GET /api/reports/grouped error:", err instanceof Error ? err.message : String(err));
    return res.status(500).json({ message: "Failed to load grouped reports" });
  }
});

/**
 * GET /api/reports/:id — Single report
 */
router.get("/:id", (req, res) => {
  try {
    const report = getReportById(req.params.id);
    if (!report) return res.status(404).json({ message: "Report not found" });
    return res.json(report);
  } catch (err) {
    console.error("GET /api/reports/:id error:", err instanceof Error ? err.message : String(err));
    return res.status(500).json({ message: "Failed to load report" });
  }
});

/**
 * PATCH /api/reports/:id — Update report fields
 * Body can include: status, fixType, proposedPattern, proposedStyleFix, verifiedBy
 */
router.patch("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      fixType,
      proposedPattern,
      proposedStyleFix,
      verifiedBy,
      failureCategory,
      referenceType,
    } = req.body as Partial<CitationReport>;

    const updates: Partial<CitationReport> = {};

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(", ")}` });
      }
      updates.status = status;
      if (status === "accepted" || status === "rejected") {
        updates.resolvedAt = new Date().toISOString();
      }
    }

    if (fixType) {
      if (!VALID_FIX_TYPES.includes(fixType)) {
        return res.status(400).json({ message: `fixType must be one of: ${VALID_FIX_TYPES.join(", ")}` });
      }
      updates.fixType = fixType;
    }

    if (proposedPattern !== undefined) updates.proposedPattern = proposedPattern;
    if (proposedStyleFix !== undefined) updates.proposedStyleFix = proposedStyleFix;
    if (verifiedBy !== undefined) updates.verifiedBy = verifiedBy;
    if (failureCategory && VALID_CATEGORIES.includes(failureCategory)) {
      updates.failureCategory = failureCategory;
    }
    if (referenceType) updates.referenceType = referenceType;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const updated = updateReport(id, updates);
    if (!updated) return res.status(404).json({ message: "Report not found" });

    return res.json({ success: true, report: updated });
  } catch (err) {
    console.error("PATCH /api/reports/:id error:", err instanceof Error ? err.message : String(err));
    return res.status(500).json({ message: "Failed to update report" });
  }
});

/**
 * POST /api/reports/:id/accept — Accept a fix
 * If fixType is "dynamic-pattern" and proposedPattern exists, writes to patterns.json.
 * Otherwise just marks as accepted (code changes handled manually).
 */
router.post("/:id/accept", (req, res) => {
  try {
    const { id } = req.params;
    const report = getReportById(id);
    if (!report) return res.status(404).json({ message: "Report not found" });

    // If dynamic-pattern fix, write the pattern
    if (report.fixType === "dynamic-pattern" && report.proposedPattern) {
      const result = writePattern(report.proposedPattern);
      if (!result.success) {
        return res.status(400).json({
          message: `Pattern write failed: ${result.error}`,
          patternError: true,
        });
      }
    }

    const updated = updateReport(id, {
      status: "accepted",
      resolvedAt: new Date().toISOString(),
      verifiedBy: req.body.verifiedBy || "admin",
      referenceType: req.body.referenceType || report.referenceType,
      fixType: req.body.fixType || report.fixType,
    });

    // Also add to stress test corpus
    if (report.originalText) {
      try { addToStressTest(report.originalText); } catch { /* non-fatal */ }
    }

    return res.json({
      success: true,
      report: updated,
      patternWritten: report.fixType === "dynamic-pattern" && !!report.proposedPattern,
    });
  } catch (err) {
    console.error("POST /api/reports/:id/accept error:", err instanceof Error ? err.message : String(err));
    return res.status(500).json({ message: "Failed to accept report" });
  }
});

/**
 * POST /api/reports/:id/resolve — Master Resolution (handles everything: Type, Pattern, Truth)
 */
router.post("/:id/resolve", (req, res) => {
  try {
    const { id } = req.params;
    const { 
        fixType, 
        referenceType, 
        proposedPattern, 
        proposedStyleFix, 
        verifiedBy,
        saveAsTruth,
        correctedFields,
        fieldApproval,
        failureTaxonomy,
        stageBlame,
        duplicateDecision
    } = req.body as Partial<CitationReport> & {
      saveAsTruth?: boolean;
      correctedFields?: ApprovedCanonicalFields;
      fieldApproval?: FieldApprovalMap;
      failureTaxonomy?: string[];
      stageBlame?: string[];
      duplicateDecision?: CitationReport["duplicateDecision"];
    };
    
    const report = getReportById(id);
    if (!report) return res.status(404).json({ message: "Report not found" });

    const updates: Partial<CitationReport> = {
        status: "accepted",
        resolvedAt: new Date().toISOString(),
        verifiedBy: verifiedBy || "admin"
    };

    // 1. Handle Reference Type / Category Fix
    if (referenceType) updates.referenceType = referenceType;
    if (fixType) updates.fixType = fixType;
    if (correctedFields) updates.correctedFields = correctedFields;
    if (fieldApproval) updates.fieldApproval = fieldApproval;
    if (failureTaxonomy) updates.failureTaxonomy = failureTaxonomy.filter(Boolean);
    if (stageBlame) updates.stageBlame = stageBlame.filter(Boolean);
    if (duplicateDecision) updates.duplicateDecision = duplicateDecision;

    // 2. Handle Dynamic Pattern Writing
    if (fixType === "dynamic-pattern" && proposedPattern) {
      const result = writePattern(proposedPattern);
      if (!result.success) {
        return res.status(400).json({ message: `Pattern write failed: ${result.error}`, patternError: true });
      }
      updates.proposedPattern = proposedPattern;
    }

    // 3. Handle Style Fix / Truth Store
    if (proposedStyleFix) {
        updates.proposedStyleFix = proposedStyleFix;
        if (saveAsTruth) {
            saveTruth({
                fingerprint: computeFingerprint(report.originalText),
                originalText: report.originalText,
                outputStyle: report.outputStyle,
                validatedOutput: proposedStyleFix,
                validatedBy: verifiedBy || "admin",
                correctedFields,
                fieldApproval,
                failureTaxonomy: failureTaxonomy?.filter(Boolean),
                stageBlame: stageBlame?.filter(Boolean),
                duplicateDecision,
                originalEngineOutput: report.originalEngineOutput ?? {
                  convertedText: report.convertedText,
                  parsedData: report.parsedData,
                  referenceType: report.referenceType,
                  confidence: report.confidence,
                },
            });
        }
    }

    // 4. Final Updates & Add to Stress Test
    const updated = updateReport(id, updates);
    if (report.originalText) {
        try { addToStressTest(report.originalText); } catch { /* non-fatal */ }
    }

    return res.json({ success: true, report: updated });
  } catch (err) {
    console.error("POST /api/reports/:id/resolve error:", err instanceof Error ? err.message : String(err));
    return res.status(500).json({ message: "Failed to resolve report" });
  }
});
router.post("/:id/reject", (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body as { reason?: string };

    const updates: Partial<CitationReport> = {
      status: "rejected",
      resolvedAt: new Date().toISOString(),
    };
    if (reason) {
      updates.proposedStyleFix = `Rejected: ${reason}`;
    }

    const updated = updateReport(id, updates);
    if (!updated) return res.status(404).json({ message: "Report not found" });

    return res.json({ success: true });
  } catch (err) {
    console.error("POST /api/reports/:id/reject error:", err instanceof Error ? err.message : String(err));
    return res.status(500).json({ message: "Failed to reject report" });
  }
});

/**
 * POST /api/reports/:id/duplicate — Mark as duplicate
 */
router.post("/:id/duplicate", (req, res) => {
  try {
    const updated = updateReport(req.params.id, {
      status: "duplicate",
      resolvedAt: new Date().toISOString(),
    });
    if (!updated) return res.status(404).json({ message: "Report not found" });
    return res.json({ success: true });
  } catch (err) {
    console.error("POST /api/reports/:id/duplicate error:", err instanceof Error ? err.message : String(err));
    return res.status(500).json({ message: "Failed to mark as duplicate" });
  }
});

/**
 * POST /api/reports/:id/add-to-stress — Add to stress test corpus
 */
router.post("/:id/add-to-stress", (req, res) => {
  try {
    const report = getReportById(req.params.id);
    if (!report) return res.status(404).json({ message: "Report not found" });
    addToStressTest(report.originalText);
    return res.json({ success: true });
  } catch (err) {
    console.error("POST /api/reports/:id/add-to-stress error:", err instanceof Error ? err.message : String(err));
    return res.status(500).json({ message: "Failed to add to stress test" });
  }
});

export default router;
