# Product Specification: Citing

**One-line description**: AI-powered citation intelligence engine for automated deduplication, enrichment, and formatting at scale.

## What is this product?
Citing is a high-performance citation intelligence engine that transforms messy, raw reference strings into perfectly formatted, enriched, and verified academic citations. It goes beyond simple "copy-paste" tools by providing deep metadata extraction, semantic deduplication, and topic clustering.

## What problem does it solve?
Researchers and publishers waste thousands of hours manually fixing broken citations, finding missing DOIs, and removing duplicates in large bibliographies. Citing automates this workflow with principal-engineer rigor, ensuring 100% style compliance and data integrity.

## Business Model
- **Self-Serve**: Per-citation pricing for individual researchers and students.
- **B2B API**: Tiered subscription for academic publishers, libraries, and lab groups.
- **Enterprise**: Custom orchestration and on-premise deployments.

## Product Stage
**Current Stage**: Growth/Scaling. Transitioning from a regex-heavy MVP to an AI-first intelligence layer.

## Target Audience
- **Primary Persona**: Academic Researchers (PhD Students, Postdocs) who manage massive citation lists.
- **Secondary Persona**: Academic Publishers & Journal Editors who need to verify incoming manuscript references.
- **Technical Level**: Intermediate to Advanced (comfortable with citation managers and API integrations).

## Market Context
- **What users compare this product to**: Zotero, Mendeley, EndNote (manual management); general-purpose LLMs like ChatGPT (unreliable for formatting); and standalone tools like Anystyle.io or Crossref Search.
- **Competitors**: Paperpile, RefWorks, automated bibliographic software in journals.
- **What makes it different?**: 
    - **Hybrid Precision**: SciBERT NER + LLM fallback for >95% extraction accuracy.
    - **Semantic Intelligence**: RAG-based deduplication and automated topic clustering.
    - **Trust Signals**: Real-time confidence scoring and automated retraction checks.
    - **Speed**: Optimized parallel pipeline (<3s for 20 citations).

## What this product is NOT
- A social network for researchers.
- A full writing environment (like Overleaf or Microsoft Word).
- A primary search engine for discovering new papers (though it enriches existing lists).

## Key User Flows
1. **Bulk Bibliography Fixer**: Paste 50+ mixed-format citations → Automatic splitting, deduplication, and conversion to target style.
2. **DOI/Metadata Recovery**: Upload a list of broken references → Waterfall enrichment fills in missing DOIs, volumes, and abstracts.
3. **Research Organization**: Input a large unsorted list → Engine clusters citations by research topic for easier review.
4. **Publisher Verification**: API check of a manuscript's references → Flags retracted papers and verifies metadata against Crossref/PubMed.

## Core Pages
- **Home**: Workspace and conversion interface.
- **History**: Conversion archive and job management.
- **Prices**: Tiered plans for individuals and enterprise.
- **Resources**: High-velocity archiving insights.
- **API**: Integration guides and waitlist.
- **About**: Mission and solo-developer story.

## Roadmap (Next 3–5 Items)
1. **Intelligence Engine v2**: Implementation of SciBERT NER and BART-NLI format detection.
2. **Retraction Watch Integration**: Real-time safety flags for every processed citation.
3. **B2B API Storefront**: Comprehensive developer portal and usage dashboard.
4. **Async Job System**: Handling massive batches (5,000+ citations) for enterprise customers.
