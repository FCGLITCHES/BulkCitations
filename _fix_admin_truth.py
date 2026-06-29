from pathlib import Path
p = Path(r"D:/Coding/Bulkreferences/server/src/routes/adminTruthRoutes.ts")
t = p.read_text(encoding="utf-8")
t = t.replace(
    "    const row = await upsertApprovedTruthPayload(parsed.data);",
    """    const d = parsed.data;
    const row = await upsertApprovedTruthPayload({
      rawText: d.rawText,
      expectedFields: d.expectedFields,
      expectedType: d.expectedType ?? null,
      expectedStyle: d.expectedStyle ?? null,
      provenance: d.provenance ?? null,
      pipelineMajor: d.pipelineMajor ?? null,
      datasetSplit: d.datasetSplit ?? null,
      trustLevel: d.trustLevel ?? "draft",
      reviewedBy: d.reviewedBy ?? null,
      notes: d.notes ?? null,
    });""",
)
t = t.replace(
    """    const merged = { ...existing, ...parsed.data };
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
    });""",
    """    const merged = { ...existing, ...parsed.data };
    const row = await upsertApprovedTruthPayload({
      id: merged.id,
      rawText: merged.rawText ?? existing.rawText,
      expectedFields: merged.expectedFields ?? existing.expectedFields,
      expectedType: merged.expectedType ?? null,
      expectedStyle: merged.expectedStyle ?? null,
      provenance: merged.provenance ?? null,
      pipelineMajor: merged.pipelineMajor ?? null,
      datasetSplit: merged.datasetSplit ?? null,
      trustLevel: merged.trustLevel ?? existing.trustLevel,
      reviewedBy: merged.reviewedBy ?? null,
      notes: merged.notes ?? null,
    });""",
)
t = t.replace(
    """      trustLevel: parsed.data.trustLevel,
      reviewedBy: parsed.data.reviewedBy ?? null,""",
    """      trustLevel: parsed.data.trustLevel ?? "reviewed",
      reviewedBy: parsed.data.reviewedBy ?? null,""",
)
p.write_text(t, encoding="utf-8")
print("fixed adminTruthRoutes")
