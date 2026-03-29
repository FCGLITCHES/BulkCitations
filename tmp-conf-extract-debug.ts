process.env.ENABLE_LLM_EXTRACTOR = '0';
process.env.ENABLE_GROBID_EXTRACTOR = '0';
process.env.OPENAI_API_KEY = '';
const { createDefaultAdapters } = await import('./server/engine/v2/adapters.ts');
const extractor = createDefaultAdapters().extractor;
const result = await extractor.extract('Neilsen, P, Hunter, I, and Kearney, R, 2003. Time-varying identification of the neuromuscular system. II. Isolated muscle mechanics. In Proceedings of the Fifteenth Annual Northeast Bioengineering Conference (pp.151-152). IEEE. https://doi.org/10.1109/nebc.1989.36745', 'harvard', { detectionConfidence: 0.95 });
console.log(JSON.stringify(result.parsed, null, 2));
console.log(JSON.stringify({ selectedBranch: result.selectedBranch, referenceType: result.referenceType, debug: result.debug }, null, 2));
