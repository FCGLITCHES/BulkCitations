import { Router } from "express";
import { randomUUID } from "crypto";
import {
  saveReport,
  loadReports,
  updateReportStatus,
  getReportById,
  addToStressTest,
  type CitationReport,
  type ReportStatus,
} from "../store/reportStore";

const REPORT_CATEGORIES = [
  "Year missing or incorrect",
  "Author name incorrect",
  "Title missing or incorrect",
  "Journal / venue incorrect",
  "Pages missing or incorrect",
  "Wrong citation style detected",
  "Other...",
] as const;

const router = Router();

router.post("/", (req, res) => {
  try {
    const body = req.body as {
      rawInput: string;
      detectedInputStyle: string;
      targetStyle: string;
      convertedOutput: string;
      userCategory: string;
      userNote?: string;
    };
    const { rawInput, detectedInputStyle, targetStyle, convertedOutput, userCategory, userNote } = body;

    if (!rawInput || typeof rawInput !== "string" || !rawInput.trim()) {
      return res.status(400).json({ message: "rawInput is required and must be non-empty" });
    }
    if (!convertedOutput || typeof convertedOutput !== "string" || !convertedOutput.trim()) {
      return res.status(400).json({ message: "convertedOutput is required and must be non-empty" });
    }
    if (!REPORT_CATEGORIES.includes(userCategory as (typeof REPORT_CATEGORIES)[number])) {
      return res.status(400).json({ message: "userCategory must be one of the allowed values" });
    }
    if (userNote != null && (typeof userNote !== "string" || userNote.length > 300)) {
      return res.status(400).json({ message: "userNote must be a string with max 300 characters" });
    }

    const report: CitationReport = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      rawInput: rawInput.trim(),
      detectedInputStyle: (detectedInputStyle ?? "").trim(),
      targetStyle: (targetStyle ?? "").trim(),
      convertedOutput: convertedOutput.trim(),
      userCategory: userCategory.trim(),
      userNote: userNote?.trim() || undefined,
      status: "open",
    };
    saveReport(report);
    return res.json({ success: true, id: report.id });
  } catch (err) {
    console.error("POST /api/reports error:", err);
    return res.status(500).json({ message: "Failed to save report" });
  }
});

router.get("/", (_req, res) => {
  try {
    const reports = loadReports();
    return res.json(reports);
  } catch (err) {
    console.error("GET /api/reports error:", err);
    return res.status(500).json({ message: "Failed to load reports" });
  }
});

router.get("/:id", (req, res) => {
  try {
    const report = getReportById(req.params.id);
    if (!report) return res.status(404).json({ message: "Report not found" });
    return res.json(report);
  } catch (err) {
    console.error("GET /api/reports/:id error:", err);
    return res.status(500).json({ message: "Failed to load report" });
  }
});

router.patch("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status?: string };
    if (!id) return res.status(400).json({ message: "id is required" });
    const validStatus: ReportStatus[] = ["open", "fixed", "rejected"];
    if (!status || !validStatus.includes(status as ReportStatus)) {
      return res.status(400).json({ message: "status must be one of: open, fixed, rejected" });
    }
    const updated = updateReportStatus(id, status as ReportStatus);
    if (!updated) return res.status(404).json({ message: "Report not found" });
    return res.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/reports/:id error:", err);
    return res.status(500).json({ message: "Failed to update report" });
  }
});

router.post("/:id/add-to-stress", (req, res) => {
  try {
    const { id } = req.params;
    const report = getReportById(id);
    if (!report) return res.status(404).json({ message: "Report not found" });
    addToStressTest(report.rawInput);
    return res.json({ success: true });
  } catch (err) {
    console.error("POST /api/reports/:id/add-to-stress error:", err);
    return res.status(500).json({ message: "Failed to add to stress test" });
  }
});

export default router;
