export type ChunkedReadyMode = 'structured' | 'semi_structured' | 'raw_unstructured';

export const READY_CORPUS_TOTAL = 1000;
export const READY_CORPUS_CHUNK_SIZE = 100;

export const READY_CORPUS_THRESHOLDS: Record<ChunkedReadyMode, number> = {
  structured: 1,
  semi_structured: 0.95,
  raw_unstructured: 0.95,
};

const STRUCTURED_REFERENCES = [
  'Smith, J. A., & Doe, R. B. (2023). Neural network optimization in low-resource environments. Journal of Artificial Intelligence Research, 45(2), 112-128.',
  'Chen, L., Wang, X., & Liu, Y. (2022). Impact of urban green spaces on mental health: A longitudinal study. Environmental Health Perspectives, 130(4), 047005.',
  'Nakamura, H. (2020). Quantum entanglement in macroscopic systems. Nature Physics, 16(8), 814-820.',
  'Bellur, S., Nowak, K. L., & Hull, K. S. (2015). Make it our time: In class multitaskers have lower academic performance. Computers in Human Behavior, 53, 63-70.',
  'Turing, A. M. (1950). Computing machinery and intelligence. Mind, 59(236), 433-460.',
  'Shannon, C. E. (1948). A mathematical theory of communication. The Bell System Technical Journal, 27(3), 379-423.',
  'Krugman, P. R. (1979). Increasing returns, monopolistic competition, and international trade. Journal of International Economics, 9(4), 469-479.',
  'Kahneman, D., & Tversky, A. (1979). Prospect theory: An analysis of decision under risk. Econometrica, 47(2), 263-291.',
  'Aljohani, Mohammed, and Tanweer Alam. "An algorithm for accessing traffic database using wireless technologies." In Computational Intelligence and Computing Research (ICCIC), 2015 IEEE International Conference on, pp. 1-4. IEEE, 2015. DOI: https://doi.org/10.1109/iccic.2015.7435818',
  'Shapiro, Jonathan. "Genetic algorithms in machine learning." In Advanced Course on Artificial Intelligence, pp. 146-168. Springer, Berlin, Heidelberg, 1999.',
  'Kennedy, David. New Relations: The Refashioning of British Poetry 1980-1994. Bridgend: Seren, 1996.',
  'Smith, Z. (2017). Swing time. London: Penguin.',
  'Arlow, J., & Neustadt, I. (2005). UML 2 and the Unified Process: Practical Object-Oriented Analysis and Design. Upper Saddle River, NJ: Addison-Wesley.',
  'Gamma, E., Helm, R., Johnson, R., & Vlissides, J. (1994). Design Patterns: Elements of Reusable Object-Oriented Software. Reading, MA: Addison-Wesley.',
  'World Health Organization. Global tuberculosis report 2023. Geneva: World Health Organization; 2023.',
  'European Medicines Agency. Guideline on medical literature monitoring. Amsterdam: EMA; 2020.',
  "UN Women. Progress of the world's women 2019-2020: families in a changing world. New York: UN Women; 2019.",
  'Darwin, C. (1859). On the Origin of Species by Means of Natural Selection. London: John Murray.',
  'Watson, J. D., & Crick, F. H. (1953). Molecular structure of nucleic acids: A structure for deoxyribose nucleic acid. Nature, 171(4356), 737-738.',
  'Brown, E. (2024). Ethics of autonomous vehicle decision-making frameworks. Ethics and Information Technology, 26(1), 12.',
] as const;

const SEMI_STRUCTURED_REFERENCES = [
  '1. Smith, J. A., & Doe, R. B. (2023). Neural network optimization in low-resource environments. Journal of Artificial Intelligence Research,\n45(2), 112-128.',
  '2. Chen, L., Wang, X., & Liu, Y. (2022). Impact of urban green spaces on mental health: A longitudinal study.\nEnvironmental Health Perspectives, 130(4), 047005.',
  '3. Nakamura, H. (2020). Quantum entanglement in macroscopic systems. Nature Physics,\n16(8), 814-820.',
  '4. Bellur, S., Nowak, K. L., & Hull, K. S. (2015). Make it our time: In class multitaskers have lower academic performance.\nComputers in Human Behavior, 53, 63-70.',
  '5. Turing, A. M. (1950). Computing machinery and intelligence. Mind,\n59(236), 433-460.',
  '6. Shannon, C. E. (1948). A mathematical theory of communication. The Bell System Technical Journal,\n27(3), 379-423.',
  '7. Krugman, P. R. (1979). Increasing returns, monopolistic competition, and international trade.\nJournal of International Economics, 9(4), 469-479.',
  '8. Kahneman, D., & Tversky, A. (1979). Prospect theory: An analysis of decision under risk.\nEconometrica, 47(2), 263-291.',
  '9. Aljohani, Mohammed, and Tanweer Alam. "An algorithm for accessing traffic database using wireless technologies."\nIn Computational Intelligence and Computing Research (ICCIC), 2015 IEEE International Conference on, pp. 1-4. IEEE, 2015.\nDOI: https://doi.org/10.1109/iccic.2015.7435818',
  '10. Shapiro, Jonathan. "Genetic algorithms in machine learning."\nIn Advanced Course on Artificial Intelligence, pp. 146-168. Springer, Berlin, Heidelberg, 1999.',
  '11. Kennedy, David. New Relations: The Refashioning of British Poetry 1980-1994.\nBridgend: Seren, 1996.',
  '12. Smith, Z. (2017). Swing time.\nLondon: Penguin.',
  '13. Arlow, J., & Neustadt, I. (2005). UML 2 and the Unified Process: Practical Object-Oriented Analysis and Design.\nUpper Saddle River, NJ: Addison-Wesley.',
  '14. Gamma, E., Helm, R., Johnson, R., & Vlissides, J. (1994). Design Patterns: Elements of Reusable Object-Oriented Software.\nReading, MA: Addison-Wesley.',
  '15. World Health Organization. Global tuberculosis report 2023.\nGeneva: World Health Organization; 2023.',
  '16. European Medicines Agency. Guideline on medical literature monitoring.\nAmsterdam: EMA; 2020.',
  "17. UN Women. Progress of the world's women 2019-2020: families in a changing world.\nNew York: UN Women; 2019.",
  '18. Darwin, C. (1859). On the Origin of Species by Means of Natural Selection.\nLondon: John Murray.',
  '19. Tapping into the drug discovery potential of AI. (2021).\nhttps://www.nature.com/articles/d43747-021-00045-7.',
  '20. OpenAI. GPT-5 system card. (2025).\nAvailable from: https://openai.com/research/gpt-5-system-card.',
] as const;

