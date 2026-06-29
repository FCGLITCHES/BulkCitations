import { describe, expect, it } from 'vitest';
import { calculateCitationSimilarity, clusterCitations } from './clustering';
import type { ConvertedReference, ParsedReference } from './schema';

function makeReference(id: string, parsedData: ParsedReference): ConvertedReference {
    return {
        id,
        originalText: parsedData.title ?? `original-${id}`,
        convertedText: parsedData.title ?? `converted-${id}`,
        referenceType: 'journal',
        parsedData,
        inputStyle: 'auto',
        outputStyle: 'apa',
    };
}

describe('clustering author normalization', () => {
    it('treats Vancouver initials as the same family name representation', () => {
        const a: ParsedReference = {
            authors: ['Smith JA', 'Doe AB'],
            title: 'Applications of machine learning in drug discovery',
            journal: 'Drug Discovery Today',
            year: '2021',
        };
        const b: ParsedReference = {
            authors: ['Smith, J. A.', 'Doe, A. B.'],
            title: 'Applications of machine learning in drug discovery',
            journal: 'Drug Discovery Today',
            year: '2021',
        };

        expect(calculateCitationSimilarity(a, b)).toBeGreaterThanOrEqual(95);
    });

    it('clusters near-identical Vancouver and comma-formatted references together', () => {
        const references = [
            makeReference('r1', {
                authors: ['Smith JA', 'Doe AB'],
                title: 'Applications of machine learning in drug discovery',
                journal: 'Drug Discovery Today',
                year: '2021',
                volume: '26',
                pages: '80-93',
            }),
            makeReference('r2', {
                authors: ['Smith, J. A.', 'Doe, A. B.'],
                title: 'Applications of machine learning in drug discovery',
                journal: 'Drug Discovery Today',
                year: '2021',
                volume: '26',
                pages: '80-93',
            }),
        ];

        const clusters = clusterCitations(references, 85);
        expect(clusters).toHaveLength(1);
        expect(clusters[0]?.members).toHaveLength(2);
    });
});

