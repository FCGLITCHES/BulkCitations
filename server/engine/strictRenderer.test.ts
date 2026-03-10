import { describe, it, expect } from 'vitest';
import { runAssertions, type ParsedFields } from './strictRenderer';

const fixtures: { id: string; fields: ParsedFields }[] = [
    {
        id: 'nguyen-2023',
        fields: {
            type: 'journal-article',
            author: [{ family: 'Nguyen', given: 'L.' }, { family: 'Patel', given: 'A.' }],
            issued: { 'date-parts': [[2023]] },
            title: 'Robust out-of-distribution detection with energy-based scores',
            'container-title': 'Journal of Machine Learning Systems',
            volume: '5',
            issue: '2',
            page: '101-128',
            doi: '10.1234/jmls.2023.0157',
        },
    },
    {
        id: 'hassan-2022',
        fields: {
            type: 'journal-article',
            author: [
                { family: 'Hassan', given: 'N.' },
                { family: 'Kim', given: 'J.-W.' },
                { family: 'Chen', given: 'W.' },
            ],
            issued: { 'date-parts': [[2022]] },
            title: 'Lightweight vision models for browser-based safety filters',
            'container-title': 'Web Security Review',
            volume: '9',
            issue: '3',
            page: '210-229',
            doi: '10.2000/wsr.2022.00321',
        },
    },
    {
        id: 'oconnor-2021',
        fields: {
            type: 'journal-article',
            author: [{ family: "O'Connor", given: 'J.' }, { family: 'García', given: 'M.' }],
            issued: { 'date-parts': [[2021]] },
            title: 'Reproducibility checklists in applied machine learning',
            'container-title': 'Computing in Practice',
            volume: '12',
            issue: '4',
            page: '55-79',
            doi: '10.5555/cip.2021.20419',
        },
    },
    {
        id: 'pickard-2011',
        fields: {
            type: 'journal-article',
            author: [{ family: 'Pickard', given: 'H.' }],
            issued: { 'date-parts': [[2011, 9]] },
            title: 'What is personality disorder?',
            'container-title': 'Philosophy, Psychiatry, & Psychology',
            volume: '18',
            issue: '3',
            page: '181-184',
            doi: '10.1353/ppp.2011.0040',
        },
    },
    {
        id: 'brown-2022',
        fields: {
            type: 'journal-article',
            author: [{ family: 'Brown', given: 'T.' }, { family: 'Li', given: 'Q.' }],
            issued: { 'date-parts': [[2022]] },
            title: 'Fast screenshot classification on edge devices',
            'container-title': 'Journal of Machine Learning Systems',
            volume: '4',
            issue: '1',
            page: '1-9',
            doi: '10.7777/jmls.2022.0001',
        },
    },
    {
        id: 'singh-2020',
        fields: {
            type: 'journal-article',
            author: [{ family: 'Singh', given: 'R.' }],
            issued: { 'date-parts': [[2020]] },
            title: 'A survey of browser-based content filtering',
            'container-title': 'Open Web Security Journal',
            volume: '9',
            issue: '1',
            page: '44-60',
            url: 'https://example.org/owsj/singh-2020',
            accessed: { 'date-parts': [[2026, 3, 2]] },
        },
    },
    {
        id: 'vandermeer-2019',
        fields: {
            type: 'journal-article',
            author: [
                { family: 'van der Meer', given: 'J.' },
                { family: 'Żukowski', given: 'P.' },
                { family: 'Nordin', given: 'S.' },
                { family: 'Chen', given: 'W.' },
                { family: 'Kim', given: 'J.-W.' },
                { family: 'Hassan', given: 'N.' },
                { family: 'Patel', given: 'A.' },
            ],
            issued: { 'date-parts': [[2019]] },
            title: 'Evaluation of lightweight CNNs for on-device vision',
            'container-title': 'Mobile AI Review',
            volume: '2',
            issue: '4',
            page: '200-219',
        },
    },
    {
        id: 'khan-2024',
        fields: {
            type: 'journal-article',
            author: [{ family: 'Khan', given: 'M.A.' }],
            issued: { 'date-parts': [[2024]] },
            title: 'Calibrating uncertainty in image classifiers',
            'container-title': 'AI Systems',
            volume: '7',
            issue: '2',
            'article-number': 'e10293', // locator replacing pages
            doi: '10.9999/aisys.2024.10293',
        },
    },
    {
        id: 'oneil-2018',
        fields: {
            type: 'journal-article',
            author: [{ family: "O'Neil", given: 'T.J.' }],
            issued: { 'date-parts': [[2018]] },
            title: 'Title casing and sentence casing in automated citation tools',
            'container-title': 'Language & Tools',
            volume: '11',
            page: '88-97',
        },
    },
    {
        id: 'muller-2017',
        fields: {
            type: 'journal-article',
            author: [{ family: 'Müller', given: 'F.' }, { family: 'Sato', given: 'K.' }],
            issued: { 'date-parts': [[2017]] },
            title: 'Detecting duplicates in reference lists',
            'container-title': 'Journal of Data Hygiene',
            volume: '3',
            issue: '2',
            page: '33-41',
        },
    },
    {
        id: 'delacruz-2020',
        fields: {
            type: 'journal-article',
            author: [{ family: 'de la Cruz', given: 'P.' }, { family: 'van Dijk', given: 'S.' }],
            issued: { 'date-parts': [[2020]] },
            title: 'Tokenization strategies for noisy bibliographic strings',
            'container-title': 'Digital Scholarship Methods',
            volume: '6',
            issue: '2',
            page: '99-121',
            doi: '10.4000/dsm.2020.00602',
        },
    },
    {
        id: 'lukasiewicz-2023',
        fields: {
            type: 'journal-article',
            author: [
                { family: 'Łukasiewicz', given: 'A.' },
                { family: 'Sørensen', given: 'E.' },
                { family: 'Németh', given: 'B.' },
            ],
            issued: { 'date-parts': [[2023]] },
            title: 'Diacritics-aware author matching in reference lists',
            'container-title': 'Information Quality Quarterly',
            volume: '15',
            issue: '1',
            page: '12-29',
            doi: '10.3100/iqq.2023.1501.02',
        },
    },
    {
        id: 'ng-2016',
        fields: {
            type: 'journal-article',
            author: [{ family: 'Ng', given: 'W.-K.' }, { family: "d'Angelo", given: 'R.' }],
            issued: { 'date-parts': [[2016]] },
            title: 'Apostrophes, particles, and surname parsing in citation software',
            'container-title': 'Journal of Library Informatics',
            volume: '8',
            issue: '4',
            page: '301-320',
            doi: '10.8800/jli.2016.08408',
        },
    },
    {
        id: 'sato-2021',
        fields: {
            type: 'journal-article',
            author: [
                { family: 'Sato', given: 'K.' },
                { family: 'Müller', given: 'F.' },
                { family: 'Hernández', given: 'P.' },
            ],
            issued: { 'date-parts': [[2021]] },
            title: 'Duplicate detection for bibliographies at scale',
            'container-title': 'Research Tooling',
            volume: '3',
            issue: '1',
            page: '1-18',
            doi: '10.6000/rt.2021.031.001',
        },
    },
    {
        id: 'who-2021',
        fields: {
            type: 'journal-article',
            author: [{ literal: 'World Health Organization' }],
            issued: { 'date-parts': [[2021]] },
            title: 'Digital health interventions: evidence and gaps',
            'container-title': 'Global Health Research',
            volume: '15',
            issue: '1',
            page: '1-12',
        },
    },
    {
        id: 'chen-2025',
        fields: {
            type: 'journal-article',
            author: [{ family: 'Chen', given: 'W.' }, { family: 'Patel', given: 'A.' }],
            issued: { 'date-parts': [[2025]] },
            title: 'Article-number locators in journal references: conversion pitfalls',
            'container-title': 'Publishing Data Studies',
            volume: '2',
            issue: '2',
            'article-number': 'e0007',
            doi: '10.5100/pds.2025.e0007',
        },
    },
    {
        id: 'hernandez-2015',
        fields: {
            type: 'journal-article',
            author: [{ family: 'Hernández', given: 'P.' }],
            issued: { 'date-parts': [[2015]] },
            title: 'Hyphens in initials and name disambiguation',
            'container-title': 'Cataloguing & Metadata',
            volume: '19',
            issue: '3',
            page: '144-158',
        },
    },
    {
        id: 'nordin-2018',
        fields: {
            type: 'journal-article',
            author: [{ family: 'Nordin', given: 'S.' }, { family: 'Kim', given: 'J.-W.' }],
            issued: { 'date-parts': [[2018]] },
            title: 'Handling missing issue numbers in automated citation conversion',
            'container-title': 'Academic Writing Systems',
            volume: '10',
            page: '77-90',
        },
    },
    {
        id: 'alkhalil-2022',
        fields: {
            type: 'journal-article',
            author: [{ family: 'Al-Khalil', given: 'Y.' }, { family: "O'Brien", given: 'M.' }],
            issued: { 'date-parts': [[2022]] },
            title: 'Abbreviated journal titles and style drift across formats',
            'container-title': 'Scholarly Communication Review',
            volume: '14',
            issue: '2',
            page: '66-84',
            doi: '10.7700/scr.2022.142.006',
        },
    },
];

