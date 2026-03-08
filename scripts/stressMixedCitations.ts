import fs from "fs";
import path from "path";

type Style = "apa" | "ieee" | "vancouver" | "harvard" | "mla" | "chicago";
type WorkType = "journal" | "conference";

type Author = {
  family: string;
  given: string;
};

type Work = {
  id: string;
  type: WorkType;
  title: string;
  year: string;
  authors: Author[];
  journal?: string;
  conferenceTitle?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  articleNumber?: string;
  month?: string;
  vancouverDate?: string;
  venueToken: string;
};

type StressCase = {
  id: string;
  workId: string;
  style: Style;
  perturbation: string;
  raw: string;
  expected: {
    style: Style;
    referenceType: WorkType;
    year: string;
    titleToken: string;
    firstAuthorFamily: string;
    venueToken: string;
    expectLocator: boolean;
    locatorToken?: string;
  };
};

type ApiReference = {
  id: string;
  originalText: string;
  convertedText: string;
  referenceType: string;
  parsedData: Record<string, any>;
  inputStyle: string;
  outputStyle: string;
  warnings?: string[];
  styleDetectionFailed?: boolean;
};

type ApiCluster = {
  clusterId: string;
  bestMemberId?: string;
  members: ApiReference[];
  winnerDiagnostics?: {
    chosenReasons: string[];
  };
};

function normalize(value: string | undefined): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function compactInitials(given: string): string {
  return given.replace(/[^A-Z]/g, "");
}

function tightInitials(given: string): string {
  return given.replace(/\s+/g, "");
}

function firstLast(author: Author): string {
  return `${author.given} ${author.family}`;
}

function inverted(author: Author): string {
  return `${author.family}, ${author.given}`;
}

function harvardInverted(author: Author): string {
  return `${author.family}, ${tightInitials(author.given)}`;
}

function vancouverName(author: Author): string {
  return `${author.family} ${compactInitials(author.given)}`;
}

function apaAuthors(authors: Author[]): string {
  if (authors.length === 1) return inverted(authors[0]);
  if (authors.length === 2) return `${inverted(authors[0])}, & ${inverted(authors[1])}`;
  return `${authors.slice(0, -1).map(inverted).join(", ")}, & ${inverted(authors[authors.length - 1])}`;
}

function harvardAuthors(authors: Author[]): string {
  if (authors.length === 1) return harvardInverted(authors[0]);
  if (authors.length === 2) return `${harvardInverted(authors[0])} and ${harvardInverted(authors[1])}`;
  return `${authors.slice(0, -1).map(harvardInverted).join(", ")} and ${harvardInverted(authors[authors.length - 1])}`;
}

function ieeeAuthors(authors: Author[]): string {
  if (authors.length === 1) return firstLast(authors[0]);
  if (authors.length === 2) return `${firstLast(authors[0])} and ${firstLast(authors[1])}`;
  return `${authors.slice(0, -1).map(firstLast).join(", ")}, and ${firstLast(authors[authors.length - 1])}`;
}

function vancouverAuthors(authors: Author[]): string {
  return `${authors.map(vancouverName).join(", ")}.`;
}

function mlaAuthors(authors: Author[]): string {
  if (authors.length === 1) return `${inverted(authors[0])}.`;
  const rest = authors.slice(1).map(firstLast);
  if (rest.length === 1) return `${inverted(authors[0])}, and ${rest[0]}.`;
  return `${inverted(authors[0])}, ${rest.slice(0, -1).join(", ")}, and ${rest[rest.length - 1]}.`;
}

function chicagoAuthors(authors: Author[]): string {
  if (authors.length === 1) return `${inverted(authors[0])}.`;
  const rest = authors.slice(1).map(firstLast);
  if (rest.length === 1) return `${inverted(authors[0])}, and ${rest[0]}.`;
  return `${inverted(authors[0])}, ${rest.slice(0, -1).join(", ")}, and ${rest[rest.length - 1]}.`;
}

