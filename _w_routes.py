from pathlib import Path
Path(r"D:/Coding/Bulkreferences/server/src/routes/adminTruthRoutes.ts").write_text(r'''import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, ErrorCode } from "../engine/errors/index.js";
import {
  deleteApprovedTruth,
  getApprovedTruth,
  listApprovedTruth,
  listLearningQueue,
  promoteLearningQueueRow,
  upsertApprovedTruthPayload,
} from "../runtime/persistence.js";
import type { StoredApprovedTruth, TruthDatasetSplit, TruthTrustLevel } from "../runtime/store.js";

const datasetSplitSchema = z.enum(["train", "val", "test", "holdout"]);
const trustLevelSchema = z.enum(["draft", "reviewed", "gold"]);

const createTruthSchema = z.object({
  rawText: z.string().min(1),
  expectedFields: z.record(z.unknown()),
  expectedType: z.string().max(40).optional().nullable(),
  expectedStyle: z.string().max(40).optional().nullable(),
  provenance: z.string().max(50).optional().nullable(),
  pipelineMajor: z.number().int().optional().nullable(),
  datasetSplit: datasetSplitSchema.optional().nullable(),
  trustLevel: trustLevelSchema.optional(),
  reviewedBy: z.string().max(120).optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
});

const patchTruthSchema = createTruthSchema.partial();

const promoteSchema = z.object({
  rawText: z.string().min(1).optional(),
  expectedFields: z.record(z.unknown()),
  expectedType: z.string().max(40).optional().nullable(),
  expectedStyle: z.string().max(40).optional().nullable(),
  datasetSplit: datasetSplitSchema.optional().nullable(),
  trustLevel: trustLevelSchema.optional(),
  reviewedBy: z.string().max(120).optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
  provenance: z.string().max(50).optional().nullable(),
});

function exportRow(t: StoredApprovedTruth): Record<string, unknown> {
  return {
    raw_text: t.rawText,
    expected_fields: t.expectedFields,
    expected_type: t.expectedType ?? undefined,
    expected_style: t.expectedStyle ?? undefined,
    input_hash: t.inputHash,
    dataset_split: t.datasetSplit ?? undefined,
    trust_level: t.trustLevel,
    provenance: t.provenance ?? undefined,
    pipeline_major: t.pipelineMajor ?? undefined,
  };
}

export function registerAdminTruthRoutes(app: FastifyInstance): void {
  app.get("/admin/approved-truth", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const trustLevel = q.trustLevel as TruthTrustLevel | undefined;
    const datasetSplit = q.datasetSplit as TruthDatasetSplit | undefined;
    const limit = q.limit ? Number(q.limit) : undefined;
    const rows = await listApprovedTruth({
      ...(trustLevel ? { trustLevel } : {}),
      ...(datasetSplit ? { datasetSplit } : {}),
      ...(limit && !Number.isNaN(limit) ? { limit } : {}),
    });
    return reply.status(200).send({ items: rows });
  });

  app.get("/admin/approved-truth/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = await getApprovedTruth(id);
    if (!row) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Approved truth row not found.");
    }
    return reply.status(200).send(row);
  });

  app.post("/admin/approved-truth", async (req, reply) => {
    const parsed = createTruthSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, "Invalid approved truth payload.", {
        issues: parsed.error.flatten(),
      });
    }
    const row = await upsertApprovedTruthPayload(parsed.data);
    return reply.status(201).send(row);
  });

  app.patch("/admin/approved-truth/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const existing = await getApprovedTruth(id);
    if (!existing) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Approved truth row not found.");
    }
    const parsed = patchTruthSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, "Invalid patch payload.", {
        issues: parsed.error.flatten(),
      });
    }
    const merged = { ...existing, ...parsed.data };
    const row = await upsertApprovedTruthPayload({
      id: merged.id,
      rawText: merged.rawText,
      expectedFields: merged.expectedFields,
      expectedType: merged.expectedType ?? null,
      expectedStyle: merged.expectedStyle ?? null,
      provenance: merged.provenance ?? null,
      pipelineMajor: merged.pipelineMajor ?? null,
      datasetSplit: merged.datasetSplit ?? null,
      trustLevel: merged.trustLevel,
      reviewedBy: merged.reviewedBy ?? null,
      notes: merged.notes ?? null,
    });
    return reply.status(200).send(row);
  });

  app.delete("/admin/approved-truth/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const ok = await deleteApprovedTruth(id);
    if (!ok) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Approved truth row not found.");
    }
    return reply.status(200).send({ ok: true as const });
  });

  app.get("/admin/training-export", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const trustLevel = q.trustLevel as TruthTrustLevel | undefined;
    const datasetSplit = q.datasetSplit as TruthDatasetSplit | undefined;
    const excludeHoldout = q.excludeHoldout !== "false";
    let rows = await listApprovedTruth({
      ...(trustLevel ? { trustLevel } : {}),
      ...(datasetSplit ? { datasetSplit } : {}),
      limit: 5000,
    });
    if (excludeHoldout) {
      rows = rows.filter((r) => r.datasetSplit !== "holdout");
    }
    const lines = rows.map((r) => JSON.stringify(exportRow(r)));
    const body = "".join([lines.join("\n"), "\n"]) if False else f"{chr(10).join(lines)}\n";
    return reply
      .header("Content-Type", "application/x-ndjson; charset=utf-8")
      .header("Content-Disposition", "attachment; filename=\"training-export.jsonl\"")
      .status(200)
      .send(body);
  });

  app.post("/admin/learning-queue/:id/promote", async (req, reply) => {
    const queueId = (req.params as { id: string }).id;
    const parsed = promoteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, "Invalid promote payload.", {
        issues: parsed.error.flatten(),
      });
    }
    const queue = (await listLearningQueue()).find((i) => i.id === queueId);
    if (!queue) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Learning queue item not found.");
    }
    const rawText =
      parsed.data.rawText?.trim()
      ?? (typeof queue.trainingData.rawInput === "string" ? queue.trainingData.rawInput : "");
    if (!rawText) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, "rawText is required when queue item has no rawInput.");
    }
    const result = await promoteLearningQueueRow(queueId, {
      rawText,
      expectedFields: parsed.data.expectedFields,
      expectedType: parsed.data.expectedType ?? null,
      expectedStyle: parsed.data.expectedStyle ?? null,
      datasetSplit: parsed.data.datasetSplit ?? null,
      trustLevel: parsed.data.trustLevel,
      reviewedBy: parsed.data.reviewedBy ?? null,
      notes: parsed.data.notes ?? null,
      provenance: parsed.data.provenance ?? null,
    });
    if (!result) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Learning queue item not found.");
    }
    return reply.status(200).send(result);
  });
}
''', encoding="utf-8")
print("written adminTruthRoutes")
