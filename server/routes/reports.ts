import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type {
  ApprovedCanonicalFields,
  CitationReport,
  FailureCategory,
  FieldApprovalMap,
  FixType,
  ProposedPattern,
  ReportEngineSnapshot,
  ReportStatus,
} from '@shared/schema';
import {
  addToStressTest,
  checkRateLimit,
  computeFingerprint,
  deleteReports,
  getGroupedReports,
  getReportById,
  hashIP,
  loadReports,
  saveReport,
  updateReport,
} from '../store/reportStore.js';
import { saveGeneratedRegressionFixture } from '../store/generatedRegressionStore.js';
import { saveTruth } from '../store/truthStore.js';
import { requireAdmin } from '../utils/adminAuth.js';
import { readPatterns, validatePattern, writePattern } from '../utils/patternWriter.js';
import {
  buildGeneratedRegressionRecord,
  buildPatternExportArtifact,
  buildResolutionTrace,
  computeLikelyStageBlame,
  createReviewEvent,
} from '../utils/reportWorkflow.js';

const VALID_CATEGORIES: FailureCategory[] = [
  'author',
  'style-detection',
  'reference-type',
  'venue',
  'locator',
  'title',
  'year',
  'dedup',
  'validation',
  'normalization',
  'other',
];

const LEGACY_CATEGORY_MAP: Record<string, FailureCategory> = {
  'Year missing or incorrect': 'year',
  'Author name incorrect': 'author',
  'Title missing or incorrect': 'title',
  'Journal / venue incorrect': 'venue',
  'Pages missing or incorrect': 'locator',
  'Wrong citation style detected': 'style-detection',
  'Other...': 'other',
};

const VALID_STATUSES: ReportStatus[] = ['pending', 'proposed', 'accepted', 'rejected', 'duplicate'];
const VALID_FIX_TYPES: FixType[] = ['dynamic-pattern', 'parser-logic', 'scoring-tweak', 'renderer-fix', 'type-correction', 'other-fix'];

const router: Router = Router();

function normalizeCategory(value: string): FailureCategory | null {
  if (VALID_CATEGORIES.includes(value as FailureCategory)) {
    return value as FailureCategory;
  }
  return LEGACY_CATEGORY_MAP[value] ?? null;
}

function actorName(value: unknown, fallback = 'admin'): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function parsePatternExport(pattern?: ProposedPattern, generatedBy?: string) {
  if (!pattern) return undefined;
  if (!pattern.id || !pattern.regex || !pattern.fields || Object.keys(pattern.fields).length === 0) {
    return undefined;
  }
  const validationError = validatePattern(pattern);
  if (validationError) {
    return { error: validationError };
  }
  return { artifact: buildPatternExportArtifact(pattern, generatedBy) };
}

async function updateReportWithEvents(
  report: CitationReport,
  updates: Partial<CitationReport>,
  events: NonNullable<CitationReport['reviewEvents']> = [],
): Promise<CitationReport | null> {
  return updateReport(report.id, {
    ...updates,
    reviewEvents: [...(report.reviewEvents ?? []), ...events],
  });
}

