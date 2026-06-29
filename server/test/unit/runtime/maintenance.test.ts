import { describe, expect, it } from 'vitest';
import type { ConvertResponse } from '../../../src/engine/types/api.js';
import { cleanupRuntimeArtifacts, recheckAuthorityFlags } from '../../../src/runtime/maintenance.js';
import { resetRuntimeStore, saveJob, saveJobExport } from '../../../src/runtime/store.js';

describe('runtime maintenance helpers', () => {
  it('cleans expired exports and counts authority recheck candidates', async () => {
    resetRuntimeStore();

    const response: ConvertResponse = {
      jobId: 'job-1',
      status: 'success',
      summary: {
        total: 1,
        ready: 0,
        needsReview: 0,
        needsAction: 1,
        failed: 0,
        parseQuality: 50,
      },
      references: [{
        id: 'citation-1',
        index: 0,
        raw: 'Smith, J. (2020). Retracted study on examples. Journal of Examples, 12(3), 44-50.',
        outputLatencyMs: 12,
        publicStatus: 'needs_action',
        status: 'ok',
        referenceType: 'article-journal',
        detectedStyle: 'apa7',
        outputStyle: 'apa7',
        fields: {
          authors: { value: [], confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          title: { value: 'Retracted study on examples', confidence: 1, source: 'ml_extraction', stageId: 'test', uncertain: false },
          year: { value: 2020, confidence: 1, source: 'ml_extraction', stageId: 'test', uncertain: false },
          journal: { value: 'Journal of Examples', confidence: 1, source: 'ml_extraction', stageId: 'test', uncertain: false },
          volume: { value: '12', confidence: 1, source: 'ml_extraction', stageId: 'test', uncertain: false },
          issue: { value: '3', confidence: 1, source: 'ml_extraction', stageId: 'test', uncertain: false },
          pages: { value: '44-50', confidence: 1, source: 'ml_extraction', stageId: 'test', uncertain: false },
          doi: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          publisher: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          placeOfPublication: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          url: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          conferenceTitle: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          bookTitle: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          institution: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          edition: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          editors: { value: [], confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          thesisType: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          repository: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          articleNumber: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          accessedDate: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          siteName: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          database: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
          reportNumber: { value: null, confidence: 0, source: 'ml_extraction', stageId: 'test', uncertain: true },
        },
        rawScore: 50,
        displayScore: 20,
        scoreBreakdown: {
          fieldEvidenceScore: 0.4,
          formatCorrectnessScore: 0.7,
          structuralIntegrityScore: 0.6,
          fieldEvidence: {
            completeness: 0.4,
            avgMandatoryConfidence: 1,
          },
          formatScoringPath: 'guaranteed',
          formatSubscores: {
            authorFormatScore: 1,
            titleCaseScore: 1,
            punctuationScore: 1,
            fieldOrderScore: 1,
            spacingScore: 1,
            noDuplicatePunctScore: 1,
            containerFormatScore: 1,
          },
          structuralSubscores: {
            refTypeConfidenceScore: 1,
            noDuplicateFieldsScore: 1,
            noArtifactTokensScore: 1,
            noCorruptedContainerScore: 1,
            fieldBoundaryScore: 1,
            noDuplicateAuthorScore: 1,
            locatorConsistencyScore: 1,
          },
          penalties: [{ code: 'authority_retraction_notice', points: 45 }],
          authorityAdjustment: -30,
          diagnostics: {
            splitQualityFlag: 'ok',
            detectionConfidence: 0.98,
            formatScoringPathReason: 'style_guaranteed',
            rescoredAfterCorrection: false,
            scoreVersion: 'v2.0',
          },
          rawScore: 50,
          displayScore: 20,
        },
        healthReasons: ['retraction notice'],
        healthBreakdown: {
          missingMandatory: [],
          invalidMandatory: [],
          lowConfidenceMandatory: [],
          presentMandatory: ['title', 'year', 'journal'],
        },
        healthWarnings: [],
        authorityFlags: [{ type: 'retracted', source: 'test' }],
        renderedText: 'Rendered citation',
        renderedWarnings: [],
        pipelineMajor: 3,
        stageLog: [],
      }],
      failedIndices: [],
      duplicateGroups: [],
      exports: [{ format: 'txt', available: true }],
      countAudit: {
        inputEstimate: 1,
        aggregatedCount: 1,
        splitCount: 1,
        delta: 0,
        needsActionCount: 1,
        droppedCount: 0,
      },
      processingPath: {
        stagesRun: ['authority_validation'],
        fallbacksUsed: [],
        durationMs: 10,
        partialResult: false,
        batchConfig: { batchSize: 32, maxConcurrency: 4 },
        stageTimings: [],
      },
      providerUsage: {
        crossrefCalls: 0,
        openalexCalls: 0,
        semanticScholarCalls: 0,
        llmTokensUsed: 0,
        llmRepairCalls: 0,
        cacheHits: 0,
      },
      warnings: [],
      diagnostics: [],
    };

    saveJob({
      id: 'job-1',
      request: {
        sourceType: 'text',
        content: response.references[0]!.raw,
        outputStyle: 'apa7',
      },
      executionMode: 'sync',
      status: 'completed',
      createdAt: new Date(0).toISOString(),
      completedAt: new Date(0).toISOString(),
      result: response,
      textExport: 'Rendered citation',
      exports: {},
      events: [],
    });
    saveJobExport('job-1', {
      format: 'txt',
      content: 'Rendered citation',
      contentType: 'text/plain',
      fileName: 'job-1.txt',
      generatedAt: new Date(0).toISOString(),
    });

    expect(await recheckAuthorityFlags()).toEqual({
      reviewedCitations: 1,
      flaggedCitations: 1,
    });
    expect(await cleanupRuntimeArtifacts(1)).toEqual({
      cleanedJobs: 1,
      removedExports: 1,
    });
  });
});
