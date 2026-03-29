import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { processV2Conversion } from './pipeline.js';
import { canonicalizePotentialDoi } from './rawPdfCopy.js';
import {
  analyzeReadyBlockers,
  deriveResolutionBucketState,
  extractIdentifierHits,
  REVIEW_CONFIDENCE_FLOOR,
} from './readyBlockers.js';

export type PdfBenchmarkMode = 'pdf_upload' | 'pdf_copy_paste';

type CoreField = 'title' | 'firstAuthorLast' | 'year';

export interface PdfBenchmarkExpectedCitation {
  raw: string;
  normalizedRaw: string;
  title: string;
  firstAuthorLast: string;
  year: string;
  doi: string | null;
  provenance: string;
  failureMode: string;
}

export interface PdfBenchmarkBatch {
  id: string;
  label: string;
  provenance: string;
  failureMode: string;
  rawInput: string;
  citations: PdfBenchmarkExpectedCitation[];
}

export interface PdfBenchmarkMetrics {
  countIntegrityPct: number;
  requiredFieldsPct: number;
  doiRetentionPct: number;
  readyPct: number;
  worthReviewingPct: number;
  actionNeededPct: number;
  contaminationFreePct: number;
  partialChunkPct: number;
  falseReadyPct: number;
  corruptReviewPct: number;
  nearReadyReviewPct: number;
  singleLinkPct: number;
  incompatibleFieldOverlapPct: number;
}

export interface PdfBenchmarkFailureSample {
  batchId: string;
  citationIndex: number;
  input: string;
  output: string;
  reasons: string[];
}

export interface PdfBenchmarkModeResult {
  mode: PdfBenchmarkMode;
  targetCorpusSize: number;
  corpusSize: number;
  corpusHash: string;
  duplicateInputCount: number;
  batchCount: number;
  metrics: PdfBenchmarkMetrics;
  contaminationByField: Record<CoreField, number>;
  topFailingSamples: PdfBenchmarkFailureSample[];
}

export interface PdfBenchmarkReport {
  generatedAt: string;
  targetCorpusSize: number;
  modes: PdfBenchmarkModeResult[];
}

const TARGET_CORPUS_SIZE = 1000;
const PDF_BENCHMARK_BATCH_CHUNK_SIZE = 20;
const DRUG_AI_STRESS_PATH = path.resolve(process.cwd(), 'scripts', 'data', 'stress-batch-20260322-drug-ai-extended.txt');

