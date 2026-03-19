/**
 * Parser Benchmark Runner
 * 
 * Tests the parser in isolation — no server required.
 * Loads benchmark-citations.json, runs each citation through CitationParser,
 * and compares extracted fields against ground truth.
 * 
 * Run: npx tsx scripts/benchmark.ts
 */

import { CitationParser } from '../server/engine/citationParser.js';
import * as fuzzball from 'fuzzball';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Types ──

interface BenchmarkCitation {
    id: number;
    category: string;
    raw: string;
    expectedStyle: string;
    expectedFields: Record<string, any>;
}

interface FieldResult {
    field: string;
    expected: any;
    actual: any;
    exactMatch: boolean;
    fuzzyScore: number;
    status: 'pass' | 'fail' | 'missing';
}

interface CitationResult {
    id: number;
    category: string;
    styleDetected: string | null;
    styleExpected: string;
    styleCorrect: boolean;
    fields: FieldResult[];
    overallScore: number;
}

// ── Helpers ──

function normalizeForComparison(val: any): string {
    if (val === undefined || val === null) return '';
    if (Array.isArray(val)) return val.join('; ');
    return String(val).trim();
}

function compareField(expected: any, actual: any): { exactMatch: boolean; fuzzyScore: number } {
    const expStr = normalizeForComparison(expected);
    const actStr = normalizeForComparison(actual);
    if (!expStr && !actStr) return { exactMatch: true, fuzzyScore: 100 };
    if (!expStr || !actStr) return { exactMatch: false, fuzzyScore: 0 };
    const exactMatch = expStr === actStr;
    const fuzzyScore = fuzzball.ratio(expStr.toLowerCase(), actStr.toLowerCase());
    return { exactMatch, fuzzyScore };
}

function compareAuthors(expected: string[], actual: string[] | undefined): { exactMatch: boolean; fuzzyScore: number } {
    if (!actual || actual.length === 0) return { exactMatch: false, fuzzyScore: 0 };
    const maxLen = Math.max(expected.length, actual.length);
    let totalScore = 0;
    for (let i = 0; i < maxLen; i++) {
        totalScore += fuzzball.ratio((expected[i] || '').toLowerCase(), (actual[i] || '').toLowerCase());
    }
    const avgScore = Math.round(totalScore / maxLen);
    let exactMatch = expected.length === actual.length;
    if (exactMatch) {
        for (let i = 0; i < expected.length; i++) {
            if (expected[i] !== actual[i]) { exactMatch = false; break; }
        }
    }
    return { exactMatch, fuzzyScore: avgScore };
}

// ── Main ──

