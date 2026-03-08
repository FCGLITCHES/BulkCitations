import { describe, it, expect, beforeAll } from 'vitest';
import { CitationParser } from '../server/services/citationParser';
import { parsedReferenceToCSL, formatCSLData, initCSLStyles } from '../server/services/cslConverter';

const parser = new CitationParser();
const pn = (raw: string) => parser.preNormalize(raw);
beforeAll(() => { initCSLStyles(); });

describe('Debug remaining 4 failures', () => {
    it('Ref 12 (Hall eLocator)', () => {
        const raw = `12. Hall, S. (2022). Quantum computing advances. Phys Rev Lett. 128(4):040501.`;
        const normalized = pn(raw);
        const style = parser.detectStyle(normalized);
        const { parsed } = parser.parseReference(normalized, style || 'apa');
        console.log('Hall:', JSON.stringify({ style, pages: parsed.pages, articleNum: (parsed as any)['article-number'], volume: parsed.volume, issue: parsed.issue }));
    });

    it('Ref 18 (Chen et al)', () => {
        const raw = `18. Chen X, Liu Y, Zhang W, Wang H, Li J, Zhao K, et al. CRISPR gene editing outcomes. Nature. 2023;615(7953):456-478.`;
        const normalized = pn(raw);
        const { parsed } = parser.parseReference(normalized, parser.detectStyle(normalized) || 'apa');
        console.log('Chen authors:', JSON.stringify(parsed.authors));
        console.log('Chen authors length:', parsed.authors?.length);
    });

    it('Ref 28 (Garcia In Eds)', () => {
        const raw = `28. Garcia, M. (2020). Evidence synthesis methods. In E. Brown & K. White (Eds.), Handbook of research methods (pp. 55–78). Sage.`;
        const normalized = pn(raw);
        const { parsed } = parser.parseReference(normalized, parser.detectStyle(normalized) || 'apa');
        console.log('Garcia:', JSON.stringify({ editor: parsed.editor, bookTitle: parsed.bookTitle, pages: parsed.pages, publisher: parsed.publisher }));
    });

    it('Ref 35 (no author)', () => {
        const raw = `35. (2020). Climate modelling projections. Nat Geosci, 15(6), 478–490.`;
        const normalized = pn(raw);
        const style = parser.detectStyle(normalized);
        const { parsed } = parser.parseReference(normalized, style || 'apa');
        console.log('NoAuthor:', JSON.stringify({ style, title: parsed.title, year: parsed.year, authors: parsed.authors }));
    });
});