const RAW_PDF_BRACKET = `[1] Whitley D, A genetic algorithm tutorial, Statistics and computing, 1994 Jun 1;4(2):65-85. 

[2] Goldberg DE, Holland JH, Genetic algorithms and machine learning, 1988. 

[3] Holland JH, Genetic algorithms, Scientific American, 1992 Jul 1;267(1), 66-73.
 
[4] Mirjalili S, Dong JS, Sadiq AS, Faris H. Genetic algorithm: Theory, literature review, and 
application in image reconstruction. InNature-Inspired Optimizers 2020 (pp. 69-85). 


[5] Mirjalili, Seyedali, Genetic algorithm, In Evolutionary algorithms and neural networks, pp. 43-55. Springer, Cham, 2019.

[6] Kramer, Olive, Genetic algorithm essentials, Vol. 679. Springer, 2017.

[7] S. R, R. T, A review of selection methods in genetic algorithm, Int. j. of eng. Sc. and tech., 
2011 May, 3(5), 3792-7. 

[8] Arabali, Amirsaman, Mahmoud Ghofrani, Mehdi Etezadi-Amoli, M. Sami Fadali, and Ya-
hia Baghzouz. "Genetic-algorithm-based optimization approach for energy management." 
IEEE Transactions on Power Delivery 28, no. 1 (2012): 162-170.

[9] Mathew, T.V., 2012. Genetic algorithm. Report submitted at IIT Bombay.

[10] Tabassum M, Mathew K, A genetic algorithm analysis towards optimization solutions, In-
ternational Journal of Digital Information and Wireless Communications (IJDIWC), 2014 
Jan 1, 4(1), 124-42.

[11] Yang, Jinhui, Chunguo Wu, Heow Pueh Lee, and Yanchun Liang. "Solving traveling 
salesman problems using generalized chromosome genetic algorithm." Progress in Natural 
Science 18, no. 7 (2008): 887-892.

[12] Hariyadi, Putri Mutira, Phong Thanh Nguyen, Iswanto Iswanto, and Dadang Sudrajat. 
"Traveling Salesman Problem Solution using Genetic Algorithm." Journal of Critical Re-
views, Vol 7, no. 1 (2020): 56-61.

[13] Tanweer Alam, "IoT-Fog: A Communication Framework using Blockchain in the Internet 
of Things", International Journal of Recent Technology and Engineering (IJRTE), Vol-
ume-7, Issue-6, 2019. 

[14] Tanweer Alam, "Blockchain and its Role in the Internet of Things (IoT)", International 
Journal of Scientific Research in Computer Science, Engineering and Information Tech-
nology, vol. 5(1), pp. 151-157, 2019. DOI: https://doi.org/10.32628/CSEIT195137

[15] Tanweer Alam, "Internet of Things: A Secure Cloud-Based MANET Mobility Model", In-
ternational Journal of Network Security, Vol. 22(3), 2020.

[16] Tanweer Alam, "Efficient and Secure Data Transmission Approach in Cloud-MANET-IoT 
integrated Framework", Journal of Telecommunication, Electronic and Computer Engi Paper— Genetic Algorithm: Reviews, Implementation and Applications

[17] Alam T, Benaida M. "The Role of Cloud-MANET Framework in the Internet of Things 
(IoT)", International Journal of Online Engineering (iJOE). Vol. 14(12), pp. 97-111. DOI: 
https://doi.org/10.3991/ijoe.v14i12.8338 

[18] Alam, Tanweer. "Middleware Implementation in Cloud-MANET Mobility Model for In-
ternet of Smart Devices", International Journal of Computer Science and Network Secu-
rity, 17(5), 2017. Pp. 86-94
[19] Alam T, Benaida M. CICS: Cloud–Internet Communication Security Framework for the 
Internet of Smart Devices. International Journal of Interactive Mobile Technologies 
(iJIM). 2018 Nov 1;12(6):74-84. DOI: https://doi.org/10.3991/ijim.v12i6.6776

[20] Alam, Tanweer. (2018) "A reliable framework for communication in internet of smart de-
vices using IEEE 802.15.4." ARPN Journal of Engineering and Applied Sciences 13(10), 
3378-3387. 

[21] Alam, Tanweer, and Mohammed Aljohani. "Design and implementation of an Ad Hoc 
Network among Android smart devices." In Green Computing and Internet of Things 
(ICGCIoT), 2015 International Conference on, pp. 1322-1327. IEEE, 2015. DOI: 
https://doi.org/10.1109/ICGCIoT.2015.7380671 

[22] Alam, Tanweer, and Mohammed Aljohani. "An approach to secure communication in mo-
bile ad-hoc networks of Android devices." In 2015 International Conference on Intelligent
Informatics and Biomedical Sciences (ICIIBMS), pp. 371-375. IEEE, 2015. DOI: 
https://doi.org/10.1109/iciibms.2015.7439466 

[23] Aljohani, Mohammed, and Tanweer Alam. "An algorithm for accessing traffic database 
using wireless technologies." In Computational Intelligence and Computing Research 
(ICCIC), 2015 IEEE International Conference on, pp. 1-4. IEEE, 2015. DOI: 
https://doi.org/10.1109/iccic.2015.7435818 

[24] Alam, Tanweer, and Mohammed Aljohani. "Design a new middleware for communication 
in ad hoc network of android smart devices." In Proceedings of the Second International 
Conference on Information and Communication Technology for Competitive Strategies, p. 
38. ACM, 2016. DOI: https://doi.org/10.1145/2905055.2905244 

[25] Alam, Tanweer. "Fuzzy control based mobility framework for evaluating mobility models 
in MANET of smart devices." ARPN Journal of Engineering and Applied Sciences 12, no. 
15 (2017): 4526-4538.

[26] Tanweer Alam, Mohamed Benaida. "Blockchain and Internet of Things in Higher Educa-
tion." Universal Journal of Educational Research 8.5 (2020). pp 2164 - 2174. DOI: 
https://doi.org/ 10.13189/ujer.2020.080556

[27] Tanweer Alam, Mohamed Benaida, "Blockchain, Fog and IoT Integrated Framework: Re-
view, Architecture and Evaluation", Technology Reports of Kansai University, Volume -
62 , Issue 02, 2020.

[28] Shapiro, Jonathan. "Genetic algorithms in machine learning." In Advanced Course on Arti-
ficial Intelligence, pp. 146-168. Springer, Berlin, Heidelberg, 1999.

[29] Jedlicka, P., Ryba, T. Genetic algorithm application in image segmentation. Pattern Recog-
nit. Image Anal. 26, 497–501 (2016). 

[30] Baker, Barrie M., and M. A. Ayechew. "A genetic algorithm for the vehicle routing prob-
lem." Computers & Operations Research 30, no. 5 (2003): 787-800.

[31] Sivanandam, S. N., and S. N. Deepa. "Genetic algorithm optimization problems." In Intro-
duction to genetic algorithms, pp. 165-209. Springer, Berlin, Heidelberg, 2008.

[32] Cuevas, Erik, Daniel Zaldívar, and Marco Pérez-Cisneros. "A swarm optimization algo-
rithm for multimodal functions and its application in multicircle detection." Mathematical 
Problems in Engineering 2013 (2013). Paper— Genetic Algorithm: Reviews, Implementation and Applications

[33] Brooks, Arthur C. "Genetic algorithms and public economics." Journal of Public Economic 
Theory 2, no. 4 (2000): 493-513.

[34] Whitley, D., Starkweather, T. and Bogart, C., 1990. Genetic algorithms and neural net-
works: Optimizing connections and connectivity. Parallel computing, 14(3), pp.347-361.

[35] Nugroho, E.D., Wibowo, M.E. and Pulungan, R., 2017, July. Parallel implementation of 
genetic algorithm for searching optimal parameters of artificial neural networks. In 2017 
3rd International Conference on Science and Technology-Computer (ICST) (pp. 136-141). 
IEEE.

[36] Shrivastava, P., Dhingra, S.L. and Gundaliya, P.J., 2002. Application of genetic algorithm 
for scheduling and schedule coordination problems. Journal of advanced transporta-
tion, 36(1), pp.23-41.

[37] Toogood, R., Hao, H. and Wong, C., 1995, October. Robot path planning using genetic al-
gorithms. In 1995 IEEE International Conference on Systems, Man and Cybernetics. Intel-
ligent Systems for the 21st Century (Vol. 1, pp. 489-494). IEEE.

[38] Marta, A.C., 2008. Parametric study of a genetic algorithm using a aircraft design optimi-
zation problem. Report Stanford University, Department of Aeronautics and Astronautics.

[39] Piserchia, Zachary. "Applications of Genetic Algorithms in Bioinformatics." PhD diss., 
UC Riverside, 2018.

[40] Cvjetkovic, Vladimir. "Pocket labs supported IoT teaching." International Journal of Engi-
neering Pedagogy 8, no. 2 (2018): 32-48.

[41] Mironova, Olga, Irina Amitan, and Jüri Vilipõld. "Programming basics for beginners: Ex-
perience of the institute of informatics at Tallinn University of Technology." International 
Journal of Engineering Pedagogy. Vol. 7, No. 4, 2017

[42] Atoum, Issa. "A Spiral Software Engineering Model to Inspire Innovation and Creativity 
of University Students." International Journal of Engineering Pedagogy (iJEP) 9, no. 5 
(2019): 7-23.

[43] Liao, Y.H. and Sun, C.T., 2001. An educational genetic algorithms learning tool. IEEE 
transactions on Education, 44(2), pp.20-pp.

[44] Tanweer Alam. mHealth Communication Framework using blockchain and IoT Technolo-
gies. International Journal of Scientific & Technology Research. Vol 9(6), 2020

[45] T. Alam "Design a blockchain-based middleware layer in the Internet of Things Architec-
ture," JOIV : International Journal on Informatics Visualization, vol. 4, no. 1, , pp. 28 - 31, 
Feb. 2020. https://doi.org/10.30630/joiv.4.1.334

[46] Rajsingh, Elijah Blessing, Jey Veerasamy, Amir H. Alavi, and J. Dinesh Peter, eds. Ad-
vances in Big Data and Cloud Computing. Vol. 645. Springer, 2018.`;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeField(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 100;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function countIntegrityPercent(totalExpected: number, totalDrift: number): number {
  if (totalExpected <= 0) return 100;
  return Number((Math.max(0, 1 - (totalDrift / totalExpected)) * 100).toFixed(2));
}

function stripLeadingNumbering(value: string): string {
  return value.replace(/^\s*(?:\[\d+\]|\d+\.)\s+/, '').trim();
}

function segmentNumberedBatch(rawInput: string): string[] {
  const citations: string[] = [];
  let current = '';

  for (const line of rawInput.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) continue;

    if (/^\s*(?:\[\d+\]|\d+\.)\s+/.test(trimmed)) {
      if (current.trim()) citations.push(current.trim());
      current = trimmed;
      continue;
    }

    current = current ? `${current}\n${trimmed}` : trimmed;
  }

  if (current.trim()) citations.push(current.trim());
  return citations;
}

