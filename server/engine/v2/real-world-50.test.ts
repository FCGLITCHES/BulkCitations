import { afterEach, describe, expect, it } from 'vitest';
import { processV2Conversion } from './pipeline.js';

const REAL_WORLD_50 = [
  'Smith, J. A., & Doe, R. B. (2023). Neural network optimization in low-resource environments. Journal of Artificial Intelligence Research, 45(2), 112-128. doi.org',
  'Chen, L., Wang, X., & Liu, Y. (2022). Impact of urban green spaces on mental health: A longitudinal study. Environmental Health Perspectives, 130(4), 047005. doi.org',
  'Rodriguez, M. S. (2021). The role of micro-LEDs in next-generation display technology. Advanced Optical Materials, 9(15), 2100456. doi.org',
  'Thompson, K., & Williams, P. (2024). Re-evaluating the Bretton Woods system in a digital economy. Global Economic Review, 53(1), 15-39. doi.org',
  'Nakamura, H. (2020). Quantum entanglement in macroscopic systems. Nature Physics, 16(8), 814-820. doi.org',
  'Gupta, V., & Miller, S. T. (2022). Genomic sequencing and the future of personalized oncology. The Lancet Oncology, 23(11), e512-e524. doi.org',
  'Patel, A. R. (2023). Blockchain applications in secure supply chain management. International Journal of Production Economics, 255, 108682. doi.org',
  'Lee, S. Y., & Kim, Y. J. (2021). Linguistic patterns in social media communication during global crises. Journal of Pragmatics, 178, 145-160. doi.org',
  'Foster, G. L., Hull, P. M., Lunt, D. J., & Zachos, J. C. (2022). Ocean acidification rates in the North Atlantic over the last millennium. Paleoceanography and Paleoclimatology, 37(3), e2021PA004354. doi.org',
  'Brown, E. (2024). Ethics of autonomous vehicle decision-making frameworks. Ethics and Information Technology, 26(1), 12. doi.org',
  'Bellur, S., Nowak, K. L., & Hull, K. S. (2015). Make it our time: In class multitaskers have lower academic performance. Computers in Human Behavior, 53, 63-70. doi.org',
  'Kennedy, David. New Relations: The Refashioning of British Poetry 1980-1994. Bridgend: Seren, 1996.',
  'Garabaghi, K., & Stuart, C. (2013). Right here, right now: Exploring life-space interventions for children and youth. Don Mills, Ontario: Pearson Education Canada.',
  'Smith, Z. (2017) Swing time. London: Penguin.',
  'Tokarczuk, O. (2019) Drive your plow over the bones of the dead. Translated from the Polish by A. Lloyd-Jones. London: Fitzcarraldo Editions.',
  'Arlow, J., & Neustadt, I. (2005). UML 2 and the Unified Process: Practical Object-Oriented Analysis and Design. Upper Saddle River, NJ: Addison-Wesley.',
  'Berners-Lee, T., & Fischetti, M. (1999). Weaving the Web: The Original Design and Ultimate Destiny of the World Wide Web. San Francisco: Harper San Francisco.',
  'Knuth, D. E. (1997). The Art of Computer Programming, Volume 1: Fundamental Algorithms (3rd ed.). Boston: Addison-Wesley.',
  'Gamma, E., Helm, R., Johnson, R., & Vlissides, J. (1994). Design Patterns: Elements of Reusable Object-Oriented Software. Reading, MA: Addison-Wesley.',
  'Turing, A. M. (1950). Computing machinery and intelligence. Mind, 59(236), 433-460. doi.org',
  'Shannon, C. E. (1948). A mathematical theory of communication. The Bell System Technical Journal, 27(3), 379-423. doi.org',
  'Einstein, A. (1905). On the electrodynamics of moving bodies. Annalen der Physik, 17(10), 891-921.',
  'Watson, J. D., & Crick, F. H. (1953). Molecular structure of nucleic acids: A structure for deoxyribose nucleic acid. Nature, 171(4356), 737-738. doi.org',
  'Hawking, S. W. (1974). Black hole explosions? Nature, 248(5443), 30-31. doi.org',
  'Darwin, C. (1859). On the Origin of Species by Means of Natural Selection. London: John Murray.',
  'Lovelock, J. E., & Margulis, L. (1974). Atmospheric homeostasis by and for the biosphere: the gaia hypothesis. Tellus, 26(1-2), 2-10. doi.org',
  'Krugman, P. R. (1979). Increasing returns, monopolistic competition, and international trade. Journal of International Economics, 9(4), 469-479. doi.org',
  'Kahneman, D., & Tversky, A. (1979). Prospect theory: An analysis of decision under risk. Econometrica, 47(2), 263-291. doi.org',
  'Fukuyama, F. (1989). The end of history? The National Interest, (16), 3-18.',
  'Chomsky, N. (1957). Syntactic Structures. The Hague: Mouton.',
  'Said, E. W. (1978). Orientalism. New York: Pantheon Books.',
  'Butler, J. (1990). Gender Trouble: Feminism and the Subversion of Identity. New York: Routledge.',
  'Foucault, M. (1975). Discipline and Punish: The Birth of the Prison. Paris: Gallimard.',
  'Bourdieu, P. (1977). Outline of a Theory of Practice. Cambridge: Cambridge University Press.',
  'Habermas, J. (1981). The Theory of Communicative Action. Boston: Beacon Press.',
  'Rawls, J. (1971). A Theory of Justice. Cambridge, MA: Harvard University Press.',
  'Nozick, R. (1974). Anarchy, State, and Utopia. New York: Basic Books.',
  'Sen, A. (1999). Development as Freedom. New York: Oxford University Press.',
  'Picketty, T. (2014). Capital in the Twenty-First Century. Cambridge, MA: Harvard University Press.',
  'Diamond, J. (1997). Guns, Germs, and Steel: The Fates of Human Societies. New York: W.W. Norton & Company.',
  'Harari, Y. N. (2014). Sapiens: A Brief History of Humankind. London: Harvill Secker.',
  'Sassen, S. (1991). The Global City: New York, London, Tokyo. Princeton, NJ: Princeton University Press.',
  'Castells, M. (1996). The Rise of the Network Society. Oxford: Blackwell.',
  'Beck, U. (1992). Risk Society: Towards a New Modernity. London: Sage.',
  'Giddens, A. (1990). The Consequences of Modernity. Stanford, CA: Stanford University Press.',
  'Harvey, D. (1989). The Condition of Postmodernity. Oxford: Blackwell.',
  'Appadurai, A. (1996). Modernity At Large: Cultural Dimensions of Globalization. Minneapolis: University of Minnesota Press.',
  'Latour, B. (1987). Science in Action: How to Follow Scientists and Engineers Through Society. Cambridge, MA: Harvard University Press.',
  'Haraway, D. J. (1991). Simians, Cyborgs, and Women: The Reinvention of Nature. New York: Routledge.',
  'Crenshaw, K. (1989). Demarginalizing the intersection of race and sex. University of Chicago Legal Forum, 1989(1), 139-167.',
] as const;