function renderJournal(work: Work, style: Style): string {
  const locator = work.pages
    ? work.pages
    : work.articleNumber
      ? `Article ${work.articleNumber}`
      : "";

  switch (style) {
    case "apa":
      return `${apaAuthors(work.authors)} (${work.year}). ${work.title}. ${work.journal}, ${work.volume}${work.issue ? `(${work.issue})` : ""}${locator ? `, ${locator}` : ""}.`;
    case "ieee":
      return `${ieeeAuthors(work.authors)}, "${work.title}," ${work.journal}, vol. ${work.volume}${work.issue ? `, no. ${work.issue}` : ""}${work.pages ? `, pp. ${work.pages}` : work.articleNumber ? `, Art. no. ${work.articleNumber}` : ""}, ${work.year}.`;
    case "vancouver":
      return `${vancouverAuthors(work.authors)} ${work.title}. ${work.journal}. ${work.year};${work.volume}${work.issue ? `(${work.issue})` : ""}:${work.pages || work.articleNumber}.`;
    case "harvard":
      return `${harvardAuthors(work.authors)}, ${work.year}. ${work.title}. ${work.journal}, ${work.volume}${work.issue ? `(${work.issue})` : ""}${work.pages ? `, pp.${work.pages}` : work.articleNumber ? `, Article ${work.articleNumber}` : ""}.`;
    case "mla":
      return `${mlaAuthors(work.authors)} "${work.title}." ${work.journal}, vol. ${work.volume}${work.issue ? `, no. ${work.issue}` : ""}, ${work.year}${work.pages ? `, pp. ${work.pages}` : work.articleNumber ? `, Article ${work.articleNumber}` : ""}.`;
    case "chicago":
      return `${chicagoAuthors(work.authors)} "${work.title}." ${work.journal} ${work.volume}${work.issue ? `, no. ${work.issue}` : ""} (${work.year})${work.pages ? `: ${work.pages}` : work.articleNumber ? `: Article ${work.articleNumber}` : ""}.`;
  }
}

function renderConference(work: Work, style: Style): string {
  const month = work.month || "March";
  const publisher = work.publisher || "IEEE";

  switch (style) {
    case "apa":
      return `${apaAuthors(work.authors)} (${work.year}, ${month}). ${work.title}. In ${work.conferenceTitle}${work.pages ? ` (pp. ${work.pages})` : ""}. ${publisher}.`;
    case "ieee":
      return `${ieeeAuthors(work.authors)}, "${work.title}," in Proc. ${work.conferenceTitle}${work.pages ? `, pp. ${work.pages}` : ""}, ${work.year}.`;
    case "vancouver":
      return `${vancouverAuthors(work.authors)} ${work.title}. In ${work.conferenceTitle} ${work.year}${work.vancouverDate ? ` ${work.vancouverDate}` : ""}${work.pages ? ` (pp. ${work.pages})` : ""}. ${publisher}.`;
    case "harvard":
      return `${harvardAuthors(work.authors)}, ${work.year}, ${month}. ${work.title}. In ${work.conferenceTitle}${work.pages ? ` (pp. ${work.pages})` : ""}. ${publisher}.`;
    case "mla":
      return `${mlaAuthors(work.authors)} "${work.title}." ${work.conferenceTitle}.${work.pages ? ` pp. ${work.pages}.` : ""} ${publisher}, ${work.year}.`;
    case "chicago":
      return `${chicagoAuthors(work.authors)} "${work.title}." In ${work.conferenceTitle}${work.pages ? `, pp. ${work.pages}` : ""}. ${publisher}, ${work.year}.`;
  }
}

function renderCitation(work: Work, style: Style): string {
  return work.type === "journal" ? renderJournal(work, style) : renderConference(work, style);
}