function chunkCitations<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function extractQuotedTitle(raw: string): string {
  const match = raw.match(/["“](.+?)["”]/);
  return match?.[1]?.trim() ?? '';
}

function extractFirstAuthorLast(raw: string): string {
  const cleaned = stripLeadingNumbering(raw);
  const quotedTitle = extractQuotedTitle(cleaned);
  if (quotedTitle) {
    const beforeQuote = cleaned.slice(0, cleaned.indexOf(quotedTitle)).trim();
    const authorToken = beforeQuote.split(/[,\s]+/).filter(Boolean)[0] ?? '';
    return normalizeField(authorToken);
  }

  const commaLead = cleaned.match(/^([^,]+),/);
  if (commaLead?.[1]) {
    return normalizeField(commaLead[1]);
  }

  const plainLead = cleaned.match(/^([A-Za-zÀ-ÖØ-öø-ÿ'’.-]+)/);
  return normalizeField(plainLead?.[1] ?? '');
}

function extractYear(raw: string): string {
  return raw.match(/\b(19|20)\d{2}\b/)?.[0] ?? '';
}

function extractTitle(raw: string): string {
  const cleaned = stripLeadingNumbering(raw);
  const quoted = extractQuotedTitle(cleaned);
  if (quoted) return normalizeField(quoted);

  const colonIndex = cleaned.indexOf(':');
  if (colonIndex >= 0) {
    const colonTitle = cleaned.slice(colonIndex + 1).split(/\.\s+/)[0] ?? '';
    if (normalizeField(colonTitle)) return normalizeField(colonTitle);
  }

  const yearMatch = cleaned.match(/\b(19|20)\d{2}\b/);
  if (yearMatch?.index != null) {
    const afterYear = cleaned.slice(yearMatch.index + yearMatch[0].length).replace(/^[^A-Za-z0-9]+/, '');
    const afterYearTitle = afterYear.split(/\.\s+/)[0] ?? '';
    if (normalizeField(afterYearTitle)) return normalizeField(afterYearTitle);
  }

  const sentences = cleaned
    .split(/\.\s+/)
    .map((part) => normalizeField(part))
    .filter(Boolean);
  return sentences[1] ?? sentences[0] ?? '';
}

function extractExpectedCitation(raw: string, provenance: string, failureMode: string): PdfBenchmarkExpectedCitation {
  return {
    raw,
    normalizedRaw: normalizeField(stripLeadingNumbering(raw)),
    title: extractTitle(raw),
    firstAuthorLast: extractFirstAuthorLast(raw),
    year: extractYear(raw),
    doi: canonicalizePotentialDoi(raw),
    provenance,
    failureMode,
  };
}

async function loadCorpusBatches(): Promise<PdfBenchmarkBatch[]> {
  const drugAiRaw = await readFile(DRUG_AI_STRESS_PATH, 'utf8');
  const batches: Array<{
    id: string;
    label: string;
    provenance: string;
    failureMode: string;
    rawInput: string;
  }> = [
    {
      id: 'drug-ai-extended',
      label: 'Drug AI extended PDF copy batch',
      provenance: 'scripts/data/stress-batch-20260322-drug-ai-extended.txt',
      failureMode: 'pdf_copy_split_token_artifact',
      rawInput: drugAiRaw,
    },
    {
      id: 'genetic-algorithm-bracket',
      label: 'Bracket-numbered genetic algorithm batch',
      provenance: 'tests/test-pdf-citations.test.ts#RAW_PDF_BRACKET',
      failureMode: 'numbered_batch_clumping',
      rawInput: RAW_PDF_BRACKET,
    },
  ];

  const seen = new Set<string>();
  let duplicateInputCount = 0;
  const result: PdfBenchmarkBatch[] = [];

  for (const batch of batches) {
    const citations = segmentNumberedBatch(batch.rawInput)
      .map((citation) => extractExpectedCitation(citation, batch.provenance, batch.failureMode))
      .filter((citation) => {
        if (seen.has(citation.normalizedRaw)) {
          duplicateInputCount += 1;
          return false;
        }
        seen.add(citation.normalizedRaw);
        return true;
      });

    const citationChunks = chunkCitations(citations, PDF_BENCHMARK_BATCH_CHUNK_SIZE);
    citationChunks.forEach((citationChunk, chunkIndex) => {
      result.push({
        id: `${batch.id}-chunk-${chunkIndex + 1}`,
        label: `${batch.label} chunk ${chunkIndex + 1}`,
        provenance: batch.provenance,
        failureMode: batch.failureMode,
        rawInput: citationChunk.map((citation) => citation.raw).join('\n\n'),
        citations: citationChunk,
      });
    });
  }

  if (duplicateInputCount > 0) {
    throw new Error(`Duplicate PDF benchmark inputs detected: ${duplicateInputCount}`);
  }

  return result;
}

async function renderBatchPdfBuffer(batch: PdfBenchmarkBatch): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const lines = batch.rawInput.split(/\r?\n/);
    if (lines.length === 0) {
      doc.addPage();
    } else {
      lines.forEach((line) => {
        doc.text(line);
      });
    }

    doc.end();
  });
}

