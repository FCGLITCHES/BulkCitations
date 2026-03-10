const Cite = require('citation-js');

// Must load custom styles as in cslConverter.ts to be realistic
const fs = require('fs');
const path = require('path');
const config = Cite.plugins.config.get('@csl');
const stylesDir = path.join(process.cwd(), 'server', 'csl-styles');

config.templates.add('ieee', fs.readFileSync(path.join(stylesDir, 'ieee.csl'), 'utf8'));

const rawData = { id: 'ref1', type: 'article-journal', title: 'Test Title', author: [{ family: 'Smith', given: 'John' }], issued: { 'date-parts': [[2020]] }, 'container-title': 'Journal', volume: '10' };

console.time('Init 1000 Cites');
for (let i = 0; i < 1000; i++) {
    const c = new Cite([rawData]);
}
console.timeEnd('Init 1000 Cites');

const c2 = new Cite([rawData]);
console.time('Format 1000 Cites');
for (let i = 0; i < 1000; i++) {
    c2.format('bibliography', { format: 'text', template: 'ieee', lang: 'en-US' });
}
console.timeEnd('Format 1000 Cites');
