import { CitationParser } from './server/engine/citationParser';
const p = new CitationParser();
const res = p.parseReference('Kresse, G. & Furthmüller, J. (1996) Efficient iterative schemes for ab initio total-energy calculations using a plane-wave basis set. Physical review. B, Condensed matter, 54(16), 11169–11186.', 'harvard');
console.log(JSON.stringify(res.parsed, null, 2));
