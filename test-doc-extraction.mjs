import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch'; // assuming node-fetch is available, or we can use native fetch in node 18+
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun } from 'docx';

async function generateTestPDF(filepath) {
    return new Promise((resolve) => {
        const doc = new PDFDocument();
        const stream = fs.createWriteStream(filepath);
        doc.pipe(stream);
        doc.fontSize(12).text('Smith, J. (2023). Testing PDF uploads. Journal of Tests, 1(2), 3-4.');
        doc.end();
        stream.on('finish', () => resolve());
    });
}

async function generateTestDOCX(filepath) {
    const doc = new Document({
        sections: [
            {
                properties: {},
                children: [
                    new Paragraph({
                        children: [
                            new TextRun("Doe, A. (2024). DOCX Extraction Methodology. Conference on Documents, 5-6."),
                        ],
                    }),
                ],
            },
        ],
    });
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filepath, buffer);
}

async function testUpload(filepath, mimetype, originalname) {
    const form = new FormData();
    form.append('file', fs.createReadStream(filepath), {
        filename: originalname,
        contentType: mimetype
    });

    const response = await fetch('http://localhost:5000/api/parse-file', {
        method: 'POST',
        body: form,
    });

    const data = await response.json();
    console.log(`\n--- Testing ${originalname} ---`);
    console.log('Status:', response.status);
    console.log('Response json:', data);
}

async function run() {
    console.log('Generating test files...');
    await generateTestPDF('./test.pdf');
    await generateTestDOCX('./test.docx');
    fs.writeFileSync('./test.txt', 'Lee, B. (2025). Plain text works too. Test Journal.');

    console.log('Testing uploads...');
    await testUpload('./test.txt', 'text/plain', 'test.txt');
    await testUpload('./test.pdf', 'application/pdf', 'test.pdf');
    await testUpload('./test.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'test.docx');
}

run().catch(console.error);