const RAW_UNSTRUCTURED_REFERENCES = [
  'Smith JA, Doe RB. Neural network optimization in low-resource environments. J Artif Intell Res. 2023, 45(2):112-128.',
  'Chen L, Wang X, Liu Y. Impact of urban green spaces on mental health: a longitudinal study. Environ Health Perspect. 2022, 130(4):047005.',
  'Nakamura H. Quantum entanglement in macroscopic systems. Nature Physics. 2020, 16(8):814-820.',
  'Bellur S, Nowak KL, Hull KS. Make it our time: in class multitaskers have lower academic performance. Computers in Human Behavior. 2015, 53:63-70.',
  'Turing AM. Computing machinery and intelligence. Mind. 1950, 59(236):433-460.',
  'Shannon CE. A mathematical theory of communication. Bell System Technical Journal. 1948, 27(3):379-423.',
  'Krugman PR. Increasing returns, monopolistic competition, and international trade. Journal of International Economics. 1979, 9(4):469-479.',
  'Kahneman D, Tversky A. Prospect theory: an analysis of decision under risk. Econometrica. 1979, 47(2):263-291.',
  'Skalic M, Jimenez J, Sabbadin D, De Fabritiis G: Shape-based generative modeling for de novo drug design. J Chem Inf Model. 2019, 59:1205-14. 10.1021/acs.jcim.8b00706',
  'Page, Matthew J, Joanne E McKenzie, Patrick M Bossuyt. "The PRISMA 2020 statement: an updated guideline for reporting systematic reviews." BMJ 372 (2021): n71.',
  'Aljohani, Mohammed, and Tanweer Alam. "An algorithm for accessing traffic database using wireless technologies." In Computational Intelligence and Computing Research (ICCIC), 2015 IEEE International Conference on, pp. 1-4. IEEE, 2015. DOI: https://doi.org/10.1109/iccic.2015.7435818',
  'Shapiro, Jonathan. "Genetic algorithms in machine learning." In Advanced Course on Arti- ficial Intelligence, pp. 146-168. Springer, Berlin, Heidelberg, 1999.',
  'Kennedy, David. New Relations: The Refashioning of British Poetry 1980-1994. Bridgend: Seren, 1996.',
  'Arlow, J., & Neustadt, I. UML 2 and the Unified Process: Practical Object-Oriented Analysis and Design. Upper Saddle River, NJ: Addison-Wesley; 2005.',
  'World Health Organization. Global tuberculosis report 2023. Geneva: World Health Organization; 2023.',
  'European Medicines Agency. Guideline on medical literature monitoring. Amsterdam: EMA; 2020.',
  "UN Women. Progress of the world's women 2019-2020: families in a changing world. New York: UN Women; 2019.",
  '[10] Tabassum M, Mathew K, A genetic algorithm analysis towards optimization solutions, International Journal of Digital Information and Wireless Communications (IJDIWC), 2014 Jan 1, 4(1), 124-42.',
  'Tapping into the drug discovery potential of AI . (2021). https://www.nature.com/articles/d43747-021-\n00045-7.',
  'OpenAI. GPT-5 system card. 2025. Available from: https://openai.com/research/gpt-5-system-card.',
] as const;

function repeatToTotal(references: readonly string[], total: number): string[] {
  return Array.from({ length: total }, (_, index) => references[index % references.length] ?? references[0] ?? '');
}

function formatChunk(mode: ChunkedReadyMode, references: string[], chunkIndex: number): string {
  if (mode === 'structured') {
    return references.map((reference, index) => `${(chunkIndex * references.length) + index + 1}. ${reference}`).join('\n\n');
  }
  if (mode === 'semi_structured') {
    return references.map((reference, index) => `${(chunkIndex * references.length) + index + 1}) ${reference}`).join('\n');
  }
  return references.join('\n\n');
}

export function buildChunkedReadyCorpus(
  mode: ChunkedReadyMode,
  total: number = READY_CORPUS_TOTAL,
  chunkSize: number = READY_CORPUS_CHUNK_SIZE,
): string[] {
  const base = mode === 'structured'
    ? STRUCTURED_REFERENCES
    : mode === 'semi_structured'
      ? SEMI_STRUCTURED_REFERENCES
      : RAW_UNSTRUCTURED_REFERENCES;
  const expanded = repeatToTotal(base, total);
  const chunks: string[] = [];
  for (let start = 0; start < expanded.length; start += chunkSize) {
    chunks.push(formatChunk(mode, expanded.slice(start, start + chunkSize), chunks.length));
  }
  return chunks;
}