function buildCorpusHash(mode: PdfBenchmarkMode, batches: PdfBenchmarkBatch[]): string {
  const hash = createHash('sha256');
  hash.update(mode);
  for (const batch of batches) {
    hash.update(batch.id);
    for (const citation of batch.citations) {
      hash.update(citation.normalizedRaw);
    }
  }
  return hash.digest('hex');
}

function outputFirstAuthorLast(citation: any): string {
  const authors = Array.isArray(citation?.authors?.value) ? citation.authors.value : [];
  const firstAuthor = authors[0];
  return normalizeField(firstAuthor?.last ?? firstAuthor?.literal ?? '');
}

function outputTitle(citation: any): string {
  return normalizeField(citation?.title?.value ?? '');
}

function outputYear(citation: any): string {
  const year = citation?.year?.value;
  return year == null ? '' : String(year);
}

function outputDoi(citation: any): string | null {
  return canonicalizePotentialDoi(citation?.doi?.value ?? '');
}

function hasRequiredFields(citation: any): boolean {
  const authors = Array.isArray(citation?.authors?.value) ? citation.authors.value : [];
  return Boolean(citation?.title?.value) && authors.length > 0 && citation?.year?.value != null;
}

function detectContamination(
  expected: PdfBenchmarkExpectedCitation,
  output: any,
  allExpected: PdfBenchmarkExpectedCitation[],
): { contaminated: boolean; byField: Record<CoreField, number> } {
  const byField: Record<CoreField, number> = {
    title: 0,
    firstAuthorLast: 0,
    year: 0,
  };

  if (!output) {
    return { contaminated: true, byField };
  }

  const outputFields: Record<CoreField, string> = {
    title: outputTitle(output),
    firstAuthorLast: outputFirstAuthorLast(output),
    year: outputYear(output),
  };

  for (const field of Object.keys(outputFields) as CoreField[]) {
    const value = outputFields[field];
    if (!value) continue;
    const ownValue = expected[field];
    if (value === ownValue) continue;
    if (allExpected.some((candidate) => candidate !== expected && candidate[field] && candidate[field] === value)) {
      byField[field] += 1;
    }
  }

  return {
    contaminated: Object.values(byField).some((count) => count > 0),
    byField,
  };
}

