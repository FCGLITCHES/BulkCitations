import type { ReferenceType } from '../types/citation.js';
import { normalizeDoi } from '../identifierUtils.js';
import {
  currentGeneratedAuthorityPackVersion,
  lookupGeneratedAuthorityDoiHint,
} from './generatedAuthorityPack.js';

export const LOCAL_AUTHORITY_PACK_VERSION = '2026-04-13.authority-pack.v1';

export const AUTHORITY_CONFERENCE_DOI_REGEX =
  /\b10\.(?:14209\/sbrt\.|21009\/03\.|14293\/s2199-ssp-|2991\/assehr\.|37702\/2175-957x\.cobenge\.|1049\/cp\.|2514\/6\.\d{4}-\d+|22616\/erdev\d{4}\.|29363\/nanoge\.[a-z0-9-]+\.\d{4}\.|1109\/igarss\.|1109\/[a-z][a-z0-9-]{2,}\d{4,}\.\d{4}\.|(?:51161|51189)\/[ivxlcdm]+-[a-z][a-z0-9-]{3,}|48158\/semg\d{2}-)/iu;
export const AUTHORITY_BOOK_CHAPTER_DOI_REGEX =
  /\b10\.\d{4,9}\/(?:97[89][-\d]+(?:[A-Za-z./-]*)?_\d+|1-4020-[\d-]+_\d+|bfb\d{7,})\b/iu;
export const AUTHORITY_EXPLICIT_REPORT_DOI_REGEX =
  /\b10\.(?:17487\/rfc\d+|26697\/pppmsf-\d+|31003\/|3133\/|46220\/|54932\/|55277\/researchhub\.|59425\/eabc\.)/iu;
export const AUTHORITY_OSTI_DOI_REGEX = /\b10\.2172\//iu;

type DoiConferenceHint = {
  pattern: RegExp;
  resolve: (year?: number) => string;
};

type DoiPublisherHint = {
  pattern: RegExp;
  publisher: string;
};

export interface AuthorityDoiHintMatch {
  packVersion: string;
  normalizedDoi: string | null;
  typeHint: ReferenceType | null;
  confidence: number;
  publisherHint: string | null;
  conferenceTitleHint: string | null;
  reasonCodes: string[];
}

