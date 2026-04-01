import type { ParsedReference } from '@shared/schema';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = "gpt-4o-mini"; // Tech spec refers to GPT-4.1 nano, using gpt-4o-mini as equivalent

export async function runLLMFallbackRepair(
  rawString: string,
  existingPartial?: Partial<ParsedReference>
): Promise<Partial<ParsedReference> | null> {
  if (!OPENAI_API_KEY) {
    console.warn("[Phase 6.5] OpenAI API key not found, skipping LLM fallback.");
    return null;
  }

  try {
    const prompt = `
You are an expert citation parser. Given a raw citation string and potentially incomplete extracted fields, return a clean JSON object of the missing or corrected fields.
ONLY return JSON. No prose.

Raw Citation: "${rawString}"
Existing Partial Data: ${JSON.stringify(existingPartial || {})}

Target JSON structure (only include fields you can extract):
{
  "authors": ["Family, Given", ...],
  "title": "Full title",
  "year": "YYYY",
  "journal": "Journal Name",
  "volume": "12",
  "issue": "3",
  "pages": "123-145",
  "doi": "10.xxx/xxx"
}
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.1
      })
    });

    if (!response.ok) {
      console.error(`[Phase 6.5] OpenAI API failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    if (!content) return null;

    const repaired = JSON.parse(content);
    console.info("[Phase 6.5] LLM repair successful for citation.");
    return repaired as Partial<ParsedReference>;

  } catch (error) {
    console.error("[Phase 6.5] LLM fallback error:", error);
    return null;
  }
}
