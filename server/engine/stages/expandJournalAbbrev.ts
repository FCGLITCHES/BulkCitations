/**
 * Stage 6: Journal Abbreviation Expansion
 * 
 * Expands abbreviated journal names to their full forms.
 * Uses a two-pass lookup: exact match first, then case-insensitive.
 * 
 * Called from normalizeParsedReference() in the engine pipeline,
 * after initial field extraction and before CSL conversion.
 */

import { JOURNAL_ABBREVIATIONS } from '../../../shared/journalAbbreviations';

/**
 * Extended abbreviation table for additional common journals
 * not yet in the shared list. These will be merged into shared/journalAbbreviations.ts
 * in a follow-up clean-up pass.
 */
const EXTENDED_ABBREVIATIONS: Record<string, string> = {
  // Physics & Math
  'Phys. Rev. Lett.': 'Physical Review Letters',
  'PRL': 'Physical Review Letters',
  'Phys. Rev. B': 'Physical Review B',
  'Phys. Rev. D': 'Physical Review D',
  'Phys. Rev. E': 'Physical Review E',
  'J. Phys. Chem.': 'Journal of Physical Chemistry',
  'J. Chem. Phys.': 'Journal of Chemical Physics',
  'J. Comput. Phys.': 'Journal of Computational Physics',
  'Math. Ann.': 'Mathematische Annalen',
  'J. Math. Phys.': 'Journal of Mathematical Physics',
  'Comm. Math. Phys.': 'Communications in Mathematical Physics',

  // Computer Science & Engineering
  'IEEE Trans. Neural Netw.': 'IEEE Transactions on Neural Networks',
  'IEEE Trans. Pattern Anal. Mach. Intell.': 'IEEE Transactions on Pattern Analysis and Machine Intelligence',
  'IEEE Trans. Image Process.': 'IEEE Transactions on Image Processing',
  'IEEE Trans. Inf. Theory': 'IEEE Transactions on Information Theory',
  'IEEE Trans. Commun.': 'IEEE Transactions on Communications',
  'IEEE Trans. Signal Process.': 'IEEE Transactions on Signal Processing',
  'IEEE Trans. Ind. Electron.': 'IEEE Transactions on Industrial Electronics',
  'IEEE Trans. Power Electron.': 'IEEE Transactions on Power Electronics',
  'ACM Trans. Graph.': 'ACM Transactions on Graphics',
  'ACM Trans. Comput. Syst.': 'ACM Transactions on Computer Systems',
  'J. ACM': 'Journal of the ACM',
  'Commun. ACM': 'Communications of the ACM',
  'Artif. Intell.': 'Artificial Intelligence',
  'J. Mach. Learn. Res.': 'Journal of Machine Learning Research',
  'JMLR': 'Journal of Machine Learning Research',
  'Mach. Learn.': 'Machine Learning',
  'Neural Netw.': 'Neural Networks',
  'Pattern Recognit.': 'Pattern Recognition',
  'Expert Syst. Appl.': 'Expert Systems with Applications',
  'Knowl.-Based Syst.': 'Knowledge-Based Systems',
  'Inf. Sci.': 'Information Sciences',
  'Inf. Process. Manag.': 'Information Processing & Management',
  'Comput. Vis. Image Underst.': 'Computer Vision and Image Understanding',
  'Int. J. Comput. Vis.': 'International Journal of Computer Vision',
  'IJCV': 'International Journal of Computer Vision',
  'J. Comput. Sci.': 'Journal of Computer Science',

  // Biology
  'Nat. Commun.': 'Nature Communications',
  'eLife': 'eLife',
  'PLoS Biol.': 'PLoS Biology',
  'PLoS ONE': 'PLoS ONE',
  'PLoS Comput. Biol.': 'PLoS Computational Biology',
  'PLoS Pathog.': 'PLoS Pathogens',
  'PLoS Genet.': 'PLoS Genetics',
  'PLoS Med.': 'PLoS Medicine',
  'Mol. Biol. Evol.': 'Molecular Biology and Evolution',
  'Genome Res.': 'Genome Research',
  'Genome Biol.': 'Genome Biology',
  'Nucleic Acids Res.': 'Nucleic Acids Research',
  'J. Mol. Biol.': 'Journal of Molecular Biology',
  'Bioinformatics': 'Bioinformatics',
  'BMC Bioinformatics': 'BMC Bioinformatics',
  'Brief. Bioinform.': 'Briefings in Bioinformatics',
  'Curr. Biol.': 'Current Biology',
  'Dev. Cell': 'Developmental Cell',
  'Mol. Cell': 'Molecular Cell',
  'Plant Cell': 'The Plant Cell',
  'Plant J.': 'The Plant Journal',
  'J. Biol. Chem.': 'Journal of Biological Chemistry',

  // Medicine
  'N Engl J Med': 'New England Journal of Medicine',
  'J Clin Invest': 'Journal of Clinical Investigation',
  'J. Clin. Invest.': 'Journal of Clinical Investigation',
  'Am. J. Med.': 'American Journal of Medicine',
  'Medicine (Baltimore)': 'Medicine',
  'Crit. Care Med.': 'Critical Care Medicine',
  'Intensive Care Med.': 'Intensive Care Medicine',
  'J. Trauma': 'Journal of Trauma',
  'Anesthesiology': 'Anesthesiology',
  'Br. J. Anaesth.': 'British Journal of Anaesthesia',
  'J. Allergy Clin. Immunol.': 'Journal of Allergy and Clinical Immunology',
  'J. Immunol.': 'Journal of Immunology',
  'Immunity': 'Immunity',
  'J. Exp. Med.': 'Journal of Experimental Medicine',
  'Eur. J. Immunol.': 'European Journal of Immunology',
  'Ann. Oncol.': 'Annals of Oncology',
  'Cancer Res.': 'Cancer Research',
  'Clin. Cancer Res.': 'Clinical Cancer Research',
  'Br. J. Cancer': 'British Journal of Cancer',
  'J. Natl. Cancer Inst.': 'Journal of the National Cancer Institute',
  'JNCI': 'Journal of the National Cancer Institute',

  // Social Sciences
  'Am. Econ. Rev.': 'American Economic Review',
  'AER': 'American Economic Review',
  'Q. J. Econ.': 'Quarterly Journal of Economics',
  'J. Polit. Econ.': 'Journal of Political Economy',
  'Econometrica': 'Econometrica',
  'Rev. Econ. Stud.': 'Review of Economic Studies',
  'Am. Sociol. Rev.': 'American Sociological Review',
  'Am. J. Sociol.': 'American Journal of Sociology',
  'Soc. Sci. Med.': 'Social Science & Medicine',
  'Ann. Rev. Sociol.': 'Annual Review of Sociology',
  'Ann. Rev. Psychol.': 'Annual Review of Psychology',
  'Psychol. Rev.': 'Psychological Review',
  'Psychol. Bull.': 'Psychological Bulletin',
  'J. Pers. Soc. Psychol.': 'Journal of Personality and Social Psychology',
  'J. Exp. Psychol.': 'Journal of Experimental Psychology',

  // Environmental Science
  'Environ. Sci. Technol.': 'Environmental Science & Technology',
  'Atmos. Environ.': 'Atmospheric Environment',
  'Water Res.': 'Water Research',
  'Glob. Chang. Biol.': 'Global Change Biology',
  'Clim. Change': 'Climatic Change',
  'Nat. Clim. Chang.': 'Nature Climate Change',
  'Ecol. Lett.': 'Ecology Letters',
  'Ecology': 'Ecology',
  'J. Ecol.': 'Journal of Ecology',
  'Environ. Pollut.': 'Environmental Pollution',

  // Chemistry & Materials
  'J. Am. Chem. Soc.': 'Journal of the American Chemical Society',
  'JACS': 'Journal of the American Chemical Society',
  'Angew. Chem. Int. Ed.': 'Angewandte Chemie International Edition',
  'Chem. Sci.': 'Chemical Science',
  'ACS Nano': 'ACS Nano',
  'Nano Lett.': 'Nano Letters',
  'Nat. Mater.': 'Nature Materials',
  'Nat. Nanotechnol.': 'Nature Nanotechnology',
  'Adv. Mater.': 'Advanced Materials',
  'J. Mater. Chem.': 'Journal of Materials Chemistry',
  'Acta Mater.': 'Acta Materialia',
  'npj Comput. Mater.': 'npj Computational Materials',
};