const perturbations = [
  {
    id: "base",
    apply: (s: string, _style: Style, _work: Work, _index: number) => s,
  },
  {
    id: "numbered-dot",
    apply: (s: string, _style: Style, _work: Work, index: number) => `${index + 1}. ${s}`,
  },
  {
    id: "numbered-bracket",
    apply: (s: string, _style: Style, _work: Work, index: number) => `[${index + 1}] ${s}`,
  },
  {
    id: "padded-whitespace",
    apply: (s: string) => `  ${s}  `,
  },
  {
    id: "wrapped-newlines",
    apply: (s: string) => `\n${s}\n`,
  },
  {
    id: "smart-punctuation",
    apply: (s: string) =>
      s
        .replace(/"([^"]+)"/g, "“$1”")
        .replace(/(\d)-(\d)/g, "$1–$2"),
  },
  {
    id: "extra-spaces",
    apply: (s: string) =>
      s
        .replace(/,\s/g, ",  ")
        .replace(/\.\s/g, ".  "),
  },
  {
    id: "compact-markers",
    apply: (s: string, style: Style, work: Work) => {
      let out = s.replace(/pp\.\s+/g, "pp.");
      if (style === "vancouver" && work.type === "conference") {
        out = out.replace(/\bIn\s+(?=\d{4}\b)/, "In");
      }
      return out;
    },
  },
] as const;

const works: Work[] = [
  {
    id: "w1",
    type: "journal",
    title: "A survey of graph neural networks in medicine",
    year: "2022",
    authors: [{ family: "Adams", given: "K. L." }, { family: "Chen", given: "R." }],
    journal: "Journal of Medical Informatics",
    volume: "51",
    issue: "2",
    pages: "101-119",
    venueToken: "Medical Informatics",
  },
  {
    id: "w2",
    type: "journal",
    title: "Quantum dots in bioimaging: Recent advances",
    year: "2020",
    authors: [{ family: "Farah", given: "N." }, { family: "Gupta", given: "A." }],
    journal: "Nano Medicine",
    volume: "15",
    issue: "6",
    articleNumber: "104512",
    venueToken: "Nano Medicine",
  },
  {
    id: "w3",
    type: "journal",
    title: "Quantum computing advances",
    year: "2022",
    authors: [{ family: "Hall", given: "S." }],
    journal: "Physical Review Letters",
    volume: "128",
    issue: "4",
    articleNumber: "040501",
    venueToken: "Physical Review Letters",
  },
  {
    id: "w4",
    type: "journal",
    title: "Drug safety profiles in elderly patients",
    year: "2021",
    authors: [{ family: "Martin", given: "K." }],
    journal: "Journal of Clinical Pharmacology",
    volume: "61",
    issue: "Suppl. 2",
    pages: "S45-S67",
    venueToken: "Clinical Pharmacology",
  },
  {
    id: "w5",
    type: "journal",
    title: "Materials microstructure analysis",
    year: "2020",
    authors: [{ family: "Kim", given: "J." }],
    journal: "Acta Materialia",
    volume: "196",
    articleNumber: "12345",
    venueToken: "Acta Materialia",
  },
  {
    id: "w6",
    type: "journal",
    title: "Multipartite entangled spatial modes of ultracold atoms generated and controlled by quantum measurement",
    year: "2015",
    authors: [
      { family: "Elliott", given: "T. J." },
      { family: "Kozlowski", given: "W." },
      { family: "Caballero-Benitez", given: "S. F." },
      { family: "Mekhov", given: "I. B." },
    ],
    journal: "Physical Review Letters",
    volume: "114",
    articleNumber: "113604",
    venueToken: "Physical Review Letters",
  },
  {
    id: "w7",
    type: "conference",
    title: "Attention is all you need",
    year: "2017",
    authors: [
      { family: "Vaswani", given: "A." },
      { family: "Shazeer", given: "N." },
      { family: "Parmar", given: "N." },
      { family: "Uszkoreit", given: "J." },
    ],
    conferenceTitle: "31st International Conference on Neural Information Processing Systems",
    publisher: "IEEE",
    venueToken: "Neural Information Processing Systems",
  },
  {
    id: "w8",
    type: "conference",
    title: "Deep residual learning for image recognition",
    year: "2016",
    authors: [
      { family: "He", given: "K." },
      { family: "Zhang", given: "X." },
      { family: "Ren", given: "S." },
      { family: "Sun", given: "J." },
    ],
    conferenceTitle: "IEEE Conference on Computer Vision and Pattern Recognition (CVPR)",
    publisher: "IEEE",
    venueToken: "Computer Vision and Pattern Recognition",
  },
  {
    id: "w9",
    type: "conference",
    title: "Machine learning in healthcare: A review",
    year: "2018",
    authors: [
      { family: "Shailaja", given: "K." },
      { family: "Seetharamulu", given: "B." },
      { family: "Jabbar", given: "M. A." },
    ],
    conferenceTitle: "2018 Second International Conference on Electronics, Communication and Aerospace Technology (ICECA)",
    publisher: "IEEE",
    pages: "910-914",
    month: "March",
    vancouverDate: "Mar 29",
    venueToken: "Electronics, Communication and Aerospace Technology",
  },
  {
    id: "w10",
    type: "conference",
    title: "Edge AI for IoT devices",
    year: "2020",
    authors: [
      { family: "Kumar", given: "A." },
      { family: "Li", given: "B." },
    ],
    conferenceTitle: "International Conference on Internet of Things",
    publisher: "IEEE",
    pages: "88-94",
    month: "June",
    vancouverDate: "Jun 18",
    venueToken: "Internet of Things",
  },
  {
    id: "w11",
    type: "conference",
    title: "Federated diagnostics for rural clinics",
    year: "2021",
    authors: [
      { family: "Brown", given: "L. D." },
      { family: "Garcia-Lopez", given: "J.-F." },
      { family: "van der Berg", given: "E." },
    ],
    conferenceTitle: "International Workshop on Digital Health Systems",
    publisher: "ACM",
    pages: "55-63",
    month: "September",
    vancouverDate: "Sep 10",
    venueToken: "Digital Health Systems",
  },
  {
    id: "w12",
    type: "conference",
    title: "Clinical NLP for low-resource triage",
    year: "2019",
    authors: [
      { family: "O'Brien", given: "M." },
      { family: "d'Angelo", given: "R." },
      { family: "Singh", given: "P." },
    ],
    conferenceTitle: "Workshop on Clinical Natural Language Processing",
    publisher: "Springer",
    pages: "201-209",
    month: "July",
    vancouverDate: "Jul 05",
    venueToken: "Clinical Natural Language Processing",
  },
];