router.post('/', async (req, res) => {
  try {
    const body = req.body as {
      originalText?: string;
      detectedStyle?: string;
      outputStyle?: string;
      convertedText?: string;
      failureCategory?: string;
      failureCategories?: string[];
      userNote?: string;
      parsedData?: any;
      referenceType?: string;
      confidence?: number;
      originalEngineOutput?: CitationReport['originalEngineOutput'];
      engineSnapshot?: ReportEngineSnapshot;
      rawInput?: string;
      detectedInputStyle?: string;
      targetStyle?: string;
      convertedOutput?: string;
      userCategory?: string;
    };

    const originalText = (body.originalText || body.rawInput || '').trim();
    const detectedStyle = (body.detectedStyle || body.detectedInputStyle || '').trim();
    const outputStyle = (body.outputStyle || body.targetStyle || '').trim();
    const convertedText = (body.convertedText || body.convertedOutput || '').trim();
    const rawCategory = body.failureCategory || body.userCategory || '';
    const rawCategories = Array.isArray(body.failureCategories)
      ? body.failureCategories.filter((value): value is string => typeof value === 'string')
      : [];

    if (!originalText) {
      return res.status(400).json({ message: 'originalText (or rawInput) is required' });
    }
    if (!convertedText) {
      return res.status(400).json({ message: 'convertedText (or convertedOutput) is required' });
    }
    if (body.userNote != null && (typeof body.userNote !== 'string' || body.userNote.length > 500)) {
      return res.status(400).json({ message: 'userNote must be a string with max 500 characters' });
    }

    const normalizedFailureCategories = Array.from(new Set(
      rawCategories
        .map((value) => normalizeCategory(value))
        .filter((value): value is FailureCategory => Boolean(value)),
    ));

    const failureCategory = normalizeCategory(rawCategory)
      ?? normalizedFailureCategories[0]
      ?? 'other';
    const failureCategories = Array.from(new Set([failureCategory, ...normalizedFailureCategories]));

    const clientIP = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';
    const ipHashed = hashIP(clientIP);
    const rateCheck = checkRateLimit(ipHashed);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        message: 'Rate limit exceeded. Maximum 10 reports per day.',
        remaining: 0,
      });
    }

    const engineSnapshot = body.engineSnapshot;
    const report: CitationReport = {
      id: randomUUID(),
      source: 'user',
      originalText,
      detectedStyle,
      outputStyle,
      parsedData: body.parsedData,
      referenceType: body.referenceType as any,
      convertedText,
      confidence: body.confidence,
      failureCategory,
      failureCategories,
      userNote: body.userNote?.trim() || undefined,
      status: 'pending',
      createdAt: new Date().toISOString(),
      fingerprint: computeFingerprint(originalText),
      reportCount: 1,
      ipHash: ipHashed,
      originalEngineOutput: body.originalEngineOutput ?? {
        convertedText,
        parsedData: body.parsedData,
        referenceType: body.referenceType as any,
        confidence: body.confidence,
      },
      engineSnapshot,
      likelyStageBlame: computeLikelyStageBlame(engineSnapshot),
      reviewEvents: [
        createReviewEvent('comment', 'system', 'Report submitted', {
          source: 'user',
        }),
      ],
    };

    const saved = await saveReport(report);
    return res.json({
      success: true,
      id: saved.id,
      deduplicated: saved.id !== report.id,
      remaining: rateCheck.remaining,
    });
  } catch (error) {
    console.error('POST /api/reports error:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ message: 'Failed to save report' });
  }
});

router.use(requireAdmin);

router.get('/', async (req, res) => {
  try {
    let reports = await loadReports();
    const { status, source } = req.query;
    if (status && typeof status === 'string') {
      reports = reports.filter((report) => report.status === status);
    }
    if (source && typeof source === 'string') {
      reports = reports.filter((report) => report.source === source);
    }
    return res.json(reports);
  } catch (error) {
    console.error('GET /api/reports error:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ message: 'Failed to load reports' });
  }
});

router.get('/grouped', async (req, res) => {
  try {
    const status = req.query.status as ReportStatus | undefined;
    const groups = await getGroupedReports(
      status && VALID_STATUSES.includes(status) ? status : undefined,
    );
    return res.json(groups);
  } catch (error) {
    console.error('GET /api/reports/grouped error:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ message: 'Failed to load grouped reports' });
  }
});

router.delete('/', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];

    if (ids.length === 0) {
      return res.status(400).json({ message: 'ids[] is required' });
    }

    const deletedCount = await deleteReports(Array.from(new Set(ids)));
    return res.json({ success: true, deletedCount });
  } catch (error) {
    console.error('DELETE /api/reports error:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ message: 'Failed to delete reports' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const report = await getReportById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });
    return res.json(report);
  } catch (error) {
    console.error('GET /api/reports/:id error:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ message: 'Failed to load report' });
  }
});

router.patch('/:id', async (req, res) => {
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
      assigneeName,
    } = req.body as Partial<CitationReport>;

    const updates: Partial<CitationReport> = {};
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      updates.status = status;
      if (status === 'accepted' || status === 'rejected') {
        updates.resolvedAt = new Date().toISOString();
      }
    }
    if (fixType) {
      if (!VALID_FIX_TYPES.includes(fixType)) {
        return res.status(400).json({ message: `fixType must be one of: ${VALID_FIX_TYPES.join(', ')}` });
      }
      updates.fixType = fixType;
    }
    if (proposedPattern !== undefined) updates.proposedPattern = proposedPattern;
    if (proposedStyleFix !== undefined) updates.proposedStyleFix = proposedStyleFix;
    if (verifiedBy !== undefined) updates.verifiedBy = verifiedBy;
    if (assigneeName !== undefined) updates.assigneeName = assigneeName;
    if (failureCategory && VALID_CATEGORIES.includes(failureCategory)) {
      updates.failureCategory = failureCategory;
    }
    if (referenceType) updates.referenceType = referenceType;

    const updated = await updateReport(id, updates);
    if (!updated) return res.status(404).json({ message: 'Report not found' });
    return res.json({ success: true, report: updated });
  } catch (error) {
    console.error('PATCH /api/reports/:id error:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ message: 'Failed to update report' });
  }
});

