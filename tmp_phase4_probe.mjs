(async () => {
  const { phase3StyleDetect } = await import('./server/src/engine/phases/phase3StyleDetect.ts');
  const { phase4Extract } = await import('./server/src/engine/phases/phase4Extract.ts');
  const { createPipelineContext } = await import('./server/src/engine/pipeline.ts');
  const { makeRawBlock } = await import('./server/test/helpers/makeRawBlock.ts');
  const samples = [
    ['usp', 'U.S. Pharmacopeial Convention. (2007). Rimexolone Ophthalmic Suspension. U.S. Pharmacopeial Convention.'],
    ['baryons', 'Hall, J. M. (2013). Baryon Resonance Determination using LQCD. BARYONS 2013, Glasgow, U.K., June 24, 2013.'],
    ['richard', '[1] Richard J, Enjolras V, Rys L, Vallon J, Nann I, Escudier P. Space Altimetry from Nano-Satellites : Payload Feasibility, Missions and System Performances, IEEE; 2014, pp. 112-116. doi:10.1109/ESA.2014.1234'],
    ['clark', 'Clark, J. (2015). Wat is een time-out? Wanneer gebruiken ouders de time-out? In SOS! Hulp voor ouders (pp. 51-62). Bohn Stafleu van Loghum. https://doi.org/10.1007/978-90-368-0941-2_4'],
  ];
  const ctx = createPipelineContext({ mode: 'test' });
  const carriers = await phase3StyleDetect.run(samples.map(([, raw]) => makeRawBlock(raw)), ctx);
  const out = await phase4Extract.run(carriers, ctx);
  for (let i = 0; i < out.length; i += 1) {
    const carrier = out[i];
    console.log('---', samples[i][0], '---');
    console.log(JSON.stringify({ type: carrier.type.type, style: carrier.style.primary, fields: Object.fromEntries(Object.entries(carrier.fields).map(([k,v]) => [k, v.value])) }, null, 2));
  }
})();
