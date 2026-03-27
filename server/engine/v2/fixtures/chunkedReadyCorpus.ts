export type ChunkedReadyMode = 'structured' | 'semi_structured' | 'raw_unstructured';

export type ChunkedReadyCorpusChunk = {
  mode: ChunkedReadyMode;
  chunkIndex: number;
  startIndex: number;
  expectedCount: number;
  content: string;
};

export type ReadyReferenceSeed = {
  id: string;
  label: string;
  sourceUrl?: string;
  structured: string;
  semiStructured?: string;
  rawUnstructured: string;
};

export const READY_CORPUS_TOTAL = 1000;
export const READY_CORPUS_CHUNK_SIZE = 100;

export const READY_CORPUS_THRESHOLDS: Record<ChunkedReadyMode, number> = {
  structured: 1,
  semi_structured: 0.95,
  raw_unstructured: 0.95,
};

export const READY_REFERENCE_SEEDS: readonly ReadyReferenceSeed[] = [
  {
    id: 'prisma-2020',
    label: 'PRISMA 2020 statement',
    sourceUrl: 'https://doi.org/10.1136/bmj.n71',
    structured: 'Page, M. J., McKenzie, J. E., Bossuyt, P. M., Boutron, I., Hoffmann, T. C., Mulrow, C. D., Shamseer, L., Tetzlaff, J. M., Akl, E. A., Brennan, S. E., Chou, R., Glanville, J., Grimshaw, J. M., Hrobjartsson, A., Lalu, M. M., Li, T., Loder, E. W., Mayo-Wilson, E., McDonald, S., ... Moher, D. (2021). The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. BMJ, 372, n71. https://doi.org/10.1136/bmj.n71',
    rawUnstructured: 'Page MJ, McKenzie JE, Bossuyt PM, Boutron I, Hoffmann TC, Mulrow CD, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. BMJ. 2021;372:n71. doi:10.1136/bmj.n71',
  },
  {
    id: 'watson-crick-1953',
    label: 'Watson and Crick DNA structure',
    sourceUrl: 'https://doi.org/10.1038/171737a0',
    structured: 'Watson, J. D., & Crick, F. H. C. (1953). Molecular structure of nucleic acids: A structure for deoxyribose nucleic acid. Nature, 171(4356), 737-738. https://doi.org/10.1038/171737a0',
    rawUnstructured: 'Watson JD, Crick FHC. Molecular structure of nucleic acids: a structure for deoxyribose nucleic acid. Nature. 1953;171(4356):737-738. doi:10.1038/171737a0',
  },
  {
    id: 'turing-1950',
    label: 'Computing machinery and intelligence',
    sourceUrl: 'https://doi.org/10.1093/mind/lix.236.433',
    structured: 'Turing, A. M. (1950). Computing machinery and intelligence. Mind, 59(236), 433-460. https://doi.org/10.1093/mind/lix.236.433',
    rawUnstructured: 'Turing AM. Computing machinery and intelligence. Mind. 1950;59(236):433-460. doi:10.1093/mind/lix.236.433',
  },
  {
    id: 'prospect-theory-1979',
    label: 'Prospect theory',
    sourceUrl: 'https://doi.org/10.2307/1914185',
    structured: 'Kahneman, D., & Tversky, A. (1979). Prospect theory: An analysis of decision under risk. Econometrica, 47(2), 263-291. https://doi.org/10.2307/1914185',
    rawUnstructured: 'Kahneman D, Tversky A. Prospect theory: an analysis of decision under risk. Econometrica. 1979;47(2):263-291. doi:10.2307/1914185',
  },
  {
    id: 'iccic-2015-aljohani',
    label: 'ICCIC wireless traffic database paper',
    sourceUrl: 'https://doi.org/10.1109/ICCIC.2015.7435818',
    structured: 'Aljohani, M., & Alam, T. (2015). An algorithm for accessing traffic database using wireless technologies. In 2015 IEEE International Conference on Computational Intelligence and Computing Research (ICCIC) (pp. 1-4). https://doi.org/10.1109/iccic.2015.7435818',
    rawUnstructured: 'Aljohani M, Alam T. An algorithm for accessing traffic database using wireless technologies. In: 2015 IEEE International Conference on Computational Intelligence and Computing Research (ICCIC). 2015. p. 1-4. doi:10.1109/ICCIC.2015.7435818',
  },
  {
    id: 'deep-learning-2015',
    label: 'Deep learning Nature review',
    sourceUrl: 'https://doi.org/10.1038/nature14539',
    structured: 'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436-444. https://doi.org/10.1038/nature14539',
    rawUnstructured: 'LeCun Y, Bengio Y, Hinton G. Deep learning. Nature. 2015;521(7553):436-444. doi:10.1038/nature14539',
  },
  {
    id: 'nanothermometry-2013',
    label: 'Nanometre-scale thermometry in a living cell',
    sourceUrl: 'https://doi.org/10.1038/nature12373',
    structured: 'Kucsko, G., Maurer, P. C., Yao, N. Y., Kubo, M., Noh, H. J., Lo, P. K., Park, H., & Lukin, M. D. (2013). Nanometre-scale thermometry in a living cell. Nature, 500(7460), 54-58. https://doi.org/10.1038/nature12373',
    rawUnstructured: 'Kucsko G, Maurer PC, Yao NY, Kubo M, Noh HJ, Lo PK, Park H, Lukin MD. Nanometre-scale thermometry in a living cell. Nature. 2013;500(7460):54-58. doi:10.1038/nature12373',
  },
  {
    id: 'hawking-1974',
    label: 'Black hole explosions',
    sourceUrl: 'https://doi.org/10.1038/248030a0',
    structured: 'Hawking, S. W. (1974). Black hole explosions? Nature, 248(5443), 30-31. https://doi.org/10.1038/248030a0',
    rawUnstructured: 'Hawking SW. Black hole explosions? Nature. 1974;248(5443):30-31. doi:10.1038/248030a0',
  },
  {
    id: 'huang-lancet-2020',
    label: 'COVID-19 clinical features in Wuhan',
    sourceUrl: 'https://doi.org/10.1016/S0140-6736(20)30183-5',
    structured: 'Huang, C., Wang, Y., Li, X., Ren, L., Zhao, J., Hu, Y., Zhang, L., Fan, G., Xu, J., Gu, X., Cheng, Z., Yu, T., Xia, J., Wei, Y., Wu, W., Xie, X., Yin, W., Li, H., Liu, M., ... Cao, B. (2020). Clinical features of patients infected with 2019 novel coronavirus in Wuhan, China. The Lancet, 395(10223), 497-506. https://doi.org/10.1016/S0140-6736(20)30183-5',
    rawUnstructured: 'Huang C, Wang Y, Li X, Ren L, Zhao J, Hu Y, et al. Clinical features of patients infected with 2019 novel coronavirus in Wuhan, China. Lancet. 2020;395(10223):497-506. doi:10.1016/S0140-6736(20)30183-5',
  },
  {
    id: 'zhu-nejm-2020',
    label: 'Novel coronavirus from patients with pneumonia',
    sourceUrl: 'https://doi.org/10.1056/NEJMoa2001017',
    structured: 'Zhu, N., Zhang, D., Wang, W., Li, X., Yang, B., Song, J., Zhao, X., Huang, B., Shi, W., Lu, R., Niu, P., Zhan, F., Ma, X., Wang, D., Xu, W., Wu, G., Gao, G. F., & Tan, W. (2020). A novel coronavirus from patients with pneumonia in China, 2019. New England Journal of Medicine, 382(8), 727-733. https://doi.org/10.1056/NEJMoa2001017',
    rawUnstructured: 'Zhu N, Zhang D, Wang W, Li X, Yang B, Song J, Zhao X, Huang B, et al. A novel coronavirus from patients with pneumonia in China, 2019. N Engl J Med. 2020;382(8):727-733. doi:10.1056/NEJMoa2001017',
  },
  {
    id: 'prisma-2009',
    label: 'PRISMA statement 2009',
    sourceUrl: 'https://doi.org/10.1371/journal.pmed.1000097',
    structured: 'Moher, D., Liberati, A., Tetzlaff, J., & Altman, D. G. (2009). Preferred reporting items for systematic reviews and meta-analyses: The PRISMA statement. PLoS Medicine, 6(7), e1000097. https://doi.org/10.1371/journal.pmed.1000097',
    rawUnstructured: 'Moher D, Liberati A, Tetzlaff J, Altman DG. Preferred reporting items for systematic reviews and meta-analyses: the PRISMA statement. PLoS Med. 2009;6(7):e1000097. doi:10.1371/journal.pmed.1000097',
  },
  {
    id: 'quantum-supremacy-2019',
    label: 'Quantum supremacy using a programmable superconducting processor',
    sourceUrl: 'https://doi.org/10.1038/s41586-019-1666-5',
    structured: 'Arute, F., Arya, K., Babbush, R., Bacon, D., Bardin, J. C., Barends, R., Biswas, R., Boixo, S., Brandao, F. G. S. L., Buell, D. A., Burkett, B., Chen, Y., Chen, Z., Chiaro, B., Collins, R., Courtney, W., Dunsworth, A., Farhi, E., Foxen, B., ... Martinis, J. M. (2019). Quantum supremacy using a programmable superconducting processor. Nature, 574(7779), 505-510. https://doi.org/10.1038/s41586-019-1666-5',
    rawUnstructured: 'Arute F, Arya K, Babbush R, Bacon D, Bardin JC, Barends R, et al. Quantum supremacy using a programmable superconducting processor. Nature. 2019;574(7779):505-510. doi:10.1038/s41586-019-1666-5',
  },
  {
    id: 'ordinary-water-1970',
    label: 'The structure of ordinary water',
    sourceUrl: 'https://doi.org/10.1126/science.169.3946.635',
    structured: 'Frank, H. S. (1970). The structure of ordinary water. Science, 169(3946), 635-641. https://doi.org/10.1126/science.169.3946.635',
    rawUnstructured: 'Frank HS. The structure of ordinary water. Science. 1970;169(3946):635-641. doi:10.1126/science.169.3946.635',
  },
  {
    id: 'measured-measurement-2009',
    label: 'Measured measurement',
    sourceUrl: 'https://doi.org/10.1038/nphys1170',
    structured: 'Aspelmeyer, M. (2009). Measured measurement. Nature Physics, 5(1), 11-12. https://doi.org/10.1038/nphys1170',
    rawUnstructured: 'Aspelmeyer M. Measured measurement. Nature Physics. 2009;5(1):11-12. doi:10.1038/nphys1170',
  },
  {
    id: 'kennedy-1996',
    label: 'New relations',
    structured: 'Kennedy, D. (1996). New relations: The refashioning of British poetry 1980-1994. Bridgend, Wales: Seren.',
    semiStructured: 'Kennedy, D. (1996). New relations: The refashioning of British poetry 1980-1994.\nBridgend, Wales: Seren.',
    rawUnstructured: 'Kennedy D. New relations: the refashioning of British poetry 1980-1994. Bridgend, Wales: Seren; 1996.',
  },
  {
    id: 'swing-time-2017',
    label: 'Swing Time',
    structured: 'Smith, Z. (2017). Swing time. London: Penguin.',
    semiStructured: 'Smith, Z. (2017). Swing time.\nLondon: Penguin.',
    rawUnstructured: 'Smith Z. Swing time. London: Penguin; 2017.',
  },
  {
    id: 'uml2-unified-process-2005',
    label: 'UML 2 and the Unified Process',
    structured: 'Arlow, J., & Neustadt, I. (2005). UML 2 and the Unified Process: Practical object-oriented analysis and design. Upper Saddle River, NJ: Addison-Wesley.',
    semiStructured: 'Arlow, J., & Neustadt, I. (2005). UML 2 and the Unified Process: Practical object-oriented analysis and design.\nUpper Saddle River, NJ: Addison-Wesley.',
    rawUnstructured: 'Arlow J, Neustadt I. UML 2 and the Unified Process: Practical object-oriented analysis and design. Upper Saddle River, NJ: Addison-Wesley; 2005.',
  },
  {
    id: 'design-patterns-1994',
    label: 'Design Patterns',
    structured: 'Gamma, E., Helm, R., Johnson, R., & Vlissides, J. (1994). Design patterns: Elements of reusable object-oriented software. Reading, MA: Addison-Wesley.',
    semiStructured: 'Gamma, E., Helm, R., Johnson, R., & Vlissides, J. (1994). Design patterns: Elements of reusable object-oriented software.\nReading, MA: Addison-Wesley.',
    rawUnstructured: 'Gamma E, Helm R, Johnson R, Vlissides J. Design patterns: elements of reusable object-oriented software. Reading, MA: Addison-Wesley; 1994.',
  },
  {
    id: 'who-tb-report-2023',
    label: 'WHO Global Tuberculosis Report 2023',
    sourceUrl: 'https://www.who.int/teams/global-tuberculosis-programme/tb-reports/global-tuberculosis-report-2023',
    structured: 'World Health Organization. (2023). Global tuberculosis report 2023. Geneva: World Health Organization.',
    semiStructured: 'World Health Organization. (2023). Global tuberculosis report 2023.\nGeneva: World Health Organization.',
    rawUnstructured: 'World Health Organization. Global tuberculosis report 2023. Geneva: World Health Organization; 2023.',
  },
  {
    id: 'ema-medlit-2020',
    label: 'EMA guideline on medical literature monitoring',
    sourceUrl: 'https://www.ema.europa.eu/en/human-regulatory-overview/post-authorisation/monitoring-post-authorisation-medicine-safety/eudravigilance/medical-literature-monitoring',
    structured: 'European Medicines Agency. (2020). Guideline on medical literature monitoring. Amsterdam: European Medicines Agency.',
    semiStructured: 'European Medicines Agency. (2020). Guideline on medical literature monitoring.\nAmsterdam: European Medicines Agency.',
    rawUnstructured: 'European Medicines Agency. Guideline on medical literature monitoring. Amsterdam: European Medicines Agency; 2020.',
  },
  {
    id: 'un-women-2019-2020',
    label: 'Progress of the world\'s women 2019-2020',
    sourceUrl: 'https://www.unwomen.org/en/digital-library/progress-of-the-worlds-women',
    structured: 'UN Women. (2019). Progress of the world\'s women 2019-2020: Families in a changing world. New York: UN Women.',
    semiStructured: 'UN Women. (2019). Progress of the world\'s women 2019-2020: Families in a changing world.\nNew York: UN Women.',
    rawUnstructured: 'UN Women. Progress of the world\'s women 2019-2020: families in a changing world. New York: UN Women; 2019.',
  },
  {
    id: 'darwin-1859',
    label: 'On the Origin of Species',
    structured: 'Darwin, C. (1859). On the origin of species by means of natural selection. London: John Murray.',
    semiStructured: 'Darwin, C. (1859). On the origin of species by means of natural selection.\nLondon: John Murray.',
    rawUnstructured: 'Darwin C. On the origin of species by means of natural selection. London: John Murray; 1859.',
  },
] as const;

