import { clusterCitations } from './shared/clustering';
import fs from 'fs';

const report = JSON.parse(fs.readFileSync('stress-finale-1000-report.json', 'utf8'));

// The references mock for clustering
const refs = report.sampleFailures.map((f, i) => ({ id: `ref${i}`, parsedData: f.actual }));

// Expand to 1000 unique-ish items to test worst case
const bigRefs = [];
for (let i = 0; i < 1000; i++) {
    const base = refs[i % refs.length];
    bigRefs.push({ ...base, id: `ref${i}`, parsedData: { ...base.parsedData, title: (base.parsedData.title || '') + ' ' + i } });
}

console.time('clustering');
clusterCitations(bigRefs, 85);
console.timeEnd('clustering');
