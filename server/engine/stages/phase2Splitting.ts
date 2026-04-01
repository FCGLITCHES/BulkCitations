const ML_SERVICE_URL = process.env.AI_MICROSERVICE_URL || "http://127.0.0.1:8000";

export async function splitCitationsML(line1: string, line2: string): Promise<boolean> {
    try {
        const response = await fetch(`${ML_SERVICE_URL}/line-pair-classifier`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line1, line2 })
        });
        
        if (!response.ok) {
            console.warn(`[Phase 2] Splitting ML failed with status ${response.status}`);
            return false;
        }

        const data = await response.json();
        
        if (data && data.action === "NEW_CITATION" && data.confidence > 0.5) {
            return true; // True if line2 is a new citation
        }
    } catch (e) {
        console.error("[Phase 2] Failed to connect to ML service for splitting:", e);
    }
    
    return false;
}