export const READY_REFERENCE_SOURCES = READY_REFERENCE_SEEDS
  .filter((seed) => Boolean(seed.sourceUrl))
  .map((seed) => ({
    id: seed.id,
    label: seed.label,
    sourceUrl: seed.sourceUrl as string,
  }));

function defaultSemiStructured(reference: string): string {
  if (reference.includes(' https://doi.org/')) {
    return reference.replace(' https://doi.org/', '\nhttps://doi.org/');
  }
  const lastSentenceBreak = reference.lastIndexOf('. ');
  if (lastSentenceBreak >= 0) {
    return `${reference.slice(0, lastSentenceBreak + 1)}\n${reference.slice(lastSentenceBreak + 2)}`;
  }
  return reference;
}

const STRUCTURED_REFERENCES = READY_REFERENCE_SEEDS.map((seed) => seed.structured);
const SEMI_STRUCTURED_REFERENCES = READY_REFERENCE_SEEDS.map((seed) => seed.semiStructured ?? defaultSemiStructured(seed.structured));
const RAW_UNSTRUCTURED_REFERENCES = READY_REFERENCE_SEEDS.map((seed) => seed.rawUnstructured);

function repeatToTotal(references: readonly string[], total: number): string[] {
  return Array.from({ length: total }, (_, index) => references[index % references.length] ?? references[0] ?? '');
}

