import { CitationParser } from "./server/services/citationParser.js";

const parser = new CitationParser();

// Test 1
const rawInput1 = `FakeAuthorName, X. Y., & MadeUpName, Z. (2099). The theoretical impossibility of parsing edge cases. Journal of Fictional Testing, 42(7), 101-110. https://doi.org/10.9999/fake.doi.123`;
const { parsed: parsed1 } = parser.parseReference(rawInput1, 'apa');
console.log("---- TEST 1 ----");
console.log(JSON.stringify(parsed1, null, 2));

// Test 2
const originalAPA = `Smith, A. B., & Doe, J. (2022). Normalization losses in citation graphs. IEEE Transactions on Software Engineering, 14(2), 55-65.`;
const { parsed: parsedData } = parser.parseReference(originalAPA, 'apa');
console.log("\n---- TEST 2 ----");
console.log(JSON.stringify(parsedData, null, 2));

// Test 3
const rawIEEE = `[1] J. Doe, "A test title for trailing years," Journal of Testing, vol. 1, no. 1, pp. 1-10, 2024.`;
const { parsed: parsed3 } = parser.parseReference(rawIEEE, 'ieee');
console.log("\n---- TEST 3 ----");
console.log(JSON.stringify(parsed3, null, 2));

// Test 4
const rawRefs = [
    `Author, A. (2021). Title. Journal, 10(Supplement_2), Article e302.`,
    `Author, B. (2019). Title. Journal, 5(Suppl. 3), e-locator: 40012.`
];
const { parsed: parsed4_1 } = parser.parseReference(rawRefs[0], 'apa');
const { parsed: parsed4_2 } = parser.parseReference(rawRefs[1], 'generic');
console.log("\n---- TEST 4 ----");
console.log("4.1:", JSON.stringify(parsed4_1, null, 2));
console.log("4.2:", JSON.stringify(parsed4_2, null, 2));