router.post('/:id/assign', async (req, res) => {
  try {
    const report = await getReportById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });

    const assigneeName = actorName(req.body?.assigneeName, 'admin');
    const event = createReviewEvent('assign', actorName(req.body?.actor, assigneeName), `Assigned to ${assigneeName}`, {
      assigneeName,
    });
    const updated = await updateReportWithEvents(report, { assigneeName }, [event]);
    if (!updated) return res.status(404).json({ message: 'Report not found' });
    return res.json({ success: true, report: updated });
  } catch (error) {
    console.error('POST /api/reports/:id/assign error:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ message: 'Failed to assign report' });
  }
});

router.post('/:id/comments', async (req, res) => {
  try {
    const report = await getReportById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ message: 'message is required' });
    }

    const event = createReviewEvent('comment', actorName(req.body?.actor, 'admin'), message);
    const updated = await updateReportWithEvents(report, {}, [event]);
    return res.json({ success: true, report: updated });
  } catch (error) {
    console.error('POST /api/reports/:id/comments error:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ message: 'Failed to add comment' });
  }
});

router.post('/:id/accept', async (req, res) => {
  try {
    const report = await getReportById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });

    const verifiedBy = actorName(req.body?.verifiedBy, 'admin');
    const writePatternDirectly = req.body?.writePatternDirectly === true;
    let patternWritten = false;
    let patternExport = report.patternExport;

    if ((req.body?.fixType || report.fixType) === 'dynamic-pattern' && report.proposedPattern) {
      const exportResult = parsePatternExport(report.proposedPattern, verifiedBy);
      if (exportResult?.error) {
        return res.status(400).json({ message: exportResult.error, patternError: true });
      }
      patternExport = exportResult?.artifact;

      if (writePatternDirectly) {
        const result = writePattern(report.proposedPattern);
        if (!result.success) {
          return res.status(400).json({ message: `Pattern write failed: ${result.error}`, patternError: true });
        }
        patternWritten = true;
      }
    }

    const event = createReviewEvent(
      'resolve',
      verifiedBy,
      'Accepted report',
      { patternWritten },
    );
    const updated = await updateReportWithEvents(report, {
      status: 'accepted',
      resolvedAt: new Date().toISOString(),
      verifiedBy,
      fixType: (req.body?.fixType || report.fixType) as FixType | undefined,
      referenceType: req.body?.referenceType || report.referenceType,
      patternExport,
    }, [event]);
    if (!updated) return res.status(404).json({ message: 'Report not found' });

    if (report.originalText) {
      try { addToStressTest(report.originalText); } catch { /* non-fatal */ }
    }

    return res.json({
      success: true,
      report: updated,
      patternWritten,
    });
  } catch (error) {
    console.error('POST /api/reports/:id/accept error:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ message: 'Failed to accept report' });
  }
});