const styles: Style[] = ["apa", "ieee", "vancouver", "harvard", "mla", "chicago"];

function buildCases(): StressCase[] {
  const cases: StressCase[] = [];
  let idx = 0;
  for (const work of works) {
    for (const style of styles) {
      const base = renderCitation(work, style);
      for (const perturbation of perturbations) {
        const raw = perturbation.apply(base, style, work, idx);
        const locatorToken = work.pages || work.articleNumber;
        const expectLocator =
          work.type === "journal"
            ? !!locatorToken
            : !!work.pages && style !== "mla" ? true : style === "mla" && !!work.pages;
        cases.push({
          id: `${work.id}-${style}-${perturbation.id}`,
          workId: work.id,
          style,
          perturbation: perturbation.id,
          raw,
          expected: {
            style,
            referenceType: work.type,
            year: work.year,
            titleToken: work.title,
            firstAuthorFamily: work.authors[0].family,
            venueToken: work.venueToken,
            expectLocator,
            locatorToken,
          },
        });
        idx++;
      }
    }
  }

  const realisticCases: StressCase[] = [
    {
      id: "real-harvard-gomes",
      workId: "real-gomes-harvard",
      style: "harvard",
      perturbation: "google-scholar-like",
      raw: `Gomes, M.A.S., Kovaleski, J.L., Pagani, R.N. and da Silva, V.L., 2022. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology, 46(7), pp.608-616.`,
      expected: {
        style: "harvard",
        referenceType: "journal",
        year: "2022",
        titleToken: "Machine learning applied to healthcare: a conceptual review",
        firstAuthorFamily: "Gomes",
        venueToken: "Medical Engineering & Technology",
        expectLocator: true,
        locatorToken: "608-616",
      },
    },
    {
      id: "real-vancouver-gomes",
      workId: "real-gomes-vancouver",
      style: "vancouver",
      perturbation: "google-scholar-like",
      raw: `Gomes MA, Kovaleski JL, Pagani RN, da Silva VL. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology. 2022 Oct 3;46(7):608-16.`,
      expected: {
        style: "vancouver",
        referenceType: "journal",
        year: "2022",
        titleToken: "Machine learning applied to healthcare: a conceptual review",
        firstAuthorFamily: "Gomes",
        venueToken: "Medical Engineering & Technology",
        expectLocator: true,
        locatorToken: "608-16",
      },
    },
    {
      id: "real-chicago-gomes",
      workId: "real-gomes-chicago",
      style: "chicago",
      perturbation: "google-scholar-like",
      raw: `Gomes, Myller Augusto Santos, João Luiz Kovaleski, Regina Negri Pagani, and Vander Luiz da Silva. "Machine learning applied to healthcare: a conceptual review." Journal of Medical Engineering & Technology 46, no. 7 (2022): 608-616.`,
      expected: {
        style: "chicago",
        referenceType: "journal",
        year: "2022",
        titleToken: "Machine learning applied to healthcare: a conceptual review",
        firstAuthorFamily: "Gomes",
        venueToken: "Medical Engineering & Technology",
        expectLocator: true,
        locatorToken: "608-616",
      },
    },
    {
      id: "real-mla-adams",
      workId: "real-adams-mla",
      style: "mla",
      perturbation: "google-scholar-like",
      raw: `Adams, K. L., and R. Chen. "A survey of graph neural networks in medicine." Journal of Medical Informatics, vol. 51, no. 2, 2022, pp. 101-119.`,
      expected: {
        style: "mla",
        referenceType: "journal",
        year: "2022",
        titleToken: "A survey of graph neural networks in medicine",
        firstAuthorFamily: "Adams",
        venueToken: "Medical Informatics",
        expectLocator: true,
        locatorToken: "101-119",
      },
    },
    {
      id: "real-vancouver-conference",
      workId: "real-shailaja-vancouver",
      style: "vancouver",
      perturbation: "google-scholar-like",
      raw: `Shailaja K, Seetharamulu B, Jabbar MA. Machine learning in healthcare: A review. In2018 Second international conference on electronics, communication and aerospace technology (ICECA) 2018 Mar 29 (pp. 910-914). IEEE.`,
      expected: {
        style: "vancouver",
        referenceType: "conference",
        year: "2018",
        titleToken: "Machine learning in healthcare: A review",
        firstAuthorFamily: "Shailaja",
        venueToken: "Electronics, Communication and Aerospace Technology",
        expectLocator: true,
        locatorToken: "910-914",
      },
    },
  ];

  cases.push(...realisticCases);
  return cases;
}