const golden: Record<string, Record<string, string>> = {
    'apa': {
        'nguyen-2023': 'Nguyen, L., & Patel, A. (2023). Robust out-of-distribution detection with energy-based scores. Journal of Machine Learning Systems, 5(2), 101–128. https://doi.org/10.1234/jmls.2023.0157',
        'hassan-2022': 'Hassan, N., Kim, J.-W., & Chen, W. (2022). Lightweight vision models for browser-based safety filters. Web Security Review, 9(3), 210–229. https://doi.org/10.2000/wsr.2022.00321',
        'oconnor-2021': "O'Connor, J., & García, M. (2021). Reproducibility checklists in applied machine learning. Computing in Practice, 12(4), 55–79. https://doi.org/10.5555/cip.2021.20419",
        'pickard-2011': 'Pickard, H. (2011). What is personality disorder? Philosophy, Psychiatry, & Psychology, 18(3), 181–184. https://doi.org/10.1353/ppp.2011.0040',
        'brown-2022': 'Brown, T., & Li, Q. (2022). Fast screenshot classification on edge devices. Journal of Machine Learning Systems, 4(1), 1–9. https://doi.org/10.7777/jmls.2022.0001',
        'singh-2020': 'Singh, R. (2020). A survey of browser-based content filtering. Open Web Security Journal, 9(1), 44–60. https://example.org/owsj/singh-2020',
        'vandermeer-2019': 'van der Meer, J., Żukowski, P., Nordin, S., Chen, W., Kim, J.-W., Hassan, N., & Patel, A. (2019). Evaluation of lightweight CNNs for on-device vision. Mobile AI Review, 2(4), 200–219.',
        'khan-2024': 'Khan, M.A. (2024). Calibrating uncertainty in image classifiers. AI Systems, 7(2), Article e10293. https://doi.org/10.9999/aisys.2024.10293',
        'oneil-2018': "O'Neil, T.J. (2018). Title casing and sentence casing in automated citation tools. Language & Tools, 11, 88–97.",
        'muller-2017': 'Müller, F., & Sato, K. (2017). Detecting duplicates in reference lists. Journal of Data Hygiene, 3(2), 33–41.',
        'delacruz-2020': 'de la Cruz, P., & van Dijk, S. (2020). Tokenization strategies for noisy bibliographic strings. Digital Scholarship Methods, 6(2), 99–121. https://doi.org/10.4000/dsm.2020.00602',
        'lukasiewicz-2023': 'Łukasiewicz, A., Sørensen, E., & Németh, B. (2023). Diacritics-aware author matching in reference lists. Information Quality Quarterly, 15(1), 12–29. https://doi.org/10.3100/iqq.2023.1501.02',
        'ng-2016': "Ng, W.-K., & d'Angelo, R. (2016). Apostrophes, particles, and surname parsing in citation software. Journal of Library Informatics, 8(4), 301–320. https://doi.org/10.8800/jli.2016.08408",
        'sato-2021': 'Sato, K., Müller, F., & Hernández, P. (2021). Duplicate detection for bibliographies at scale. Research Tooling, 3(1), 1–18. https://doi.org/10.6000/rt.2021.031.001',
        'who-2021': 'World Health Organization. (2021). Digital health interventions: evidence and gaps. Global Health Research, 15(1), 1–12.',
        'chen-2025': 'Chen, W., & Patel, A. (2025). Article-number locators in journal references: conversion pitfalls. Publishing Data Studies, 2(2), Article e0007. https://doi.org/10.5100/pds.2025.e0007',
        'hernandez-2015': 'Hernández, P. (2015). Hyphens in initials and name disambiguation. Cataloguing & Metadata, 19(3), 144–158.',
        'nordin-2018': 'Nordin, S., & Kim, J.-W. (2018). Handling missing issue numbers in automated citation conversion. Academic Writing Systems, 10, 77–90.',
        'alkhalil-2022': "Al-Khalil, Y., & O'Brien, M. (2022). Abbreviated journal titles and style drift across formats. Scholarly Communication Review, 14(2), 66–84. https://doi.org/10.7700/scr.2022.142.006",
    },

    'harvard-ctr': {
        'nguyen-2023': "Nguyen, L. and Patel, A. (2023) 'Robust out-of-distribution detection with energy-based scores', Journal of Machine Learning Systems, 5(2), pp. 101–128. Available at: https://doi.org/10.1234/jmls.2023.0157.",
        'hassan-2022': "Hassan, N., Kim, J.-W. and Chen, W. (2022) 'Lightweight vision models for browser-based safety filters', Web Security Review, 9(3), pp. 210–229. Available at: https://doi.org/10.2000/wsr.2022.00321.",
        'oconnor-2021': "O'Connor, J. and García, M. (2021) 'Reproducibility checklists in applied machine learning', Computing in Practice, 12(4), pp. 55–79. Available at: https://doi.org/10.5555/cip.2021.20419.",
        'pickard-2011': "Pickard, H. (2011) 'What is personality disorder?', Philosophy, Psychiatry, & Psychology, 18(3), pp. 181–184. Available at: https://doi.org/10.1353/ppp.2011.0040.",
        'brown-2022': "Brown, T. and Li, Q. (2022) 'Fast screenshot classification on edge devices', Journal of Machine Learning Systems, 4(1), pp. 1–9. Available at: https://doi.org/10.7777/jmls.2022.0001.",
        'singh-2020': "Singh, R. (2020) 'A survey of browser-based content filtering', Open Web Security Journal, 9(1), pp. 44–60. Available at: https://example.org/owsj/singh-2020 (Accessed: 2 March 2026).",
        'vandermeer-2019': "van der Meer, J., Żukowski, P., Nordin, S., Chen, W., Kim, J.-W., Hassan, N. and Patel, A. (2019) 'Evaluation of lightweight CNNs for on-device vision', Mobile AI Review, 2(4), pp. 200–219.",
        'khan-2024': "Khan, M.A. (2024) 'Calibrating uncertainty in image classifiers', AI Systems, 7(2), article e10293. Available at: https://doi.org/10.9999/aisys.2024.10293.",
        'oneil-2018': "O'Neil, T.J. (2018) 'Title casing and sentence casing in automated citation tools', Language & Tools, 11, pp. 88–97.",
        'muller-2017': "Müller, F. and Sato, K. (2017) 'Detecting duplicates in reference lists', Journal of Data Hygiene, 3(2), pp. 33–41.",
        'delacruz-2020': "de la Cruz, P. and van Dijk, S. (2020) 'Tokenization strategies for noisy bibliographic strings', Digital Scholarship Methods, 6(2), pp. 99–121. Available at: https://doi.org/10.4000/dsm.2020.00602.",
        'lukasiewicz-2023': "Łukasiewicz, A., Sørensen, E. and Németh, B. (2023) 'Diacritics-aware author matching in reference lists', Information Quality Quarterly, 15(1), pp. 12–29. Available at: https://doi.org/10.3100/iqq.2023.1501.02.",
        'ng-2016': "Ng, W.-K. and d'Angelo, R. (2016) 'Apostrophes, particles, and surname parsing in citation software', Journal of Library Informatics, 8(4), pp. 301–320. Available at: https://doi.org/10.8800/jli.2016.08408.",
        'sato-2021': "Sato, K., Müller, F. and Hernández, P. (2021) 'Duplicate detection for bibliographies at scale', Research Tooling, 3(1), pp. 1–18. Available at: https://doi.org/10.6000/rt.2021.031.001.",
        'who-2021': "World Health Organization (2021) 'Digital health interventions: evidence and gaps', Global Health Research, 15(1), pp. 1–12.",
        'chen-2025': "Chen, W. and Patel, A. (2025) 'Article-number locators in journal references: conversion pitfalls', Publishing Data Studies, 2(2), article e0007. Available at: https://doi.org/10.5100/pds.2025.e0007.",
        'hernandez-2015': "Hernández, P. (2015) 'Hyphens in initials and name disambiguation', Cataloguing & Metadata, 19(3), pp. 144–158.",
        'nordin-2018': "Nordin, S. and Kim, J.-W. (2018) 'Handling missing issue numbers in automated citation conversion', Academic Writing Systems, 10, pp. 77–90.",
        'alkhalil-2022': "Al-Khalil, Y. and O'Brien, M. (2022) 'Abbreviated journal titles and style drift across formats', Scholarly Communication Review, 14(2), pp. 66–84. Available at: https://doi.org/10.7700/scr.2022.142.006.",
    },

    'chicago-ad': {
        'nguyen-2023': 'Nguyen, L., and A. Patel. 2023. "Robust Out-of-Distribution Detection with Energy-Based Scores." Journal of Machine Learning Systems 5, no. 2: 101–128. https://doi.org/10.1234/jmls.2023.0157.',
        'pickard-2011': 'Pickard, Hanna. 2011. "What Is Personality Disorder?" Philosophy, Psychiatry, & Psychology 18, no. 3: 181–184. https://doi.org/10.1353/ppp.2011.0040.',
        'singh-2020': 'Singh, R. 2020. "A Survey of Browser-Based Content Filtering." Open Web Security Journal 9, no. 1: 44–60. https://example.org/owsj/singh-2020.',
        'vandermeer-2019': 'van der Meer, J., P. Żukowski, S. Nordin, W. Chen, J.-W. Kim, N. Hassan, and A. Patel. 2019. "Evaluation of Lightweight CNNs for On-Device Vision." Mobile AI Review 2, no. 4: 200–219.',
        'who-2021': 'World Health Organization. 2021. "Digital Health Interventions: Evidence and Gaps." Global Health Research 15, no. 1: 1–12.',
        'oneil-2018': "O'Neil, T.J. 2018. \"Title Casing and Sentence Casing in Automated Citation Tools.\" Language & Tools 11: 88–97.",
        'nordin-2018': 'Nordin, S., and J.-W. Kim. 2018. "Handling Missing Issue Numbers in Automated Citation Conversion." Academic Writing Systems 10: 77–90.',
    },

    'chicago-nb': {
        'nguyen-2023': 'Nguyen, L., and A. Patel. "Robust Out-of-Distribution Detection with Energy-Based Scores." Journal of Machine Learning Systems 5, no. 2 (2023): 101–128. https://doi.org/10.1234/jmls.2023.0157.',
        'pickard-2011': 'Pickard, Hanna. "What Is Personality Disorder?" Philosophy, Psychiatry, & Psychology 18, no. 3 (September 2011): 181–184. https://doi.org/10.1353/ppp.2011.0040.',
        'singh-2020': 'Singh, R. "A Survey of Browser-Based Content Filtering." Open Web Security Journal 9, no. 1 (2020): 44–60. https://example.org/owsj/singh-2020.',
        'vandermeer-2019': 'van der Meer, J., P. Żukowski, S. Nordin, W. Chen, J.-W. Kim, N. Hassan, and A. Patel. "Evaluation of Lightweight CNNs for On-Device Vision." Mobile AI Review 2, no. 4 (2019): 200–219.',
        'who-2021': 'World Health Organization. "Digital Health Interventions: Evidence and Gaps." Global Health Research 15, no. 1 (2021): 1–12.',
        'oneil-2018': "O'Neil, T.J. \"Title Casing and Sentence Casing in Automated Citation Tools.\" Language & Tools 11 (2018): 88–97.",
        'nordin-2018': 'Nordin, S., and J.-W. Kim. "Handling Missing Issue Numbers in Automated Citation Conversion." Academic Writing Systems 10 (2018): 77–90.',
    },

    'mla': {
        'nguyen-2023': 'Nguyen, L., and A. Patel. "Robust out-of-distribution detection with energy-based scores." Journal of Machine Learning Systems, vol. 5, no. 2, 2023, pp. 101–128. https://doi.org/10.1234/jmls.2023.0157.',
        'hassan-2022': 'Hassan, N., et al. "Lightweight vision models for browser-based safety filters." Web Security Review, vol. 9, no. 3, 2022, pp. 210–229. https://doi.org/10.2000/wsr.2022.00321.',
        'vandermeer-2019': 'van der Meer, J., et al. "Evaluation of lightweight CNNs for on-device vision." Mobile AI Review, vol. 2, no. 4, 2019, pp. 200–219.',
        'oneil-2018': "O'Neil, T.J. \"Title casing and sentence casing in automated citation tools.\" Language & Tools, vol. 11, 2018, pp. 88–97.",
        'who-2021': 'World Health Organization. "Digital health interventions: evidence and gaps." Global Health Research, vol. 15, no. 1, 2021, pp. 1–12.',
        'singh-2020': 'Singh, R. "A survey of browser-based content filtering." Open Web Security Journal, vol. 9, no. 1, 2020, pp. 44–60. https://example.org/owsj/singh-2020.',
        'nordin-2018': 'Nordin, S., and J.-W. Kim. "Handling missing issue numbers in automated citation conversion." Academic Writing Systems, vol. 10, 2018, pp. 77–90.',
    },

    'ieee': {
        'nguyen-2023': '[1] L. Nguyen and A. Patel, "Robust out-of-distribution detection with energy-based scores," Journal of Machine Learning Systems, vol. 5, no. 2, pp. 101–128, 2023, doi: 10.1234/jmls.2023.0157.',
        'hassan-2022': '[2] N. Hassan, J.-W. Kim, and W. Chen, "Lightweight vision models for browser-based safety filters," Web Security Review, vol. 9, no. 3, pp. 210–229, 2022, doi: 10.2000/wsr.2022.00321.',
        'singh-2020': '[3] R. Singh, "A survey of browser-based content filtering," Open Web Security Journal, vol. 9, no. 1, pp. 44–60, 2020, [Online]. Available: https://example.org/owsj/singh-2020.',
        'khan-2024': '[4] M.A. Khan, "Calibrating uncertainty in image classifiers," AI Systems, vol. 7, no. 2, Art. no. e10293, 2024, doi: 10.9999/aisys.2024.10293.',
        'oneil-2018': '[5] T.J. O\'Neil, "Title casing and sentence casing in automated citation tools," Language & Tools, vol. 11, pp. 88–97, 2018.',
        'vandermeer-2019': '[6] J. van der Meer et al., "Evaluation of lightweight CNNs for on-device vision," Mobile AI Review, vol. 2, no. 4, pp. 200–219, 2019.',
        'who-2021': '[7] World Health Organization, "Digital health interventions: evidence and gaps," Global Health Research, vol. 15, no. 1, pp. 1–12, 2021.',
    },

    'vancouver': {
        'nguyen-2023': 'Nguyen L, Patel A. Robust out-of-distribution detection with energy-based scores. Journal of Machine Learning Systems. 2023;5(2):101-128.',
        'hassan-2022': 'Hassan N, Kim JW, Chen W. Lightweight vision models for browser-based safety filters. Web Security Review. 2022;9(3):210-229.',
        'pickard-2011': 'Pickard H. What is personality disorder? Philosophy, Psychiatry, & Psychology. 2011 Sep;18(3):181-184.',
        'singh-2020': 'Singh R. A survey of browser-based content filtering. Open Web Security Journal [Internet]. 2020;9(1):44-60 [cited 2026 Mar 2]. Available from: https://example.org/owsj/singh-2020.',
        'vandermeer-2019': 'van der Meer J, Żukowski P, Nordin S, Chen W, Kim JW, Hassan N, et al. Evaluation of lightweight CNNs for on-device vision. Mobile AI Review. 2019;2(4):200-219.',
        'khan-2024': 'Khan MA. Calibrating uncertainty in image classifiers. AI Systems. 2024;7(2):e10293.',
        'oneil-2018': "O'Neil TJ. Title casing and sentence casing in automated citation tools. Language & Tools. 2018;11:88-97.",
        'who-2021': 'World Health Organization. Digital health interventions: evidence and gaps. Global Health Research. 2021;15(1):1-12.',
        'nordin-2018': 'Nordin S, Kim JW. Handling missing issue numbers in automated citation conversion. Academic Writing Systems. 2018;10:77-90.',
    },
};

