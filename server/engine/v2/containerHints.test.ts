import { describe, expect, it } from 'vitest';
import { buildContainerHints, resolveWinnerContainer } from './containerHints.js';

describe('container hints', () => {
  it('preserves a real publisher name when stripping copyright tails', () => {
    const parsed = {
      title: 'Flexible endoscopy methods',
      year: '2021',
      bookTitle: 'Handbook of Methods',
      publisher: '© 2021 Georg Thieme Verlag KG. All rights reserved.',
    };

    const resolved = resolveWinnerContainer(parsed, 'book');

    expect(resolved.parsed.publisher).toBe('Georg Thieme Verlag KG');
    expect(resolved.containerHints.copyrightTailPresent).toBe(false);
  });

  it('infers conference containers from proceedings-style venues', () => {
    const hints = buildContainerHints({
      title: 'A conference paper',
      year: '2024',
      conferenceTitle: 'Proceedings of the 2024 Testing Symposium',
      pages: '1-4',
    }, 'conference');

    expect(hints.containerKindHint).toBe('conference');
    expect(hints.containerKindConfidence).toBeGreaterThanOrEqual(0.95);
  });

  it('strips year, page, and publisher tails from contaminated conference titles', () => {
    const resolved = resolveWinnerContainer({
      title: 'Fuzzy Tolerance Analysis of 3-D Mechanical Assemblies',
      year: '1997',
      conferenceTitle: 'Volume 2: 23rd Design Automation Conference, 1997, pp. V002T29A056. American Society of Mechanical Engineers',
      pages: 'V002T29A056',
      publisher: 'American Society of Mechanical Engineers',
    }, 'conference');

    expect(resolved.parsed.conferenceTitle).toBe('Volume 2: 23rd Design Automation Conference');
  });

  it('strips semicolon locator tails from conference titles without dropping the conference name', () => {
    const resolved = resolveWinnerContainer({
      title: 'Virtually Rotated Multiple Mass Resonator Enabled by Electrostatic Frequency and Q-factor Tuning',
      year: '2023',
      conferenceTitle: '2023 IEEE International Symposium on Inertial Sensors and Systems (INERTIAL), 2023;1-4',
      pages: '1-4',
      doi: '10.1109/inertial56358.2023.10103981',
    }, 'conference');

    expect(resolved.parsed.conferenceTitle).toBe('2023 IEEE International Symposium on Inertial Sensors and Systems (INERTIAL)');
  });

  it('strips APA serial tails from contaminated journal venues', () => {
    const resolved = resolveWinnerContainer({
      title: 'A Quantitative Intersectional Exploration of Sexual Violence and Mental Health among Bi + People: Looking within and across Race and Gender',
      year: '2022',
      journal: 'Journal of Bisexuality, 22(4), 485-512',
      volume: '22',
      issue: '4',
      pages: '485-512',
    }, 'journal');

    expect(resolved.parsed.journal).toBe('Journal of Bisexuality');
  });

  it('strips Vancouver year-volume tails from contaminated journal venues', () => {
    const resolved = resolveWinnerContainer({
      title: 'Naira to Dollar Exchange Rate Fluctuations and Nigeria’s Balance of Payment',
      year: '2022',
      journal: 'JOURNAL OF ECONOMICS, FINANCE AND MANAGEMENT STUDIES. 2022;5(9)',
    }, 'journal');

    expect(resolved.parsed.journal).toBe('JOURNAL OF ECONOMICS, FINANCE AND MANAGEMENT STUDIES');
    expect(resolved.parsed.volume).toBe('5');
    expect(resolved.parsed.issue).toBe('9');
    expect(resolved.parsed.year).toBe('2022');
  });

  it('preserves IEEE Cat. No. fragments inside valid conference titles', () => {
    const resolved = resolveWinnerContainer({
      title: 'Distributed dynamic resource allocation for multicell SDMA packet access networks',
      year: '2004',
      conferenceTitle: '2004 IEEE International Conference on Communications (IEEE Cat. No.04CH37577)',
      pages: '202-207',
      doi: '10.1109/icc.2004.1312480',
    }, 'conference');

    expect(resolved.parsed.conferenceTitle).toBe('2004 IEEE International Conference on Communications (IEEE Cat. No.04CH37577)');
  });

  it('splits trailing publisher tails out of chapter book titles', () => {
    const resolved = resolveWinnerContainer({
      title: 'Transformationsprozesse in wohnbezogenen Unterstützungsangeboten',
      year: '2016',
      bookTitle: 'Inklusives Wohnen, Fraunhofer IRB Verlag',
      pages: '45-64',
      doi: '10.51202/9783816795650-45',
    }, 'chapter');

    expect(resolved.parsed.bookTitle).toBe('Inklusives Wohnen');
    expect(resolved.parsed.publisher).toBe('Fraunhofer IRB Verlag');
  });

  it('keeps website claims as websites even when an institution is present', () => {
    const hints = buildContainerHints({
      authors: ['OpenAI'],
      title: 'GPT-5.1 system card',
      year: '2026',
      url: 'https://openai.com/research/gpt-5-1',
      institution: 'OpenAI',
    }, 'website');

    expect(hints.containerKindHint).toBe('website');
    expect(hints.containerKindConfidence).toBeGreaterThanOrEqual(0.95);
  });

  it('preserves book claims for handbook-style institutional references', () => {
    const hints = buildContainerHints({
      authors: ['Cochrane Collaboration'],
      title: 'Cochrane handbook for systematic reviews of interventions',
      year: '2022',
      edition: 'Version 6.3',
      institution: 'Cochrane Collaboration',
    }, 'book');

    expect(hints.containerKindHint).toBe('book');
    expect(hints.containerKindConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps monograph books with press publishers out of the report bucket', () => {
    const hints = buildContainerHints({
      authors: ['Li, Yue', 'Rama, Martín'],
      title: 'Firm Dynamics, Productivity Growth, and Job Creation in Developing Countries: The Role of Micro- and Small Enterprises',
      year: '2015',
      publisher: 'Oxford University Press on behalf of the World Bank',
      doi: '10.1596/24807',
    }, 'book');

    expect(hints.containerKindHint).toBe('book');
    expect(hints.containerKindConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it('prefers report containers for strong report doi and publisher families', () => {
    const hints = buildContainerHints({
      authors: ['Kliesen, K. L.'],
      title: 'FRED-SD: A Real-Time Database for State-Level Data with Forecasting Applications',
      year: '2020',
      publisher: 'Federal Reserve Bank of St. Louis',
      doi: '10.20955/wp.2020.031',
    }, 'report');

    expect(hints.containerKindHint).toBe('report');
    expect(hints.containerKindConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it('prefers thesis over report when dissertation institution evidence is present', () => {
    const hints = buildContainerHints({
      authors: ["O'Rourke, N."],
      title: 'Dose response ranking for translational pharmacology',
      year: '2019',
      institution: 'North Coast University',
      url: 'https://stress.example.org/apat/031',
    }, 'thesis');

    expect(hints.containerKindHint).toBe('thesis');
    expect(hints.containerKindConfidence).toBeGreaterThanOrEqual(0.95);
  });
});
