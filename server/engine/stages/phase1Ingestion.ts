import type { PreNormalizedText } from "@shared/types/textBrands";

const ML_SERVICE_URL = process.env.AI_MICROSERVICE_URL || "http://127.0.0.1:8000";

export interface ExtractionResult {
    sourceType: string;
    rawString: string;
    filePosition?: number;
    ingestionConfidence: number;
}

export async function extractTextML(fileBuffer: Buffer, filename: string): Promise<ExtractionResult[]> {
    try {
        const formData = new FormData();
        const blob = new Blob([fileBuffer]);
        formData.append("file", blob, filename);

        const response = await fetch(`${ML_SERVICE_URL}/extract-text`, {
            method: 'POST',
            body: formData as any,
        });

        if (!response.ok) {
            throw new Error(`[Phase 1] ML extraction failed: ${response.statusText}`);
        }

        return await response.json() as ExtractionResult[];
    } catch (e) {
        console.error("[Phase 1] Failed to process file via ML ingestion:", e);
        throw e;
    }
}
