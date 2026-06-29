(async () => {
  const { phase3StyleDetect } = await import('./server/src/engine/phases/phase3StyleDetect.ts');
  const { phase4Extract } = await import('./server/src/engine/phases/phase4Extract.ts');
  const { createTestPipelineContext } = await import('./server/test/helpers/createPipelineContext.ts');
  const { makeRawBlock } = await import('./server/test/helpers/makeRawBlock.ts');
  const samples = [
    ['proxy1', 'Acácio, M. da S., MOREIRA, S. L. D. B., SOUZA, M. A. D., BRAGA, T. R. D. S., & REIS, M. C. D. S. (2023). A CONTRIBUIÇÃO DO ESTÁGIO SUPERVISIONADO DE TERAPIA OCUPACIONAL NA ATENÇÃO BÁSICA PARA O ENSINO APRENDIZADO. Anais do II Congresso Brasileiro de Saúde Pública On-line. https://doi.org/10.51161/ii-conbrasp/15864'],
    ['proxy2', 'Acácio, M. da S. et al. (2023) “A CONTRIBUIÇÃO DO ESTÁGIO SUPERVISIONADO DE TERAPIA OCUPACIONAL NA ATENÇÃO BÁSICA PARA O ENSINO APRENDIZADO.” Revista Multidisciplinar em Saúde. Available at: https://doi.org/10.51161/ii-conbrasp/15864.'],
    ['usp', 'U.S. Pharmacopeial Convention. (2021). Rimexolone Ophthalmic Suspension. U.S. Pharmacopeial Convention. https://doi.org/10.31003/USPNF_M35740_03_01'],
    ['baryons1', 'Edwards, R. (2013). Baryon Resonance Determination using LQCD. BARYONS 2013, Glasgow, U.K., June 24, 2013. https://doi.org/10.2172/1992065'],
    ['baryons2', 'Edwards, Robert. “Baryon Resonance Determination Using LQCD.” 2013, BARYONS 2013, Glasgow, U.K., June 24, 2013, https://doi.org/10.2172/1992065.'],
    ['richard', '[1]Richard J, Enjolras V, Rys L, Vallon J, Nann I, Escudier P. Space Altimetry from Nano-Satellites : Payload Feasibility, Missions and System Performances, IEEE; 2008, p. III-71-III–74. https://doi.org/10.1109/igarss.2008.4779285.'],
  ];
  const ctx = createTestPipelineContext();
  const carriers = await phase3StyleDetect.run(samples.map(([, raw]) => makeRawBlock(raw)), ctx);
  const out = await phase4Extract.run(carriers, ctx);
  for (let i = 0; i < out.length; i += 1) {
    const carrier = out[i];
    console.log('---', samples[i][0], '---');
    console.log(JSON.stringify({
      type: carrier.type.type,
      style: carrier.style.primary,
      fields: Object.fromEntries(Object.entries(carrier.fields).map(([k, v]) => [k, v.value]))
    }, null, 2));
  }
})();