async function run() {
  const cases = buildCases();
  const body = {
    references: cases.map(c => c.raw),
    inputStyle: "auto",
    outputStyle: "apa",
    isPro: false,
    enrichWithAuthority: false,
  };

  const res = await fetch("http://127.0.0.1:5000/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Stress API request failed: ${res.status} ${res.statusText}`);
  }

  const payload = await res.json() as { convertedReferences: ApiReference[]; clusters?: ApiCluster[]; errors?: string[] };
  const converted = payload.convertedReferences || [];

  const failures: Array<{
    caseId: string;
    workId: string;
    style: Style;
    perturbation: string;
    categories: string[];
    expected: StressCase["expected"];
    actual: {
      inputStyle?: string;
      referenceType?: string;
      year?: string;
      title?: string;
      firstAuthor?: string;
      venue?: string;
      locator?: string;
      output?: string;
      warnings?: string[];
    };
  }> = [];

  const byCategory: Record<string, number> = {};
  const byStyle: Record<string, { total: number; failed: number }> = {};
  const byWorkStyle: Record<string, { total: number; failed: number }> = {};

  cases.forEach((testCase, index) => {
    const ref = converted[index];
    const categories: string[] = [];

    byStyle[testCase.style] ||= { total: 0, failed: 0 };
    byStyle[testCase.style].total++;
    const workStyleKey = `${testCase.workId}:${testCase.style}`;
    byWorkStyle[workStyleKey] ||= { total: 0, failed: 0 };
    byWorkStyle[workStyleKey].total++;

    if (!ref) {
      categories.push("missing-response");
    } else {
      const parsed = ref.parsedData || {};
      const actualVenue = parsed.conferenceTitle || parsed.journal || parsed.bookTitle || "";
      const actualLocator = parsed.pages || parsed["article-number"] || "";
      const actualFirstAuthor = parsed.authors?.[0] || "";

      if ((ref.inputStyle || "").toLowerCase() !== testCase.expected.style) {
        categories.push("style-detection");
      }
      if ((ref.referenceType || "").toLowerCase() !== testCase.expected.referenceType) {
        categories.push("reference-type");
      }
      if ((parsed.year || "").trim() !== testCase.expected.year) {
        categories.push("year");
      }
      if (!normalize(parsed.title).includes(normalize(testCase.expected.titleToken))) {
        categories.push("title");
      }
      if (!normalize(actualFirstAuthor).includes(normalize(testCase.expected.firstAuthorFamily))) {
        categories.push("author");
      }
      if (!normalize(actualVenue || ref.convertedText).includes(normalize(testCase.expected.venueToken))) {
        categories.push("venue");
      }
      if (testCase.expected.expectLocator) {
        const locatorOk =
          normalize(actualLocator).includes(normalize(testCase.expected.locatorToken)) ||
          normalize(ref.convertedText).includes(normalize(testCase.expected.locatorToken));
        if (!locatorOk) {
          categories.push("locator");
        }
      }
      if (/Unknown Title|Unknown Author/.test(ref.convertedText)) {
        categories.push("placeholder-output");
      }
      if (countOccurrences(ref.convertedText, `(${testCase.expected.year})`) !== 1) {
        categories.push("year-duplication");
      }
    }

    if (categories.length > 0) {
      byStyle[testCase.style].failed++;
      byWorkStyle[workStyleKey].failed++;
      for (const category of categories) {
        byCategory[category] = (byCategory[category] || 0) + 1;
      }
      failures.push({
        caseId: testCase.id,
        workId: testCase.workId,
        style: testCase.style,
        perturbation: testCase.perturbation,
        categories,
        expected: testCase.expected,
        actual: ref
          ? {
              inputStyle: ref.inputStyle,
              referenceType: ref.referenceType,
              year: ref.parsedData?.year,
              title: ref.parsedData?.title,
              firstAuthor: ref.parsedData?.authors?.[0],
              venue: ref.parsedData?.conferenceTitle || ref.parsedData?.journal || ref.parsedData?.bookTitle,
              locator: ref.parsedData?.pages || ref.parsedData?.["article-number"],
              output: ref.convertedText,
              warnings: ref.warnings,
            }
          : {},
      });
    }
  });

  const clusters = payload.clusters || [];
  const apiRefsById = new Map(converted.map(ref => [ref.id, ref]));
  const clusterSummary = {
    totalClusters: clusters.length,
    clustersWithApaMember: clusters.filter(c => c.members.some(m => (m.inputStyle || "").toLowerCase() === "apa")).length,
    apaWinners: clusters.filter(c => {
      const winner = c.bestMemberId ? apiRefsById.get(c.bestMemberId) : undefined;
      return winner && (winner.inputStyle || "").toLowerCase() === "apa";
    }).length,
    apaPreferenceReasonTriggered: clusters.filter(c =>
      c.winnerDiagnostics?.chosenReasons?.includes("prefer APA-source variant for near-equivalent duplicates")
    ).length,
  };

  const failureExamplesByCategory: Record<string, typeof failures> = {};
  for (const failure of failures) {
    for (const category of failure.categories) {
      failureExamplesByCategory[category] ||= [];
      if (failureExamplesByCategory[category].length < 5) {
        failureExamplesByCategory[category].push(failure);
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    totalFailures: failures.length,
    passRate: Number((((cases.length - failures.length) / cases.length) * 100).toFixed(2)),
    byCategory,
    byStyle,
    byWorkStyle,
    clusterSummary,
    errors: payload.errors || [],
    failureExamplesByCategory,
  };

  const outPath = path.resolve(process.cwd(), "stress-mixed-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${outPath}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
