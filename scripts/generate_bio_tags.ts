import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadRegressionFixtures } from '../server/engine/v2/regressionFixtureLoader.js';
import { CitationParser } from '../server/engine/citationParser.js';
import { splitRawReferenceBlock } from '../server/engine/v2/rawPdfCopy.js';
import { READY_REFERENCE_SEEDS } from '../server/engine/v2/fixtures/chunkedReadyCorpus.js';
import { REAL_WORLD_BATCH_FIXTURES } from '../server/engine/v2/fixtures/realWorldBatchFixtures.js';

// ES Module dirname polyfill
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIELD_MAPPING = [
  { key: 'title', tag: 'title' },
  { key: 'authors', tag: 'author' },
  { key: 'year', tag: 'year' },
  { key: 'journal', tag: 'journal' },
  { key: 'volume', tag: 'volume' },
  { key: 'issue', tag: 'issue' },
  { key: 'pages', tag: 'pages' },
  { key: 'publisher', tag: 'publisher' },
  { key: 'doi', tag: 'doi' },
  { key: 'url', tag: 'url' },
];

function tokenize(text: string): string[] {
  // Extract word characters and punctuation separately
  const matches = text.match(/[\w\u00C0-\u017F]+|[^\s\w\u00C0-\u017F]+/g);
  return matches || [];
}

/**
 * Normalizes text to handle parser stripping out punctuation etc.
 */
function fuzzyMatchStr(a: string, b: string): boolean {
    const cleanA = a.toLowerCase().replace(/[^\w]/g, '');
    const cleanB = b.toLowerCase().replace(/[^\w]/g, '');
    // If both are punctuation only, match exactly. Otherwise, fuzzy string match.
    if (cleanA === '' && cleanB === '') return a.trim() === b.trim();
    if (cleanA === '' || cleanB === '') return true; // Treat punctuation as a wild card match during value sequence
    return cleanA === cleanB;
}

function processFixture(rawReference: string, parser: CitationParser) {
  // Normalize exactly like the real pipeline
  const normalized = parser.preNormalize(rawReference);
  const { parsed } = parser.parseReference(normalized, 'auto');
  
  const tokens = tokenize(rawReference);
  const labels = new Array(tokens.length).fill('O');
  
  for (const mapping of FIELD_MAPPING) {
    let rawFieldValue = (parsed as any)[mapping.key];
    if (!rawFieldValue) continue;
    
    let values: string[] = [];
    if (Array.isArray(rawFieldValue)) {
       values = rawFieldValue;
    } else {
       values = [String(rawFieldValue)];
    }
    
    for (const valText of values) {
      if (!valText) continue;
      const valTokens = tokenize(valText);
      if (valTokens.length === 0) continue;
      
      // Attempt to align the parsed component to the raw input tokens using a sliding window
      for (let i = 0; i < tokens.length - valTokens.length + 1; i++) {
        let isMatch = true;
        for (let j = 0; j < valTokens.length; j++) {
           if (!fuzzyMatchStr(tokens[i+j], valTokens[j])) {
              isMatch = false;
              break;
           }
        }
        
        if (isMatch) {
          // Label the span (only avoiding overwriting already tagged fields)
          for (let j = 0; j < valTokens.length; j++) {
            if (labels[i+j] === 'O') {
              labels[i+j] = j === 0 ? `B-${mapping.tag}` : `I-${mapping.tag}`;
            }
          }
          break; // Stop after first matched sequence
        }
      }
    }
  }
  
  // Fix bio tagging validity: Ensure an 'I-' tag always follows either a 'B-' or an 'I-' identical tag
  for (let i = 1; i < labels.length; i++) {
      if (labels[i].startsWith('I-')) {
          const type = labels[i].substring(2);
          if (labels[i-1] !== `B-${type}` && labels[i-1] !== `I-${type}`) {
              labels[i] = `B-${type}`;
          }
      }
  }
  
  return { tokens, labels };
}

async function main() {
  const parser = new CitationParser();
  const regressionFix = await loadRegressionFixtures();
  
  const rawBaseStrings = [];
  
  for (const f of regressionFix) {
      for (const r of f.references) rawBaseStrings.push(r.trim());
  }
  
  for (const r of READY_REFERENCE_SEEDS) {
      rawBaseStrings.push(r.rawUnstructured);
      if (r.semiStructured) rawBaseStrings.push(r.semiStructured);
      rawBaseStrings.push(r.structured);
  }
  
  for (const r of REAL_WORLD_BATCH_FIXTURES) {
      if (r.content.includes('\n')) {
          const split = splitRawReferenceBlock(r.content, []);
          for (const s of split) rawBaseStrings.push(s.rawChunk.trim());
      } else {
          rawBaseStrings.push(r.content.trim());
      }
  }
  
  // deduplicate
  let uniqueRefs = Array.from(new Set(rawBaseStrings.filter(Boolean)));
  console.log(`Loaded ${uniqueRefs.length} deduplicated raw reference strings from fixtures.`);
  
  const results = [];
  
  for (const ref of uniqueRefs) {
      if (!ref.trim()) continue;
      const result = processFixture(ref, parser);
      results.push(result);
  }
  
  const outPath = path.resolve(process.cwd(), 'tmp', 'training_data.jsonl');
  
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  
  const fileLines = results.map(r => JSON.stringify({ tokens: r.tokens, ner_tags: r.labels })).join('\n');
  await fs.writeFile(outPath, fileLines, 'utf-8');
  console.log(`\nSuccess! Wrote ${results.length} BIO-tagged sequences to ${outPath}`);
}

main().catch(console.error);