describe('v2 real-world 50-reference stress corpus', () => {
  afterEach(() => {
    delete process.env.ENABLE_LLM_EXTRACTOR;
    delete process.env.ENABLE_GROBID_EXTRACTOR;
  });

  it('keeps real-world authors and book tails structurally intact', async () => {
    process.env.ENABLE_LLM_EXTRACTOR = '0';
    process.env.ENABLE_GROBID_EXTRACTOR = '0';

    const { response } = await processV2Conversion({
      sourceType: 'text',
      content: REAL_WORLD_50.join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: false,
    }, {
      executionMode: 'sync',
    });

    expect(response.citations).toHaveLength(50);

    const formatted = response.citations.map((citation) => citation.rendered?.formatted ?? '').join('\n');
    expect(formatted).not.toMatch(/\b[A-Z][a-z]+,\s*[A-Z]\.,\s*[A-Z]\./);
    expect(formatted).not.toContain('& &');
    expect(formatted).not.toContain('Software.Addison-Wesley');
    expect(formatted).not.toContain('Society.Harvard University Press');

    expect(response.citations[0]?.rendered?.formatted).toContain('Smith, J. A., & Doe, R. B. (2023).');
    expect(response.citations[7]?.rendered?.formatted).toContain('Lee, S. Y., & Kim, Y. J. (2021).');
    expect(response.citations[22]?.rendered?.formatted).toContain('Watson, J. D., & Crick, F. H. (1953).');

    const kennedy = response.citations[11];
    expect(kennedy?.referenceType).toBe('book');
    expect(kennedy?.rendered?.formatted).toContain('New Relations: The Refashioning of British Poetry 1980-1994');
    expect(kennedy?.rendered?.formatted).toContain('Seren.');

    const smith = response.citations[13];
    expect(smith?.referenceType).toBe('book');
    expect(smith?.rendered?.formatted).toContain('Swing time.');
    expect(smith?.rendered?.formatted).toContain('Penguin.');

    const tokarczuk = response.citations[14];
    expect(tokarczuk?.referenceType).toBe('book');
    expect(tokarczuk?.rendered?.formatted).toContain('Drive your plow over the bones of the dead.');
    expect(tokarczuk?.rendered?.formatted).toContain('Fitzcarraldo Editions.');

    const arlow = response.citations[15];
    expect(arlow?.referenceType).toBe('book');
    expect(arlow?.rendered?.formatted).toContain('UML 2 and the Unified Process: Practical Object-Oriented Analysis and Design.');
    expect(arlow?.rendered?.formatted).toContain('Addison-Wesley.');

    const gamma = response.citations[18];
    expect(gamma?.referenceType).toBe('book');
    expect(gamma?.rendered?.formatted).toContain('Design Patterns: Elements of Reusable Object-Oriented Software.');
    expect(gamma?.rendered?.formatted).toContain('Addison-Wesley.');
  });
});
