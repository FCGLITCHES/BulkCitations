import { CitationParser } from "../server/engine/citationParser";
import { parsedReferenceToCSL, formatCSLData } from "../server/engine/cslConverter";
import { fixFormatting } from "../server/engine/strictRenderer";
import type { CitationStyle } from "@shared/schema";

const INPUT_STYLE: CitationStyle | "auto" = "auto";
const OUTPUT_STYLE: CitationStyle = "apa";

const refs: string[] = [
  '[1] Whitley D, A genetic algorithm tutorial, Statistics and computing, 1994 Jun 1;4(2):65-85.',
  '[2] Goldberg DE, Holland JH, Genetic algorithms and machine learning, 1988.',
  '[3] Holland JH, Genetic algorithms, Scientific American, 1992 Jul 1;267(1), 66-73.',
  '[4] Mirjalili S, Dong JS, Sadiq AS, Faris H. Genetic algorithm: Theory, literature review, and application in image reconstruction. InNature-Inspired Optimizers 2020 (pp. 69-85).',
  '[5] Mirjalili, Seyedali, Genetic algorithm, In Evolutionary algorithms and neural networks, pp. 43-55. Springer, Cham, 2019.',
  '[6] Kramer, Olive, Genetic algorithm essentials, Vol. 679. Springer, 2017.',
  '[7] S. R, R. T, A review of selection methods in genetic algorithm, Int. j. of eng. Sc. and tech., 2011 May, 3(5), 3792-7.',
  '[8] Arabali, Amirsaman, Mahmoud Ghofrani, Mehdi Etezadi-Amoli, M. Sami Fadali, and Ya-hia Baghzouz. "Genetic-algorithm-based optimization approach for energy management." IEEE Transactions on Power Delivery 28, no. 1 (2012): 162-170.',
  '[9] Mathew, T.V., 2012. Genetic algorithm. Report submitted at IIT Bombay.',
  '[10] Tabassum M, Mathew K, A genetic algorithm analysis towards optimization solutions, International Journal of Digital Information and Wireless Communications (IJDIWC), 2014 Jan 1, 4(1), 124-42.'
];

async function main() {
  const parser = new CitationParser();
  console.log(`DEBUG BATCH — style in: ${INPUT_STYLE}, out: ${OUTPUT_STYLE}`);

  for (let i = 0; i < refs.length; i++) {
    const raw = refs[i];
    const pre = parser.preNormalize(raw);
    const detected =
      INPUT_STYLE === "auto" ? parser.detectStyle(pre) ?? "apa" : (INPUT_STYLE as CitationStyle);
    const { parsed } = parser.parseReference(pre, detected);
    const refType = parser.determineReferenceType(parsed);
    const csl = parsedReferenceToCSL(parsed, refType, `r${i + 1}`);
    const rawOut = formatCSLData(csl, OUTPUT_STYLE, { includeDoi: false });
    const final = fixFormatting(OUTPUT_STYLE, rawOut, parsed);

    console.log("=".repeat(80));
    console.log(`REF #${i + 1}`);
    console.log("INPUT:   ", raw);
    console.log("PRENORM: ", pre);
    console.log("STYLE:   ", detected, "TYPE:", refType);
    console.log("PARSED:  ", JSON.stringify(parsed, null, 2));
    console.log("RAW OUT: ", rawOut);
    console.log("FINAL:   ", final);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