// Build merged lookup table (case-normalised keys)
const MERGED: Record<string, string> = {};
for (const [abbr, full] of Object.entries(JOURNAL_ABBREVIATIONS)) {
  MERGED[abbr.toLowerCase().trim()] = full;
}
for (const [abbr, full] of Object.entries(EXTENDED_ABBREVIATIONS)) {
  MERGED[abbr.toLowerCase().trim()] = full;
}

/**
 * Try to expand an abbreviated journal name to its full form.
 * 
 * @param abbreviated The potentially abbreviated journal name
 * @returns The full journal name if known, otherwise the original string
 */
export function expandJournalName(abbreviated: string): string {
  if (!abbreviated || abbreviated.length < 2) return abbreviated;
  const key = abbreviated.trim().toLowerCase();
  return MERGED[key] ?? abbreviated;
}

/**
 * Check if a journal name looks abbreviated.
 * (Heuristic: contains ". " pattern or is all-caps 2-6 chars)
 */
export function looksAbbreviated(journal: string): boolean {
  if (!journal) return false;
  // ISO pattern: "J. Am. Chem. Soc."
  if (/\w+\.\s+\w/.test(journal)) return true;
  // All-caps acronym: "JAMA", "NEJM", "BMJ"
  if (/^[A-Z]{2,6}$/.test(journal.trim())) return true;
  return false;
}