function formatChunk(mode: ChunkedReadyMode, references: string[], startIndex: number): string {
  if (mode === 'structured') {
    return references.map((reference, index) => `${startIndex + index + 1}. ${reference}`).join('\n\n');
  }
  if (mode === 'semi_structured') {
    return references.map((reference, index) => `${startIndex + index + 1}) ${reference}`).join('\n');
  }
  return references.join('\n\n');
}

export function buildChunkedReadyCorpus(
  mode: ChunkedReadyMode,
  total: number = READY_CORPUS_TOTAL,
  chunkSize: number = READY_CORPUS_CHUNK_SIZE,
): string[] {
  return buildChunkedReadyCorpusPlan(mode, total, chunkSize).map((chunk) => chunk.content);
}

export function buildChunkedReadyCorpusPlan(
  mode: ChunkedReadyMode,
  total: number = READY_CORPUS_TOTAL,
  chunkSize: number = READY_CORPUS_CHUNK_SIZE,
): ChunkedReadyCorpusChunk[] {
  const base = mode === 'structured'
    ? STRUCTURED_REFERENCES
    : mode === 'semi_structured'
      ? SEMI_STRUCTURED_REFERENCES
      : RAW_UNSTRUCTURED_REFERENCES;
  const expanded = repeatToTotal(base, total);
  const chunks: ChunkedReadyCorpusChunk[] = [];
  for (let start = 0; start < expanded.length; start += chunkSize) {
    const references = expanded.slice(start, start + chunkSize);
    chunks.push({
      mode,
      chunkIndex: chunks.length,
      startIndex: start,
      expectedCount: references.length,
      content: formatChunk(mode, references, start),
    });
  }
  return chunks;
}
