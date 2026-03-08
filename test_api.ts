import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_URL = 'http://localhost:5000/api/convert';

const references = [
    // Bug 2: Authors
    '[21] L. Zhang, R. Osei, and T. Ivanova, "Analysis of AI trends," IEEE Software, vol. 35, no. 2, pp. 11-20, 2018.',
    '22. van Houten P, d\'Silva K. The limits of modern medicine. Vancouver Medical Journal. 2015;14(2):45-56.',
    '[26] M. O\'Sullivan, "Engineering the future," IEEE Engineering Management Review, vol. 42, no. 1, pp. 22-30, 2014.',
    '30. O\'Brien M, van der Berg S. Global health initiatives. International Health. 2019;11(4):256-265.',

    // Bug 3: Locators
    '18. Nordin S, van der Meer J. Neural pathways. Brain Research. 2018;123(1):77-90.',
    '39. d\'Angelo F. Quantum mechanics. Physics Today. 2021;40(3):Art. no. 27.',

    // Bug 4: Bleeding
    'Ferenczi, S. (2018) "Psychoanalysis and education." Journal of Psychology, 22(4), pp. 112-125.',
    '[33] S. Al-Farsi, "Data mining," J. Inf. Syst, vol. 12, no. 3, pp. 44-55, 2019.',
    'Angelopoulos, M. (2023). Network topology. Computer Networks, 56, 102208.'
];

async function runTests() {
    const styles = ['apa', 'harvard-ctr', 'chicago-ad', 'chicago-nb', 'mla', 'ieee', 'vancouver'];
    let totalWarnings = 0;

    for (const style of styles) {
        console.log(`\n==============================================`);
        console.log(`TESTING STYLE: ${style.toUpperCase()}`);
        console.log(`==============================================\n`);

        try {
            const response = await fetch(SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    references,
                    inputStyle: 'auto',
                    outputStyle: style,
                    enrichWithDoi: false // turn off network requests to speed up test
                })
            });

            if (!response.ok) {
                console.error(`Failed to fetch for style ${style}:`, response.statusText);
                continue;
            }

            const data = await response.json();

            data.convertedReferences.forEach((ref: any, idx: number) => {
                console.log(`[${idx + 1}] Output: ${ref.convertedText}`);

                if (ref.warnings && ref.warnings.length > 0) {
                    console.log(`    ⚠️ Warnings: ${ref.warnings.join(', ')}`);
                    // Only count format errors, missing locators/titles are expected from raw text inputs lacking them
                    const strictFails = ref.warnings.filter((w: string) => w.startsWith('error:'));
                    totalWarnings += strictFails.length;
                }
                console.log('');
            });

        } catch (e) {
            console.error(`Error testing style ${style}`, e);
        }
    }

    console.log(`\nDone. Strict Format Failures triggers: ${totalWarnings}`);
    process.exit(totalWarnings > 0 ? 1 : 0);
}

runTests();
