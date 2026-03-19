# Product Strategy: Citing (Bulk Citations)
*One-line description: Community-verified citation parsing and style conversion at scale.*

### What is this product?
Citing is a high-performance citation engine designed to convert raw reference strings (copy-pasted from PDFs, websites, or documents) into valid, perfectly formatted citations in APA, IEEE, Harvard, MLA, Chicago, and Vancouver styles.

### What problem does it solve?
Researchers, students, and authors often waste hours correctly formatting citations or manually entering metadata into tools like Zotero. Citing automates the "copy-paste" workflow or "PDF-to-bibliography" workflow with higher accuracy than general-purpose LLMs.

### Who uses this product?
- **Primary Persona**: Academic researchers (PhD students, postdocs) who need to format bibliographies for publication.
- **Secondary Persona**: Students who need to fix broken citations in their essays.

### Key User Flows
1. **Raw Paster**: Paste 50 citations → Instant conversion to target style.
2. **Failure Report**: Click "Wrong?" → Report parsing error → Admin accepts fix → Pattern propagated live.
3. **Auto-Detection**: High-frequency parsing patterns are automatically flagged for review.

### Roadmap
1. **Community-Verified Patterns**: FEEDBACK LOOP implemented. Improve accuracy via `patterns.json`.
2. **Auto-Queue**: Confidence-based flagging of imperfect citations.
3. **Batch PDF Processing**: Extract and format citations directly from uploaded PDFs.

### What makes it different?
Unlike static CSL engines, Citing uses a **Hybrid Extraction Engine** (Static + Dynamic Regex + Heuristics + Confidence Scoring) and is designed to "get smarter" via community-reported failure patterns.