function bucketOf(citation: any): 'ready' | 'worth_reviewing' | 'action_needed' {
  const bucket = citation?.quality?.bucket;
  if (bucket === 'ready' || bucket === 'worth_reviewing' || bucket === 'action_needed') {
    return bucket;
  }
  return 'action_needed';
}

function finalReadyBlockers(citation: any): string[] {
  if (Array.isArray(citation?.quality?.readyBlockers)) {
    return citation.quality.readyBlockers.filter((value: unknown): value is string => typeof value === 'string');
  }
  return [];
}

function renderedIdentifierTargetCount(citation: any): number {
  const text = [
    citation?.rendered?.formatted ?? '',
    citation?.doi?.value ?? '',
    citation?.url?.value ?? '',
  ].join(' ');
  return new Set(extractIdentifierHits(text).map((hit) => hit.target)).size;
}

export async function runPdfReadyBenchmarkMode(mode: PdfBenchmarkMode): Promise<PdfBenchmarkModeResult> {
  const previousLlm = process.env.ENABLE_LLM_EXTRACTOR;
  const previousGrobid = process.env.ENABLE_GROBID_EXTRACTOR;

  process.env.ENABLE_LLM_EXTRACTOR = '0';
  process.env.ENABLE_GROBID_EXTRACTOR = '0';

  try {
    const batches = await loadCorpusBatches();
    const corpusSize = batches.reduce((sum, batch) => sum + batch.citations.length, 0);
    const corpusHash = buildCorpusHash(mode, batches);
    const topFailingSamples: PdfBenchmarkFailureSample[] = [];
    const contaminationByField: Record<CoreField, number> = {
      title: 0,
      firstAuthorLast: 0,
      year: 0,
    };

    let requiredFieldsCount = 0;
    let doiExpectedCount = 0;
    let doiRetainedCount = 0;
    let readyCount = 0;
    let worthReviewingCount = 0;
    let actionNeededCount = 0;
    let contaminationFreeCount = 0;
    let partialBatchCount = 0;
    let totalCountDrift = 0;
    let falseReadyCount = 0;
    let corruptReviewCount = 0;
    let reviewEligibleCount = 0;
    let nearReadyReviewCount = 0;
    let singleLinkCount = 0;
    let incompatibleFieldOverlapCount = 0;

    for (const batch of batches) {
      const content = mode === 'pdf_copy_paste'
        ? batch.rawInput
        : (await renderBatchPdfBuffer(batch)).toString('base64');

      const { response } = await processV2Conversion({
        sourceType: mode === 'pdf_copy_paste' ? 'text' : 'pdf_base64',
        content,
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrich: false,
        dedup: false,
        group: false,
        debug: false,
      }, {
        executionMode: 'sync',
      });

      totalCountDrift += Math.abs(response.citations.length - batch.citations.length);
      if (response.processingPath.partialResult) {
        partialBatchCount += 1;
      }

      for (let index = 0; index < batch.citations.length; index += 1) {
        const expected = batch.citations[index]!;
        const actual = response.citations[index];
        const reasons: string[] = [];

        if (actual && hasRequiredFields(actual)) {
          requiredFieldsCount += 1;
        } else {
          reasons.push('missing_required_fields');
        }

        if (expected.doi) {
          doiExpectedCount += 1;
          if (actual && outputDoi(actual) === expected.doi) {
            doiRetainedCount += 1;
          } else {
            reasons.push('doi_not_retained');
          }
        }

        if (actual) {
          const bucket = bucketOf(actual);
          const blockerAnalysis = analyzeReadyBlockers(actual);
          const readyBlockers = finalReadyBlockers(actual);
          const hardBlockerCount = blockerAnalysis.hardCodes.length;
          const softBlockerCount = blockerAnalysis.softCodes.length;
          const resolutionState = deriveResolutionBucketState(actual);
          const reviewEligible = hardBlockerCount === 0
            && (
              softBlockerCount === 1
              || resolutionState.softUnresolvedAfterEscalation
            )
            && Number(actual?.quality?.overall ?? 0) >= REVIEW_CONFIDENCE_FLOOR
            && actual?.resolution?.repairFailed !== true;

          if (bucket === 'ready') readyCount += 1;
          else if (bucket === 'worth_reviewing') worthReviewingCount += 1;
          else actionNeededCount += 1;

          if (bucket === 'ready' && readyBlockers.length > 0) {
            falseReadyCount += 1;
            reasons.push('false_ready');
          }

          if (bucket === 'worth_reviewing' && (hardBlockerCount > 0 || softBlockerCount >= 2)) {
            corruptReviewCount += 1;
            reasons.push('corrupt_review');
          }

          if (reviewEligible) {
            reviewEligibleCount += 1;
            if (bucket === 'worth_reviewing') {
              nearReadyReviewCount += 1;
            }
          }

          if (renderedIdentifierTargetCount(actual) <= 1) {
            singleLinkCount += 1;
          } else {
            reasons.push('multiple_rendered_links');
          }

          if (readyBlockers.includes('incompatible_field_overlap')) {
            incompatibleFieldOverlapCount += 1;
            reasons.push('incompatible_field_overlap');
          }
        } else {
          actionNeededCount += 1;
          reasons.push('missing_output');
        }

        const contamination = detectContamination(expected, actual, batch.citations);
        if (!contamination.contaminated) {
          contaminationFreeCount += 1;
        } else {
          reasons.push('contamination_detected');
          for (const field of Object.keys(contamination.byField) as CoreField[]) {
            contaminationByField[field] += contamination.byField[field];
          }
        }

        if (reasons.length > 0 && topFailingSamples.length < 20) {
          topFailingSamples.push({
            batchId: batch.id,
            citationIndex: index,
            input: normalizeWhitespace(expected.raw),
            output: normalizeWhitespace(actual?.rendered?.formatted ?? actual?.raw ?? ''),
            reasons,
          });
        }
      }

      for (let index = batch.citations.length; index < response.citations.length; index += 1) {
        if (topFailingSamples.length >= 20) break;
        topFailingSamples.push({
          batchId: batch.id,
          citationIndex: index,
          input: '',
          output: normalizeWhitespace(response.citations[index]?.rendered?.formatted ?? response.citations[index]?.raw ?? ''),
          reasons: ['extra_output'],
        });
      }
    }

    return {
      mode,
      targetCorpusSize: TARGET_CORPUS_SIZE,
      corpusSize,
      corpusHash,
      duplicateInputCount: 0,
      batchCount: batches.length,
      metrics: {
        countIntegrityPct: countIntegrityPercent(corpusSize, totalCountDrift),
        requiredFieldsPct: toPercent(requiredFieldsCount, corpusSize),
        doiRetentionPct: toPercent(doiRetainedCount, doiExpectedCount),
        readyPct: toPercent(readyCount, corpusSize),
        worthReviewingPct: toPercent(worthReviewingCount, corpusSize),
        actionNeededPct: toPercent(actionNeededCount, corpusSize),
        contaminationFreePct: toPercent(contaminationFreeCount, corpusSize),
        partialChunkPct: toPercent(partialBatchCount, batches.length),
        falseReadyPct: toPercent(falseReadyCount, corpusSize),
        corruptReviewPct: toPercent(corruptReviewCount, corpusSize),
        nearReadyReviewPct: toPercent(nearReadyReviewCount, reviewEligibleCount),
        singleLinkPct: toPercent(singleLinkCount, corpusSize),
        incompatibleFieldOverlapPct: toPercent(incompatibleFieldOverlapCount, corpusSize),
      },
      contaminationByField,
      topFailingSamples,
    };
  } finally {
    if (previousLlm == null) delete process.env.ENABLE_LLM_EXTRACTOR;
    else process.env.ENABLE_LLM_EXTRACTOR = previousLlm;
    if (previousGrobid == null) delete process.env.ENABLE_GROBID_EXTRACTOR;
    else process.env.ENABLE_GROBID_EXTRACTOR = previousGrobid;
  }
}

export async function runPdfReadyBenchmark(): Promise<PdfBenchmarkReport> {
  return {
    generatedAt: new Date().toISOString(),
    targetCorpusSize: TARGET_CORPUS_SIZE,
    modes: await Promise.all([
      runPdfReadyBenchmarkMode('pdf_upload'),
      runPdfReadyBenchmarkMode('pdf_copy_paste'),
    ]),
  };
}