router.post('/:id/resolve', async (req, res) => {
  try {
    const report = await getReportById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });

    const verifiedBy = actorName(req.body?.verifiedBy, 'admin');
    const fixType = req.body?.fixType as FixType | undefined;
    if (fixType && !VALID_FIX_TYPES.includes(fixType)) {
      return res.status(400).json({ message: `fixType must be one of: ${VALID_FIX_TYPES.join(', ')}` });
    }

    const proposedPattern = req.body?.proposedPattern as ProposedPattern | undefined;
    const proposedStyleFix = typeof req.body?.proposedStyleFix === 'string'
      ? req.body.proposedStyleFix.trim()
      : '';
    const correctedFields = req.body?.correctedFields as ApprovedCanonicalFields | undefined;
    const fieldApproval = req.body?.fieldApproval as FieldApprovalMap | undefined;
    const failureTaxonomy = Array.isArray(req.body?.failureTaxonomy) ? req.body.failureTaxonomy.filter(Boolean) : undefined;
    const stageBlame = Array.isArray(req.body?.stageBlame) ? req.body.stageBlame.filter(Boolean) : undefined;
    const duplicateDecision = req.body?.duplicateDecision as CitationReport['duplicateDecision'] | undefined;
    const saveAsTruth = req.body?.saveAsTruth === true;
    const writePatternDirectly = req.body?.writePatternDirectly === true;
    const resolvedByCommit = typeof req.body?.resolvedByCommit === 'string' ? req.body.resolvedByCommit.trim() : process.env.GIT_COMMIT_SHA;
    const resolvedByVersion = typeof req.body?.resolvedByVersion === 'string' ? req.body.resolvedByVersion.trim() : (process.env.APP_VERSION ?? process.env.npm_package_version);

    let patternExport = report.patternExport;
    let patternWritten = false;
    if (fixType === 'dynamic-pattern' && proposedPattern) {
      const exportResult = parsePatternExport(proposedPattern, verifiedBy);
      if (exportResult?.error) {
        return res.status(400).json({ message: exportResult.error, patternError: true });
      }
      patternExport = exportResult?.artifact;
      if (writePatternDirectly) {
        const result = writePattern(proposedPattern);
        if (!result.success) {
          return res.status(400).json({ message: `Pattern write failed: ${result.error}`, patternError: true });
        }
        patternWritten = true;
      }
    }

    let truthId = report.truthId;
    if (saveAsTruth && proposedStyleFix) {
      const truthEntry = await saveTruth({
        fingerprint: computeFingerprint(report.originalText),
        originalText: report.originalText,
        outputStyle: report.outputStyle,
        validatedOutput: proposedStyleFix,
        validatedBy: verifiedBy,
        correctedFields,
        fieldApproval,
        failureTaxonomy,
        stageBlame,
        duplicateDecision,
        originalEngineOutput: report.originalEngineOutput ?? {
          convertedText: report.convertedText,
          parsedData: report.parsedData,
          referenceType: report.referenceType,
          confidence: report.confidence,
        },
        sourceReportId: report.id,
        resolvedByCommit,
        resolvedByVersion,
      });
      truthId = truthEntry.truthId;
    }

    const baseUpdated: CitationReport = {
      ...report,
      status: 'accepted',
      resolvedAt: new Date().toISOString(),
      verifiedBy,
      fixType: fixType ?? report.fixType,
      referenceType: req.body?.referenceType || report.referenceType,
      proposedPattern: proposedPattern ?? report.proposedPattern,
      proposedStyleFix: proposedStyleFix || report.proposedStyleFix,
      correctedFields: correctedFields ?? report.correctedFields,
      fieldApproval: fieldApproval ?? report.fieldApproval,
      failureTaxonomy: failureTaxonomy ?? report.failureTaxonomy,
      stageBlame: stageBlame ?? report.stageBlame,
      duplicateDecision: duplicateDecision ?? report.duplicateDecision,
      finalApprovedOutput: proposedStyleFix || report.finalApprovedOutput || report.proposedStyleFix || report.convertedText,
      truthId,
      patternExport,
      resolvedByCommit,
      resolvedByVersion,
      resolutionTrace: buildResolutionTrace({
        ...report,
        resolvedByCommit,
        resolvedByVersion,
      }, verifiedBy, typeof req.body?.resolutionNote === 'string' ? req.body.resolutionNote : undefined),
    };

    const generatedRegression = buildGeneratedRegressionRecord(baseUpdated, verifiedBy);
    const savedGeneratedRegression = await saveGeneratedRegressionFixture(generatedRegression);
    baseUpdated.regressionFixtureId = savedGeneratedRegression.id;

    const reviewEvents = [
      createReviewEvent('resolve', verifiedBy, 'Resolved report', {
        fixType: baseUpdated.fixType,
        truthId,
        regressionFixtureId: savedGeneratedRegression.id,
        patternWritten,
      }),
      ...(truthId ? [createReviewEvent('truth_saved', verifiedBy, 'Saved approved truth', { truthId })] : []),
      ...(patternExport ? [createReviewEvent('pattern_exported', verifiedBy, 'Generated pattern export artifact', { filePath: patternExport.filePath, patternWritten })] : []),
      createReviewEvent(
        'regression_generated',
        verifiedBy,
        savedGeneratedRegression.skipped ? 'Skipped generated regression fixture' : 'Generated regression fixture',
        savedGeneratedRegression.skipped
          ? { skipReason: savedGeneratedRegression.skipReason }
          : { regressionFixtureId: savedGeneratedRegression.id },
      ),
    ];

    const updated = await updateReportWithEvents(report, baseUpdated, reviewEvents);
    if (!updated) return res.status(404).json({ message: 'Report not found' });

    if (report.originalText) {
      try { addToStressTest(report.originalText); } catch { /* non-fatal */ }
    }

    return res.json({
      success: true,
      report: updated,
      patternWritten,
      generatedRegression: savedGeneratedRegression,
    });
  } catch (error) {
    console.error('POST /api/reports/:id/resolve error:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ message: 'Failed to resolve report' });
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    const report = await getReportById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined;
    const updated = await updateReportWithEvents(report, {
      status: 'rejected',
      resolvedAt: new Date().toISOString(),
      proposedStyleFix: reason ? `Rejected: ${reason}` : report.proposedStyleFix,
      resolutionTrace: buildResolutionTrace(report, actorName(req.body?.actor, 'admin'), reason),
    }, [createReviewEvent(
      'reject',
      actorName(req.body?.actor, 'admin'),
      reason || 'Rejected report',
    )]);
    if (!updated) return res.status(404).json({ message: 'Report not found' });

    return res.json({ success: true, report: updated });
  } catch (error) {
    console.error('POST /api/reports/:id/reject error:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ message: 'Failed to reject report' });
  }
});

router.post('/:id/duplicate', async (req, res) => {
  try {
    const report = await getReportById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });
    const updated = await updateReportWithEvents(report, {
      status: 'duplicate',
      resolvedAt: new Date().toISOString(),
      resolutionTrace: buildResolutionTrace(report, actorName(req.body?.actor, 'admin'), 'Marked as duplicate'),
    }, [createReviewEvent(
      'duplicate',
      actorName(req.body?.actor, 'admin'),
      'Marked as duplicate',
    )]);
    if (!updated) return res.status(404).json({ message: 'Report not found' });

    return res.json({ success: true, report: updated });
  } catch (error) {
    console.error('POST /api/reports/:id/duplicate error:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ message: 'Failed to mark as duplicate' });
  }
});

router.post('/:id/add-to-stress', async (req, res) => {
  try {
    const report = await getReportById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });
    addToStressTest(report.originalText);
    return res.json({ success: true });
  } catch (error) {
    console.error('POST /api/reports/:id/add-to-stress error:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ message: 'Failed to add to stress test' });
  }
});

export default router;