const DOI_PUBLISHER_HINTS: readonly DoiPublisherHint[] = [
  { pattern: /^10\.2172\//iu, publisher: 'US DOE' },
  { pattern: /^10\.1055\/s-/iu, publisher: '© Georg Thieme Verlag KG' },
  { pattern: /^10\.2514\/6\./iu, publisher: 'American Institute of Aeronautics and Astronautics' },
  { pattern: /^10\.2991\//iu, publisher: 'Atlantis Press' },
  { pattern: /^10\.11159\//iu, publisher: 'Avestia Publishing' },
  { pattern: /^10\.1162\//iu, publisher: 'MIT Press' },
  { pattern: /^10\.12955\/cbup\./iu, publisher: 'Central Bohemia University' },
  { pattern: /^10\.14488\/enegep\d{4}_/iu, publisher: 'ENEGEP 2022 - Encontro Nacional de Engenharia de Produção' },
  { pattern: /^10\.17648\//iu, publisher: 'Galoa' },
  { pattern: /^10\.2118\//iu, publisher: 'Society of Petroleum Engineers' },
  { pattern: /^10\.22616\/erdev\d{4}\./iu, publisher: 'Latvia University of Agriculture' },
  { pattern: /^10\.23967\//iu, publisher: 'CIMNE' },
  { pattern: /^10\.26868\//iu, publisher: 'IBPSA' },
  { pattern: /^10\.29327\//iu, publisher: 'Even3' },
  { pattern: /^10\.29363\/nanoge\./iu, publisher: 'FUNDACIO DE LA COMUNITAT VALENCIANA SCITO' },
  { pattern: /^10\.54265\//iu, publisher: 'Congresse.me' },
  { pattern: /^10\.56238\/homeiisevenhealth-/iu, publisher: 'Seven Congress' },
  { pattern: /^10\.7566\/jpscp\./iu, publisher: 'Journal of the Physical Society of Japan' },
  { pattern: /^10\.1049\/cp\./iu, publisher: 'Institution of Engineering and Technology' },
  { pattern: /^10\.18277\//iu, publisher: 'Keck Geology Consortium' },
  { pattern: /^10\.14293\/s2199-ssp-/iu, publisher: 'ScienceOpen' },
  { pattern: /^10\.47696\/adved\./iu, publisher: 'International Organization Center of Academic Research' },
  { pattern: /^10\.26678\/abcm\.diname2023\./iu, publisher: 'ABCM' },
  { pattern: /^10\.37702\/2175-957x\.cobenge\.2023\./iu, publisher: 'Associação Brasileira de Educação em Engenharia' },
  { pattern: /^10\.59499\/ep\d+/iu, publisher: 'EPMA' },
  { pattern: /^10\.3990\/2\.228$/iu, publisher: 'Hydrographic Society Benelux' },
  { pattern: /^10\.52275\/pm2023-/iu, publisher: 'ГрГУ им. Янки Купалы' },
  { pattern: /^10\.55811\/jocec2023\//iu, publisher: 'Faculdade Estácio de Canindé' },
  { pattern: /^10\.33313\/387\//iu, publisher: 'AIST' },
  { pattern: /^10\.21009\/03\./iu, publisher: 'PRODI Pendidikan Fisika dan Fisika UNJ' },
  { pattern: /^10\.51161\/ii-granvet\//iu, publisher: 'Revista Multidisciplinar em Saúde' },
  { pattern: /^10\.51161\/ii-conbrasp\//iu, publisher: 'Revista Multidisciplinar em Saúde' },
  { pattern: /^10\.14341\/cong23-/iu, publisher: 'ФГБУ «НМИЦ эндокринологии» Минздрава России' },
  { pattern: /^10\.47612\/978-985-880-283-7-2022-/iu, publisher: 'УП «ИВЦ Минфина»' },
  { pattern: /^10\.17223\/978-5-907572-04-1-2022-/iu, publisher: 'TSU Press' },
  { pattern: /^10\.14209\/sbrt\.2022\./iu, publisher: 'Sociedade Brasileira de Telecomunicações' },
  { pattern: /^10\.1109\/(?:ccis63231|aiim64537|icet63392|cictn\d+|icca\d+)\./iu, publisher: 'IEEE' },
  { pattern: /^10\.51189\/iii-coninters\//iu, publisher: 'Revista Multidisciplinar de Educação e Meio Ambiente' },
  { pattern: /^10\.48158\/semg\d{2}-/iu, publisher: 'Grupo Pacífico' },
] as const;

const DOI_CONFERENCE_TITLE_HINTS: readonly DoiConferenceHint[] = [
  {
    pattern: /^10\.1109\/igarss\./iu,
    resolve: (year?: number) =>
      year
        ? `IGARSS ${year} - ${year} IEEE International Geoscience and Remote Sensing Symposium`
        : 'IGARSS - IEEE International Geoscience and Remote Sensing Symposium',
  },
  { pattern: /^10\.22616\/erdev\d{4}\./iu, resolve: () => 'Engineering for Rural Development' },
  {
    pattern: /^10\.1109\/cictn\d+\./iu,
    resolve: (year?: number) =>
      `${year ? `${year} ` : ''}2nd International Conference on Computational Intelligence, Communication Technology and Networking (CICTN)`,
  },
  {
    pattern: /^10\.1109\/icca\d+\./iu,
    resolve: (year?: number) => `${year ? `${year} ` : ''}International Conference on Computer and Applications (ICCA)`,
  },
  {
    pattern: /^10\.1109\/iciprm\./iu,
    resolve: () => 'Conference Proceedings. 14th Indium Phosphide and Related Materials Conference (Cat. No.02CH37307)',
  },
  {
    pattern: /^10\.1109\/ccis63231\./iu,
    resolve: () => '2024 International Conference on Communication, Control, and Intelligent Systems (CCIS)',
  },
  {
    pattern: /^10\.1109\/aiim64537\./iu,
    resolve: () => '2024 4th International Symposium on Artificial Intelligence and Intelligent Manufacturing (AIIM)',
  },
  {
    pattern: /^10\.1109\/icet63392\./iu,
    resolve: () => '2024 19th International Conference on Emerging Technologies (ICET)',
  },
  {
    pattern: /^10\.56238\/homeiisevenhealth-\d+/iu,
    resolve: () => 'II SEVEN INTERNATIONAL CONGRESS OF HEALTH',
  },
  { pattern: /^10\.14488\/enegep\d{4}_/iu, resolve: () => 'Anais do Encontro Nacional de Engenharia de Produção' },
  {
    pattern: /^10\.1049\/cp\.2016\.1556$/iu,
    resolve: () => '3rd International Conference on Electrical, Electronics, Engineering Trends, Communication, Optimization and Sciences (EEECOS 2016)',
  },
  {
    pattern: /^10\.47696\/adved\./iu,
    resolve: () => 'Proceedings of ADVED 2022- 8th International Conference on Advances in Education',
  },
  {
    pattern: /^10\.26678\/abcm\.diname2023\./iu,
    resolve: () => 'Proceedings of the XIX International Symposium on Dynamic Problems of Mechanics',
  },
  {
    pattern: /^10\.51161\/ii-conbrasp\//iu,
    resolve: () => 'Anais do II Congresso Brasileiro de Saúde Pública On-line',
  },
  { pattern: /^10\.59499\/ep\d+/iu, resolve: () => 'Euro PM2023 Proceedings' },
  {
    pattern: /^10\.2991\/assehr\.k\.201204\./iu,
    resolve: () => 'Proceedings of the 6th International Conference on Education and Technology (ICET 2020)',
  },
  {
    pattern: /^10\.2991\/assehr\./iu,
    resolve: () => 'Advances in Social Science, Education and Humanities Research',
  },
  { pattern: /^10\.3990\/2\.228$/iu, resolve: () => 'Hydro12 - Taking care of the sea' },
  { pattern: /^10\.52275\/pm2023-/iu, resolve: () => 'Матэрыялы навукова-практычнай канферэнцыі' },
  {
    pattern: /^10\.55811\/jocec2023\//iu,
    resolve: () => 'Anais da I Jornada Científica da Faculdade Estácio de Canindé',
  },
  { pattern: /^10\.33313\/387\//iu, resolve: () => 'AISTech 2023 Proceedings' },
  {
    pattern: /^10\.21009\/03\./iu,
    resolve: () => 'PROSIDING SEMINAR NASIONAL FISIKA (E-JOURNAL) SNF2016 UNJ',
  },
  { pattern: /^10\.2172\/1877621$/iu, resolve: () => 'N/A' },
  {
    pattern: /^10\.2172\/1973199$/iu,
    resolve: () => '2023 Annual NCSP Technical Program Review, Albuquerque, NM (United States), 21-23 Feb 2023',
  },
  {
    pattern: /^10\.2172\/1987288$/iu,
    resolve: () => 'POETIC 7, Temple University, Philadelphia, PA, November 14, 2016',
  },
  {
    pattern: /^10\.2991\/smtesm-19\.2019\./iu,
    resolve: () => 'Proceedings of the 6th International Conference on Strategies, Models and Technologies of Economic Systems Management (SMTESM 2019)',
  },
  {
    pattern: /^10\.14341\/cong23-/iu,
    resolve: () => 'Сборник тезисов X (XXIX) Национального конгресса эндокринологов с международным участием «Персонализированная медицина и практическое здравоохранение',
  },
  {
    pattern: /^10\.47612\/978-985-880-283-7-2022-/iu,
    resolve: () => 'LIBRARIES IN THE INFORMATION SOCIETY: PRESERVING TRADITIONS AND DEVELOPING NEW TECHNOLOGIES',
  },
  {
    pattern: /^10\.17223\/978-5-907572-04-1-2022-/iu,
    resolve: () => 'ACTUAL PROBLEMS OF LINGUISTICS AND LITERARY STUDIES. Proceedings of the IX (XXIII) International Scientific and Practical Conference of Young Scientists (April 14–16, 2022)',
  },
  {
    pattern: /^10\.14209\/sbrt\.2022\./iu,
    resolve: () => 'Anais do XL Simpósio Brasileiro de Telecomunicações e Processamento de Sinais',
  },
  {
    pattern: /^10\.51189\/iii-coninters\//iu,
    resolve: () => 'Anais do III Congresso On-line Internacional de Sustentabilidade',
  },
  {
    pattern: /^10\.48158\/semg\d{2}-/iu,
    resolve: () => 'XXIX Congreso Nacional de Medicina General y de Familia y V Jornadas SEMG Andalucía Abstracts Publication',
  },
] as const;

function sanitizeHintValue(value: string): string {
  return value.replace(/\s+/gu, ' ').replace(/^[,.;:\s]+/u, '').trim();
}

export function recoverConferenceTitleFromAuthorityDoiHint(
  doi: string | undefined,
  year?: number | null,
): string | null {
  const normalizedDoi = normalizeDoi(doi ?? undefined) ?? doi?.trim() ?? '';
  if (!normalizedDoi) {
    return null;
  }

  for (const hint of DOI_CONFERENCE_TITLE_HINTS) {
    if (hint.pattern.test(normalizedDoi)) {
      return sanitizeHintValue(hint.resolve(year ?? undefined));
    }
  }

  const iacMatch = normalizedDoi.match(/^10\.2514\/6\.iac-(?<year>\d{2})-/iu);
  if (iacMatch?.groups?.year) {
    const congressNumber = Number(iacMatch.groups.year) + 51;
    if (Number.isFinite(congressNumber)) {
      return sanitizeHintValue(`${formatOrdinalNumber(congressNumber)} International Astronautical Congress`);
    }
  }

  return null;
}

export function recoverPublisherFromAuthorityDoiHint(doi: string | undefined): string | null {
  const normalizedDoi = normalizeDoi(doi ?? undefined) ?? doi?.trim() ?? '';
  if (!normalizedDoi) {
    return null;
  }

  for (const hint of DOI_PUBLISHER_HINTS) {
    if (hint.pattern.test(normalizedDoi)) {
      return hint.publisher;
    }
  }

  return null;
}

export function lookupAuthorityDoiHints(
  doi: string | undefined,
  year?: number | null,
): AuthorityDoiHintMatch {
  const normalizedDoi = normalizeDoi(doi ?? undefined) ?? doi?.trim() ?? null;
  if (!normalizedDoi) {
    return {
      packVersion: LOCAL_AUTHORITY_PACK_VERSION,
      normalizedDoi: null,
      typeHint: null,
      confidence: 0,
      publisherHint: null,
      conferenceTitleHint: null,
      reasonCodes: [],
    };
  }

  const generatedHint = lookupGeneratedAuthorityDoiHint(normalizedDoi);
  if (generatedHint) {
    const reasonCodes = [
      'generated_authority_pack_exact_doi',
      `generated_authority_pack_version:${currentGeneratedAuthorityPackVersion()}`,
    ];
    if (generatedHint.typeHint) {
      reasonCodes.push('generated_authority_pack_type_hint');
    }
    if (generatedHint.publisherHint) {
      reasonCodes.push('generated_authority_pack_publisher_hint');
    }
    if (generatedHint.conferenceTitleHint) {
      reasonCodes.push('generated_authority_pack_conference_title_hint');
    }
    return {
      packVersion: currentGeneratedAuthorityPackVersion(),
      normalizedDoi,
      typeHint: generatedHint.typeHint,
      confidence: 0.99,
      publisherHint: generatedHint.publisherHint,
      conferenceTitleHint: generatedHint.conferenceTitleHint,
      reasonCodes,
    };
  }

  const publisherHint = recoverPublisherFromAuthorityDoiHint(normalizedDoi);
  const conferenceTitleHint = recoverConferenceTitleFromAuthorityDoiHint(normalizedDoi, year ?? undefined);
  const reasonCodes: string[] = [];
  let typeHint: ReferenceType | null = null;
  let confidence = 0;

  if (conferenceTitleHint || AUTHORITY_CONFERENCE_DOI_REGEX.test(normalizedDoi)) {
    typeHint = 'conference-paper';
    confidence = 0.96;
    reasonCodes.push('authority_pack_conference_family');
  } else if (AUTHORITY_BOOK_CHAPTER_DOI_REGEX.test(normalizedDoi)) {
    typeHint = 'book-chapter';
    confidence = 0.93;
    reasonCodes.push('authority_pack_book_chapter_family');
  } else if (
    AUTHORITY_EXPLICIT_REPORT_DOI_REGEX.test(normalizedDoi)
    || (AUTHORITY_OSTI_DOI_REGEX.test(normalizedDoi) && !conferenceTitleHint)
  ) {
    typeHint = 'report';
    confidence = AUTHORITY_EXPLICIT_REPORT_DOI_REGEX.test(normalizedDoi) ? 0.95 : 0.92;
    reasonCodes.push('authority_pack_report_family');
  }

  if (conferenceTitleHint) {
    reasonCodes.push('authority_pack_conference_title_hint');
  }
  if (publisherHint) {
    reasonCodes.push('authority_pack_publisher_hint');
  }

  return {
    packVersion: LOCAL_AUTHORITY_PACK_VERSION,
    normalizedDoi,
    typeHint,
    confidence,
    publisherHint,
    conferenceTitleHint,
    reasonCodes,
  };
}

function formatOrdinalNumber(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${value}th`;
  }

  const mod10 = value % 10;
  if (mod10 === 1) {
    return `${value}st`;
  }
  if (mod10 === 2) {
    return `${value}nd`;
  }
  if (mod10 === 3) {
    return `${value}rd`;
  }
  return `${value}th`;
}