function runBenchmark() {
    const parser = new CitationParser();

    const citationsPath = resolve(__dirname, 'benchmark-citations.json');
    const citations: BenchmarkCitation[] = JSON.parse(readFileSync(citationsPath, 'utf8'));

    console.log(`\n🔬 Parser Benchmark — ${citations.length} citations\n`);
    console.log('─'.repeat(80));

    const results: CitationResult[] = [];
    let styleCorrectCount = 0;
    const fieldStats: Record<string, { exact: number; fuzzy90: number; total: number }> = {};
    const categoryStats: Record<string, { scores: number[]; count: number }> = {};

    for (const citation of citations) {
        const normalized = parser.preNormalize(citation.raw);

        // Style detection
        const detectedStyle = parser.detectStyle(normalized);
        const styleCorrect = detectedStyle === citation.expectedStyle ||
            (citation.expectedStyle === 'harvard' && detectedStyle === 'harvard-ctr') ||
            (citation.expectedStyle === 'chicago' && (detectedStyle === 'chicago-ad' || detectedStyle === 'chicago-nb'));
        if (styleCorrect) styleCorrectCount++;

        // Parse with EXPECTED style (isolates parser accuracy from detection)
        const { parsed } = parser.parseReference(normalized, citation.expectedStyle as any);

        // Compare each expected field
        const fields: FieldResult[] = [];
        for (const [key, expectedVal] of Object.entries(citation.expectedFields)) {
            const actualVal = (parsed as any)[key];
            const comparison = key === 'authors' && Array.isArray(expectedVal)
                ? compareAuthors(expectedVal, actualVal)
                : compareField(expectedVal, actualVal);

            const status: FieldResult['status'] = (actualVal === undefined || actualVal === null ||
                (Array.isArray(actualVal) && actualVal.length === 0))
                ? 'missing'
                : comparison.exactMatch ? 'pass' : 'fail';

            fields.push({
                field: key, expected: expectedVal, actual: actualVal,
                exactMatch: comparison.exactMatch, fuzzyScore: comparison.fuzzyScore, status,
            });

            if (!fieldStats[key]) fieldStats[key] = { exact: 0, fuzzy90: 0, total: 0 };
            fieldStats[key].total++;
            if (comparison.exactMatch) fieldStats[key].exact++;
            if (comparison.fuzzyScore >= 90) fieldStats[key].fuzzy90++;
        }

        const overallScore = fields.length > 0
            ? Math.round(fields.reduce((s, f) => s + f.fuzzyScore, 0) / fields.length)
            : 0;

        // Category aggregation
        const cat = citation.category.replace(/-.*$/, '');
        if (!categoryStats[cat]) categoryStats[cat] = { scores: [], count: 0 };
        categoryStats[cat].scores.push(overallScore);
        categoryStats[cat].count++;

        results.push({
            id: citation.id, category: citation.category,
            styleDetected: detectedStyle, styleExpected: citation.expectedStyle,
            styleCorrect, fields, overallScore,
        });

        // Print failures
        const failedFields = fields.filter(f => f.status !== 'pass');
        if (failedFields.length > 0 || !styleCorrect) {
            const sIcon = styleCorrect ? '✓' : '✗';
            console.log(`\n#${citation.id} [${citation.category}] — Score: ${overallScore}% — Style: ${sIcon} (exp: ${citation.expectedStyle}, got: ${detectedStyle})`);
            if (!styleCorrect) {
                console.log(`  ✗ style: expected "${citation.expectedStyle}" → got "${detectedStyle}"`);
            }
            for (const f of failedFields) {
                const icon = f.status === 'missing' ? '⊘' : '✗';
                const expStr = Array.isArray(f.expected) ? f.expected.join('; ') : f.expected;
                const actStr = f.actual === undefined ? '(missing)' : Array.isArray(f.actual) ? f.actual.join('; ') : f.actual;
                console.log(`  ${icon} ${f.field}: "${expStr}" → "${actStr}" (fuzzy: ${f.fuzzyScore}%)`);
            }
        }
    }

    // ── Summary ──
    console.log('\n' + '═'.repeat(80));
    console.log('BENCHMARK SUMMARY');
    console.log('═'.repeat(80));

    console.log(`\n📊 Style Detection: ${styleCorrectCount}/${citations.length} (${Math.round(styleCorrectCount / citations.length * 100)}%)`);

    console.log('\n📋 Field-Level Accuracy:');
    console.log('─'.repeat(65));
    console.log(`${'Field'.padEnd(18)} ${'Exact Match'.padEnd(18)} ${'Fuzzy ≥90%'.padEnd(18)} ${'Count'.padEnd(8)}`);
    console.log('─'.repeat(65));

    const sortedFields = Object.entries(fieldStats).sort((a, b) => b[1].total - a[1].total);
    for (const [field, stats] of sortedFields) {
        const exactPct = Math.round(stats.exact / stats.total * 100);
        const fuzzyPct = Math.round(stats.fuzzy90 / stats.total * 100);
        console.log(
            `${field.padEnd(18)} ${(stats.exact + '/' + stats.total + ' (' + exactPct + '%)').padEnd(18)} ${(stats.fuzzy90 + '/' + stats.total + ' (' + fuzzyPct + '%)').padEnd(18)} ${String(stats.total).padEnd(8)}`
        );
    }

    console.log('\n📂 Category Scores:');
    console.log('─'.repeat(45));
    for (const [cat, stats] of Object.entries(categoryStats)) {
        const avg = Math.round(stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length);
        console.log(`  ${cat.padEnd(18)} ${avg}% avg  (${stats.count} citations)`);
    }

    const overallAvg = Math.round(results.reduce((s, r) => s + r.overallScore, 0) / results.length);
    const perfectCount = results.filter(r => r.fields.every(f => f.exactMatch)).length;

    console.log('\n' + '═'.repeat(80));
    console.log(`🎯 OVERALL: ${overallAvg}% average field accuracy`);
    console.log(`✅ PERFECT: ${perfectCount}/${citations.length} citations with all fields exact-match`);
    console.log('═'.repeat(80));

    // Save results
    const outputPath = resolve(__dirname, 'benchmark-results.json');
    writeFileSync(outputPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        totalCitations: citations.length,
        styleDetection: {
            correct: styleCorrectCount,
            total: citations.length,
            accuracy: Math.round(styleCorrectCount / citations.length * 100),
        },
        fieldAccuracy: Object.fromEntries(
            sortedFields.map(([field, stats]) => [field, {
                exact: stats.exact, fuzzy90: stats.fuzzy90, total: stats.total,
                exactPct: Math.round(stats.exact / stats.total * 100),
                fuzzy90Pct: Math.round(stats.fuzzy90 / stats.total * 100),
            }])
        ),
        overallAverage: overallAvg,
        perfectCount,
        results,
    }, null, 2));

    console.log(`\n💾 Results saved to ${outputPath}\n`);
}

runBenchmark();
