import { CitationParser } from './server/engine/citationParser.ts';
import { isGroupAuthor, normalizeGroupAuthor } from './server/engine/shared/citationSemantics.ts';

const clean = `FakeAuthorName, X. Y., & MadeUpName, Z`;
const tokens = clean
    .split(/,?\s+and\s+|,\s*&\s*|(?:\.,\s*)|(?:,\s*(?=[A-Z][a-z]))/)
    .map(t => t.trim())
    .filter(Boolean);

console.log('Tokens:', tokens);

const trailingGroupAuthors = tokens
    .map((part) => {
        const norm = normalizeGroupAuthor(part);
        const isGroup = isGroupAuthor(norm);
        console.log(`Part: "${part}" -> Norm: "${norm}" -> IsGroup: ${isGroup}`);
        return isGroup ? norm : null;
    })
    .filter(Boolean);

console.log('Trailing Group Authors:', trailingGroupAuthors);
