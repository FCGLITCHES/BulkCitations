import { processV2Conversion } from './server/engine/v2/pipeline.js';

const content = [
  'Baron, Reuben M., and David A. Kenny. "The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.." Journal of Personality and Social Psychology 51, no. 6 (1986): 1173-1182.',
  'Baron RM, Kenny DA. The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.. Journal of Personality and Social Psychology. 1986;51(6):1173-1182.'
].join('\n\n');

const { response } = await processV2Conversion({
  sourceType: 'text',
  content,
  inputStyle: 'auto',
  outputStyle: 'apa',
  enrich: false,
  dedup: true,
  group: false,
  debug: true,
});

console.log(JSON.stringify(response.citations.map((c) => ({
  status: c.status,
  title: c.title.value,
  authors: c.authors.value,
  detected: c.detectedStyle.value,
  extract: c.extraction,
  debug: c.stageDebug?.extract,
  formatted: c.rendered?.formatted,
  quality: c.quality,
})), null, 2));
