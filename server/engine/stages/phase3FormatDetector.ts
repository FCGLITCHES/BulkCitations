import type { PreNormalizedText } from "@shared/types/textBrands";
import type { CitationStyle } from "@shared/schema";

const ML_SERVICE_URL = process.env.AI_MICROSERVICE_URL || "http://127.0.0.1:8000";

export async function detectCitationFormatML(text: PreNormalizedText): Promise<CitationStyle | null> {
    try {
        const response = await fetch(`${ML_SERVICE_URL}/detect-format`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ citation: text })
        });
        
        if (!response.ok) {
            console.warn(`[Phase 3] Format detection ML failed with status ${response.status}`);
            return null;
        }

        const data = await response.json();
        
        // Ensure confidence meets a reasonable threshold, otherwise fallback
        if (data && data.style && typeof data.confidence === 'number' && data.confidence > 0.4) {
            return data.style as CitationStyle;
        }
        
    } catch (e: any) {
        if (e.code === 'ECONNREFUSED' || e.cause?.code === 'ECONNREFUSED' || e.message?.includes('fetch failed')) {
            console.warn("[Phase 3] ML service offline, using format heuristic fallback.");
        } else {
            console.error("[Phase 3] Format detection error:", e);
        }
    }
    
    return null;
}
