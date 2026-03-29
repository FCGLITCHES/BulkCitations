process.env.ENABLE_LLM_EXTRACTOR = '0';
process.env.ENABLE_GROBID_EXTRACTOR = '0';
process.env.OPENAI_API_KEY = '';
const { createDefaultAdapters } = await import('./server/engine/v2/adapters.ts');
const extractor = createDefaultAdapters().extractor;
const result = await extractor.extract('10. 0009, BGS. bb. ResearchHub Technologies, Inc., 2026. https://doi.org/10.55277/researchhub.dmbxp6iu.1', 'ieee', { detectionConfidence: 0.95 });
console.log(JSON.stringify(result.parsed, null, 2));
console.log(JSON.stringify({ selectedBranch: result.selectedBranch, referenceType: result.referenceType, debug: result.debug }, null, 2));