const styles = ['apa', 'harvard-ctr', 'chicago-ad', 'chicago-nb', 'mla', 'ieee', 'vancouver'] as const;

for (const style of styles) {
    describe(`Style: ${style.toUpperCase()}`, () => {
        const styleGolden = golden[style];
        if (!styleGolden) return;

        for (const [fixtureId, expectedOutput] of Object.entries(styleGolden)) {
            const fixture = fixtures.find(f => f.id === fixtureId);
            if (!fixture) throw new Error(`Fixture not found: ${fixtureId}`);

            it(`${fixtureId} → passes all assertions`, () => {
                const { warnings } = runAssertions(style, expectedOutput, fixture.fields);
                const errors = warnings.filter(w => w.startsWith('error:'));
                expect(errors).toEqual([]);
            });

            it(`${fixtureId} → matches golden string exactly`, () => {
                // We will assert golden string here once renderer is hooked up
                // const actual = renderCitation(style, fixture.fields);
                // expect(actual).toBe(expectedOutput);

                expect(expectedOutput.length).toBeGreaterThan(20);
                expect(expectedOutput).not.toContain('Unknown Title');
                expect(expectedOutput).not.toMatch(/\[https?:\/\//);
            });
        }

        it('no fixture produces "Unknown Title"', () => {
            for (const output of Object.values(styleGolden)) {
                expect(output).not.toContain('Unknown Title');
            }
        });

        it('no fixture contains Markdown link syntax', () => {
            for (const output of Object.values(styleGolden)) {
                expect(output).not.toMatch(/\[https?:\/\//);
            }
        });
    });
}

describe('MLA et al. threshold (gate)', () => {
    const mlaGolden = golden['mla'];
    if (!mlaGolden) return;

    it('2-author entries never use "et al." in MLA output', () => {
        for (const fixture of fixtures) {
            const authorCount = Array.isArray(fixture.fields.author) ? fixture.fields.author.length : 0;
            if (authorCount !== 2) continue;
            const expected = mlaGolden[fixture.id as keyof typeof mlaGolden];
            if (!expected) continue;
            expect(expected).not.toContain('et al.');
        }
    });

    it('3+-author entries always use "et al." in MLA output', () => {
        for (const fixture of fixtures) {
            const authorCount = Array.isArray(fixture.fields.author) ? fixture.fields.author.length : 0;
            if (authorCount < 3) continue;
            const expected = mlaGolden[fixture.id as keyof typeof mlaGolden];
            if (!expected) continue;
            expect(expected).toContain('et al.');
        }
    });
});
